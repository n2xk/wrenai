#!/usr/bin/env python3
"""Run offline smoke checks for ask-runtime governance contracts.

This runner intentionally avoids LLM calls and UI/API traffic. It validates the
pure-policy seams that should stay stable before every full UI E2E regression:
clarification routing, inactive template lifecycle, configured external
dependency blocking, external-supply validation, and request-level policy
evaluation.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parents[1]
AI_SERVICE_ROOT = REPO_ROOT / "wren-ai-service"
DEFAULT_CASES = ROOT / "ask_runtime_eval_cases.yaml"

if str(AI_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_SERVICE_ROOT))

from src.core.ask_policy import (  # noqa: E402
    AskPolicyConfig,
    AskPolicyRule,
    evaluate_policy_context,
)
from src.core.fixed_order_ask_runtime import (  # noqa: E402
    BaseFixedOrderAskRuntime,
    NL2SQLToolset,
    build_minimal_semantic_plan,
    build_template_decision,
    detect_missing_external_source_requirement,
    filter_active_sql_samples,
)


@dataclass(frozen=True)
class EvalCase:
    case_id: str
    kind: str
    query: str
    expected_route: str | None = None
    expected_fallback_reason: str | None = None
    expected_missing_slots: list[str] = field(default_factory=list)
    expected_external_dependencies: list[str] = field(default_factory=list)
    expected_score_drop_min: float | None = None


@dataclass
class EvalResult:
    case: EvalCase
    verdict: str
    diagnostics: dict[str, Any] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


def _parse_scalar(value: str) -> Any:
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
                current = {key.strip(): _parse_scalar(value)}
                current_list_key = None
            elif current is not None and current_list_key:
                current.setdefault(current_list_key, []).append(_parse_scalar(item))
            continue
        if current is not None and ":" in stripped:
            key, value = stripped.split(":", 1)
            key = key.strip()
            value = value.strip()
            if value:
                current[key] = _parse_scalar(value)
                current_list_key = None
            else:
                current[key] = []
                current_list_key = key
    if current is not None:
        cases.append(current)
    return cases


def load_cases(path: Path) -> list[EvalCase]:
    text = path.read_text(encoding="utf-8")
    try:
        payload = json.loads(text)
        raw_cases = payload.get("cases") if isinstance(payload, dict) else payload
    except json.JSONDecodeError:
        raw_cases = _parse_minimal_yaml_cases(text)

    cases: list[EvalCase] = []
    for raw_case in raw_cases or []:
        if not isinstance(raw_case, dict):
            continue
        cases.append(
            EvalCase(
                case_id=str(raw_case.get("case_id") or raw_case.get("id")),
                kind=str(raw_case.get("kind") or ""),
                query=str(raw_case.get("query") or ""),
                expected_route=raw_case.get("expected_route"),
                expected_fallback_reason=raw_case.get("expected_fallback_reason"),
                expected_missing_slots=[
                    str(item) for item in raw_case.get("expected_missing_slots") or []
                ],
                expected_external_dependencies=[
                    str(item)
                    for item in raw_case.get("expected_external_dependencies") or []
                ],
                expected_score_drop_min=(
                    float(raw_case["expected_score_drop_min"])
                    if raw_case.get("expected_score_drop_min") is not None
                    else None
                ),
            )
        )
    return [case for case in cases if case.case_id and case.kind]


def _configured_external_dependency_instruction() -> list[dict[str, Any]]:
    return [
        {
            "knowledge_asset_type": "external_dependency",
            "external_dependency_id": "ad_spend",
            "name": "投放金额",
            "source_status": "missing",
            "missing_behavior": "ask_user",
            "required_grain": ["日期", "渠道ID"],
            "metadata": {
                "trigger_when": ["ROI", "投放回收", "首存成本"],
                "validation": {"required_columns": ["日期", "渠道ID", "投放金额"]},
            },
        }
    ]


def _assert_contains_all(
    *,
    actual: list[Any] | tuple[Any, ...] | set[Any],
    expected: list[str],
    label: str,
    notes: list[str],
) -> None:
    actual_values = {str(item) for item in actual}
    missing = [item for item in expected if item not in actual_values]
    if missing:
        notes.append(f"{label} missing: {', '.join(missing)}")


def run_missing_tenant_clarification(case: EvalCase) -> EvalResult:
    plan = build_minimal_semantic_plan(case.query)
    decision = plan.get("decision") or {}
    notes: list[str] = []
    if case.expected_route and decision.get("route") != case.expected_route:
        notes.append(
            f"route expected {case.expected_route}, got {decision.get('route')}"
        )
    _assert_contains_all(
        actual=plan.get("missing_slots") or [],
        expected=case.expected_missing_slots,
        label="missing_slots",
        notes=notes,
    )
    return EvalResult(case, "pass" if not notes else "fail", plan, notes)


def run_inactive_template_fallback(case: EvalCase) -> EvalResult:
    filtered_samples, inactive_sample = filter_active_sql_samples(
        [
            {
                "id": "T_INACTIVE",
                "question": case.query,
                "sql": "SELECT 1",
                "status": "deprecated",
                "retrieval_score": 0.99,
                "template_mode": "anchored_template",
            }
        ]
    )
    decision = build_template_decision(
        filtered_samples,
        case.query,
        histories=[],
        inactive_sample=inactive_sample,
    )
    notes: list[str] = []
    if decision.get("fallback_reason") != case.expected_fallback_reason:
        notes.append(
            "fallback_reason expected "
            f"{case.expected_fallback_reason}, got {decision.get('fallback_reason')}"
        )
    if decision.get("sql_source") in {"anchored_template", "rendered_template"}:
        notes.append("inactive template still produced a hard template SQL source")
    return EvalResult(case, "pass" if not notes else "fail", decision, notes)


def run_configured_external_block(case: EvalCase) -> EvalResult:
    requirement = detect_missing_external_source_requirement(
        case.query,
        instructions=_configured_external_dependency_instruction(),
    )
    notes: list[str] = []
    if not requirement:
        notes.append("expected configured external dependency requirement")
        diagnostics: dict[str, Any] = {}
    else:
        diagnostics = requirement
        _assert_contains_all(
            actual=requirement.get("required_external_dependencies") or [],
            expected=case.expected_external_dependencies,
            label="required_external_dependencies",
            notes=notes,
        )
    return EvalResult(case, "pass" if not notes else "fail", diagnostics, notes)


def run_external_supply_rejects_missing_columns(case: EvalCase) -> EvalResult:
    requirement = detect_missing_external_source_requirement(
        case.query,
        instructions=_configured_external_dependency_instruction(),
        supplied_external_dependencies={
            "external_dependency_values": {
                "ad_spend": {
                    "columns": ["日期", "投放金额"],
                    "grain": ["日期"],
                }
            }
        },
    )
    notes: list[str] = []
    if not requirement:
        notes.append("invalid supplied data unexpectedly bypassed external guard")
        diagnostics: dict[str, Any] = {}
    else:
        diagnostics = requirement
        if "已补充数据校验未通过" not in str(requirement.get("content") or ""):
            notes.append("invalid supply did not expose validation failure content")
    return EvalResult(case, "pass" if not notes else "fail", diagnostics, notes)


def run_external_supply_accepts_required_columns(case: EvalCase) -> EvalResult:
    requirement = detect_missing_external_source_requirement(
        case.query,
        instructions=_configured_external_dependency_instruction(),
        supplied_external_dependencies={
            "external_dependency_values": {
                "ad_spend": {
                    "columns": ["日期", "渠道ID", "投放金额"],
                    "grain": ["日期", "渠道ID"],
                }
            }
        },
    )
    notes: list[str] = []
    if requirement is not None:
        notes.append("valid supplied data was still blocked")
    return EvalResult(
        case,
        "pass" if not notes else "fail",
        {"requirement": requirement},
        notes,
    )


def run_policy_required_slot(case: EvalCase) -> EvalResult:
    plan = build_minimal_semantic_plan(case.query)
    evaluation = evaluate_policy_context(
        query=case.query,
        semantic_plan=plan,
        config=AskPolicyConfig(
            policy_id="offline_eval",
            version="v1",
            rules=(
                AskPolicyRule(
                    id="require_tenant_plat_for_core_metrics",
                    reason_code="require_tenant_plat_for_core_metrics",
                    query_contains_any=("首充", "首存", "充值"),
                    required_slots=("tenant_plat_id",),
                ),
            ),
        ),
    )
    notes: list[str] = []
    _assert_contains_all(
        actual=evaluation.missing_required_slots,
        expected=case.expected_missing_slots,
        label="policy_missing_required_slots",
        notes=notes,
    )
    return EvalResult(
        case,
        "pass" if not notes else "fail",
        evaluation.to_metadata(),
        notes,
    )


def run_semantic_plan_route_guard(case: EvalCase) -> EvalResult:
    deterministic_plan = build_minimal_semantic_plan(case.query)
    runtime = BaseFixedOrderAskRuntime(toolset=NL2SQLToolset({}))
    merged_plan = runtime._merge_llm_semantic_plan(
        deterministic_plan=deterministic_plan,
        llm_plan={
            "subject": "channel",
            "metrics": ["first_deposit"],
            "dimensions": ["channel_id"],
            "filters": {"channel_id": 990011},
            "missing_slots": [],
            "decision": {
                "route": "normal_text_to_sql",
                "reason_codes": ["llm_relaxed_route"],
            },
        },
    )

    notes: list[str] = []
    decision = merged_plan.get("decision") or {}
    if case.expected_route and decision.get("route") != case.expected_route:
        notes.append(
            f"route expected {case.expected_route}, got {decision.get('route')}"
        )
    _assert_contains_all(
        actual=merged_plan.get("missing_slots") or [],
        expected=case.expected_missing_slots,
        label="missing_slots",
        notes=notes,
    )
    return EvalResult(case, "pass" if not notes else "fail", merged_plan, notes)


def run_template_confidence_ablation(case: EvalCase) -> EvalResult:
    base_sample = {
        "id": "CONF_ABLATION_TEMPLATE",
        "question": case.query,
        "sql": "SELECT SUM(actual_amount) FROM dwd_order_deposit WHERE tenant_plat_id = :tenant_plat_id AND channel_id = :channel_id",
        "score": 0.86,
        "asset_kind": "sql_template",
        "template_mode": "anchored_template",
        "template_level": "L2",
        "parameter_schema": {
            "required": ["tenant_plat_id", "channel_id"],
        },
        "business_signature": {
            "templateId": "CONF_ABLATION_TEMPLATE",
            "positiveCues": ["充值", "存款"],
            "features": ["daily_summary"],
        },
    }
    approved_decision = build_template_decision(
        [{**base_sample, "source_type": "business_import"}],
        case.query,
        histories=[],
    )
    user_saved_decision = build_template_decision(
        [{**base_sample, "source_type": "user_saved"}],
        case.query,
        histories=[],
    )
    approved_score = float(approved_decision.get("score") or 0.0)
    user_saved_score = float(user_saved_decision.get("score") or 0.0)
    score_drop = approved_score - user_saved_score
    notes: list[str] = []
    if (
        case.expected_score_drop_min is not None
        and score_drop < case.expected_score_drop_min
    ):
        notes.append(
            "source_type ablation score_drop expected >= "
            f"{case.expected_score_drop_min}, got {score_drop:.3f}"
        )
    return EvalResult(
        case,
        "pass" if not notes else "fail",
        {
            "approved": approved_decision,
            "user_saved": user_saved_decision,
            "score_drop": score_drop,
        },
        notes,
    )


CASE_RUNNERS = {
    "missing_tenant_clarification": run_missing_tenant_clarification,
    "inactive_template_fallback": run_inactive_template_fallback,
    "configured_external_block": run_configured_external_block,
    "external_supply_rejects_missing_columns": run_external_supply_rejects_missing_columns,
    "external_supply_accepts_required_columns": run_external_supply_accepts_required_columns,
    "policy_required_slot": run_policy_required_slot,
    "semantic_plan_route_guard": run_semantic_plan_route_guard,
    "template_confidence_ablation": run_template_confidence_ablation,
}


def run_case(case: EvalCase) -> EvalResult:
    runner = CASE_RUNNERS.get(case.kind)
    if not runner:
        return EvalResult(case, "fail", notes=[f"unknown case kind: {case.kind}"])
    return runner(case)


def write_markdown_report(results: list[EvalResult], output: Path) -> None:
    now = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    lines = [
        "# 问数 Runtime 离线结构化评估结果",
        "",
        f"- 执行时间：{now}",
        f"- 总数：{len(results)}",
        f"- 通过：{sum(result.verdict == 'pass' for result in results)}",
        f"- 失败：{sum(result.verdict != 'pass' for result in results)}",
        "",
        "| case_id | kind | verdict | notes |",
        "| --- | --- | --- | --- |",
    ]
    for result in results:
        lines.append(
            "| {case_id} | {kind} | {verdict} | {notes} |".format(
                case_id=result.case.case_id,
                kind=result.case.kind,
                verdict=result.verdict,
                notes="<br>".join(result.notes) if result.notes else "-",
            )
        )
    lines.append("")
    lines.append("> 该报告只覆盖纯策略断言；UI E2E、数值对账、图表和产物化仍以问数回归测试计划为准。")
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "ask_runtime_eval_results.md",
        help="Markdown report path.",
    )
    parser.add_argument(
        "--no-report",
        action="store_true",
        help="Only print stdout summary and do not write markdown output.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    cases = load_cases(args.cases)
    results = [run_case(case) for case in cases]
    failed = [result for result in results if result.verdict != "pass"]

    for result in results:
        notes = "; ".join(result.notes) if result.notes else "ok"
        print(f"{result.case.case_id}: {result.verdict} ({notes})")

    if not args.no_report:
        write_markdown_report(results, args.output)
        print(f"wrote report: {args.output}")

    if failed:
        print(f"failed cases: {', '.join(result.case.case_id for result in failed)}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
