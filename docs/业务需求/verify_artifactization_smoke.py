#!/usr/bin/env python3
"""Smoke-check ask result artifactization endpoints.

This runner is intentionally separate from ask route regression. It verifies the
UI-side artifact surface after a query has already produced a response:

- dashboard item list / preview
- spreadsheet list / preview
- response feedback lookup
- repo-local CSV/XLS export utility presence

By default it is read-only. Use --dry-run when local services are not running.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen


REPO_ROOT = Path(__file__).resolve().parents[2]
EXPORT_UTILITY = REPO_ROOT / "wren-ui/src/utils/exportTabularData.ts"
SPREADSHEET_API = REPO_ROOT / "wren-ui/src/pages/api/v1/spreadsheets/index.ts"
DASHBOARD_ITEM_API = REPO_ROOT / "wren-ui/src/pages/api/v1/dashboard-items/index.ts"
FEEDBACK_API = REPO_ROOT / "wren-ui/src/pages/api/v1/thread-responses/[id]/feedback.ts"


@dataclass(frozen=True)
class SmokeTarget:
    name: str
    method: str
    path: str
    body: dict[str, Any] | None = None
    scope: str = "runtime"
    expected_statuses: tuple[int, ...] = (200,)
    required: bool = True


@dataclass
class SmokeResult:
    name: str
    target: str
    status: str
    detail: str = ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Verify ask result artifactization endpoints.",
    )
    parser.add_argument("--ui-endpoint", default="http://127.0.0.1:3002")
    parser.add_argument("--workspace-id")
    parser.add_argument("--knowledge-base-id")
    parser.add_argument("--kb-snapshot-id")
    parser.add_argument("--deploy-hash")
    parser.add_argument("--thread-response-id")
    parser.add_argument("--dashboard-item-id")
    parser.add_argument("--spreadsheet-id")
    parser.add_argument("--authorization", help="Optional Authorization header value")
    parser.add_argument("--cookie", help="Optional Cookie header value")
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--report", help="Optional markdown report output path")
    return parser.parse_args()


def runtime_scope_params(args: argparse.Namespace) -> dict[str, str]:
    candidates = {
        "workspaceId": args.workspace_id,
        "knowledgeBaseId": args.knowledge_base_id,
        "kbSnapshotId": args.kb_snapshot_id,
        "deployHash": args.deploy_hash,
    }
    return {key: value for key, value in candidates.items() if value}


def build_url(endpoint: str, path: str, params: dict[str, str]) -> str:
    base = endpoint.rstrip("/") + "/"
    url = urljoin(base, path.lstrip("/"))
    if params:
        return f"{url}?{urlencode(params)}"
    return url


def build_targets(args: argparse.Namespace) -> list[SmokeTarget]:
    targets = [
        SmokeTarget("spreadsheet_list", "GET", "/api/v1/spreadsheets"),
        SmokeTarget("dashboard_list", "GET", "/api/v1/dashboards"),
    ]
    if args.spreadsheet_id:
        targets.append(
            SmokeTarget(
                "spreadsheet_preview",
                "POST",
                f"/api/v1/spreadsheets/{args.spreadsheet_id}/preview",
                body={"page": 1, "pageSize": 20, "includeCount": True},
            )
        )
    if args.dashboard_item_id:
        targets.append(
            SmokeTarget(
                "dashboard_item_preview",
                "POST",
                f"/api/v1/dashboard-items/{args.dashboard_item_id}/preview",
                body={"limit": 20, "refresh": False},
                scope="workspace",
            )
        )
    if args.thread_response_id:
        targets.append(
            SmokeTarget(
                "response_feedback",
                "GET",
                f"/api/v1/thread-responses/{args.thread_response_id}/feedback",
                expected_statuses=(200, 204),
                required=False,
            )
        )
    return targets


def request_json(
    *,
    url: str,
    method: str,
    authorization: str | None,
    cookie: str | None,
    timeout: float,
    body: dict[str, Any] | None = None,
) -> tuple[int, Any]:
    headers = {"Accept": "application/json"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    if authorization:
        headers["Authorization"] = authorization
    if cookie:
        headers["Cookie"] = cookie

    request = Request(url, data=data, method=method, headers=headers)
    with urlopen(request, timeout=timeout) as response:
        body = response.read()
        if not body:
            return response.status, None
        try:
            return response.status, json.loads(body.decode("utf-8"))
        except json.JSONDecodeError:
            return response.status, body.decode("utf-8", errors="replace")[:500]


def check_repo_assets() -> list[SmokeResult]:
    results: list[SmokeResult] = []
    for name, path in (
        ("csv_excel_export_utility", EXPORT_UTILITY),
        ("spreadsheet_api", SPREADSHEET_API),
        ("dashboard_item_api", DASHBOARD_ITEM_API),
        ("response_feedback_api", FEEDBACK_API),
    ):
        results.append(
            SmokeResult(
                name=name,
                target=str(path.relative_to(REPO_ROOT)),
                status="pass" if path.exists() else "fail",
                detail="found" if path.exists() else "missing",
            )
        )
    return results


def run_http_checks(args: argparse.Namespace) -> list[SmokeResult]:
    params = runtime_scope_params(args)
    workspace_only_params = {
        "workspaceId": args.workspace_id,
    } if args.workspace_id else {}
    results: list[SmokeResult] = []
    for target in build_targets(args):
        url = build_url(
            args.ui_endpoint,
            target.path,
            workspace_only_params if target.scope == "workspace" else params,
        )
        if args.dry_run:
            results.append(
                SmokeResult(
                    name=target.name,
                    target=url,
                    status="skip",
                    detail="dry-run",
                )
            )
            continue

        try:
            status, payload = request_json(
                url=url,
                method=target.method,
                authorization=args.authorization,
                cookie=args.cookie,
                timeout=args.timeout,
                body=target.body,
            )
        except HTTPError as error:
            status = error.code
            payload = error.read().decode("utf-8", errors="replace")[:500]
        except URLError as error:
            results.append(
                SmokeResult(
                    name=target.name,
                    target=url,
                    status="fail" if target.required else "warn",
                    detail=f"network_error: {error.reason}",
                )
            )
            continue

        ok = status in target.expected_statuses
        detail = f"HTTP {status}"
        if not ok:
            detail = f"{detail}; payload={str(payload)[:300]}"
        results.append(
            SmokeResult(
                name=target.name,
                target=url,
                status="pass" if ok else "fail" if target.required else "warn",
                detail=detail,
            )
        )
    return results


def render_report(results: list[SmokeResult], args: argparse.Namespace) -> str:
    lines = [
        "# 问数产物化冒烟验证报告",
        "",
        f"- 生成时间：{datetime.now().isoformat(timespec='seconds')}",
        f"- UI Endpoint：`{args.ui_endpoint}`",
        f"- Dry Run：`{args.dry_run}`",
        "",
        "| 检查项 | 目标 | 结果 | 说明 |",
        "| --- | --- | --- | --- |",
    ]
    for result in results:
        lines.append(
            f"| {result.name} | `{result.target}` | {result.status} | "
            f"{result.detail} |"
        )
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    results = [*check_repo_assets(), *run_http_checks(args)]
    report = render_report(results, args)
    if args.report:
        Path(args.report).write_text(report, encoding="utf-8")
    print(report)
    return 1 if any(result.status == "fail" for result in results) else 0


if __name__ == "__main__":
    sys.exit(main())
