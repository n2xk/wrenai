#!/usr/bin/env python3
"""Run route-level smoke checks for the 46 business generalization cases.

The CSV contains product, numeric, and UI assertions that cannot all be proven by
the AI-service ask API alone. This runner therefore focuses on the route contract
that can be checked automatically from `/v1/asks`: terminal status, template
adoption, clarification, external-dependency blocking, and diagnostics fields.
It writes a Markdown report for manual follow-up on cases that require UI or
numeric reconciliation.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from verify_ask_route_regression import (
    HARD_TEMPLATE_MODES,
    HARD_TEMPLATE_SQL_SOURCES,
    poll_result,
)

ROOT = Path(__file__).resolve().parent
DEFAULT_CSV = ROOT / "csv" / "14_业务泛化补充用例.csv"


@dataclass(frozen=True)
class BusinessCase:
    case_id: str
    category: str
    target: str
    question: str
    route_expectation: str
    precondition: str
    expected_result: str
    pass_criteria: str


@dataclass
class BusinessResult:
    case: BusinessCase
    status: str
    ask_type: str | None
    template_decision: dict[str, Any]
    semantic_plan: dict[str, Any]
    clarification_state: dict[str, Any]
    content: str | None = None
    error: str | None = None
    query_id: str | None = None
    raw_payload: dict[str, Any] | None = None
    generated_sql: str | None = None
    automated_verdict: str = "pass"
    automated_notes: list[str] | None = None

    @property
    def mode(self) -> str | None:
        return self.template_decision.get("mode")

    @property
    def sql_source(self) -> str | None:
        return self.template_decision.get("sql_source") or self.template_decision.get(
            "sqlSource"
        )

    @property
    def fallback_reason(self) -> str | None:
        return self.template_decision.get(
            "fallback_reason"
        ) or self.template_decision.get("fallbackReason")

    @property
    def template_id(self) -> str | None:
        value = self.template_decision.get("template_id") or self.template_decision.get(
            "templateId"
        )
        return str(value) if value is not None else None

    @property
    def missing_parameters(self) -> list[Any]:
        value = self.template_decision.get(
            "missing_parameters"
        ) or self.template_decision.get("missingParameters")
        return value if isinstance(value, list) else []

    @property
    def route(self) -> str | None:
        decision = self.semantic_plan.get("decision") or {}
        return decision.get("route")

    @property
    def hard_template_applied(self) -> bool:
        return self.mode in HARD_TEMPLATE_MODES or self.sql_source in (
            HARD_TEMPLATE_SQL_SOURCES
        )

    @property
    def hard_template_sql_applied(self) -> bool:
        return (
            self.sql_source in HARD_TEMPLATE_SQL_SOURCES
            and len(self.missing_parameters) == 0
        )

    @property
    def content_text(self) -> str:
        return self.content or ""

    @property
    def decision_reason(self) -> str | None:
        return self.template_decision.get(
            "decision_reason"
        ) or self.template_decision.get("decisionReason")


def load_cases(csv_path: Path) -> list[BusinessCase]:
    with csv_path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        return [
            BusinessCase(
                case_id=row["test_id"],
                category=row["category"],
                target=row["target"],
                question=row["recommended_question"],
                route_expectation=row["route_expectation"],
                precondition=row["precondition"],
                expected_result=row["expected_result"],
                pass_criteria=row["pass_criteria"],
            )
            for row in reader
        ]


def _parse_assertion_scalar(value: str) -> Any:
    value = value.strip()
    if value in {"", "null", "None", "~"}:
        return None
    if value in {"true", "True"}:
        return True
    if value in {"false", "False"}:
        return False
    if (
        (value.startswith('"') and value.endswith('"'))
        or (value.startswith("'") and value.endswith("'"))
    ):
        return value[1:-1]
    return value


def _parse_minimal_yaml_cases(text: str) -> list[dict[str, Any]]:
    """Parse the small YAML subset used by docs assertion seed files."""

    cases: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    current_list_key: str | None = None
    for raw_line in text.splitlines():
        stripped = raw_line.split("#", 1)[0].strip()
        if not stripped or stripped == "cases:":
            continue
        if stripped.startswith("- "):
            item = stripped[2:].strip()
            if ":" in item:
                key, value = item.split(":", 1)
                if current is not None:
                    cases.append(current)
                current = {key.strip(): _parse_assertion_scalar(value)}
                current_list_key = None
            elif current is not None and current_list_key:
                current.setdefault(current_list_key, []).append(
                    _parse_assertion_scalar(item)
                )
            continue
        if current is not None and ":" in stripped:
            key, value = stripped.split(":", 1)
            key = key.strip()
            value = value.strip()
            if value:
                current[key] = _parse_assertion_scalar(value)
                current_list_key = None
            else:
                current[key] = []
                current_list_key = key
    if current is not None:
        cases.append(current)
    return cases


def load_structured_assertions(path: Path | None) -> dict[str, dict[str, Any]]:
    if not path:
        return {}

    text = path.read_text(encoding="utf-8")
    try:
        payload = json.loads(text)
        raw_cases = payload.get("cases") if isinstance(payload, dict) else payload
    except json.JSONDecodeError:
        raw_cases = _parse_minimal_yaml_cases(text)

    assertions: dict[str, dict[str, Any]] = {}
    for raw_case in raw_cases or []:
        if not isinstance(raw_case, dict):
            continue
        case_id = raw_case.get("case_id")
        if case_id:
            assertions[str(case_id)] = raw_case
    return assertions


def run_case(
    args: argparse.Namespace,
    case: BusinessCase,
    assertions: dict[str, dict[str, Any]],
) -> BusinessResult:
    query_id: str | None = None
    try:
        query_id = post_business_ask(args=args, case=case)
        payload = poll_result(
            ai_endpoint=args.ai_endpoint,
            query_id=query_id,
            poll_interval=args.poll_interval,
            timeout=args.case_timeout,
        )
        result = BusinessResult(
            case=case,
            status=payload.get("status") or "unknown",
            ask_type=payload.get("type"),
            template_decision=payload.get("template_decision")
            or payload.get("templateDecision")
            or {},
            semantic_plan=payload.get("semantic_plan")
            or payload.get("semanticPlan")
            or {},
            clarification_state=payload.get("clarification_state")
            or payload.get("clarificationState")
            or {},
            content=payload.get("content"),
            error=(payload.get("error") or {}).get("message")
            if isinstance(payload.get("error"), dict)
            else payload.get("error"),
            query_id=query_id,
            raw_payload=payload,
            generated_sql=extract_result_sql(payload),
        )
    except Exception as exc:  # noqa: BLE001 - diagnostics script captures all cases
        result = BusinessResult(
            case=case,
            status="error",
            ask_type=None,
            template_decision={},
            semantic_plan={},
            clarification_state={},
            error=str(exc),
            query_id=query_id,
        )

    result.automated_verdict, result.automated_notes = evaluate_result(
        result,
        assertions.get(case.case_id),
    )
    return result


def post_business_ask(*, args: argparse.Namespace, case: BusinessCase) -> str:
    import requests

    response = requests.post(
        f"{args.ai_endpoint.rstrip('/')}/v1/asks",
        json={
            "query": case.question,
            "mdl_hash": args.mdl_hash,
            "histories": [],
            "ignore_sql_generation_reasoning": args.ignore_sql_generation_reasoning,
        },
        timeout=args.http_timeout,
    )
    response.raise_for_status()
    return response.json()["query_id"]


def _contains_any(text: str, values: list[str]) -> bool:
    return any(value in text for value in values)


def _iter_payload_values(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value]
    return []


def extract_result_sql(payload: dict[str, Any]) -> str | None:
    """Best-effort SQL extraction from ask result payloads.

    Different ask paths expose SQL either under `response`, `responses`,
    `result`, or a direct `sql` field. The route runner keeps this tolerant so
    YAML assertions can start checking SQL shape without coupling to one UI
    response envelope.
    """

    candidates: list[Any] = [payload]
    for key in ("response", "responses", "result", "results", "data"):
        candidates.extend(_iter_payload_values(payload.get(key)))

    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        sql = candidate.get("sql")
        if isinstance(sql, str) and sql.strip():
            return sql.strip()
    return None


def evaluate_structured_assertion(
    result: BusinessResult,
    assertion: dict[str, Any] | None,
) -> list[str]:
    if not assertion:
        return []

    notes: list[str] = []
    expected_route = assertion.get("expected_route")
    if expected_route and result.route != expected_route:
        notes.append(f"route={result.route}, expected_route={expected_route}")

    expected_ask_type = assertion.get("expected_ask_type")
    if expected_ask_type and result.ask_type != expected_ask_type:
        notes.append(
            f"ask_type={result.ask_type}, expected_ask_type={expected_ask_type}"
        )

    expected_sql_source = assertion.get("expected_sql_source")
    if expected_sql_source and result.sql_source != expected_sql_source:
        notes.append(
            f"sql_source={result.sql_source}, expected_sql_source={expected_sql_source}"
        )

    expected_template_mode = assertion.get("expected_template_mode")
    if expected_template_mode and result.mode != expected_template_mode:
        notes.append(
            f"mode={result.mode}, expected_template_mode={expected_template_mode}"
        )

    expected_fallback_reason = assertion.get("expected_fallback_reason")
    if expected_fallback_reason and result.fallback_reason != expected_fallback_reason:
        notes.append(
            "fallback_reason={actual}, expected_fallback_reason={expected}".format(
                actual=result.fallback_reason,
                expected=expected_fallback_reason,
            )
        )

    forbidden_templates = {
        str(value) for value in assertion.get("forbidden_templates") or []
    }
    if result.template_id and result.template_id in forbidden_templates:
        notes.append(f"命中禁止模板 {result.template_id}")

    allowed_template_id = assertion.get("allowed_template_id")
    if allowed_template_id and result.template_id != str(allowed_template_id):
        notes.append(
            f"template_id={result.template_id}, allowed_template_id={allowed_template_id}"
        )

    if assertion.get("forbid_hard_template") and result.hard_template_sql_applied:
        notes.append("结构化断言禁止硬套模板，但实际已硬套")

    required_missing_parameters = {
        str(value) for value in assertion.get("required_missing_parameters") or []
    }
    missing_parameters = {str(value) for value in result.missing_parameters}
    missing_slots = {
        str(value) for value in result.semantic_plan.get("missing_slots") or []
    }
    missing_slots.update(
        str(value) for value in result.clarification_state.get("pending_slots") or []
    )
    missing_all = missing_parameters | missing_slots
    for value in sorted(required_missing_parameters - missing_all):
        notes.append(f"missing_parameters 缺少 {value}")

    if "expected_clarification" in assertion:
        expected = bool(assertion.get("expected_clarification"))
        actual = (
            result.route == "clarification_required"
            or result.clarification_state.get("status") == "needs_clarification"
        )
        if actual != expected:
            notes.append(
                f"clarification={actual}, expected_clarification={expected}"
            )

    if assertion.get("expected_external_blocking"):
        blocked = result.route == "blocked_missing_external_data" or _contains_any(
            result.content_text,
            ["外部", "投放金额", "PV", "UV", "不能编造", "请补充"],
        )
        if not blocked:
            notes.append("预期外部数据阻断/补充，但未观察到")

    for value in assertion.get("required_content") or []:
        if str(value) not in result.content_text:
            notes.append(f"content 缺少 {value}")
    for value in assertion.get("forbidden_content") or []:
        if str(value) in result.content_text:
            notes.append(f"content 不应包含 {value}")

    for value in assertion.get("expected_sql_contains") or []:
        if not result.generated_sql or str(value) not in result.generated_sql:
            notes.append(f"SQL 缺少 {value}")
    for value in assertion.get("forbid_sql_contains") or []:
        if result.generated_sql and str(value) in result.generated_sql:
            notes.append(f"SQL 不应包含 {value}")
    if assertion.get("require_sql") and not result.generated_sql:
        notes.append("预期返回 SQL，但未能从 payload 中提取")

    diagnostics_text = json.dumps(
        {
            "template_decision": result.template_decision,
            "semantic_plan": result.semantic_plan,
            "clarification_state": result.clarification_state,
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    for value in assertion.get("diagnostics_must_include") or []:
        if str(value) not in diagnostics_text:
            notes.append(f"diagnostics 缺少 {value}")

    return notes


def evaluate_result(
    result: BusinessResult,
    assertion: dict[str, Any] | None = None,
) -> tuple[str, list[str]]:
    notes: list[str] = []
    case_id = result.case.case_id
    text = result.content_text
    expectation = result.case.route_expectation

    if result.status != "finished":
        if result.case.case_id in {"ROUTE07", "ROUTE08"} or "已有结果" in (
            result.case.precondition or ""
        ):
            return "needs_manual", [
                "needs_conversation_context",
                f"status={result.status}",
                result.error or "",
            ]
        return "fail", [f"status={result.status}", result.error or ""]

    expects_external = (
        "外部" in expectation
        or _contains_any(
            result.case.question,
            [
                "ROI",
                "投放",
                "PV",
                "UV",
                "下载点击",
                "投放回收",
                "回本",
                "首存成本",
                "首充成本",
            ],
        )
    )
    expects_clarification = (
        "澄清" in expectation
        or "模糊" in result.case.target
        or case_id in {"LING09", "ROUTE03"}
    )
    forbids_hard_template = (
        "不用" in result.case.question
        or "不要用" in result.case.question
        or case_id in {"LING10", "ROUTE06"}
    )

    if forbids_hard_template and result.hard_template_applied:
        notes.append("明确禁止模板时仍硬套模板")

    if case_id == "ROUTE01" and not result.hard_template_applied:
        notes.append("明确模板命中用例未观察到硬模板命中")

    if expects_clarification:
        clarified = result.route == "clarification_required" or _contains_any(
            text,
            ["请补充", "请明确", "需要确认", "租户平台", "时间", "指标"],
        )
        if not clarified:
            notes.append("预期澄清但未观察到澄清提示")

    if expects_external:
        blocked_or_clarified = result.route in {
            "blocked_missing_external_data",
            "clarification_required",
        } or _contains_any(
            text,
            ["外部", "投放金额", "PV", "UV", "下载点击", "不能编造", "请补充"],
        )
        if not blocked_or_clarified:
            notes.append("预期外部依赖阻断/补充但未观察到相关提示")

    if result.error:
        notes.append(f"error={result.error}")

    notes.extend(evaluate_structured_assertion(result, assertion))

    if notes:
        return "fail", notes

    manual_markers = {
        "数值": "needs_numeric",
        "对账": "needs_numeric",
        "图表": "needs_ui",
        "保存": "needs_artifactization",
        "导出": "needs_artifactization",
        "诊断页面": "needs_diagnostics_page",
    }
    manual_reasons = [
        reason
        for marker, reason in manual_markers.items()
        if marker in result.case.pass_criteria
    ]
    if manual_reasons:
        return "needs_manual", sorted(set(manual_reasons))

    return "pass", []


def render_markdown(results: list[BusinessResult]) -> str:
    counts: dict[str, int] = {}
    for result in results:
        counts[result.automated_verdict] = counts.get(result.automated_verdict, 0) + 1

    lines = [
        "# 业务泛化全量路由回归结果",
        "",
        f"- 执行时间：{datetime.now(timezone.utc).isoformat()}",
        f"- 用例数：{len(results)}",
        f"- pass：{counts.get('pass', 0)}",
        f"- needs_manual：{counts.get('needs_manual', 0)}",
        f"- fail：{counts.get('fail', 0)}",
        "",
        "| 用例 | 自动结论 | 状态 | 类型 | route | 模式 | SQL来源 | 模板 | 降级原因 | query_id | 备注 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for result in results:
        notes = "；".join(result.automated_notes or []) or "-"
        lines.append(
            "| {case_id} | {verdict} | {status} | {ask_type} | {route} | {mode} | "
            "{sql_source} | {template_id} | {fallback_reason} | {query_id} | {notes} |".format(
                case_id=result.case.case_id,
                verdict=result.automated_verdict,
                status=result.status,
                ask_type=result.ask_type or "-",
                route=result.route or "-",
                mode=result.mode or "-",
                sql_source=result.sql_source or "-",
                template_id=result.template_id or "-",
                fallback_reason=result.fallback_reason or "-",
                query_id=result.query_id or "-",
                notes=notes.replace("|", "\\|"),
            )
        )

    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--ai-endpoint",
        default=os.getenv("WREN_AI_ENDPOINT", "http://127.0.0.1:5555"),
        help="AI service endpoint. Default: %(default)s",
    )
    parser.add_argument(
        "--mdl-hash",
        default=os.getenv("WREN_ROUTE_MDL_HASH") or os.getenv("WREN_MDL_HASH"),
        help="Deploy/MDL hash for the active TiDB knowledge base.",
    )
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    parser.add_argument("--case", action="append", dest="cases")
    parser.add_argument("--http-timeout", type=float, default=15)
    parser.add_argument("--poll-interval", type=float, default=2)
    parser.add_argument("--case-timeout", type=float, default=180)
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--assertions-yaml",
        type=Path,
        help="可选结构化路由断言文件（支持最小 YAML 子集或 JSON）。",
    )
    parser.add_argument(
        "--ignore-sql-generation-reasoning",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Skip the separate SQL reasoning LLM step for faster route smoke.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero when automated route checks fail.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.mdl_hash:
        print(
            "缺少 --mdl-hash。可传入当前 knowledge base 的 deployHash，"
            "或设置 WREN_ROUTE_MDL_HASH。",
            file=sys.stderr,
        )
        return 2

    cases = load_cases(args.csv)
    if args.cases:
        wanted = set(args.cases)
        cases = [case for case in cases if case.case_id in wanted]
        missing = wanted - {case.case_id for case in cases}
        if missing:
            print(f"未知 case id: {', '.join(sorted(missing))}", file=sys.stderr)
            return 2

    assertions = load_structured_assertions(args.assertions_yaml)

    results: list[BusinessResult] = []
    for case in cases:
        print(f"[business] {case.case_id} {case.question}", flush=True)
        result = run_case(args, case, assertions)
        results.append(result)
        print(
            "  -> verdict={verdict} status={status} type={ask_type} route={route} "
            "mode={mode} template={template_id} fallback={fallback_reason}".format(
                verdict=result.automated_verdict,
                status=result.status,
                ask_type=result.ask_type or "-",
                route=result.route or "-",
                mode=result.mode or "-",
                template_id=result.template_id or "-",
                fallback_reason=result.fallback_reason or "-",
            ),
            flush=True,
        )
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(render_markdown(results), encoding="utf-8")

    markdown = render_markdown(results)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(markdown, encoding="utf-8")
        print(f"结果已写入：{args.output}")

    failed_count = sum(1 for result in results if result.automated_verdict == "fail")
    if failed_count and args.strict:
        print(markdown)
        return 1
    print(f"业务泛化路由回归完成，fail={failed_count}。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
