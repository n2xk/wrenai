#!/usr/bin/env python3
"""Streaming transforms for local TiDB seed data derived from seed_data_refer.

The reference dumps keep their source database table names. The local business
schema follows the v1.3 design DDL, where several product-side tables are
renamed to dim_* tables and `game` has fewer columns than the exported source.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable, Iterator

ROOT = Path(__file__).resolve().parent
DEFAULT_REFERENCE_DIR = ROOT / "seed_data_refer"
DEFAULT_LOCAL_SEED_DIR = ROOT / "seed_data_local"
DEFAULT_REGRESSION_OVERLAY_FILE = DEFAULT_LOCAL_SEED_DIR / "regression_fixture.sql"
DEFAULT_SUPPLEMENTAL_SEED_FILES = [ROOT / "external-data" / "full_external_metrics_daily.sql"]
DEFAULT_BATCH_SIZE = 1000

TABLE_RENAMES = {
    "report_channel_data_percent_config": "dim_report_channel_data_percent_config",
    "channel_player_statistics_of_day": "dim_channel_player_statistics_of_day",
    "game_line_series": "dim_game_line_series",
    "game_type": "dim_game_type",
    "game_line": "dim_game_line",
    "game": "dim_game",
    "vip": "dim_vip",
}

COLUMNS_TO_DROP_BY_TABLE = {
    "game": {"high_bonus_flag", "high_multiple_flag", "game_line_seq"},
    "tenant_plat": {"rebate_agent_h5_img_url", "rebate_agent_pc_img_url"},
}
INSERT_RE = re.compile(
    r"^(?P<prefix>\s*INSERT\s+INTO\s+)`?(?P<table>[\w.]+)`?\s*"
    r"\((?P<columns>.*?)\)\s+VALUES\s*(?P<values>.*);\s*$",
    re.IGNORECASE | re.DOTALL,
)


def split_csv_top_level(value: str) -> list[str]:
    items: list[str] = []
    current: list[str] = []
    quote: str | None = None
    escaped = False
    depth = 0
    for char in value:
        if quote:
            current.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in {"'", '"', "`"}:
            quote = char
            current.append(char)
            continue
        if char == "(":
            depth += 1
            current.append(char)
            continue
        if char == ")":
            depth -= 1
            current.append(char)
            continue
        if char == "," and depth == 0:
            items.append("".join(current).strip())
            current = []
            continue
        current.append(char)
    if current:
        items.append("".join(current).strip())
    return items


def split_value_tuples(values_sql: str) -> list[str]:
    tuples: list[str] = []
    current: list[str] = []
    quote: str | None = None
    escaped = False
    depth = 0
    for char in values_sql.strip():
        if quote:
            current.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in {"'", '"'}:
            quote = char
            current.append(char)
            continue
        if char == "(":
            if depth > 0:
                current.append(char)
            depth += 1
            continue
        if char == ")":
            depth -= 1
            if depth == 0:
                tuples.append("".join(current).strip())
                current = []
            else:
                current.append(char)
            continue
        if char == "," and depth == 0:
            continue
        current.append(char)
    return tuples


def parse_columns(columns_sql: str) -> list[str]:
    return [item.strip().strip("`") for item in split_csv_top_level(columns_sql)]


def quote_columns(columns: Iterable[str]) -> str:
    return ", ".join(f"`{column}`" for column in columns)


def transform_insert_parts(statement: str) -> tuple[str, str, str, str] | None:
    match = INSERT_RE.match(statement.strip())
    if not match:
        return None

    source_table = match.group("table")
    target_table = TABLE_RENAMES.get(source_table, source_table)

    columns_to_drop = COLUMNS_TO_DROP_BY_TABLE.get(source_table, set())
    if not columns_to_drop:
        return (
            match.group("prefix"),
            target_table,
            match.group("columns").strip(),
            match.group("values").strip(),
        )

    columns = parse_columns(match.group("columns"))
    keep_indexes = [
        index for index, column in enumerate(columns) if column not in columns_to_drop
    ]
    kept_columns = [columns[index] for index in keep_indexes]
    transformed_rows: list[str] = []
    for tuple_sql in split_value_tuples(match.group("values")):
        values = split_csv_top_level(tuple_sql)
        if len(values) != len(columns):
            raise ValueError(
                f"{source_table} INSERT has {len(values)} values but {len(columns)} columns"
            )
        transformed_rows.append(
            "(" + ", ".join(values[index] for index in keep_indexes) + ")"
        )
    return (
        match.group("prefix"),
        target_table,
        quote_columns(kept_columns),
        ", ".join(transformed_rows),
    )


def render_insert_parts(parts: tuple[str, str, str, str]) -> str:
    prefix, table, columns, values = parts
    return f"{prefix}`{table}` ({columns}) VALUES {values};"


def transform_insert_statement(statement: str) -> str | None:
    parts = transform_insert_parts(statement)
    return render_insert_parts(parts) if parts else None


def split_sql_statements(sql_text: str) -> Iterator[str]:
    current: list[str] = []
    quote: str | None = None
    escaped = False
    in_line_comment = False
    in_block_comment = False
    i = 0
    while i < len(sql_text):
        char = sql_text[i]
        nxt = sql_text[i + 1] if i + 1 < len(sql_text) else ""
        if in_line_comment:
            current.append(char)
            if char == "\n":
                in_line_comment = False
            i += 1
            continue
        if in_block_comment:
            current.append(char)
            if char == "*" and nxt == "/":
                current.append(nxt)
                in_block_comment = False
                i += 2
            else:
                i += 1
            continue
        if quote:
            current.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            i += 1
            continue
        if char == "-" and nxt == "-":
            current.append(char)
            current.append(nxt)
            in_line_comment = True
            i += 2
            continue
        if char == "/" and nxt == "*":
            current.append(char)
            current.append(nxt)
            in_block_comment = True
            i += 2
            continue
        if char in {"'", '"', "`"}:
            quote = char
            current.append(char)
            i += 1
            continue
        if char == ";":
            statement = "".join(current).strip()
            if statement:
                yield statement
            current = []
            i += 1
            continue
        current.append(char)
        i += 1
    tail = "".join(current).strip()
    if tail:
        yield tail


def transform_table_references(statement: str) -> str:
    transformed = statement
    for source_table, target_table in TABLE_RENAMES.items():
        transformed = re.sub(
            rf"(\b(?:FROM|JOIN|UPDATE|INTO|TABLE)\s+)`?{re.escape(source_table)}`?\b",
            rf"\1`{target_table}`",
            transformed,
            flags=re.IGNORECASE,
        )
    return transformed


def strip_leading_sql_comments(statement: str) -> str:
    text = statement.strip()
    while True:
        if text.startswith("--"):
            newline = text.find("\n")
            if newline == -1:
                return ""
            text = text[newline + 1 :].lstrip()
            continue
        if text.startswith("/*"):
            end = text.find("*/")
            if end == -1:
                return ""
            text = text[end + 2 :].lstrip()
            continue
        return text


def iter_reference_file_seed_statements(
    path: Path,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> Iterator[str]:
    batch_key: tuple[str, str, str] | None = None
    batch_values: list[str] = []

    def flush_batch() -> Iterator[str]:
        nonlocal batch_key, batch_values
        if batch_key and batch_values:
            prefix, table, columns = batch_key
            yield f"{prefix}`{table}` ({columns}) VALUES {', '.join(batch_values)};"
        batch_key = None
        batch_values = []

    if not path.exists():
        raise FileNotFoundError(path)
    with path.open(encoding="utf-8", errors="ignore") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line.upper().startswith("INSERT INTO"):
                continue
            parts = transform_insert_parts(line)
            if not parts:
                continue
            prefix, table, columns, values = parts
            key = (prefix, table, columns)
            if batch_key and (key != batch_key or len(batch_values) >= batch_size):
                yield from flush_batch()
            batch_key = key
            batch_values.append(values)
    yield from flush_batch()


def iter_reference_seed_statements(
    reference_dir: Path = DEFAULT_REFERENCE_DIR,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> Iterator[str]:
    # Load product-side dimensions before warehouse facts.
    for file_name in ("saas_prod.sql", "saas_warehouse.sql"):
        yield from iter_reference_file_seed_statements(
            reference_dir / file_name,
            batch_size=batch_size,
        )


def iter_regression_overlay_statements(
    overlay_file: Path = DEFAULT_REGRESSION_OVERLAY_FILE,
) -> Iterator[str]:
    if not overlay_file.exists():
        return
    for statement in split_sql_statements(overlay_file.read_text(encoding="utf-8")):
        executable_statement = strip_leading_sql_comments(statement)
        if not executable_statement:
            continue
        insert_statement = transform_insert_statement(executable_statement + ";")
        if insert_statement:
            yield insert_statement
            continue
        yield transform_table_references(executable_statement) + ";"


def iter_supplemental_seed_statements(
    supplemental_files: Iterable[Path] = DEFAULT_SUPPLEMENTAL_SEED_FILES,
) -> Iterator[str]:
    for path in supplemental_files:
        if not path.exists():
            continue
        yield path.read_text(encoding="utf-8").strip()


def iter_local_seed_sql(
    reference_dir: Path = DEFAULT_REFERENCE_DIR,
    regression_overlay_file: Path | None = None,
    supplemental_files: Iterable[Path] = DEFAULT_SUPPLEMENTAL_SEED_FILES,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> Iterator[str]:
    yield "-- Generated from docs/业务需求/seed_data_refer; do not hand-edit."
    yield "-- Source dumps: saas_prod.sql + saas_warehouse.sql."
    yield "-- Table-name mapping: product reference tables are mapped to v1.3 dim_* table names."
    yield "-- Legacy regression fixture is optional; default seed uses real reference data only."
    yield "SET FOREIGN_KEY_CHECKS=0;"
    yield from iter_reference_seed_statements(reference_dir, batch_size=batch_size)
    if regression_overlay_file:
        yield from iter_regression_overlay_statements(regression_overlay_file)
    yield from iter_supplemental_seed_statements(supplemental_files)
    yield "SET FOREIGN_KEY_CHECKS=1;"
