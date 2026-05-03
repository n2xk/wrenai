#!/usr/bin/env python3
"""Validate strict FULL-shape coverage for 第一期数据报表需求V1.xlsx.

This validator is intentionally stricter than the interactive E2E runner. It is
used to prevent a response that merely explains a missing dependency, returns a
message SQL, or emits a partial long table from being counted as a FULL Excel
same-shape pass.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
DEFAULT_XLSX = ROOT / "第一期数据报表需求V1.xlsx"
DEFAULT_FULL_CSV = ROOT / "csv" / "15_第一期Excel示例表格全覆盖保存清单.csv"
DEFAULT_VARIANT_CSV = ROOT / "csv" / "17_第一期Excel_FULL泛化变体清单.csv"
DEFAULT_ASK_SUMMARY = (
    ROOT.parent.parent / "wren-ui" / "tmp" / "tidb-b2-b6-full-e2e-output" / "ask-summary.json"
)

GLOBAL_BLOCK_SIGNALS = [
    "SQL 缺失",
    "缺少",
    "缺失",
    "请提供",
    "不能编造",
    "当前知识库还缺少",
    "需要补充回收周期",
    "请说明要累计到",
]
MESSAGE_SQL_RE = re.compile(r"SELECT\s+['\"]?[^\n]{0,120}(?:缺少|缺失|请提供|无法计算|message)", re.I)


@dataclass
class FullCase:
    test_id: str
    excel_sheet: str
    example_table: str
    excel_range: str
    result_shape: str
    strict_gate: str
    required_external_dependencies: list[str]
    required_tokens: list[str]
    forbidden_signals: list[str]
    pass_rule: str


def split_pipe(value: str | None) -> list[str]:
    return [item.strip() for item in str(value or "").split("|") if item.strip()]


def load_full_cases(path: Path) -> list[FullCase]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    cases: list[FullCase] = []
    for row in rows:
        cases.append(
            FullCase(
                test_id=row["test_id"],
                excel_sheet=row["excel_sheet"],
                example_table=row["example_table"],
                excel_range=row["excel_range"],
                result_shape=row["result_shape"],
                strict_gate=row.get("strict_gate") or "sql_result_required",
                required_external_dependencies=split_pipe(row.get("required_external_dependencies")),
                required_tokens=split_pipe(row.get("strict_required_columns_or_segments")),
                forbidden_signals=split_pipe(row.get("strict_forbidden_pass_signals")),
                pass_rule=row.get("strict_full_pass_rule") or row.get("pass_criteria") or "",
            )
        )
    return cases


def load_ask_summary(path: Path | None) -> dict[str, dict[str, Any]]:
    if not path or not path.exists():
        return {}
    rows = json.loads(path.read_text(encoding="utf-8"))
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        test_id = str(row.get("testId") or row.get("test_id") or "")
        if test_id.endswith("-FULL"):
            result[test_id.removesuffix("-FULL")] = row
    return result


def load_variant_counts(path: Path) -> dict[str, int]:
    if not path.exists():
        return {}
    counts: dict[str, int] = {}
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            ref = row.get("full_ref") or ""
            counts[ref] = counts.get(ref, 0) + 1
    return counts


def normalize_text(value: Any) -> str:
    return str(value or "").replace(" ", "").replace("\n", "")


def evaluate_case(case: FullCase, result: dict[str, Any] | None) -> tuple[str, list[str]]:
    if not result:
        return "NOT_RUN", ["未找到该 FULL 用例的 ask-summary 结果"]

    notes: list[str] = []
    status = str(result.get("status") or "")
    has_sql = bool(result.get("hasSql"))
    content = str(result.get("contentPreview") or result.get("content") or "")
    sql = str(result.get("sqlPreview") or result.get("sql") or "")
    notes_text = "\n".join(str(item) for item in result.get("notes") or [])
    haystack = normalize_text("\n".join([content, sql, notes_text]))

    if status != "PASS":
        notes.append(f"runner_status={status or '-'}")
    if not has_sql:
        notes.append("SQL 缺失")
    if MESSAGE_SQL_RE.search(sql):
        notes.append("返回的是提示型 message SQL，不是原始 Excel 同形结果")

    forbidden = [*GLOBAL_BLOCK_SIGNALS, *case.forbidden_signals]
    hit_forbidden = [signal for signal in forbidden if signal and normalize_text(signal) in haystack]
    supplemental_prompt_re = re.compile(
        r"请补充(?:投放|PV|UV|下载|平台|租户|渠道|日期|时间|参数|条件|周期|回收)",
        re.I,
    )
    if supplemental_prompt_re.search(haystack):
        hit_forbidden.append("请补充必要条件")
    if hit_forbidden:
        notes.append("命中阻断/缺口信号：" + "、".join(dict.fromkeys(hit_forbidden)))

    missing_tokens = [token for token in case.required_tokens if normalize_text(token) not in haystack]
    if missing_tokens:
        notes.append("缺少同形字段/分组：" + "、".join(missing_tokens[:12]))

    if case.strict_gate == "external_input_required" and hit_forbidden:
        return "BLOCKED_EXTERNAL", notes
    if case.strict_gate == "external_input_required" and case.required_external_dependencies and not has_sql:
        return "BLOCKED_EXTERNAL", notes
    if has_sql and not hit_forbidden and not missing_tokens and not MESSAGE_SQL_RE.search(sql):
        return "FULL_PASS", notes
    if hit_forbidden and case.required_external_dependencies:
        return "BLOCKED_EXTERNAL", notes
    return "SHAPE_GAP", notes


def render_markdown(
    cases: list[FullCase],
    ask_results: dict[str, dict[str, Any]],
    variant_counts: dict[str, int],
) -> str:
    evaluated = []
    for case in cases:
        strict_status, notes = evaluate_case(case, ask_results.get(case.test_id))
        evaluated.append((case, strict_status, notes))

    counts: dict[str, int] = {}
    for _, strict_status, _ in evaluated:
        counts[strict_status] = counts.get(strict_status, 0) + 1

    lines = [
        "# 第一期 Excel FULL 同形严格校验结果",
        "",
        f"- 执行时间：{datetime.now(timezone.utc).isoformat()}",
        f"- FULL 用例数：{len(cases)}",
        f"- 严格状态统计：{json.dumps(counts, ensure_ascii=False, sort_keys=True)}",
        "",
        "## 判定规则",
        "",
        "- `FULL_PASS`：必须有真实 SQL/结果、没有缺口/阻断/提示型 message SQL，并包含该 FT 的关键列、分组和宽表信号。",
        "- `BLOCKED_EXTERNAL`：外部投放/PV/UV/下载点击UV/VIP模型等能力缺失被正确阻断；这是安全行为，但不能计入 FULL 同形通过。",
        "- `SHAPE_GAP`：有结果但字段、分组、宽表/透视形态、汇总行或周期列不足；不能计入 FULL 同形通过。",
        "- `NOT_RUN`：未找到该 FT 的执行证据。",
        "",
        "## 明细",
        "",
        "| FT | Excel sheet | 示例表格 | 严格状态 | 泛化变体数 | 主要原因 |",
        "| --- | --- | --- | --- | ---: | --- |",
    ]
    for case, strict_status, notes in evaluated:
        reason = "；".join(notes[:3]) or case.pass_rule
        lines.append(
            f"| {case.test_id} | {case.excel_sheet} | {case.example_table} | "
            f"{strict_status} | {variant_counts.get(case.test_id, 0)} | {reason.replace('|', '/')} |"
        )

    if counts.get("FULL_PASS", 0) != len(cases):
        lines.extend(
            [
                "",
                "## 结论",
                "",
                "当前不能声明 `第一期数据报表需求V1.xlsx` 原始 FULL 示例表格 11/11 同形覆盖。",
                "只有所有 FT 均达到 `FULL_PASS`，才允许在最终报告中写“原始 Excel 示例表格已完全覆盖且查出来一样”。",
            ]
        )
    else:
        lines.extend(["", "## 结论", "", "全部 FT 达到严格 FULL 同形通过。"])
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--full-csv", type=Path, default=DEFAULT_FULL_CSV)
    parser.add_argument("--variants-csv", type=Path, default=DEFAULT_VARIANT_CSV)
    parser.add_argument("--ask-summary", type=Path, default=DEFAULT_ASK_SUMMARY)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    cases = load_full_cases(args.full_csv)
    if len(cases) != 11:
        raise SystemExit(f"expected 11 FULL cases, got {len(cases)}")
    variant_counts = load_variant_counts(args.variants_csv)
    missing_variants = [case.test_id for case in cases if variant_counts.get(case.test_id, 0) < 3]
    if missing_variants:
        raise SystemExit("each FT should have at least 3 variants; missing=" + ",".join(missing_variants))

    markdown = render_markdown(cases, load_ask_summary(args.ask_summary), variant_counts)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(markdown, encoding="utf-8")
    else:
        print(markdown)


if __name__ == "__main__":
    main()
