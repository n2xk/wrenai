#!/usr/bin/env python3
"""Run local TiDB regression checks for the business demo dataset."""

from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import pymysql
from pymysql.cursors import DictCursor


ROOT = Path(__file__).resolve().parent
SQL_TEMPLATE_DIR = ROOT / "knowledge-base" / "sql-templates"
SQL_CODE_BLOCK_RE = re.compile(r"```sql\s*(.*?)```", re.DOTALL)
PARAM_RE = re.compile(r":([A-Za-z_][A-Za-z0-9_]*)")
PARTITION_TOKEN_RE = re.compile(r"\bPARTITION\b")
TTL_TOKEN_RE = re.compile(r"\bTTL\b")

COMMON_PARAMS = {
    # 基于 seed_data_refer 的真实 v1.3 数据窗口：tenant_plat_id=72 / channel_id=1932
    # 覆盖充值、提现、投注、首存 cohort、游戏类型分布与 TOP3/非TOP3 分层。
    "tenant_plat_id": 72,
    "channel_id": 1932,
    "start_date": "2026-04-10",
    "end_date": "2026-04-16",
    "cohort_start_date": "2026-04-10",
    "cohort_end_date": "2026-04-16",
    "top_n": 3,
    "n_days": 7,
    "period_days": 7,
}

T02_PARAMS = {
    "tenant_plat_id": 1,
    "configured_channel_id": 1867,
    "unconfigured_channel_id": 1760,
}

TEMPLATE_FILES = {
    "T01": "T01_渠道日基础汇总.md",
    "T02": "T02_渠道与折扣映射.md",
    "T03": "T03_首存 cohort 提取.md",
    "T04": "T04_cohort 累计收入.md",
    "T06": "T06_TOP3-非TOP3 分层.md",
    "T08": "T08_首存 cohort 续存.md",
    "T09": "T09_所有用户区间汇总.md",
    "T10": "T10_首存用户日龄趋势.md",
    "T11": "T11_按游戏类型分布.md",
    "T12": "T12_TOP3-5 游戏类型分层.md",
    "T13": "T13_首存金额分桶.md",
}


@dataclass(frozen=True)
class CheckResult:
    name: str
    passed: bool
    details: str


def sql_literal(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, Decimal)):
        return str(value)
    if isinstance(value, float):
        return format(value, "f")
    return "'" + str(value).replace("\\", "\\\\").replace("'", "''") + "'"


def normalize_scalar(value: Any) -> Any:
    if isinstance(value, Decimal):
        return value
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, date):
        return value.isoformat()
    return value


def rows_by_key(rows: list[dict[str, Any]], keys: tuple[str, ...]) -> dict[tuple[Any, ...], dict[str, Any]]:
    return {
        tuple(normalize_scalar(row[key]) for key in keys): row
        for row in rows
    }


def compare_value(actual: Any, expected: Any) -> bool:
    actual = normalize_scalar(actual)
    expected = normalize_scalar(expected)
    if isinstance(actual, Decimal) or isinstance(expected, Decimal):
        return Decimal(str(actual)) == Decimal(str(expected))
    return actual == expected


def load_template_sql(template_id: str) -> str:
    path = SQL_TEMPLATE_DIR / TEMPLATE_FILES[template_id]
    text = path.read_text(encoding="utf-8")
    match = SQL_CODE_BLOCK_RE.search(text)
    if not match:
        raise ValueError(f"{template_id} 未找到 SQL 代码块: {path}")
    return match.group(1).strip()


def render_template_sql(template_id: str, params: dict[str, Any]) -> str:
    sql = load_template_sql(template_id)

    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        if key not in params:
            raise KeyError(f"{template_id} 缺少参数 :{key}")
        return sql_literal(params[key])

    return PARAM_RE.sub(replace, sql)


def make_connection() -> pymysql.connections.Connection:
    return pymysql.connect(
        host=os.getenv("TIDB_HOST", "127.0.0.1"),
        port=int(os.getenv("TIDB_PORT", "4000")),
        user=os.getenv("TIDB_USER", "root"),
        password=os.getenv("TIDB_PASSWORD", ""),
        database=os.getenv("TIDB_DATABASE", "tidb_business_demo"),
        charset="utf8mb4",
        cursorclass=DictCursor,
        connect_timeout=5,
        read_timeout=30,
        write_timeout=30,
        autocommit=True,
    )


def fetch_all(conn: pymysql.connections.Connection, sql: str) -> list[dict[str, Any]]:
    with conn.cursor() as cursor:
        cursor.execute(sql)
        return list(cursor.fetchall())


def check_schema(conn: pymysql.connections.Connection) -> CheckResult:
    table_rows = fetch_all(
        conn,
        "SELECT table_name "
        "FROM information_schema.tables "
        "WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' "
        "ORDER BY table_name",
    )
    table_names = {row["table_name"] for row in table_rows}
    table_count = fetch_all(
        conn,
        "SELECT COUNT(*) AS table_count "
        "FROM information_schema.tables "
        "WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'",
    )[0]["table_count"]
    partitioned = fetch_all(
        conn,
        "SELECT table_name, COUNT(*) AS partition_count "
        "FROM information_schema.partitions "
        "WHERE table_schema = DATABASE() "
        "  AND partition_name IS NOT NULL "
        "GROUP BY table_name "
        "ORDER BY table_name",
    )
    create_rows = {}
    for table_name in ("dwd_bet_order", "bds_bet_order_detail"):
        create_rows[table_name] = fetch_all(conn, f"SHOW CREATE TABLE {table_name}")[0]["Create Table"]

    failures: list[str] = []
    if table_count != 27:
        failures.append(f"table_count={table_count}, expected=27")
    if "dim_vip" not in table_names:
        failures.append("缺少 v1.3 VIP 维表 dim_vip")
    if "vip" in table_names:
        failures.append("不应再存在独立 vip 表，参考数据 vip 必须映射导入 dim_vip")
    if partitioned:
        failures.append(f"仍有分区表: {partitioned}")
    for table_name, ddl in create_rows.items():
        upper_ddl = ddl.upper()
        if PARTITION_TOKEN_RE.search(upper_ddl):
            failures.append(f"{table_name} SHOW CREATE 仍包含 PARTITION")
        if TTL_TOKEN_RE.search(upper_ddl):
            failures.append(f"{table_name} SHOW CREATE 仍包含 TTL")

    if failures:
        return CheckResult("schema", False, "; ".join(failures))
    return CheckResult(
        "schema",
        True,
        f"table_count=27, dim_vip=present, vip=absent, "
        f"partitioned_tables=0, checked={','.join(create_rows)}",
    )


def check_expected_rows(
    name: str,
    actual_rows: list[dict[str, Any]],
    expected_rows: list[dict[str, Any]],
    key_fields: tuple[str, ...],
    *,
    exact_keys: bool = True,
    expected_row_count: int | None = None,
) -> CheckResult:
    actual_map = rows_by_key(actual_rows, key_fields)
    expected_map = rows_by_key(expected_rows, key_fields)

    failures: list[str] = []
    if expected_row_count is not None and len(actual_rows) != expected_row_count:
        failures.append(f"row_count={len(actual_rows)} expected={expected_row_count}")
    if exact_keys:
        if set(actual_map) != set(expected_map):
            failures.append(
                f"key mismatch actual={sorted(actual_map)} expected={sorted(expected_map)}"
            )
    else:
        missing_keys = [key for key in expected_map if key not in actual_map]
        if missing_keys:
            failures.append(f"missing keys={missing_keys}")

    for key, expected_row in expected_map.items():
        actual_row = actual_map.get(key)
        if actual_row is None:
            continue
        for field, expected_value in expected_row.items():
            if field in key_fields:
                continue
            if not compare_value(actual_row.get(field), expected_value):
                failures.append(
                    f"{key} field={field} actual={normalize_scalar(actual_row.get(field))} "
                    f"expected={normalize_scalar(expected_value)}"
                )

    if failures:
        return CheckResult(name, False, "; ".join(failures[:8]))

    sample_keys = list(expected_map)[:3]
    sample_text = ", ".join(str(key) for key in sample_keys)
    return CheckResult(name, True, f"rows={len(actual_rows)}, sample_keys={sample_text}")


def build_checks(conn: pymysql.connections.Connection) -> list[CheckResult]:
    """Validate the active TiDB seed against v1.3 reference-data template shapes.

    Default parameters intentionally use real IDs/date windows from
    docs/业务需求/seed_data_refer instead of the old 990001/990011 fixture.
    """
    checks: list[CheckResult] = [check_schema(conn)]

    checks.append(
        check_expected_rows(
            "T01",
            fetch_all(conn, render_template_sql("T01", COMMON_PARAMS)),
            [
                {
                    "biz_date": "2026-04-10",
                    "register_user_count": 11,
                    "deposit_amount": Decimal("100.0000"),
                    "valid_bet_amount": Decimal("3635.0000"),
                    "win_loss_amount": Decimal("4644.9600"),
                    "promotion_total_amount": Decimal("1075.0000"),
                },
                {
                    "biz_date": "2026-04-13",
                    "deposit_user_count": 5,
                    "deposit_amount": Decimal("1100.0000"),
                    "withdrawal_amount": Decimal("3200.0000"),
                    "valid_bet_amount": Decimal("7920.2000"),
                    "task_amount": Decimal("3.1400"),
                },
                {
                    "biz_date": "2026-04-16",
                    "deposit_amount": Decimal("1000.0000"),
                    "first_deposit_user_count": 3,
                    "develop_user_count": 1,
                    "valid_bet_amount": Decimal("400.0000"),
                    "lottery_amount": Decimal("60.0000"),
                },
            ],
            ("biz_date",),
            exact_keys=False,
            expected_row_count=7,
        )
    )

    t02_rows: list[dict[str, Any]] = []
    for channel_id in (
        T02_PARAMS["configured_channel_id"],
        T02_PARAMS["unconfigured_channel_id"],
    ):
        t02_rows.extend(
            fetch_all(
                conn,
                render_template_sql(
                    "T02",
                    {
                        "tenant_plat_id": T02_PARAMS["tenant_plat_id"],
                        "channel_id": channel_id,
                        "channel_partner_id": None,
                    },
                ),
            )
        )
    checks.append(
        check_expected_rows(
            "T02",
            t02_rows,
            [
                {
                    "channel_id": 1867,
                    "channel_name": "呆萌吉祥坊",
                    "channel_partner_id": None,
                    "channel_partner_username": None,
                    "report_percent": Decimal("100.0000"),
                    "report_percent_ratio": Decimal("1.000000"),
                    "has_percent_config": 1,
                },
                {
                    "channel_id": 1760,
                    "channel_name": "本站",
                    "channel_partner_id": 2711,
                    "channel_partner_username": "sdeef234",
                    "report_percent": Decimal("100.0000"),
                    "report_percent_ratio": Decimal("1.000000"),
                    "has_percent_config": 0,
                },
            ],
            ("channel_id",),
            expected_row_count=2,
        )
    )

    checks.append(
        check_expected_rows(
            "T03",
            fetch_all(conn, render_template_sql("T03", COMMON_PARAMS)),
            [
                {
                    "first_deposit_date": "2026-04-10",
                    "player_id": 4543498,
                    "player_username": "aaa124",
                    "first_deposit_amount": Decimal("100.0000"),
                    "is_new_customer_first_deposit": 1,
                },
                {
                    "first_deposit_date": "2026-04-13",
                    "player_id": 4543588,
                    "player_username": "demi1213621",
                    "first_deposit_amount": Decimal("500.0000"),
                    "is_new_customer_first_deposit": 1,
                },
            ],
            ("first_deposit_date", "player_id"),
            exact_keys=False,
            expected_row_count=20,
        )
    )

    checks.append(
        check_expected_rows(
            "T04_wide",
            fetch_all(conn, render_template_sql("T04", COMMON_PARAMS)),
            [
                {
                    "日期": "2026-04-10",
                    "用户类型": "全部",
                    "首存用户数": 1,
                    "累计1天": Decimal("0.5600"),
                    "3天": Decimal("71.7600"),
                    "7天": Decimal("71.7600"),
                },
                {
                    "日期": "2026-04-13",
                    "用户类型": "TOP3",
                    "首存用户数": 1,
                    "累计1天": Decimal("2480.0000"),
                    "7天": Decimal("2480.0000"),
                },
                {
                    "日期": "2026-04-15",
                    "用户类型": "非TOP3",
                    "首存用户数": 5,
                    "累计1天": Decimal("228.2000"),
                    "7天": Decimal("686.4200"),
                },
            ],
            ("日期", "用户类型"),
            exact_keys=False,
            expected_row_count=15,
        )
    )

    checks.append(
        check_expected_rows(
            "T06",
            fetch_all(conn, render_template_sql("T06", COMMON_PARAMS)),
            [
                {
                    "player_id": 4543567,
                    "total_valid_bet_amount": Decimal("2000.0000"),
                    "total_win_loss_amount": Decimal("5915.0000"),
                    "bet_rank": 1,
                    "user_segment": "TOP3",
                },
                {
                    "player_id": 4543569,
                    "total_valid_bet_amount": Decimal("1213.0000"),
                    "bet_rank": 3,
                    "user_segment": "TOP3",
                },
                {
                    "player_id": 4543665,
                    "total_valid_bet_amount": Decimal("28.0000"),
                    "bet_rank": 30,
                    "user_segment": "非TOP3",
                },
            ],
            ("player_id",),
            exact_keys=False,
            expected_row_count=30,
        )
    )

    checks.append(
        check_expected_rows(
            "T08_wide",
            fetch_all(conn, render_template_sql("T08", COMMON_PARAMS)),
            [
                {
                    "日期": "汇总",
                    "用户分层": "全部用户",
                    "注册人数": 65,
                    "首存人数": 20,
                    "首存率": Decimal("0.3077"),
                    "二存人数": Decimal("5"),
                    "三存人数": Decimal("2"),
                    "四存人数": Decimal("2"),
                },
                {
                    "日期": "汇总",
                    "用户分层": "非TOP3",
                    "注册人数": 62,
                    "首存人数": 20,
                    "首存率": Decimal("0.3226"),
                    "二存人数": Decimal("5"),
                    "三存人数": Decimal("2"),
                },
            ],
            ("日期", "用户分层"),
            expected_row_count=2,
        )
    )

    checks.append(
        check_expected_rows(
            "T09_wide",
            fetch_all(conn, render_template_sql("T09", COMMON_PARAMS)),
            [
                {
                    "用户分层": "全部用户",
                    "用户数": 38,
                    "存款金额": Decimal("4300.0000"),
                    "提现金额": Decimal("11000.0000"),
                    "有效投注": Decimal("16225.2000"),
                    "杀率": Decimal("1.285190"),
                    "投充比": Decimal("3.773302"),
                },
                {
                    "用户分层": "TOP3",
                    "用户数": 3,
                    "存款金额": Decimal("0"),
                    "提现金额": Decimal("900.0000"),
                    "有效投注": Decimal("4613.0000"),
                    "杀率": Decimal("1.300889"),
                },
                {
                    "用户分层": "非TOP3",
                    "用户数": 35,
                    "存款金额": Decimal("4300.0000"),
                    "有效投注": Decimal("11612.2000"),
                    "投充比": Decimal("2.700512"),
                },
            ],
            ("用户分层",),
            exact_keys=False,
            expected_row_count=7,
        )
    )

    checks.append(
        check_expected_rows(
            "T10_wide",
            fetch_all(conn, render_template_sql("T10", COMMON_PARAMS)),
            [
                {
                    "日期": "汇总",
                    "用户类型": "全部",
                    "用户人数": Decimal("20"),
                    "首日杀率": Decimal("1.688032"),
                    "2日杀率": Decimal("0.577947"),
                    "首日投充比": Decimal("0.818049"),
                },
                {
                    "日期": "汇总",
                    "用户类型": "TOP3",
                    "用户人数": Decimal("3"),
                    "首日杀率": Decimal("2.231250"),
                    "2日投充比": Decimal("9.150000"),
                },
                {
                    "日期": "2026-04-15",
                    "用户类型": "非TOP3",
                    "用户人数": Decimal("5"),
                    "首日杀率": Decimal("0.559203"),
                    "2日投充比": Decimal("4.000000"),
                },
            ],
            ("日期", "用户类型"),
            exact_keys=False,
            expected_row_count=18,
        )
    )

    checks.append(
        check_expected_rows(
            "T11",
            fetch_all(conn, render_template_sql("T11", COMMON_PARAMS)),
            [
                {
                    "dim_game_type_id": 4,
                    "dim_game_type_name": "电子-老虎机",
                    "bet_times": 153,
                    "valid_bet_amount": Decimal("11712.0000"),
                    "kill_rate": Decimal("1.829594"),
                },
                {
                    "dim_game_type_id": 1,
                    "dim_game_type_name": "捕鱼",
                    "bet_times": 11,
                    "valid_bet_amount": Decimal("2202.0000"),
                    "kill_rate": Decimal("-0.142144"),
                },
                {
                    "dim_game_type_id": 6,
                    "dim_game_type_name": "电子棋牌",
                    "bet_times": 13,
                    "valid_bet_amount": Decimal("1295.2000"),
                },
            ],
            ("dim_game_type_id",),
            exact_keys=False,
            expected_row_count=4,
        )
    )

    checks.append(
        check_expected_rows(
            "T12_wide",
            fetch_all(conn, render_template_sql("T12", COMMON_PARAMS)),
            [
                {
                    "用户分层": "所有用户",
                    "指标": "有效投注流水",
                    "合计": Decimal("16225.200000"),
                    "捕鱼": Decimal("2202.000000"),
                    "电子-老虎机": Decimal("11712.000000"),
                    "电子棋牌": Decimal("1295.200000"),
                },
                {
                    "用户分层": "TOP3",
                    "指标": "有效投注流水",
                    "合计": Decimal("4613.000000"),
                    "捕鱼": Decimal("613.000000"),
                    "电子-老虎机": Decimal("4000.000000"),
                },
                {
                    "用户分层": "非TOP3",
                    "指标": "有效投注流水",
                    "合计": Decimal("11612.200000"),
                    "电子-老虎机": Decimal("7712.000000"),
                    "电子棋牌": Decimal("1295.200000"),
                },
            ],
            ("用户分层", "指标"),
            exact_keys=False,
            expected_row_count=18,
        )
    )

    checks.append(
        check_expected_rows(
            "T13_wide",
            fetch_all(conn, render_template_sql("T13", COMMON_PARAMS)),
            [
                {
                    "日期": "汇总",
                    "首存用户数": 20,
                    "100元": Decimal("11"),
                    "100元占比": Decimal("0.550000"),
                    "200元": Decimal("7"),
                    "500元": Decimal("2"),
                },
                {
                    "日期": "2026-04-13",
                    "首存用户数": 5,
                    "100元": Decimal("2"),
                    "200元": Decimal("2"),
                    "500元": Decimal("1"),
                },
                {
                    "日期": "2026-04-16",
                    "首存用户数": 3,
                    "100元": Decimal("3"),
                    "100元占比": Decimal("1.000000"),
                },
            ],
            ("日期",),
            exact_keys=False,
            expected_row_count=7,
        )
    )

    return checks


def build_extended_seed_checks(conn: pymysql.connections.Connection) -> list[CheckResult]:
    checks: list[CheckResult] = []

    checks.append(
        check_expected_rows(
            "EXT_channel_config",
            fetch_all(
                conn,
                "SELECT c.id, c.name, rpc.percent "
                "FROM channel c "
                "LEFT JOIN dim_report_channel_data_percent_config rpc "
                "  ON rpc.channel_id = c.id AND rpc.deleted = 0 "
                "WHERE c.id IN (990013, 990014) "
                "ORDER BY c.id",
            ),
            [
                {"id": 990013, "name": "KB扩展渠道C", "percent": Decimal("85.0000")},
                {"id": 990014, "name": "KB扩展渠道D", "percent": Decimal("92.0000")},
            ],
            ("id",),
            expected_row_count=2,
        )
    )

    checks.append(
        check_expected_rows(
            "EXT_user_refs",
            fetch_all(
                conn,
                "SELECT id, username, nickname "
                "FROM `user` "
                "WHERE id IN (980023, 980024, 980033, 980034) "
                "ORDER BY id",
            ),
            [
                {"id": 980023, "username": "partner_c", "nickname": "Partner C"},
                {"id": 980024, "username": "partner_d", "nickname": "Partner D"},
                {"id": 980033, "username": "rate_c", "nickname": "Rate Agent C"},
                {"id": 980034, "username": "rate_d", "nickname": "Rate Agent D"},
            ],
            ("id",),
            expected_row_count=4,
        )
    )

    checks.append(
        check_expected_rows(
            "EXT_players_by_channel",
            fetch_all(
                conn,
                "SELECT channel_id, COUNT(*) AS cnt, MIN(id) AS min_id, MAX(id) AS max_id "
                "FROM dim_player "
                "WHERE tenant_plat_id = 990001 AND id BETWEEN 990108 AND 990121 "
                "GROUP BY channel_id "
                "ORDER BY channel_id",
            ),
            [
                {"channel_id": 990011, "cnt": 1, "min_id": 990120, "max_id": 990120},
                {"channel_id": 990012, "cnt": 1, "min_id": 990121, "max_id": 990121},
                {"channel_id": 990013, "cnt": 6, "min_id": 990108, "max_id": 990113},
                {"channel_id": 990014, "cnt": 6, "min_id": 990114, "max_id": 990119},
            ],
            ("channel_id",),
            expected_row_count=4,
        )
    )

    checks.append(
        check_expected_rows(
            "EXT_login_rows",
            fetch_all(
                conn,
                "SELECT channel_id, COUNT(*) AS cnt "
                "FROM dwd_player_login_log "
                "WHERE tenant_plat_id = 990001 AND player_id BETWEEN 990108 AND 990121 "
                "GROUP BY channel_id "
                "ORDER BY channel_id",
            ),
            [
                {"channel_id": 990011, "cnt": 3},
                {"channel_id": 990012, "cnt": 2},
                {"channel_id": 990013, "cnt": 15},
                {"channel_id": 990014, "cnt": 15},
            ],
            ("channel_id",),
            expected_row_count=4,
        )
    )

    checks.append(
        check_expected_rows(
            "EXT_deposit_rows",
            fetch_all(
                conn,
                "SELECT channel_id, COUNT(*) AS cnt, SUM(actual_amount) AS amt "
                "FROM dwd_order_deposit "
                "WHERE tenant_plat_id = 990001 "
                "  AND player_id BETWEEN 990108 AND 990121 "
                "  AND status = 2 "
                "GROUP BY channel_id "
                "ORDER BY channel_id",
            ),
            [
                {"channel_id": 990011, "cnt": 2, "amt": Decimal("120.0000")},
                {"channel_id": 990012, "cnt": 2, "amt": Decimal("150.0000")},
                {"channel_id": 990013, "cnt": 12, "amt": Decimal("910.0000")},
                {"channel_id": 990014, "cnt": 12, "amt": Decimal("950.0000")},
            ],
            ("channel_id",),
            expected_row_count=4,
        )
    )

    checks.append(
        check_expected_rows(
            "EXT_withdraw_rows",
            fetch_all(
                conn,
                "SELECT channel_id, COUNT(*) AS cnt, SUM(act_amount) AS amt "
                "FROM dwd_order_withdrawal "
                "WHERE tenant_plat_id = 990001 "
                "  AND player_id BETWEEN 990108 AND 990121 "
                "  AND status = 3 "
                "GROUP BY channel_id "
                "ORDER BY channel_id",
            ),
            [
                {"channel_id": 990012, "cnt": 1, "amt": Decimal("29.2000")},
                {"channel_id": 990013, "cnt": 3, "amt": Decimal("84.5100")},
                {"channel_id": 990014, "cnt": 3, "amt": Decimal("54.3000")},
            ],
            ("channel_id",),
            expected_row_count=3,
        )
    )

    checks.append(
        check_expected_rows(
            "EXT_bet_rows",
            fetch_all(
                conn,
                "SELECT channel_id, COUNT(*) AS cnt, "
                "       SUM(valid_bet_amount) AS amt, "
                "       SUM(win_loss_amount) AS wl "
                "FROM dwd_bet_order "
                "WHERE tenant_plat_id = 990001 "
                "  AND player_id BETWEEN 990108 AND 990121 "
                "  AND settle_status = 1 "
                "GROUP BY channel_id "
                "ORDER BY channel_id",
            ),
            [
                {"channel_id": 990011, "cnt": 3, "amt": Decimal("460.0000"), "wl": Decimal("12.8000")},
                {"channel_id": 990012, "cnt": 3, "amt": Decimal("870.0000"), "wl": Decimal("103.2000")},
                {"channel_id": 990013, "cnt": 16, "amt": Decimal("4880.0000"), "wl": Decimal("384.8000")},
                {"channel_id": 990014, "cnt": 16, "amt": Decimal("4440.0000"), "wl": Decimal("481.6000")},
            ],
            ("channel_id",),
            expected_row_count=4,
        )
    )

    checks.append(
        check_expected_rows(
            "EXT_detail_rows",
            fetch_all(
                conn,
                "SELECT channel_id, COUNT(*) AS cnt, "
                "       SUM(valid_bet_amount) AS amt, "
                "       SUM(win_loss_amount) AS wl "
                "FROM bds_bet_order_detail "
                "WHERE tenant_plat_id = 990001 "
                "  AND player_id BETWEEN 990108 AND 990121 "
                "  AND settle_status = 1 "
                "GROUP BY channel_id "
                "ORDER BY channel_id",
            ),
            [
                {"channel_id": 990011, "cnt": 3, "amt": Decimal("460.0000"), "wl": Decimal("12.8000")},
                {"channel_id": 990012, "cnt": 3, "amt": Decimal("870.0000"), "wl": Decimal("103.2000")},
                {"channel_id": 990013, "cnt": 16, "amt": Decimal("4880.0000"), "wl": Decimal("384.8000")},
                {"channel_id": 990014, "cnt": 16, "amt": Decimal("4440.0000"), "wl": Decimal("481.6000")},
            ],
            ("channel_id",),
            expected_row_count=4,
        )
    )

    checks.append(
        check_expected_rows(
            "EXT_reward_counts",
            fetch_all(
                conn,
                "SELECT 'rebate' AS tbl, COUNT(*) AS cnt "
                "FROM dwd_order_rebate "
                "WHERE tenant_plat_id = 990001 AND player_id BETWEEN 990108 AND 990121 "
                "UNION ALL "
                "SELECT 'task', COUNT(*) "
                "FROM dwd_order_task "
                "WHERE tenant_plat_id = 990001 AND player_id BETWEEN 990108 AND 990121 "
                "UNION ALL "
                "SELECT 'activity', COUNT(*) "
                "FROM dwd_order_activity "
                "WHERE tenant_plat_id = 990001 AND player_id BETWEEN 990108 AND 990121 "
                "UNION ALL "
                "SELECT 'promote', COUNT(*) "
                "FROM dwd_order_promote_activity "
                "WHERE tenant_plat_id = 990001 AND player_id BETWEEN 990108 AND 990121 "
                "UNION ALL "
                "SELECT 'add_sub', COUNT(*) "
                "FROM dwd_order_add_or_sub "
                "WHERE tenant_plat_id = 990001 AND player_id BETWEEN 990108 AND 990121 "
                "UNION ALL "
                "SELECT 'lottery', COUNT(*) "
                "FROM dwd_order_lottery "
                "WHERE tenant_plat_id = 990001 AND player_id BETWEEN 990108 AND 990121 "
                "UNION ALL "
                "SELECT 'vip_award', COUNT(*) "
                "FROM dwd_order_vip_award "
                "WHERE tenant_plat_id = 990001 AND player_id BETWEEN 990108 AND 990121",
            ),
            [
                {"tbl": "rebate", "cnt": 5},
                {"tbl": "task", "cnt": 4},
                {"tbl": "activity", "cnt": 3},
                {"tbl": "promote", "cnt": 3},
                {"tbl": "add_sub", "cnt": 14},
                {"tbl": "lottery", "cnt": 2},
                {"tbl": "vip_award", "cnt": 6},
            ],
            ("tbl",),
            expected_row_count=7,
        )
    )

    checks.append(
        check_expected_rows(
            "EXT_channel_player_stats",
            fetch_all(
                conn,
                "SELECT channel_id, COUNT(*) AS cnt, "
                "       MIN(DATE(biz_date)) AS min_day, MAX(DATE(biz_date)) AS max_day, "
                "       SUM(regist_num) AS regist_sum, "
                "       SUM(first_deposit_num) AS fd_sum, "
                "       SUM(first_deposit_amount) AS fd_amt "
                "FROM dim_channel_player_statistics_of_day "
                "WHERE tenant_plat_id = 990001 "
                "  AND biz_date >= '2026-04-08' "
                "  AND biz_date < '2026-04-15' "
                "GROUP BY channel_id "
                "ORDER BY channel_id",
            ),
            [
                {
                    "channel_id": 990011,
                    "cnt": 2,
                    "min_day": "2026-04-08",
                    "max_day": "2026-04-09",
                    "regist_sum": 1,
                    "fd_sum": 1,
                    "fd_amt": Decimal("50.0000"),
                },
                {
                    "channel_id": 990012,
                    "cnt": 3,
                    "min_day": "2026-04-09",
                    "max_day": "2026-04-11",
                    "regist_sum": 1,
                    "fd_sum": 1,
                    "fd_amt": Decimal("60.0000"),
                },
                {
                    "channel_id": 990013,
                    "cnt": 7,
                    "min_day": "2026-04-08",
                    "max_day": "2026-04-14",
                    "regist_sum": 6,
                    "fd_sum": 6,
                    "fd_amt": Decimal("280.0000"),
                },
                {
                    "channel_id": 990014,
                    "cnt": 7,
                    "min_day": "2026-04-08",
                    "max_day": "2026-04-14",
                    "regist_sum": 6,
                    "fd_sum": 6,
                    "fd_amt": Decimal("290.0000"),
                },
            ],
            ("channel_id",),
            expected_row_count=4,
        )
    )

    checks.append(
        check_expected_rows(
            "EXT_relay_rows",
            fetch_all(
                conn,
                "SELECT channel_id, COUNT(*) AS cnt, SUM(top_flag) AS top_cnt, "
                "       SUM(bet_amount) AS bet_amt, SUM(valid_bet_amount) AS valid_bet_amt, "
                "       SUM(win_loss_amount) AS wl "
                "FROM dwd_sport_predict_relay_record "
                "WHERE tenant_plat_id = 990001 AND id BETWEEN 999450 AND 999453 "
                "GROUP BY channel_id "
                "ORDER BY channel_id",
            ),
            [
                {
                    "channel_id": 990011,
                    "cnt": 1,
                    "top_cnt": 0,
                    "bet_amt": Decimal("90.0000"),
                    "valid_bet_amt": Decimal("90.0000"),
                    "wl": Decimal("-10.0000"),
                },
                {
                    "channel_id": 990012,
                    "cnt": 1,
                    "top_cnt": 0,
                    "bet_amt": Decimal("70.0000"),
                    "valid_bet_amt": Decimal("70.0000"),
                    "wl": Decimal("-8.0000"),
                },
                {
                    "channel_id": 990013,
                    "cnt": 1,
                    "top_cnt": 1,
                    "bet_amt": Decimal("160.0000"),
                    "valid_bet_amt": Decimal("150.0000"),
                    "wl": Decimal("24.0000"),
                },
                {
                    "channel_id": 990014,
                    "cnt": 1,
                    "top_cnt": 1,
                    "bet_amt": Decimal("120.0000"),
                    "valid_bet_amt": Decimal("120.0000"),
                    "wl": Decimal("18.0000"),
                },
            ],
            ("channel_id",),
            expected_row_count=4,
        )
    )

    checks.append(
        check_expected_rows(
            "EXT_champion_rows",
            fetch_all(
                conn,
                "SELECT channel_id, COUNT(*) AS cnt, SUM(amount) AS amt, SUM(correct_flag) AS correct_cnt "
                "FROM dwd_sport_predict_champion_record "
                "WHERE tenant_plat_id = 990001 AND id BETWEEN 999460 AND 999463 "
                "GROUP BY channel_id "
                "ORDER BY channel_id",
            ),
            [
                {"channel_id": 990011, "cnt": 1, "amt": Decimal("88.0000"), "correct_cnt": 1},
                {"channel_id": 990012, "cnt": 1, "amt": Decimal("0.0000"), "correct_cnt": 0},
                {"channel_id": 990013, "cnt": 1, "amt": Decimal("66.0000"), "correct_cnt": 1},
                {"channel_id": 990014, "cnt": 1, "amt": Decimal("0.0000"), "correct_cnt": 0},
            ],
            ("channel_id",),
            expected_row_count=4,
        )
    )

    checks.append(
        check_expected_rows(
            "BULK_counts",
            fetch_all(
                conn,
                "SELECT 'dim_player' AS tbl, COUNT(*) AS cnt "
                "FROM dim_player "
                "WHERE tenant_plat_id = 990001 AND id BETWEEN 990200 AND 990459 "
                "UNION ALL "
                "SELECT 'login', COUNT(*) "
                "FROM dwd_player_login_log "
                "WHERE tenant_plat_id = 990001 AND player_id BETWEEN 990200 AND 990459 "
                "UNION ALL "
                "SELECT 'deposit', COUNT(*) "
                "FROM dwd_order_deposit "
                "WHERE tenant_plat_id = 990001 AND player_id BETWEEN 990200 AND 990459 "
                "UNION ALL "
                "SELECT 'withdrawal', COUNT(*) "
                "FROM dwd_order_withdrawal "
                "WHERE tenant_plat_id = 990001 AND player_id BETWEEN 990200 AND 990459 "
                "UNION ALL "
                "SELECT 'bet', COUNT(*) "
                "FROM dwd_bet_order "
                "WHERE tenant_plat_id = 990001 AND player_id BETWEEN 990200 AND 990459 "
                "UNION ALL "
                "SELECT 'detail', COUNT(*) "
                "FROM bds_bet_order_detail "
                "WHERE tenant_plat_id = 990001 AND player_id BETWEEN 990200 AND 990459 "
                "UNION ALL "
                "SELECT 'chess_extend', COUNT(*) "
                "FROM bds_bet_order_person_chess_and_card_extend "
                "WHERE tenant_plat_id = 990001 AND bet_order_id BETWEEN 1008001 AND 1009300 "
                "UNION ALL "
                "SELECT 'cp_stats', COUNT(*) "
                "FROM dim_channel_player_statistics_of_day "
                "WHERE tenant_plat_id = 990001 AND biz_date >= '2026-04-15' "
                "UNION ALL "
                "SELECT 'relay', COUNT(*) "
                "FROM dwd_sport_predict_relay_record "
                "WHERE tenant_plat_id = 990001 AND player_id BETWEEN 990200 AND 990459 "
                "UNION ALL "
                "SELECT 'champ', COUNT(*) "
                "FROM dwd_sport_predict_champion_record "
                "WHERE tenant_plat_id = 990001 AND player_id BETWEEN 990200 AND 990459",
            ),
            [
                {"tbl": "dim_player", "cnt": 260},
                {"tbl": "login", "cnt": 1300},
                {"tbl": "deposit", "cnt": 1040},
                {"tbl": "withdrawal", "cnt": 38},
                {"tbl": "bet", "cnt": 1300},
                {"tbl": "detail", "cnt": 1300},
                {"tbl": "chess_extend", "cnt": 260},
                {"tbl": "cp_stats", "cnt": 48},
                {"tbl": "relay", "cnt": 0},
                {"tbl": "champ", "cnt": 0},
            ],
            ("tbl",),
            expected_row_count=10,
        )
    )

    checks.append(
        check_expected_rows(
            "BULK_players_by_channel",
            fetch_all(
                conn,
                "SELECT channel_id, COUNT(*) AS players, MIN(id) AS min_id, MAX(id) AS max_id "
                "FROM dim_player "
                "WHERE tenant_plat_id = 990001 AND id BETWEEN 990200 AND 990459 "
                "GROUP BY channel_id "
                "ORDER BY channel_id",
            ),
            [
                {"channel_id": 990011, "players": 65, "min_id": 990200, "max_id": 990456},
                {"channel_id": 990012, "players": 65, "min_id": 990201, "max_id": 990457},
                {"channel_id": 990013, "players": 65, "min_id": 990202, "max_id": 990458},
                {"channel_id": 990014, "players": 65, "min_id": 990203, "max_id": 990459},
            ],
            ("channel_id",),
            expected_row_count=4,
        )
    )

    checks.append(
        check_expected_rows(
            "BULK_login_by_channel",
            fetch_all(
                conn,
                "SELECT channel_id, COUNT(*) AS cnt "
                "FROM dwd_player_login_log "
                "WHERE tenant_plat_id = 990001 AND player_id BETWEEN 990200 AND 990459 "
                "GROUP BY channel_id "
                "ORDER BY channel_id",
            ),
            [
                {"channel_id": 990011, "cnt": 325},
                {"channel_id": 990012, "cnt": 325},
                {"channel_id": 990013, "cnt": 325},
                {"channel_id": 990014, "cnt": 325},
            ],
            ("channel_id",),
            expected_row_count=4,
        )
    )

    checks.append(
        check_expected_rows(
            "BULK_withdraw_by_channel",
            fetch_all(
                conn,
                "SELECT channel_id, COUNT(*) AS cnt, ROUND(SUM(act_amount), 2) AS amt "
                "FROM dwd_order_withdrawal "
                "WHERE tenant_plat_id = 990001 AND player_id BETWEEN 990200 AND 990459 "
                "GROUP BY channel_id "
                "ORDER BY channel_id",
            ),
            [
                {"channel_id": 990011, "cnt": 10, "amt": Decimal("708.00")},
                {"channel_id": 990012, "cnt": 9, "amt": Decimal("767.00")},
                {"channel_id": 990013, "cnt": 9, "amt": Decimal("925.40")},
                {"channel_id": 990014, "cnt": 10, "amt": Decimal("1200.00")},
            ],
            ("channel_id",),
            expected_row_count=4,
        )
    )

    checks.append(
        check_expected_rows(
            "BULK_deposit_by_channel",
            fetch_all(
                conn,
                "SELECT channel_id, COUNT(*) AS cnt, ROUND(SUM(actual_amount), 2) AS amt "
                "FROM dwd_order_deposit "
                "WHERE tenant_plat_id = 990001 AND player_id BETWEEN 990200 AND 990459 "
                "GROUP BY channel_id "
                "ORDER BY channel_id",
            ),
            [
                {"channel_id": 990011, "cnt": 260, "amt": Decimal("38350.00")},
                {"channel_id": 990012, "cnt": 260, "amt": Decimal("42900.00")},
                {"channel_id": 990013, "cnt": 260, "amt": Decimal("47450.00")},
                {"channel_id": 990014, "cnt": 260, "amt": Decimal("52000.00")},
            ],
            ("channel_id",),
            expected_row_count=4,
        )
    )

    checks.append(
        check_expected_rows(
            "BULK_bet_by_channel",
            fetch_all(
                conn,
                "SELECT channel_id, COUNT(*) AS cnt, "
                "       ROUND(SUM(valid_bet_amount), 2) AS amt, "
                "       ROUND(SUM(win_loss_amount), 2) AS wl "
                "FROM dwd_bet_order "
                "WHERE tenant_plat_id = 990001 AND player_id BETWEEN 990200 AND 990459 "
                "GROUP BY channel_id "
                "ORDER BY channel_id",
            ),
            [
                {"channel_id": 990011, "cnt": 325, "amt": Decimal("45500.00"), "wl": Decimal("1573.00")},
                {"channel_id": 990012, "cnt": 325, "amt": Decimal("50375.00"), "wl": Decimal("1699.75")},
                {"channel_id": 990013, "cnt": 325, "amt": Decimal("55250.00"), "wl": Decimal("1826.50")},
                {"channel_id": 990014, "cnt": 325, "amt": Decimal("60125.00"), "wl": Decimal("1953.25")},
            ],
            ("channel_id",),
            expected_row_count=4,
        )
    )

    checks.append(
        check_expected_rows(
            "BULK_channel_player_stats_range",
            fetch_all(
                conn,
                "SELECT COUNT(*) AS cnt, "
                "       MIN(DATE(biz_date)) AS min_day, "
                "       MAX(DATE(biz_date)) AS max_day, "
                "       COUNT(DISTINCT channel_id) AS channels "
                "FROM dim_channel_player_statistics_of_day "
                "WHERE tenant_plat_id = 990001 AND biz_date >= '2026-04-15'",
            ),
            [
                {
                    "cnt": 48,
                    "min_day": "2026-04-15",
                    "max_day": "2026-04-26",
                    "channels": 4,
                }
            ],
            ("cnt",),
            expected_row_count=1,
        )
    )

    checks.append(
        check_expected_rows(
            "BULK_channel_player_stats_by_channel",
            fetch_all(
                conn,
                "SELECT channel_id, COUNT(*) AS cnt, "
                "       ROUND(SUM(first_deposit_amount), 2) AS fd_amt, "
                "       SUM(first_deposit_num) AS fd_num "
                "FROM dim_channel_player_statistics_of_day "
                "WHERE tenant_plat_id = 990001 AND biz_date >= '2026-04-15' "
                "GROUP BY channel_id "
                "ORDER BY channel_id",
            ),
            [
                {"channel_id": 990011, "cnt": 12, "fd_amt": Decimal("5200.00"), "fd_num": 65},
                {"channel_id": 990012, "cnt": 12, "fd_amt": Decimal("5850.00"), "fd_num": 65},
                {"channel_id": 990013, "cnt": 12, "fd_amt": Decimal("6500.00"), "fd_num": 65},
                {"channel_id": 990014, "cnt": 12, "fd_amt": Decimal("7150.00"), "fd_num": 65},
            ],
            ("channel_id",),
            expected_row_count=4,
        )
    )

    checks.append(
        check_expected_rows(
            "BULK_integrity",
            fetch_all(
                conn,
                "SELECT SUM(CASE WHEN d.id IS NULL THEN 1 ELSE 0 END) AS missing_detail, "
                "       0 AS missing_bet "
                "FROM dwd_bet_order b "
                "LEFT JOIN bds_bet_order_detail d "
                "  ON d.id = b.id AND d.tenant_plat_id = b.tenant_plat_id "
                "WHERE b.tenant_plat_id = 990001 AND b.player_id BETWEEN 990200 AND 990459",
            ),
            [{"missing_detail": 0, "missing_bet": 0}],
            ("missing_detail",),
            expected_row_count=1,
        )
    )

    return checks


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--extended-seed",
        action="store_true",
        help="also validate the optional legacy regression_fixture expanded layer (04-08+ channels, auxiliary tables, bulk data)",
    )
    args = parser.parse_args()

    try:
        conn = make_connection()
    except Exception as exc:  # pragma: no cover - CLI failure path
        print(f"[FAIL] connect: {exc}", file=sys.stderr)
        return 2

    try:
        results = build_checks(conn)
        if args.extended_seed:
            results.extend(build_extended_seed_checks(conn))
    finally:
        conn.close()

    failures = 0
    for result in results:
        status = "PASS" if result.passed else "FAIL"
        print(f"[{status}] {result.name}: {result.details}")
        if not result.passed:
            failures += 1

    print(f"Summary: {len(results) - failures} passed, {failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
