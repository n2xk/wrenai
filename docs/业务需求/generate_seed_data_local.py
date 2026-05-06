#!/usr/bin/env python3
"""Materialize v1.3-ready local TiDB seed files.

`seed_data_refer/` intentionally keeps raw exported reference dumps. This
script turns those dumps plus the fixed regression fixture into direct-import
SQL files under `seed_data_local/` so deploy/bootstrap does not need to run the
table-name conversion path while importing data.
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from local_tidb_seed_transform import (
    DEFAULT_LOCAL_SEED_DIR,
    DEFAULT_REFERENCE_DIR,
    DEFAULT_SUPPLEMENTAL_SEED_FILES,
    iter_reference_file_seed_statements,
    split_sql_statements,
    strip_leading_sql_comments,
    transform_insert_statement,
    transform_table_references,
)


REFERENCE_OUTPUTS = {
    "saas_prod.sql": "saas_prod_v1_3.sql",
    "saas_warehouse.sql": "saas_warehouse_v1_3.sql",
}
REGRESSION_FIXTURE_NAME = "regression_fixture.sql"
EXTERNAL_METRICS_NAME = "external_metrics.sql"
README_NAME = "README.md"
EXCLUDED_FIXTURE_TABLES = {"marketing_external_metrics_daily"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--reference-dir",
        type=Path,
        default=DEFAULT_REFERENCE_DIR,
        help="Directory containing raw saas_prod.sql and saas_warehouse.sql dumps.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_LOCAL_SEED_DIR,
        help="Directory where direct-import v1.3 SQL files are written.",
    )
    parser.add_argument(
        "--legacy-regression-overlay-file",
        type=Path,
        default=None,
        help=(
            "Optional legacy fixed regression overlay to normalize into regression_fixture.sql. "
            "By default the existing seed_data_local/regression_fixture.sql is preserved."
        ),
    )
    parser.add_argument(
        "--external-metrics-file",
        type=Path,
        default=DEFAULT_SUPPLEMENTAL_SEED_FILES[0],
        help="External metrics SQL copied into seed_data_local/external_metrics.sql.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=1,
        help=(
            "Maximum rows per generated INSERT for normalized reference dumps. "
            "Default 1 preserves source row granularity and avoids oversized TiDB insert packets."
        ),
    )
    parser.add_argument(
        "--fixtures-only",
        action="store_true",
        help="Only regenerate regression_fixture.sql, external_metrics.sql, and README.md.",
    )
    return parser.parse_args()


def write_statement(handle, statement: str) -> None:
    handle.write(statement.rstrip())
    handle.write("\n")


def should_skip_fixture_statement(statement: str) -> bool:
    lower = statement.lower()
    return any(table in lower for table in EXCLUDED_FIXTURE_TABLES)


def iter_regression_fixture_statements(path: Path):
    if not path.exists():
        raise FileNotFoundError(path)
    for statement in split_sql_statements(path.read_text(encoding="utf-8")):
        executable_statement = strip_leading_sql_comments(statement)
        if not executable_statement or should_skip_fixture_statement(executable_statement):
            continue
        insert_statement = transform_insert_statement(executable_statement + ";")
        if insert_statement:
            yield insert_statement
            continue
        yield transform_table_references(executable_statement) + ";"


def materialize_reference_file(
    source: Path,
    target: Path,
    *,
    batch_size: int,
) -> int:
    count = 0
    with target.open("w", encoding="utf-8") as handle:
        write_statement(handle, f"-- Generated from {source}; do not hand-edit.")
        write_statement(handle, "SET FOREIGN_KEY_CHECKS=0;")
        for statement in iter_reference_file_seed_statements(source, batch_size=batch_size):
            write_statement(handle, statement)
            count += 1
        write_statement(handle, "SET FOREIGN_KEY_CHECKS=1;")
    return count


def materialize_regression_fixture(source: Path, target: Path) -> int:
    count = 0
    with target.open("w", encoding="utf-8") as handle:
        write_statement(handle, f"-- Generated from {source}; do not hand-edit.")
        write_statement(
            handle,
            "-- Legacy 990001/990011 regression fixture normalized to the v1.3 schema.",
        )
        write_statement(
            handle,
            "-- External metrics are stored separately in external_metrics.sql.",
        )
        for statement in iter_regression_fixture_statements(source):
            write_statement(handle, statement)
            count += 1
    return count


def materialize_external_metrics(source: Path, target: Path) -> int:
    if not source.exists():
        raise FileNotFoundError(source)
    shutil.copyfile(source, target)
    return sum(1 for statement in split_sql_statements(target.read_text(encoding="utf-8")) if statement.strip())


def write_readme(output_dir: Path) -> None:
    (output_dir / README_NAME).write_text(
        """# seed_data_local

本目录是本地 / demo / 回归测试可直接导入 TiDB 的 v1.3 seed 数据入口。

- `saas_prod_v1_3.sql`：由 `../seed_data_refer/saas_prod.sql` 规范化生成。
- `saas_warehouse_v1_3.sql`：由 `../seed_data_refer/saas_warehouse.sql` 规范化生成。
- `regression_fixture.sql`：legacy 固定对账窗口 `tenant_plat_id=990001` / `channel_id=990011` 的可选夹具；默认核心回归不再依赖它，只有专项复现旧对账口径时显式导入。
- `external_metrics.sql`：FULL 回归外部投放 / 流量指标样例。

`seed_data_refer/` 是原始参考导出，不直接修改；重新拿到参考 dump 后运行：

```bash
python3 docs/业务需求/generate_seed_data_local.py
```

生成后的 `saas_*_v1_3.sql` 体积较大，默认由本目录 `.gitignore` 忽略。
默认按单行 INSERT 输出，只做表名 / 字段兼容转换，避免过大的批量 INSERT 导致 TiDB 导入连接中断。
如需临时压缩体积，可显式传入 `--batch-size <N>`，但完整回归推荐保留默认值。
默认不会覆盖 `regression_fixture.sql`；如果需要从旧 fixture 迁移一次，可显式传入
`--legacy-regression-overlay-file <path>`。

当前默认核心回归参数来自真实参考数据：`tenant_plat_id=72`、`channel_id=1932`、`2026-04-10~2026-04-16`；T02 渠道费率专项使用 `tenant_plat_id=1` 下的 `channel_id=1867/1760`。
""",
        encoding="utf-8",
    )


def write_gitignore(output_dir: Path) -> None:
    (output_dir / ".gitignore").write_text(
        "# Large generated normalized reference dumps.\n"
        "/saas_prod_v1_3.sql\n"
        "/saas_warehouse_v1_3.sql\n",
        encoding="utf-8",
    )


def main() -> None:
    args = parse_args()
    output_dir: Path = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    write_gitignore(output_dir)
    write_readme(output_dir)

    counts: dict[str, int] = {}
    if not args.fixtures_only:
        for source_name, target_name in REFERENCE_OUTPUTS.items():
            counts[target_name] = materialize_reference_file(
                args.reference_dir / source_name,
                output_dir / target_name,
                batch_size=max(args.batch_size, 1),
            )
    regression_fixture = output_dir / REGRESSION_FIXTURE_NAME
    if args.legacy_regression_overlay_file:
        counts[REGRESSION_FIXTURE_NAME] = materialize_regression_fixture(
            args.legacy_regression_overlay_file,
            regression_fixture,
        )
    elif not regression_fixture.exists():
        raise FileNotFoundError(
            f"{regression_fixture} does not exist. Provide --legacy-regression-overlay-file once "
            "to migrate an old fixture, then maintain regression_fixture.sql directly."
        )
    else:
        counts[REGRESSION_FIXTURE_NAME] = sum(
            1
            for statement in split_sql_statements(regression_fixture.read_text(encoding="utf-8"))
            if statement.strip()
        )
    counts[EXTERNAL_METRICS_NAME] = materialize_external_metrics(
        args.external_metrics_file,
        output_dir / EXTERNAL_METRICS_NAME,
    )

    for name, count in counts.items():
        print(f"{name}: {count} SQL statement(s); reference rows may be batched")


if __name__ == "__main__":
    main()
