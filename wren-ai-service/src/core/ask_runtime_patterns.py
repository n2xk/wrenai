"""Configurable regex patterns used by the ask runtime.

The runtime still ships safe Chinese-business defaults for the TiDB regression
workspace, but callers can extend or replace them with JSON environment
variables.  Keeping this small module independent makes the policy surface
unit-testable without importing the full fixed-order runtime.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


def _coerce_regex_patterns(value: Any) -> tuple[str, ...]:
    if isinstance(value, str):
        values = [value]
    elif isinstance(value, (list, tuple, set)):
        values = list(value)
    else:
        return ()
    return tuple(str(item).strip() for item in values if str(item).strip())


def load_regex_pattern_config(
    env_name: str,
    defaults: dict[str, tuple[str, ...]],
) -> dict[str, tuple[str, ...]]:
    """Load additive regex pattern config from JSON env while preserving defaults."""

    raw_config = os.getenv(env_name)
    if not raw_config:
        return defaults

    try:
        parsed_config = json.loads(raw_config)
    except json.JSONDecodeError:
        logger.warning("Ignoring invalid %s regex config JSON.", env_name)
        return defaults

    if not isinstance(parsed_config, dict):
        logger.warning("Ignoring non-object %s regex config.", env_name)
        return defaults

    replace_raw = os.getenv(f"{env_name}_REPLACE", "")
    should_replace = replace_raw.strip().lower() in {"1", "true", "yes", "on"}
    merged: dict[str, tuple[str, ...]] = (
        {} if should_replace else {key: tuple(value) for key, value in defaults.items()}
    )
    for key, raw_patterns in parsed_config.items():
        normalized_key = str(key).strip()
        configured_patterns = _coerce_regex_patterns(raw_patterns)
        if not normalized_key or not configured_patterns:
            continue
        existing_patterns = merged.get(normalized_key, ())
        merged[normalized_key] = tuple(
            dict.fromkeys([*existing_patterns, *configured_patterns])
        )
    return merged


DEFAULT_TEMPLATE_FEATURE_PATTERNS: dict[str, tuple[str, ...]] = {
    "bucket": (r"分桶", r"档位"),
    "cohort": (
        r"\bcohort\b",
        r"首存\s*cohort",
        r"首存用户群",
        r"首存群体",
    ),
    "cumulative_revenue": (r"累计收入", r"回收", r"渠道收入"),
    "daily_summary": (
        r"日报",
        r"每日",
        r"登录",
        r"注册",
        r"充值",
        r"提现",
        r"返水",
        r"任务彩金",
    ),
    "financial_ratio": (r"投充比", r"杀率", r"充提差", r"输赢"),
    "game_type": (r"游戏类型", r"game[_\s-]?type"),
    "retention": (
        r"续存",
        r"复存",
        r"留存",
        r"2\s*[~\-到至]\s*6\s*存",
        r"[2-6]\s*存",
        r"[二三四五六]\s*存",
    ),
    "segment": (
        r"TOP\s*\d+",
        r"TOPN",
        r"非\s*TOP",
        r"NON[_\s-]?TOPN",
        r"前\s*\d+\s*(?:名|个)?(?:大户|用户|玩家)?",
        r"大户",
        r"头部用户",
        r"高流水用户",
        r"投注流水最高",
        r"分层",
        r"区间汇总",
        r"全部用户",
        r"所有用户",
        r"排名",
    ),
    "trend": (r"日龄", r"趋势", r"D\s*1", r"D\s*\d+"),
}
DEFAULT_SEMANTIC_METRIC_PATTERNS: dict[str, tuple[str, ...]] = {
    "ad_spend": (r"投放金额", r"投放成本", r"广告费", r"买量成本"),
    "bet_amount": (r"有效投注", r"流水", r"投注"),
    "bet_count": (r"下注次数", r"投注次数"),
    "deposit_amount": (r"充值金额", r"存款金额", r"充值总额", r"存款总额"),
    "deposit_count": (r"充值笔数", r"存款笔数", r"几笔成功充值"),
    "deposit_user_count": (r"充值人数", r"存款人数"),
    "download_click_uv": (r"下载点击", r"下载点击UV"),
    "first_deposit": (r"首存", r"首充", r"首次存款", r"第一次充值"),
    "first_deposit_cost": (r"首存成本", r"首充成本", r"新客.*成本"),
    "kill_rate": (r"杀率", r"平台赢率"),
    "login_user_count": (r"登录人数", r"登录用户", r"登录去重"),
    "pv": (r"\bPV\b", r"访问量", r"访问PV"),
    "registration_count": (r"注册人数", r"注册用户"),
    "retention_deposit": (r"续存", r"复存", r"[二三四五六2-6]\s*存"),
    "roi": (r"(?<![A-Za-z0-9])ROI(?![A-Za-z0-9])", r"投放回收", r"回本"),
    "uv": (r"\bUV\b", r"独立访客", r"访问UV"),
    "withdraw_amount": (r"提现金额", r"提款金额"),
    "win_loss": (r"输赢", r"平台输赢"),
}


DEFAULT_SEMANTIC_DIMENSION_PATTERNS: dict[str, tuple[str, ...]] = {
    "biz_date": (r"每日", r"按天", r"日期", r"日报", r"趋势"),
    "channel_id": (r"渠道", r"channel[_\s-]?id"),
    "cohort_age": (r"D\s*\d+", r"日龄"),
    "first_deposit_date": (r"首存日期", r"首充日期", r"cohort"),
    "game_type": (r"游戏类型", r"game[_\s-]?type"),
    "player_id": (r"玩家", r"用户", r"player[_\s-]?id", r"名单", r"明细"),
    "segment": (
        r"TOP\s*\d+",
        r"非\s*TOP",
        r"前\s*\d+\s*(?:名|个)?(?:大户|用户|玩家)?",
        r"分层",
        r"大户",
        r"头部用户",
        r"高流水用户",
        r"投注流水最高",
    ),
    "tenant_plat_id": (r"租户平台", r"tenant[_\s-]?plat[_\s-]?id"),
}
