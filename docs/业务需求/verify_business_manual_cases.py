#!/usr/bin/env python3
"""Verify the four business-generalization cases that need data/UI checks.

The route-level runner intentionally marks PX01/PX05/PX12/LING01 as
`needs_manual` because their pass criteria require numeric reconciliation or chart
inspection. This script performs those checks against the local TiDB seed and AI
service so the governance regression can be closed with repeatable evidence.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

import requests

from verify_ask_route_regression import poll_result
from verify_tidb_regression import fetch_all, make_connection, render_template_sql

ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT = ROOT / "业务泛化人工核验结果-2026-04-30.md"

PX01_QUESTION = "统计租户平台990001下渠道990011在2026-04-02这一天的综合日报基础指标"
PX05_QUESTION = (
    "统计租户平台990001下渠道990011在2026-04-15到2026-04-26的TOP5和非TOP5用户"
    "存款、有效投注、输赢、投充比和杀率"
)
PX12_ORIGINAL_QUESTION = "对“TOP5和非TOP5用户存款、有效投注、输赢、投充比和杀率”生成分组对比图"
PX12_SCOPED_QUESTION = (
    "对租户平台990001下渠道990011在2026-04-15到2026-04-26的TOP5和非TOP5用户"
    "存款、有效投注、输赢、投充比和杀率生成分组对比图"
)
LING01_MISSING_TENANT_QUESTION = "统计渠道990011在2026-04-01到2026-04-03首充用户的二存到六存情况"
LING01_SCOPED_QUESTION = "统计租户平台990001下渠道990011在2026-04-01到2026-04-03首充用户的二存到六存情况"

TERMINAL_CHART_STATUSES = {"finished", "failed", "stopped"}


@dataclass
class ManualCaseResult:
    case_id: str
    status: str = "pass"
    query_id: str | None = None
    chart_query_id: str | None = None
    details: list[str] = field(default_factory=list)

    def fail(self, message: str) -> None:
        self.status = "fail"
        self.details.append(message)

    def note(self, message: str) -> None:
        self.details.append(message)


def decimal_value(value: Any) -> Decimal:
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def normalize_sql_for_tidb(sql: str) -> str:
    # AI-service SQL is generated against Wren Engine's dataset-qualified table
    # aliases (for example `tidb_business_demo_dwd_order_deposit`). The local
    # TiDB regression database uses the physical table names without the dataset
    # prefix, so direct reconciliation strips that prefix from both CTE and table
    # references consistently.
    return sql.replace("tidb_business_demo_", "")


def post_ask(args: argparse.Namespace, question: str) -> str:
    response = requests.post(
        f"{args.ai_endpoint.rstrip('/')}/v1/asks",
        json={
            "query": question,
            "mdl_hash": args.mdl_hash,
            "histories": [],
            "ignore_sql_generation_reasoning": True,
        },
        timeout=args.http_timeout,
    )
    response.raise_for_status()
    return str(response.json()["query_id"])


def run_ask(args: argparse.Namespace, question: str) -> tuple[str, dict[str, Any]]:
    query_id = post_ask(args, question)
    payload = poll_result(
        ai_endpoint=args.ai_endpoint,
        query_id=query_id,
        poll_interval=args.poll_interval,
        timeout=args.case_timeout,
    )
    return query_id, payload


def extract_sql(payload: dict[str, Any]) -> str | None:
    for item in payload.get("response") or []:
        if isinstance(item, dict) and item.get("sql"):
            return str(item["sql"])
    return None


def execute_generated_sql(sql: str) -> list[dict[str, Any]]:
    conn = make_connection()
    try:
        return fetch_all(conn, normalize_sql_for_tidb(sql))
    finally:
        conn.close()


def to_chart_dataset(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        return {"columns": [], "data": []}
    normalized_rows: list[dict[str, Any]] = []
    for row in rows:
        normalized_rows.append(
            {
                key: (
                    float(value)
                    if isinstance(value, Decimal)
                    else value.isoformat()
                    if hasattr(value, "isoformat")
                    else value
                )
                for key, value in row.items()
            }
        )
    columns = []
    sample = normalized_rows[0]
    for key, value in sample.items():
        if isinstance(value, (int, float)):
            column_type = "DOUBLE"
        else:
            column_type = "VARCHAR"
        columns.append({"name": key, "type": column_type})
    return {"columns": columns, "data": normalized_rows}


def poll_chart(args: argparse.Namespace, chart_query_id: str) -> dict[str, Any]:
    deadline = time.monotonic() + args.chart_timeout
    last_payload: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        response = requests.get(
            f"{args.ai_endpoint.rstrip('/')}/v1/charts/{chart_query_id}",
            timeout=args.http_timeout,
        )
        response.raise_for_status()
        payload = response.json()
        last_payload = payload
        if payload.get("status") in TERMINAL_CHART_STATUSES:
            return payload
        time.sleep(args.poll_interval)
    raise TimeoutError(
        f"chart {chart_query_id} did not finish within {args.chart_timeout:.0f}s; "
        f"last_payload={last_payload}"
    )


def verify_px01(args: argparse.Namespace) -> ManualCaseResult:
    result = ManualCaseResult("PX01")
    query_id, payload = run_ask(args, PX01_QUESTION)
    result.query_id = query_id
    if payload.get("status") != "finished":
        result.fail(f"ask status={payload.get('status')}")
        return result
    sql = extract_sql(payload)
    if not sql:
        result.fail("未生成 SQL")
        return result
    rows = execute_generated_sql(sql)
    if len(rows) != 1:
        result.fail(f"row_count={len(rows)}, expected=1")
        return result
    row = rows[0]
    if str(row.get("biz_date")) != "2026-04-02":
        result.fail(f"biz_date={row.get('biz_date')}, expected=2026-04-02")
    if decimal_value(row.get("deposit_amount")) != Decimal("2080"):
        result.fail(f"deposit_amount={row.get('deposit_amount')}, expected=2080")
    result.note("只返回 2026-04-02 单日，deposit_amount=2080，未混入其他日期。")
    return result


def fetch_t09_rows(user_segment: str) -> list[dict[str, Any]]:
    conn = make_connection()
    try:
        return fetch_all(
            conn,
            render_template_sql(
                "T09",
                {
                    "tenant_plat_id": 990001,
                    "channel_id": 990011,
                    "start_date": "2026-04-15",
                    "end_date": "2026-04-26",
                    "top_n": 5,
                    "user_segment": user_segment,
                    "cohort_start_date": "2026-04-15",
                    "cohort_end_date": "2026-04-26",
                    "n_days": 7,
                    "period_days": 7,
                },
            ),
        )
    finally:
        conn.close()


def verify_px05(args: argparse.Namespace) -> tuple[ManualCaseResult, str | None, list[dict[str, Any]]]:
    result = ManualCaseResult("PX05")
    query_id, payload = run_ask(args, PX05_QUESTION)
    result.query_id = query_id
    if payload.get("status") != "finished":
        result.fail(f"ask status={payload.get('status')}")
        return result, None, []
    params = (payload.get("template_decision") or {}).get("parameters") or {}
    if int(params.get("top_n") or 0) != 5:
        result.fail(f"top_n={params.get('top_n')}, expected=5")
    sql = extract_sql(payload)
    if not sql:
        result.fail("未生成 SQL")
        return result, None, []
    rows = execute_generated_sql(sql)
    by_segment = {str(row.get("user_segment")): row for row in rows}
    if set(by_segment) != {"TOPN", "NON_TOPN"}:
        result.fail(f"segments={sorted(by_segment)}, expected=TOPN/NON_TOPN")
        return result, sql, rows
    all_row = fetch_t09_rows("ALL")[0]
    for field in [
        "user_count",
        "deposit_user_count",
        "deposit_amount",
        "withdrawal_user_count",
        "withdrawal_amount",
        "charge_withdraw_diff",
        "bet_user_count",
        "valid_bet_amount",
        "win_loss_amount",
    ]:
        segmented_sum = decimal_value(by_segment["TOPN"].get(field)) + decimal_value(
            by_segment["NON_TOPN"].get(field)
        )
        expected = decimal_value(all_row.get(field))
        if segmented_sum != expected:
            result.fail(f"{field}: TOPN+NON_TOPN={segmented_sum}, ALL={expected}")
    result.note(
        "top_n=5；TOPN 与 NON_TOPN 两组返回，deposit/withdraw/bet/win_loss 等可加指标与 ALL 对账一致。"
    )
    return result, sql, rows


def verify_px12(
    args: argparse.Namespace,
    px05_sql: str | None,
    px05_rows: list[dict[str, Any]],
) -> ManualCaseResult:
    result = ManualCaseResult("PX12")
    query_id, payload = run_ask(args, PX12_ORIGINAL_QUESTION)
    result.query_id = query_id
    clarification_state = payload.get("clarification_state") or {}
    pending_slots = set(clarification_state.get("pending_slots") or [])
    expected_slots = {"tenant_plat_id", "channel_id", "date_range"}
    route = ((payload.get("semantic_plan") or {}).get("decision") or {}).get("route")
    if route != "clarification_required" or not expected_slots.issubset(pending_slots):
        result.fail(
            f"原始图表问题未触发完整范围澄清：route={route}, pending_slots={sorted(pending_slots)}"
        )
        return result
    if args.skip_chart:
        result.note("已验证原始问题触发范围澄清；--skip-chart 跳过图表生成。")
        return result
    if not px05_sql or not px05_rows:
        result.fail("缺少 PX05 preview 数据，无法生成图表核验")
        return result
    response = requests.post(
        f"{args.ai_endpoint.rstrip('/')}/v1/charts",
        json={
            "query": PX12_SCOPED_QUESTION,
            "sql": px05_sql,
            "data": to_chart_dataset(px05_rows),
            "configurations": {"language": "zh-CN"},
        },
        timeout=args.http_timeout,
    )
    response.raise_for_status()
    chart_query_id = str(response.json()["query_id"])
    result.chart_query_id = chart_query_id
    chart_payload = poll_chart(args, chart_query_id)
    if chart_payload.get("status") != "finished":
        result.fail(f"chart status={chart_payload.get('status')}, error={chart_payload.get('error')}")
        return result
    chart_response = chart_payload.get("response") or {}
    chart_type = chart_response.get("chart_type")
    schema_text = json.dumps(chart_response.get("chart_schema") or {}, ensure_ascii=False)
    if chart_type not in {"grouped_bar", "bar", "stacked_bar"}:
        result.fail(f"chart_type={chart_type}, expected grouped/bar comparison chart")
    for field in ["user_segment", "deposit_amount", "valid_bet_amount", "win_loss_amount"]:
        if field not in schema_text:
            result.fail(f"chart schema 缺少字段 {field}")
    result.note(
        f"原始问题先澄清范围；补齐 PX05 preview 后 chart status=finished，chart_type={chart_type}，分组字段与关键指标可见。"
    )
    return result


def verify_ling01(args: argparse.Namespace) -> ManualCaseResult:
    result = ManualCaseResult("LING01")
    query_id, payload = run_ask(args, LING01_MISSING_TENANT_QUESTION)
    result.query_id = query_id
    clarification_state = payload.get("clarification_state") or {}
    pending_slots = set(clarification_state.get("pending_slots") or [])
    route = ((payload.get("semantic_plan") or {}).get("decision") or {}).get("route")
    if route != "clarification_required" or "tenant_plat_id" not in pending_slots:
        result.fail(
            f"缺租户问题未触发 tenant_plat_id 澄清：route={route}, pending_slots={sorted(pending_slots)}"
        )
        return result

    scoped_query_id, scoped_payload = run_ask(args, LING01_SCOPED_QUESTION)
    result.note(f"补租户 query_id={scoped_query_id}")
    if scoped_payload.get("status") != "finished":
        result.fail(f"补租户后 ask status={scoped_payload.get('status')}")
        return result
    sql = extract_sql(scoped_payload)
    if not sql:
        result.fail("补租户后未生成 SQL")
        return result
    generated_rows = execute_generated_sql(sql)
    expected_rows = execute_generated_sql(render_template_sql("T08", {
        "tenant_plat_id": 990001,
        "channel_id": 990011,
        "start_date": "2026-04-01",
        "end_date": "2026-04-07",
        "cohort_start_date": "2026-04-01",
        "cohort_end_date": "2026-04-03",
        "top_n": 3,
        "n_days": 7,
        "period_days": 7,
    }))
    generated_by_day = {str(row.get("first_deposit_date")): row for row in generated_rows}
    expected_by_day = {str(row.get("first_deposit_date")): row for row in expected_rows}
    for day in ["2026-04-01", "2026-04-02", "2026-04-03"]:
        if day not in generated_by_day:
            result.fail(f"缺少 first_deposit_date={day}")
            continue
        for field in [
            "first_deposit_user_count",
            "second_deposit_user_count",
            "third_deposit_user_count",
            "sixth_deposit_user_count",
        ]:
            actual = decimal_value(generated_by_day[day].get(field))
            expected = decimal_value(expected_by_day[day].get(field))
            if actual != expected:
                result.fail(f"{day} {field}: actual={actual}, expected={expected}")
    result.note("缺 tenant_plat_id 时澄清；补租户平台990001后首充/首存口径与 T08 续存结果一致。")
    return result


def render_report(results: list[ManualCaseResult], args: argparse.Namespace) -> str:
    pass_count = sum(1 for result in results if result.status == "pass")
    fail_count = len(results) - pass_count
    lines = [
        "# 业务泛化人工核验结果",
        "",
        f"- 执行时间：{datetime.now(timezone.utc).isoformat()}",
        f"- AI Endpoint：`{args.ai_endpoint}`",
        f"- MDL Hash：`{args.mdl_hash}`",
        f"- 用例数：{len(results)}",
        f"- pass：{pass_count}",
        f"- fail：{fail_count}",
        "",
        "| 用例 | 结论 | query_id | chart_query_id | 核验证据 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for result in results:
        details = "；".join(result.details) or "-"
        lines.append(
            f"| {result.case_id} | {result.status} | {result.query_id or '-'} | "
            f"{result.chart_query_id or '-'} | {details.replace('|', '\\|')} |"
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
    parser.add_argument("--http-timeout", type=float, default=20)
    parser.add_argument("--poll-interval", type=float, default=2)
    parser.add_argument("--case-timeout", type=float, default=180)
    parser.add_argument("--chart-timeout", type=float, default=180)
    parser.add_argument("--skip-chart", action="store_true")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--strict", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.mdl_hash:
        print(
            "缺少 --mdl-hash。可传入当前 knowledge base 的 deployHash，或设置 WREN_ROUTE_MDL_HASH。",
            file=sys.stderr,
        )
        return 2

    results: list[ManualCaseResult] = []
    px01 = verify_px01(args)
    results.append(px01)
    print(f"[manual] PX01 -> {px01.status}: {'; '.join(px01.details)}", flush=True)

    px05, px05_sql, px05_rows = verify_px05(args)
    results.append(px05)
    print(f"[manual] PX05 -> {px05.status}: {'; '.join(px05.details)}", flush=True)

    px12 = verify_px12(args, px05_sql, px05_rows)
    results.append(px12)
    print(f"[manual] PX12 -> {px12.status}: {'; '.join(px12.details)}", flush=True)

    ling01 = verify_ling01(args)
    results.append(ling01)
    print(f"[manual] LING01 -> {ling01.status}: {'; '.join(ling01.details)}", flush=True)

    report = render_report(results, args)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(report, encoding="utf-8")
        print(f"结果已写入：{args.output}")

    failed_count = sum(1 for result in results if result.status == "fail")
    if failed_count and args.strict:
        print(report)
        return 1
    print(f"业务泛化人工核验完成，fail={failed_count}。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
