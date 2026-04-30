#!/usr/bin/env python3
"""Run route-level regression checks against the local AI service.

This script focuses on "should the ask flow hard-apply a business SQL template"
instead of doing full numeric SQL reconciliation. It is intentionally separated
from ``verify_tidb_regression.py`` so the expensive LLM-backed route smoke can be
run on demand with the active workspace deploy hash.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests


ROOT = Path(__file__).resolve().parent
OQ_CASES_CSV = ROOT / "csv" / "13_普通问数补充用例.csv"
TERMINAL_STATUSES = {"finished", "failed", "stopped"}
HARD_TEMPLATE_MODES = {"anchored_template", "executable_template"}
HARD_TEMPLATE_SQL_SOURCES = {"anchored_template", "rendered_template"}


@dataclass(frozen=True)
class RouteCase:
    case_id: str
    category: str
    question: str
    route_expectation: str
    pass_criteria: str


@dataclass
class RouteResult:
    case: RouteCase
    status: str
    ask_type: str | None
    template_decision: dict[str, Any]
    content: str | None = None
    error: str | None = None
    query_id: str | None = None

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
    def hard_template_applied(self) -> bool:
        return self.mode in HARD_TEMPLATE_MODES or self.sql_source in HARD_TEMPLATE_SQL_SOURCES


def load_oq_cases() -> list[RouteCase]:
    with OQ_CASES_CSV.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        return [
            RouteCase(
                case_id=row["test_id"],
                category=row["类型"],
                question=row["推荐问题"],
                route_expectation=row["路由预期"],
                pass_criteria=row["通过标准"],
            )
            for row in reader
        ]


def post_ask(
    *,
    ai_endpoint: str,
    case: RouteCase,
    mdl_hash: str,
    timeout: float,
) -> str:
    response = requests.post(
        f"{ai_endpoint.rstrip('/')}/v1/asks",
        json={
            "query": case.question,
            "mdl_hash": mdl_hash,
            "histories": [],
            "ignore_sql_generation_reasoning": False,
        },
        timeout=timeout,
    )
    response.raise_for_status()
    return response.json()["query_id"]


def poll_result(
    *,
    ai_endpoint: str,
    query_id: str,
    poll_interval: float,
    timeout: float,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last_payload: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        response = requests.get(
            f"{ai_endpoint.rstrip('/')}/v1/asks/{query_id}/result",
            timeout=15,
        )
        response.raise_for_status()
        payload = response.json()
        last_payload = payload
        if payload.get("status") in TERMINAL_STATUSES:
            return payload
        time.sleep(poll_interval)

    raise TimeoutError(
        f"ask {query_id} did not finish within {timeout:.0f}s; "
        f"last_status={(last_payload or {}).get('status')}"
    )


def run_case(args: argparse.Namespace, case: RouteCase) -> RouteResult:
    query_id: str | None = None
    try:
        query_id = post_ask(
            ai_endpoint=args.ai_endpoint,
            case=case,
            mdl_hash=args.mdl_hash,
            timeout=args.http_timeout,
        )
        payload = poll_result(
            ai_endpoint=args.ai_endpoint,
            query_id=query_id,
            poll_interval=args.poll_interval,
            timeout=args.case_timeout,
        )
        return RouteResult(
            case=case,
            status=payload.get("status") or "unknown",
            ask_type=payload.get("type"),
            template_decision=payload.get("template_decision")
            or payload.get("templateDecision")
            or {},
            content=payload.get("content"),
            error=(payload.get("error") or {}).get("message")
            if isinstance(payload.get("error"), dict)
            else payload.get("error"),
            query_id=query_id,
        )
    except Exception as exc:  # noqa: BLE001 - diagnostics script should capture all cases
        return RouteResult(
            case=case,
            status="error",
            ask_type=None,
            template_decision={},
            error=str(exc),
            query_id=query_id,
        )


def validate_results(
    results: list[RouteResult],
    *,
    max_hard_template_ratio: float,
) -> list[str]:
    failures: list[str] = []

    for result in results:
        case_id = result.case.case_id
        if result.status != "finished":
            failures.append(f"{case_id}: status={result.status}, error={result.error}")
            continue

        if case_id in {"OQ01", "OQ06", "OQ08"} and result.hard_template_applied:
            failures.append(
                f"{case_id}: hard template unexpectedly applied "
                f"(mode={result.mode}, sql_source={result.sql_source}, "
                f"template_id={result.template_id})"
            )

        expected_fallback = {
            "OQ01": "template_guard_plain_sql_requested",
            "OQ06": "template_guard_channel_period_summary_mismatch",
            "OQ08": "template_guard_login_without_deposit_mismatch",
        }.get(case_id)
        if expected_fallback and result.fallback_reason != expected_fallback:
            failures.append(
                f"{case_id}: fallback_reason={result.fallback_reason}, "
                f"expected={expected_fallback}"
            )

        if case_id == "OQ09" and result.ask_type != "GENERAL":
            failures.append(f"{case_id}: type={result.ask_type}, expected=GENERAL")
        if case_id == "OQ10" and result.ask_type != "GENERAL":
            failures.append(f"{case_id}: type={result.ask_type}, expected=GENERAL")
        if case_id == "OQ10" and result.hard_template_applied:
            failures.append(f"{case_id}: should clarify, but hard template was applied")

    finished = [result for result in results if result.status == "finished"]
    if finished:
        hard_count = sum(1 for result in finished if result.hard_template_applied)
        ratio = hard_count / len(finished)
        if ratio > max_hard_template_ratio:
            failures.append(
                f"OQ hard-template ratio {hard_count}/{len(finished)}={ratio:.0%} "
                f"exceeds max {max_hard_template_ratio:.0%}"
            )

    return failures


def render_markdown(results: list[RouteResult], failures: list[str]) -> str:
    lines = [
        "# 问数路由回归结果",
        "",
        f"- 执行时间：{datetime.now(timezone.utc).isoformat()}",
        f"- 结论：{'通过' if not failures else '失败'}",
        "",
        "| 用例 | 状态 | 类型 | 模式 | SQL 来源 | 模板 | 降级原因 | query_id |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for result in results:
        lines.append(
            "| {case_id} | {status} | {ask_type} | {mode} | {sql_source} | {template_id} | "
            "{fallback_reason} | {query_id} |".format(
                case_id=result.case.case_id,
                status=result.status,
                ask_type=result.ask_type or "-",
                mode=result.mode or "-",
                sql_source=result.sql_source or "-",
                template_id=result.template_id or "-",
                fallback_reason=result.fallback_reason or "-",
                query_id=result.query_id or "-",
            )
        )

    if failures:
        lines.extend(["", "## 失败项", ""])
        lines.extend(f"- {failure}" for failure in failures)

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
    parser.add_argument(
        "--case",
        action="append",
        dest="cases",
        help="Run only the specified case id. Can be passed multiple times.",
    )
    parser.add_argument("--http-timeout", type=float, default=15)
    parser.add_argument("--poll-interval", type=float, default=2)
    parser.add_argument("--case-timeout", type=float, default=180)
    parser.add_argument(
        "--max-hard-template-ratio",
        type=float,
        default=0.4,
        help="Allowed ratio of OQ cases that hard-apply anchored/executable templates.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional markdown output path for the run summary.",
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

    cases = load_oq_cases()
    if args.cases:
        wanted = set(args.cases)
        cases = [case for case in cases if case.case_id in wanted]
        missing = wanted - {case.case_id for case in cases}
        if missing:
            print(f"未知 case id: {', '.join(sorted(missing))}", file=sys.stderr)
            return 2

    results: list[RouteResult] = []
    for case in cases:
        print(f"[route] {case.case_id} {case.question}")
        result = run_case(args, case)
        results.append(result)
        print(
            "  -> status={status} type={ask_type} mode={mode} sql_source={sql_source} "
            "template={template_id} fallback={fallback_reason}".format(
                status=result.status,
                ask_type=result.ask_type or "-",
                mode=result.mode or "-",
                sql_source=result.sql_source or "-",
                template_id=result.template_id or "-",
                fallback_reason=result.fallback_reason or "-",
            )
        )

    failures = validate_results(
        results,
        max_hard_template_ratio=args.max_hard_template_ratio,
    )
    markdown = render_markdown(results, failures)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(markdown, encoding="utf-8")
        print(f"结果已写入：{args.output}")

    if failures:
        print(markdown)
        return 1

    print("问数路由回归通过。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
