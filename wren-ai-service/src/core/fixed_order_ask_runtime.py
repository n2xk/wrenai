import asyncio
import csv
import itertools
import logging
import os
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from difflib import SequenceMatcher
from io import StringIO
from typing import Any, Callable, Iterable, Literal, Optional, Protocol, Sequence

import aiohttp
import sqlparse

from src.core.ask_policy import (
    coerce_ask_policy_config,
    evaluate_policy_context,
    is_metadata_explanation_query,
    load_ask_policy_config,
)
from src.core.ask_runtime_patterns import (
    DEFAULT_SEMANTIC_DIMENSION_PATTERNS,
    DEFAULT_SEMANTIC_METRIC_PATTERNS,
    DEFAULT_TEMPLATE_FEATURE_PATTERNS,
)
from src.core.ask_runtime_patterns import (
    load_regex_pattern_config as _load_regex_pattern_config,
)
from src.core.slot_extractor import (
    DATE_PATTERN,
    extract_channel_ids as _shared_extract_channel_ids,
    extract_date_range as _shared_extract_date_range,
    extract_tenant_plat_ids as _shared_extract_tenant_plat_ids,
    normalize_question_skeleton,
)
from src.core.mixed_answer_composer import MixedAnswerComposer
from src.core.pipeline import BasicPipeline
from src.pipelines.common import retrieve_data_source

logger = logging.getLogger("wren-ai-service")

SemanticPlanMode = Literal["deterministic", "shadow", "enhanced"]


class AskHistoryLike(Protocol):
    sql: str
    question: str


class AskRequestLike(Protocol):
    query: str
    query_id: str
    configurations: Any
    custom_instruction: Optional[str]
    ignore_sql_generation_reasoning: bool
    enable_column_pruning: bool
    use_dry_plan: bool
    allow_dry_plan_fallback: bool
    request_from: str
    skills: Sequence[Any]
    ask_policy: Optional[dict[str, Any]]
    slot_values: dict[str, Any]


class SkillCandidateLike(Protocol):
    instruction: Optional[str]
    skill_id: Optional[str]
    skill_name: Optional[str]


ResultUpdater = Callable[..., None]
ResultBuilder = Callable[..., Any]
StopChecker = Callable[[], bool]


@dataclass
class AskExecutionState:
    user_query: str
    rephrased_question: Optional[str] = None
    intent_reasoning: Optional[str] = None
    sql_generation_reasoning: Any = None
    sql_samples: list[Any] = field(default_factory=list)
    instructions: list[Any] = field(default_factory=list)
    effective_instructions: list[Any] = field(default_factory=list)
    api_results: list[Any] = field(default_factory=list)
    table_names: list[str] = field(default_factory=list)
    error_message: Optional[str] = None
    invalid_sql: Optional[str] = None
    retrieval_result: dict[str, Any] = field(default_factory=dict)
    table_ddls: list[str] = field(default_factory=list)
    ask_path: Optional[str] = None
    current_sql_correction_retries: int = 0
    template_decision: Optional[dict[str, Any]] = None
    semantic_plan: Optional[dict[str, Any]] = None
    query_decomposition: Optional[dict[str, Any]] = None
    clarification_state: Optional[dict[str, Any]] = None
    slot_values: dict[str, Any] = field(default_factory=dict)


def _normalize_instruction(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None

    normalized_value = value.strip()
    return normalized_value or None


def extract_skill_instructions(
    skills: Sequence[SkillCandidateLike] | Sequence[Any],
) -> list[dict[str, Any]]:
    extracted_instructions: list[dict[str, Any]] = []

    for skill in skills:
        instruction = _normalize_instruction(getattr(skill, "instruction", None))

        if instruction:
            extracted_instructions.append(
                {
                    "instruction": instruction,
                    "source": "skill_definition",
                    "skill_id": getattr(skill, "skill_id", None),
                    "skill_name": getattr(skill, "skill_name", None),
                    "execution_mode": "inject_only",
                }
            )

    return extracted_instructions


TEMPLATE_LEVEL_RANK = {"L0": 0, "L1": 1, "L2": 2, "L3": 3}
TEMPLATE_ANCHORED_MODES = {"anchored_template", "executable_template"}
TEMPLATE_TRUSTED_MODES = {"trusted_reference", *TEMPLATE_ANCHORED_MODES}
TEMPLATE_APPROVED_SOURCE_TYPES = {
    "admin_marked",
    "business_import",
    "system_promoted",
}
TEMPLATE_MIN_TRUSTED_CONFIDENCE = float(
    os.getenv("WREN_TEMPLATE_TRUSTED_CONFIDENCE_MIN", "0.6")
)
TEMPLATE_MIN_ANCHORED_CONFIDENCE = float(
    os.getenv("WREN_TEMPLATE_ANCHORED_CONFIDENCE_MIN", "0.75")
)
TEMPLATE_MIN_EXECUTABLE_CONFIDENCE = float(
    os.getenv("WREN_TEMPLATE_EXECUTABLE_CONFIDENCE_MIN", "0.88")
)
TEMPLATE_MIN_CONFLICT_MARGIN = float(
    os.getenv("WREN_TEMPLATE_CONFLICT_MARGIN_MIN", "0.15")
)
TEMPLATE_MIN_RETRIEVAL_SCORE = float(
    os.getenv("WREN_TEMPLATE_MIN_RETRIEVAL_SCORE", "0.45")
)
TEMPLATE_MIN_ADJUSTED_SCORE = float(
    os.getenv("WREN_TEMPLATE_MIN_ADJUSTED_SCORE", "1.15")
)
SQL_TEMPLATE_PLACEHOLDER_PATTERN = re.compile(r"(?<!:):([A-Za-z_][A-Za-z0-9_]*)")


def normalize_semantic_plan_mode(
    semantic_plan_mode: Optional[str],
    *,
    allow_semantic_plan_llm: bool = False,
) -> SemanticPlanMode:
    mode = str(semantic_plan_mode or "deterministic").strip().lower()
    if mode not in {"deterministic", "shadow", "enhanced"}:
        mode = "deterministic"
    if allow_semantic_plan_llm and mode == "deterministic":
        return "enhanced"
    return mode  # type: ignore[return-value]


def _supplied_external_sql_builders_enabled() -> bool:
    raw_value = os.getenv("WREN_SUPPLIED_EXTERNAL_SQL_BUILDERS_ENABLED")
    if raw_value is None:
        return True
    return raw_value.strip().lower() not in {"0", "false", "no", "off"}


TEMPLATE_FEATURE_WEIGHTS = {
    "bucket": 1.15,
    "cohort": 0.55,
    "cumulative_revenue": 1.1,
    "daily_summary": 1.2,
    "financial_ratio": 1.0,
    "game_type": 1.35,
    "retention": 1.15,
    "segment": 0.85,
    "trend": 1.15,
}
DISCRIMINATIVE_TEMPLATE_FEATURES = {
    "bucket",
    "cumulative_revenue",
    "daily_summary",
    "game_type",
    "retention",
    "segment",
    "trend",
}
MISSING_SOURCE_PROMPTS = {
    "download_click_uv": "下载点击UV",
    "pv": "访问PV",
    "spend_amount": "投放金额",
    "uv": "访问UV",
}

EXTERNAL_DEPENDENCY_EXCLUSION_CUES = (
    "不用",
    "不使用",
    "不依赖",
    "无需",
    "不需要",
    "排除",
    "去掉",
    "剔除",
    "不看",
    "不展示",
    "不输出",
    "不计算",
    "不要",
    "暂不",
    "暂时不用",
)

INTERNAL_ONLY_QUERY_PATTERNS = (
    r"(?:只用|仅用|只展示|仅展示|只输出|仅输出|暂时只用|暂时仅用).{0,24}(?:内部数据|内部指标|系统内|可查询|原始指标)",
    r"(?:不用|不使用|不依赖|无需|不需要|排除|去掉|剔除|不看|不展示|不输出|不计算|不要|暂不|暂时不用).{0,24}(?:外部数据|外部指标|外部数据源)",
)

EXTERNAL_DEPENDENCY_EXCLUSION_ALIASES = {
    "ad_spend": (
        "投放金额",
        "投放成本",
        "买量成本",
        "广告费",
        "广告成本",
        "ROI",
        "投放回收",
        "回本",
        "回本率",
        "首存成本",
        "首充成本",
    ),
    "access_pv": ("PV", "访问PV", "访问量", "流量PV", "UV注册率"),
    "access_uv": (
        "UV",
        "访问UV",
        "独立访客",
        "UV下载率",
        "UV注册率",
    ),
    "download_click_uv": ("下载点击UV", "下载点击", "下载点击人数", "UV下载率"),
}


def _env_flag_enabled(name: str, default: bool = True) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() not in {"0", "false", "no", "off"}


def _template_route_guards_enabled() -> bool:
    return _env_flag_enabled("WREN_TEMPLATE_ROUTE_GUARD_ENABLED", True)


def _tenant_slot_guard_enabled() -> bool:
    return _env_flag_enabled("WREN_TENANT_SLOT_GUARD_ENABLED", True)


def _legacy_external_dependency_fallback_enabled() -> bool:
    return _env_flag_enabled("WREN_LEGACY_EXTERNAL_DEPENDENCY_FALLBACK_ENABLED", False)


SQL_CORRECTION_STRATEGY_HINTS = (
    (
        "diagnosis_first",
        "先按诊断结论定位根因，只修复导致 dry run 失败的最小 SQL 片段，"
        "避免重写查询结构或业务口径。",
    ),
    (
        "schema_first",
        "优先核对表名、列名、别名、JOIN 条件和 GROUP BY 粒度是否与 DATABASE SCHEMA 一致，"
        "不要编造不存在的字段。",
    ),
    (
        "dialect_first",
        "优先修复 SQL 方言、日期函数、聚合表达式、类型转换和保留字转义问题，"
        "保持原始 SELECT 业务字段不变。",
    ),
)


SQL_GENERATION_STRATEGY_HINTS = (
    (
        "template_first",
        "优先复用最匹配的 SQL template / SQL sample 的 CTE 和业务口径；"
        "只替换参数、过滤条件和必要的字段，避免重写模板核心。",
    ),
    (
        "schema_first",
        "优先从 DATABASE SCHEMA 反推表关系、JOIN key、时间字段和指标字段；"
        "如果模板与 schema 冲突，以 schema 中存在的表列为准。",
    ),
    (
        "decomposition_first",
        "先按 QUERY DECOMPOSITION PLAN 拆成 CTE：基础过滤、业务 cohort/TOPN 分层、"
        "聚合指标、最终宽表/明细输出，然后组合成一条 SQL。",
    ),
)


def _sql_correction_candidate_count() -> int:
    raw_value = os.getenv("WREN_SQL_CORRECTION_CANDIDATE_COUNT", "3")
    try:
        parsed_value = int(raw_value)
    except (TypeError, ValueError):
        parsed_value = 3
    return max(1, min(parsed_value, len(SQL_CORRECTION_STRATEGY_HINTS)))


def _query_decomposition_enabled() -> bool:
    return _env_flag_enabled("WREN_QUERY_DECOMPOSITION_ENABLED", True)


def _execution_voting_enabled() -> bool:
    return _env_flag_enabled("WREN_SQL_EXECUTION_VOTING_ENABLED", True)


def _sql_generation_candidate_count() -> int:
    raw_value = os.getenv("WREN_SQL_GENERATION_CANDIDATE_COUNT", "3")
    try:
        parsed_value = int(raw_value)
    except (TypeError, ValueError):
        parsed_value = 3
    return max(1, min(parsed_value, len(SQL_GENERATION_STRATEGY_HINTS)))


def _query_complexity_features(
    query: Optional[str],
    *,
    semantic_plan: Optional[dict[str, Any]] = None,
    table_names: Optional[Sequence[str]] = None,
) -> list[str]:
    normalized_query = str(query or "")
    features: list[str] = []
    patterns = {
        "topn_segment": r"TOP\s*\d+|前\s*\d+|非\s*TOP|非前",
        "cohort": r"cohort|首存|首充|续存|留存|D\s*\d+|累计\s*\d+\s*天",
        "external_metric": r"ROI|投放|首存成本|UV下载率|UV注册率|PV|UV",
        "wide_excel_shape": r"宽表|同形|汇总行|环比|D1|D3|D7|D15|D30|D60|D90|D120|D150|D180|D210|D240|D270|D300|D330|D360",
        "multi_metric": r"综合日报|多个指标|趋势|分布|对比|排名",
    }
    for feature, pattern in patterns.items():
        if re.search(pattern, normalized_query, flags=re.IGNORECASE):
            features.append(feature)

    if len(table_names or []) >= 3:
        features.append("multi_table")

    plan = semantic_plan or {}
    filters = plan.get("filters") if isinstance(plan, dict) else None
    metrics = plan.get("metrics") if isinstance(plan, dict) else None
    dimensions = plan.get("dimensions") if isinstance(plan, dict) else None
    if isinstance(filters, dict) and len(
        [value for value in filters.values() if value]
    ):
        features.append("filtered_query")
    if isinstance(metrics, list) and len(metrics) >= 3:
        features.append("multi_metric")
    if isinstance(dimensions, list) and len(dimensions) >= 2:
        features.append("multi_dimension")

    return list(dict.fromkeys(features))


def build_query_decomposition_plan(
    query: Optional[str],
    *,
    semantic_plan: Optional[dict[str, Any]] = None,
    table_names: Optional[Sequence[str]] = None,
) -> dict[str, Any]:
    features = _query_complexity_features(
        query,
        semantic_plan=semantic_plan,
        table_names=table_names,
    )
    enabled = _query_decomposition_enabled() and len(features) >= 2
    steps: list[dict[str, str]] = []
    if enabled:
        steps.append(
            {
                "name": "base_scope",
                "instruction": "先建立基础数据范围 CTE：租户、渠道、日期、状态等过滤条件必须集中处理。",
            }
        )
        if "cohort" in features:
            steps.append(
                {
                    "name": "cohort_users",
                    "instruction": "单独建立首存/首充 cohort CTE，保留 cohort 日期、玩家、渠道和租户字段。",
                }
            )
        if "topn_segment" in features:
            steps.append(
                {
                    "name": "segment_users",
                    "instruction": "单独建立 TOPN / 非 TOPN 分层 CTE，后续指标必须按该分层 JOIN 或聚合。",
                }
            )
        if "external_metric" in features:
            steps.append(
                {
                    "name": "external_metrics",
                    "instruction": "外部补充数据只从用户提供的 inline CTE 或已配置依赖进入，不得编造外部物理表。",
                }
            )
        steps.append(
            {
                "name": "metric_aggregation",
                "instruction": "按目标 grain 聚合内部指标；派生指标在最终 SELECT 中统一计算。",
            }
        )
        if "wide_excel_shape" in features:
            steps.append(
                {
                    "name": "final_pivot",
                    "instruction": "需要 Excel 同形宽表时，用条件聚合生成固定列；汇总行必须与明细行口径一致。",
                }
            )
        else:
            steps.append(
                {
                    "name": "final_select",
                    "instruction": "最终 SELECT 只输出用户请求的维度、指标和必要对账列。",
                }
            )

    return {
        "enabled": enabled,
        "features": features,
        "steps": steps,
    }


def _format_query_decomposition_instruction(plan: dict[str, Any]) -> str:
    if not plan.get("enabled"):
        return ""
    lines = [
        "QUERY DECOMPOSITION PLAN：该问题较复杂，生成 SQL 时必须先拆解再组合。",
        f"复杂度特征：{', '.join(plan.get('features') or [])}",
        "推荐 CTE / 生成步骤：",
    ]
    for index, step in enumerate(plan.get("steps") or [], start=1):
        lines.append(f"{index}. {step.get('name')}: {step.get('instruction')}")
    return "\n".join(lines)


def _build_runtime_instruction(instruction: str, *, source: str) -> dict[str, Any]:
    return {
        "instruction": instruction,
        "source": source,
        "knowledge_asset_type": "query_rules",
        "runtime_usage": "sql_generation",
    }


def _build_sql_generation_candidate_instruction(
    *,
    candidate_index: int,
    candidate_count: int,
    strategy_name: str,
    strategy_hint: str,
) -> dict[str, Any]:
    return _build_runtime_instruction(
        (
            f"SQL generation candidate {candidate_index}/{candidate_count} "
            f"({strategy_name})：{strategy_hint}"
        ),
        source="runtime_sql_generation_candidate",
    )


def _sql_generation_candidate_count_for_state(state: AskExecutionState) -> int:
    if not _execution_voting_enabled():
        return 1
    configured_count = _sql_generation_candidate_count()
    if configured_count <= 1:
        return 1
    decomposition = state.query_decomposition or {}
    if decomposition.get("enabled"):
        return configured_count
    if state.template_decision and state.template_decision.get("mode") in {
        "anchored_template",
        "executable_template",
    }:
        return 1
    return 2


def _build_execution_result_signature(preview_result: Any) -> dict[str, Any]:
    def normalize_preview_value(value: Any) -> Any:
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        return str(value)

    def normalize_preview_row(row: Any) -> Any:
        if isinstance(row, dict):
            return {
                str(key): normalize_preview_value(value) for key, value in row.items()
            }
        if isinstance(row, (list, tuple)):
            return [normalize_preview_value(value) for value in row]
        return normalize_preview_value(row)

    rows: list[Any] = []
    columns: list[str] = []
    if isinstance(preview_result, dict):
        raw_rows = preview_result.get("data")
        if isinstance(raw_rows, list):
            rows = raw_rows
        raw_columns = (
            preview_result.get("columns")
            or preview_result.get("fields")
            or preview_result.get("headers")
        )
        if isinstance(raw_columns, list):
            columns = [
                str(column.get("name") if isinstance(column, dict) else column)
                for column in raw_columns
            ]
    elif isinstance(preview_result, list):
        rows = preview_result

    if not columns and rows and isinstance(rows[0], dict):
        columns = list(rows[0].keys())

    return {
        "columns": columns,
        "row_count": len(rows),
        "sample": [normalize_preview_row(row) for row in rows[:3]],
    }


def _execution_signature_key(signature: dict[str, Any]) -> str:
    return repr(
        (
            tuple(signature.get("columns") or []),
            signature.get("row_count"),
            signature.get("sample"),
        )
    )


def _score_sql_generation_candidate(
    *,
    sql: str,
    candidate_index: int,
    execution_success: bool,
    execution_vote_count: int,
    template_sql: Optional[str] = None,
) -> float:
    score = 0.0
    if execution_success:
        score += 2.0
    score += execution_vote_count * 0.5
    if template_sql:
        score += SequenceMatcher(
            None,
            _normalize_sql_for_signature(template_sql),
            _normalize_sql_for_signature(sql),
        ).ratio()
    # Stable tie-breaker: earlier candidate wins when quality is equal.
    score -= candidate_index * 0.001
    return score


def _build_sql_correction_candidate_inputs(
    *,
    original_sql: str,
    error_message: Optional[str],
    diagnosis_reasoning: Optional[str],
    candidate_count: Optional[int] = None,
) -> list[dict[str, str]]:
    base_error = (diagnosis_reasoning or error_message or "").strip()
    if not base_error:
        base_error = "SQL dry run failed; correct the SQL using the schema and rules."

    count = (
        candidate_count
        if candidate_count is not None
        else _sql_correction_candidate_count()
    )
    count = max(1, min(count, len(SQL_CORRECTION_STRATEGY_HINTS)))

    candidates: list[dict[str, str]] = []
    for index, (strategy_name, strategy_hint) in enumerate(
        SQL_CORRECTION_STRATEGY_HINTS[:count],
        start=1,
    ):
        candidates.append(
            {
                "sql": original_sql,
                "error": (
                    f"{base_error}\n\n"
                    f"Correction candidate {index}/{count} ({strategy_name}): "
                    f"{strategy_hint}"
                ),
            }
        )
    return candidates


def _score_sql_correction_candidate(
    *,
    original_sql: str,
    corrected_sql: Optional[str],
    candidate_index: int,
) -> float:
    if not corrected_sql:
        return 0.0
    similarity = SequenceMatcher(
        None,
        _normalize_sql_for_signature(original_sql),
        _normalize_sql_for_signature(corrected_sql),
    ).ratio()
    # Prefer smaller, diagnosis-targeted changes when multiple candidates pass
    # dry run; use candidate order as a stable tie-breaker.
    return similarity - (candidate_index * 0.001)


def _select_best_sql_correction_result(
    correction_results: Sequence[dict[str, Any]],
    *,
    original_sql: str,
) -> tuple[Optional[dict[str, Any]], Optional[dict[str, Any]]]:
    """Return the best valid correction result plus the first invalid fallback.

    SQLCorrection does not currently expose model confidence, so we use a
    conservative proxy: dry-run success first, then the valid SQL that preserves
    the original SQL shape most closely.  The first invalid result is kept so
    the existing retry loop can continue with the next concrete engine error.
    """

    first_invalid_result: Optional[dict[str, Any]] = None
    best_result: Optional[dict[str, Any]] = None
    best_score = float("-inf")
    for index, correction_result in enumerate(correction_results):
        post_process = correction_result.get("post_process") or {}
        valid_generation_result = post_process.get("valid_generation_result") or {}
        if valid_generation_result:
            score = _score_sql_correction_candidate(
                original_sql=original_sql,
                corrected_sql=valid_generation_result.get("sql"),
                candidate_index=index,
            )
            if best_result is None or score > best_score:
                best_score = score
                best_result = correction_result
            continue

        invalid_generation_result = post_process.get("invalid_generation_result") or {}
        if invalid_generation_result and first_invalid_result is None:
            first_invalid_result = invalid_generation_result

    return best_result, first_invalid_result


def _normalize_string_list(value: Any) -> list[str]:
    if value is None:
        return []

    raw_values = value if isinstance(value, (list, tuple, set)) else [value]
    normalized_values: list[str] = []
    for raw_value in raw_values:
        normalized_value = str(raw_value or "").strip()
        if normalized_value and normalized_value not in normalized_values:
            normalized_values.append(normalized_value)
    return normalized_values


def _get_mapping_value(mapping: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in mapping and mapping[key] not in (None, ""):
            return mapping[key]
    return default


def _normalize_dependency_id(value: Any) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        return ""
    aliases = {
        "spend_amount": "ad_spend",
        "pv": "access_pv",
        "uv": "access_uv",
    }
    return aliases.get(normalized, normalized)


def _canonical_dependency_name(dependency_id: str) -> str:
    fallback_names = {
        "ad_spend": "投放金额",
        "access_pv": "访问PV",
        "access_uv": "访问UV",
        "download_click_uv": "下载点击UV",
    }
    return fallback_names.get(dependency_id, dependency_id)


def _external_dependency_slot_name(dependency_id: Any) -> str:
    return f"external_dependency:{_normalize_dependency_id(dependency_id)}"


def _dependency_id_from_external_slot(slot: Any) -> str:
    value = str(slot or "").strip()
    prefixes = (
        "external_dependency:",
        "external_dependency.",
        "external_dependencies.",
    )
    for prefix in prefixes:
        if value.startswith(prefix):
            return _normalize_dependency_id(value[len(prefix) :])
    return ""


def _normalize_external_supply_column_name(column: Any) -> str:
    normalized = str(column or "").strip()
    normalized_lower = normalized.lower()
    aliases = {
        "biz_date": "date",
        "业务日期": "date",
        "日期": "date",
        "统计日期": "date",
        "channel": "channel_id",
        "渠道": "channel_id",
        "渠道id": "channel_id",
        "渠道ID": "channel_id",
        "投放金额": "ad_spend",
        "投放成本": "ad_spend",
        "买量成本": "ad_spend",
        "广告费": "ad_spend",
        "访问PV": "access_pv",
        "PV": "access_pv",
        "pv": "access_pv",
        "访问UV": "access_uv",
        "UV": "access_uv",
        "uv": "access_uv",
        "下载点击UV": "download_click_uv",
        "下载UV": "download_click_uv",
        "下载点击人数": "download_click_uv",
    }
    return aliases.get(normalized, aliases.get(normalized_lower, normalized))


def _infer_external_supply_grain(columns: Sequence[Any]) -> list[str]:
    normalized_columns = {
        _normalize_external_supply_column_name(column) for column in columns
    }
    inferred: list[str] = []
    if {"date", "channel_id"}.issubset(normalized_columns):
        inferred.extend(["biz_date + channel_id", "date + channel_id"])
    elif "date" in normalized_columns:
        inferred.extend(["biz_date", "date"])
    if "cohort_period" in normalized_columns:
        inferred.append("cohort_period")
    return list(dict.fromkeys(inferred))


def _parse_external_supply_text(raw_text: Any, dependency_id: Any) -> dict[str, Any]:
    text = str(raw_text or "").strip()
    dependency_id = _normalize_dependency_id(dependency_id)
    if not text:
        return {"columns": [], "grain": [], "rows": []}

    def normalize_row(row: dict[str, Any]) -> dict[str, Any]:
        return {
            _normalize_external_supply_column_name(key): str(value).strip()
            for key, value in row.items()
            if str(key or "").strip() and str(value or "").strip()
        }

    rows: list[dict[str, Any]] = []
    normalized_text = text.replace("\t", ",")
    csv_lines = [
        line.strip()
        for line in normalized_text.splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    if csv_lines and any("," in line for line in csv_lines):
        try:
            reader = csv.DictReader(StringIO("\n".join(csv_lines)))
            rows = [normalize_row(row) for row in reader if isinstance(row, dict)]
            rows = [row for row in rows if row]
        except csv.Error:
            rows = []

    if not rows:
        date_value_pairs = re.findall(
            r"(\d{4}[-/]\d{2}[-/]\d{2}|\d{2}[-/]\d{2})\s*(?:=|:|：|为)?\s*([0-9]+(?:\.[0-9]+)?)",
            text,
        )
        channel_match = re.search(
            r"(?:渠道|channel[_\s-]?id)\s*[:：#]?\s*([0-9]{3,})",
            text,
            flags=re.IGNORECASE,
        )
        for date_value, metric_value in date_value_pairs:
            normalized_date = date_value.replace("/", "-")
            if re.fullmatch(r"\d{2}-\d{2}", normalized_date):
                normalized_date = f"2026-{normalized_date}"
            row = {"date": normalized_date, dependency_id: metric_value}
            if channel_match:
                row["channel_id"] = channel_match.group(1)
            rows.append(row)

    if not rows:
        value_match = re.search(r"([0-9]+(?:\.[0-9]+)?)", text)
        if value_match:
            rows.append({dependency_id: value_match.group(1)})

    columns = list(
        dict.fromkeys(
            _normalize_external_supply_column_name(column)
            for row in rows
            for column in row.keys()
        )
    )
    if dependency_id and dependency_id not in columns:
        columns.append(dependency_id)
    return {
        "columns": columns,
        "grain": _infer_external_supply_grain(columns),
        "rows": rows,
        "raw_text": text,
    }


def _extract_business_signature_list(
    business_signature: dict[str, Any],
    *keys: str,
) -> list[str]:
    for key in keys:
        values = _normalize_string_list(business_signature.get(key))
        if values:
            return values
    return []


def _query_matches_any_text(query: str, texts: Sequence[Any]) -> bool:
    normalized_query = query.lower()
    for text in _normalize_string_list(texts):
        if text.lower() and text.lower() in normalized_query:
            return True
        if re.search(re.escape(text), query, flags=re.IGNORECASE):
            return True
    return False


def _query_requests_internal_only(query: str) -> bool:
    return any(
        re.search(pattern, query, flags=re.IGNORECASE)
        for pattern in INTERNAL_ONLY_QUERY_PATTERNS
    )


def _external_dependency_exclusion_texts(dependency: dict[str, Any]) -> list[str]:
    dependency_id = _normalize_dependency_id(dependency.get("id"))
    texts = [
        dependency_id,
        dependency.get("name"),
        *(_normalize_string_list(dependency.get("aliases"))),
        *EXTERNAL_DEPENDENCY_EXCLUSION_ALIASES.get(dependency_id, ()),
    ]
    return list(dict.fromkeys(_normalize_string_list(texts)))


def _query_excludes_external_dependency(
    query: str,
    dependency: dict[str, Any],
) -> bool:
    if _query_requests_internal_only(query):
        return True

    # Phrases such as "不要编造" / "不要用默认值" are safety guards, not a
    # request to exclude the external metric that appears before them.  Without
    # stripping these guard phrases, queries like "如果缺投放金额，请先说明，不要
    # 编造" incorrectly match the generic "不要 ... 投放金额" exclusion pattern
    # and skip the external-data clarification path.
    exclusion_query = re.sub(
        r"(?:不要|不能|不可|避免).{0,8}(?:编造|虚构|瞎编|默认值|默认|硬凑|伪造)",
        "",
        query,
        flags=re.IGNORECASE,
    )
    exclusion_cue = "|".join(
        re.escape(cue) for cue in EXTERNAL_DEPENDENCY_EXCLUSION_CUES
    )
    for text in _external_dependency_exclusion_texts(dependency):
        if not text:
            continue
        escaped_text = re.escape(text)
        if re.search(
            rf"(?:{exclusion_cue}).{{0,80}}{escaped_text}",
            exclusion_query,
            flags=re.IGNORECASE,
        ):
            return True
        if re.search(
            rf"{escaped_text}.{{0,40}}(?:{exclusion_cue})",
            exclusion_query,
            flags=re.IGNORECASE,
        ):
            return True

    return False


def _extract_configured_external_dependencies(
    sql_samples: Sequence[Any] | None = None,
    instructions: Sequence[Any] | None = None,
) -> list[dict[str, Any]]:
    dependencies: dict[str, dict[str, Any]] = {}

    def upsert_dependency(dependency_id: str, **values: Any) -> None:
        normalized_dependency_id = _normalize_dependency_id(dependency_id)
        if not normalized_dependency_id:
            return

        existing = dependencies.setdefault(
            normalized_dependency_id,
            {
                "id": normalized_dependency_id,
                "name": _canonical_dependency_name(normalized_dependency_id),
                "aliases": [],
                "source_status": "missing",
                "missing_behavior": "ask_user",
                "ask_user_prompt": None,
                "required_grain": [],
                "required_by_terms": [],
                "required_by_templates": [],
                "trigger_when": [],
                "not_trigger_when": [],
                "input_modes": [],
                "lifecycle": "per_question",
                "validation": {},
                "required_columns": [],
                "matched_by_signature": False,
                "matched_by_instruction": False,
            },
        )
        for key, value in values.items():
            if key in {
                "aliases",
                "required_grain",
                "required_by_terms",
                "required_by_templates",
                "trigger_when",
                "not_trigger_when",
                "input_modes",
                "required_columns",
            }:
                for item in _normalize_string_list(value):
                    if item not in existing[key]:
                        existing[key].append(item)
                continue
            if value not in (None, ""):
                existing[key] = value

    for sample in sql_samples or []:
        signature = _get_business_signature(sample)
        dependency_ids = _extract_business_signature_list(
            signature,
            "externalDependencies",
            "external_dependencies",
        )
        template_ids = _normalize_string_list(
            signature.get("templateId") or signature.get("template_id")
        )
        for dependency_id in dependency_ids:
            upsert_dependency(
                dependency_id,
                required_by_templates=template_ids,
                matched_by_signature=True,
            )

    for instruction in instructions or []:
        asset_type = _get_sample_value(
            instruction, "knowledge_asset_type"
        ) or _get_sample_value(instruction, "knowledgeAssetType")
        if asset_type != "external_dependency":
            continue

        dependency_id = _get_sample_value(
            instruction, "external_dependency_id"
        ) or _get_sample_value(instruction, "externalDependencyId")
        metadata = _get_sample_value(instruction, "metadata") or {}
        if not isinstance(metadata, dict):
            metadata = {}
        required_grain_schema = metadata.get("required_grain_schema") or metadata.get(
            "requiredGrainSchema"
        )
        required_columns = metadata.get("required_columns") or metadata.get(
            "requiredColumns"
        )
        if not required_columns and isinstance(required_grain_schema, dict):
            required_columns = required_grain_schema.get(
                "required_columns"
            ) or required_grain_schema.get("requiredColumns")
        upsert_dependency(
            dependency_id,
            name=(
                _canonical_dependency_name(_normalize_dependency_id(dependency_id))
                if not _get_sample_value(instruction, "name")
                else _get_sample_value(instruction, "name")
            ),
            aliases=_get_sample_value(instruction, "aliases") or [],
            source_status=_get_sample_value(instruction, "source_status")
            or _get_sample_value(instruction, "sourceStatus")
            or "missing",
            missing_behavior=_get_sample_value(instruction, "missing_behavior")
            or _get_sample_value(instruction, "missingBehavior")
            or "ask_user",
            ask_user_prompt=_get_sample_value(instruction, "ask_user_prompt")
            or _get_sample_value(instruction, "askUserPrompt"),
            required_grain=_get_sample_value(instruction, "required_grain")
            or _get_sample_value(instruction, "requiredGrain")
            or [],
            required_by_terms=metadata.get("required_by_terms")
            or metadata.get("requiredByTerms")
            or _get_sample_value(instruction, "related_business_terms")
            or [],
            required_by_templates=metadata.get("required_by_templates")
            or metadata.get("requiredByTemplates")
            or [],
            trigger_when=metadata.get("trigger_when")
            or metadata.get("triggerWhen")
            or [],
            not_trigger_when=metadata.get("not_trigger_when")
            or metadata.get("notTriggerWhen")
            or [],
            input_modes=metadata.get("input_modes") or metadata.get("inputModes") or [],
            lifecycle=metadata.get("lifecycle") or "per_question",
            validation=metadata.get("validation") or {},
            required_columns=required_columns or [],
            matched_by_instruction=True,
        )

    return list(dependencies.values())


def _normalize_external_dependency_supply_map(value: Any) -> dict[str, dict[str, Any]]:
    if not value:
        return {}

    raw_dependencies = value
    if isinstance(value, dict):
        raw_dependencies = (
            value.get("external_dependency_values")
            or value.get("externalDependencyValues")
            or value.get("external_dependencies")
            or value.get("externalDependencies")
            or value
        )

    supplies: dict[str, dict[str, Any]] = {}

    def collect_columns(raw_supply: Any) -> list[str]:
        if isinstance(raw_supply, str):
            return _parse_external_supply_text(raw_supply, "").get("columns", [])
        if not isinstance(raw_supply, dict):
            return []
        columns = (
            raw_supply.get("columns")
            or raw_supply.get("headers")
            or raw_supply.get("fields")
            or raw_supply.get("schema")
            or []
        )
        normalized_columns = [
            _normalize_external_supply_column_name(column)
            for column in _normalize_string_list(columns)
        ]
        rows = raw_supply.get("rows")
        if isinstance(rows, list) and rows and isinstance(rows[0], dict):
            normalized_columns = [
                *normalized_columns,
                *[
                    _normalize_external_supply_column_name(key)
                    for key in rows[0].keys()
                ],
            ]
        return list(dict.fromkeys(normalized_columns))

    def collect_grain(raw_supply: Any) -> list[str]:
        if isinstance(raw_supply, str):
            return _parse_external_supply_text(raw_supply, "").get("grain", [])
        if not isinstance(raw_supply, dict):
            return []
        explicit_grain = _normalize_string_list(
            raw_supply.get("grain")
            or raw_supply.get("granularity")
            or raw_supply.get("required_grain")
            or raw_supply.get("requiredGrain")
            or []
        )
        return list(
            dict.fromkeys(
                [
                    *explicit_grain,
                    *_infer_external_supply_grain(collect_columns(raw_supply)),
                ]
            )
        )

    def collect_rows(raw_supply: Any, dependency_id: Any) -> list[dict[str, Any]]:
        if isinstance(raw_supply, str):
            return _parse_external_supply_text(raw_supply, dependency_id).get(
                "rows", []
            )
        if isinstance(raw_supply, dict):
            rows = raw_supply.get("rows")
            if isinstance(rows, list):
                return [row for row in rows if isinstance(row, dict)]
            raw_text = raw_supply.get("raw_text") or raw_supply.get("rawText")
            if raw_text:
                return _parse_external_supply_text(raw_text, dependency_id).get(
                    "rows", []
                )
        return []

    def collect_raw_text(raw_supply: Any) -> Optional[str]:
        if isinstance(raw_supply, str) and raw_supply.strip():
            return raw_supply.strip()
        if isinstance(raw_supply, dict):
            raw_text = raw_supply.get("raw_text") or raw_supply.get("rawText")
            if isinstance(raw_text, str) and raw_text.strip():
                return raw_text.strip()
        return None

    def add_supply(dependency_id: Any, raw_supply: Any) -> None:
        normalized_dependency_id = _normalize_dependency_id(str(dependency_id or ""))
        if not normalized_dependency_id:
            return
        supply = supplies.setdefault(
            normalized_dependency_id,
            {"columns": [], "grain": [], "rows": []},
        )
        if isinstance(raw_supply, str):
            raw_supply = _parse_external_supply_text(
                raw_supply,
                normalized_dependency_id,
            )
        for column in collect_columns(raw_supply):
            if column not in supply["columns"]:
                supply["columns"].append(column)
        for grain in collect_grain(raw_supply):
            if grain not in supply["grain"]:
                supply["grain"].append(grain)
        for row in collect_rows(raw_supply, normalized_dependency_id):
            supply["rows"].append(row)
        raw_text = collect_raw_text(raw_supply)
        if raw_text:
            supply["raw_text"] = raw_text

    if isinstance(raw_dependencies, dict):
        for key, raw_supply in raw_dependencies.items():
            slot_dependency_id = _dependency_id_from_external_slot(key)
            if slot_dependency_id:
                add_supply(slot_dependency_id, raw_supply)
            elif isinstance(raw_supply, dict):
                dependency_id = (
                    raw_supply.get("id")
                    or raw_supply.get("external_dependency_id")
                    or raw_supply.get("externalDependencyId")
                    or raw_supply.get("dependency_id")
                    or raw_supply.get("dependencyId")
                    or key
                )
                add_supply(dependency_id, raw_supply)
            elif isinstance(raw_supply, str):
                add_supply(key, raw_supply)
        return supplies

    if isinstance(raw_dependencies, list):
        for raw_supply in raw_dependencies:
            if not isinstance(raw_supply, dict):
                continue
            dependency_id = (
                raw_supply.get("id")
                or raw_supply.get("external_dependency_id")
                or raw_supply.get("externalDependencyId")
                or raw_supply.get("dependency_id")
                or raw_supply.get("dependencyId")
            )
            add_supply(dependency_id, raw_supply)

    return supplies


def _normalize_comparable_values(values: Sequence[Any]) -> set[str]:
    return {
        re.sub(r"\s+", "", str(value or "").strip()).lower()
        for value in values
        if str(value or "").strip()
    }


def _evaluate_supplied_external_dependency(
    dependency: dict[str, Any],
    supplies: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    dependency_id = str(dependency.get("id") or "").strip()
    supply = supplies.get(_normalize_dependency_id(dependency_id))
    if not supply:
        return {
            "satisfied": False,
            "missing_dependency": dependency_id,
            "missing_columns": [],
            "missing_grain": [],
        }

    validation = dependency.get("validation") or {}
    if not isinstance(validation, dict):
        validation = {}
    required_columns = [
        _normalize_external_supply_column_name(column)
        for column in _normalize_string_list(
            validation.get("required_columns")
            or validation.get("requiredColumns")
            or dependency.get("required_columns")
            or dependency.get("requiredColumns")
            or []
        )
    ]
    required_grain = _normalize_string_list(dependency.get("required_grain"))

    supplied_columns = _normalize_comparable_values(supply.get("columns") or [])
    supplied_grain = _normalize_comparable_values(supply.get("grain") or [])
    supplied_schema_values = supplied_columns | supplied_grain

    missing_columns = [
        column
        for column in required_columns
        if _normalize_comparable_values([column]).isdisjoint(supplied_columns)
    ]
    missing_grain = [
        grain
        for grain in required_grain
        if _normalize_comparable_values([grain]).isdisjoint(supplied_schema_values)
    ]
    if required_grain and len(missing_grain) < len(required_grain):
        missing_grain = []
    return {
        "satisfied": not missing_columns and not missing_grain,
        "missing_dependency": None,
        "missing_columns": missing_columns,
        "missing_grain": missing_grain,
    }


def _match_configured_external_dependencies(
    query: str,
    configured_dependencies: Sequence[dict[str, Any]],
) -> list[dict[str, Any]]:
    configured_matches: list[dict[str, Any]] = []
    for dependency in configured_dependencies:
        if _query_excludes_external_dependency(query, dependency):
            continue

        match_texts = [
            dependency.get("name"),
            dependency.get("id"),
            *(_normalize_string_list(dependency.get("aliases"))),
        ]
        required_by_terms = _normalize_string_list(dependency.get("required_by_terms"))
        required_by_templates = _normalize_string_list(
            dependency.get("required_by_templates")
        )
        trigger_when = _normalize_string_list(dependency.get("trigger_when"))
        not_trigger_when = _normalize_string_list(dependency.get("not_trigger_when"))
        signature_matched = bool(dependency.get("matched_by_signature"))
        instruction_matched = bool(dependency.get("matched_by_instruction"))
        if not_trigger_when and _query_matches_any_text(query, not_trigger_when):
            continue

        base_matched = (
            _query_matches_any_text(query, match_texts)
            or (required_by_terms and _query_matches_any_text(query, required_by_terms))
            or (
                required_by_templates
                and _query_matches_any_text(query, required_by_templates)
            )
            or signature_matched
        )
        trigger_matched = bool(
            trigger_when and _query_matches_any_text(query, trigger_when)
        )
        should_match = (
            base_matched or trigger_matched
            if trigger_when
            else base_matched or instruction_matched
        )

        if should_match:
            configured_matches.append(dependency)
    return configured_matches


def detect_supplied_external_dependency_coverage(
    query: Optional[str],
    *,
    sql_samples: Sequence[Any] | None = None,
    instructions: Sequence[Any] | None = None,
    supplied_external_dependencies: Any = None,
) -> Optional[dict[str, Any]]:
    if not query or not supplied_external_dependencies:
        return None

    supplies = _normalize_external_dependency_supply_map(supplied_external_dependencies)
    if not supplies:
        return None

    configured_dependencies = _extract_configured_external_dependencies(
        sql_samples=sql_samples,
        instructions=instructions,
    )
    configured_matches = _match_configured_external_dependencies(
        query,
        configured_dependencies,
    )
    missing_dependencies = [
        dependency
        for dependency in configured_matches
        if str(dependency.get("source_status") or "missing").lower()
        in {"missing", "partial", "manual_input"}
        and str(dependency.get("missing_behavior") or "ask_user").lower()
        in {"ask_user", "block_answer"}
    ]
    if not missing_dependencies:
        return None

    evaluations = [
        {
            "dependency_id": dependency.get("id"),
            **_evaluate_supplied_external_dependency(dependency, supplies),
        }
        for dependency in missing_dependencies
    ]
    if not evaluations or not all(
        evaluation["satisfied"] for evaluation in evaluations
    ):
        return None

    return {
        "source": "external_dependency_user_supplied",
        "required_external_dependencies": [
            str(dependency.get("id"))
            for dependency in missing_dependencies
            if dependency.get("id")
        ],
        "provided_external_dependencies": list(supplies.keys()),
        "evaluations": evaluations,
        "supplies": supplies,
    }


def build_supplied_external_dependency_instruction(
    supplied_external_dependencies: Any,
) -> Optional[dict[str, Any]]:
    supplies = _normalize_external_dependency_supply_map(supplied_external_dependencies)
    if not supplies:
        return None

    def safe_cte_name(dependency_id: Any, index: int) -> str:
        normalized = re.sub(
            r"[^a-zA-Z0-9_]+",
            "_",
            _normalize_external_supply_column_name(dependency_id).lower(),
        ).strip("_")
        if not normalized or not re.match(r"^[a-zA-Z_]", normalized):
            normalized = f"dependency_{index + 1}"
        return f"supplied_external_{normalized}"

    def sql_column_name(column: Any) -> str:
        normalized = _normalize_external_supply_column_name(column)
        # The internal semantic layer and imported TiDB fixture use biz_date.
        # Keep user-facing parsing permissive ("date"/"日期"), but provide a SQL
        # ready CTE column that LLMs can join to internal tables without
        # inventing an external source table.
        if normalized == "date":
            return "biz_date"
        normalized = re.sub(r"[^a-zA-Z0-9_]+", "_", normalized).strip("_")
        if not normalized or not re.match(r"^[a-zA-Z_]", normalized):
            normalized = "value"
        return normalized

    def sql_literal(value: Any, column: str) -> str:
        raw = str(value or "").strip()
        escaped = raw.replace("'", "''")
        if column in {"date", "biz_date"} and re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
            return f"DATE '{escaped}'"
        if re.fullmatch(r"-?\d+(?:\.\d+)?", raw):
            return raw
        return f"'{escaped}'"

    def build_inline_cte(dependency_id: str, supply: dict[str, Any], index: int) -> str:
        rows = supply.get("rows") or []
        if not isinstance(rows, list) or not rows:
            return ""

        row_columns = list(
            dict.fromkeys(
                _normalize_external_supply_column_name(column)
                for row in rows
                if isinstance(row, dict)
                for column in row.keys()
                if str(column or "").strip()
            )
        )
        columns = row_columns or [
            _normalize_external_supply_column_name(column)
            for column in supply.get("columns") or []
            if str(column or "").strip()
        ]
        # Avoid leaking localized dependency names as SQL identifiers when the
        # supplied CSV already contains canonical metric columns.
        columns = [
            column
            for column in list(dict.fromkeys(columns))
            if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", sql_column_name(column))
        ]
        if not columns:
            return ""

        cte_columns = [sql_column_name(column) for column in columns]
        select_rows = []
        for row in rows[:50]:
            if not isinstance(row, dict):
                continue
            normalized_row = {
                _normalize_external_supply_column_name(key): value
                for key, value in row.items()
            }
            select_rows.append(
                "SELECT "
                + ", ".join(
                    f"{sql_literal(normalized_row.get(column, ''), column)} AS {cte_column}"
                    for column, cte_column in zip(columns, cte_columns)
                )
            )
        if not select_rows:
            return ""

        return (
            f"{safe_cte_name(dependency_id, index)} AS (\n  "
            + "\n  UNION ALL\n  ".join(select_rows)
            + "\n)"
        )

    inline_ctes: list[str] = []
    for index, (dependency_id, supply) in enumerate(supplies.items()):
        cte = build_inline_cte(dependency_id, supply, index)
        if cte:
            inline_ctes.append(cte)

    lines = [
        "用户已在本次对话中补充外部数据。生成 SQL 时必须只使用这些用户补充值，不能编造、不能跨问题复用。",
        "如需参与计算，必须使用下面的 inline CTE；不要假设存在 dwd_ad_spend、external_metrics 等外部物理表。",
        "CTE 中 biz_date/channel_id 等列可直接与内部表按日期、渠道或 cohort 粒度关联。",
        "如果用户提到 Excel ROI 回收表的 D1 到 D360，应按 Excel 固定回收周期列 D1/D3/D7/D15/D30/D60/D90/D120/D150/D180/D210/D240/D270/D300/D330/D360 输出，不要生成 360 个逐日列。",
    ]
    if inline_ctes:
        lines.extend(
            [
                "可直接复用的外部数据 CTE：",
                "WITH " + ",\n".join(inline_ctes),
            ]
        )
    for dependency_id, supply in supplies.items():
        rows = supply.get("rows") or []
        row_preview = rows[:20] if isinstance(rows, list) else []
        lines.append(
            f"- {dependency_id}: columns={supply.get('columns') or []}; "
            f"grain={supply.get('grain') or []}; rows={row_preview}"
        )
        raw_text = supply.get("raw_text")
        if raw_text and not row_preview:
            lines.append(f"  raw_text={raw_text}")

    return {
        "instruction": "\n".join(lines),
        "source": "external_dependency_user_supplied",
        "knowledge_asset_type": "external_dependency_supply",
        "provided_external_dependencies": list(supplies.keys()),
        "inline_cte_count": len(inline_ctes),
    }


def build_supplied_external_daily_report_sql(
    query: Optional[str],
    supplied_external_dependencies: Any,
) -> Optional[str]:
    """Build a deterministic Excel-shaped comprehensive daily report SQL.

    FT01 FULL needs user-supplied ad spend and traffic metrics to be joined
    with internal daily metrics.  The generic LLM path is intentionally blocked
    before those metrics are supplied, but after the clarification form provides
    them we should not depend on free-form SQL generation because it can loop on
    SQL correction or accidentally invent physical external tables.
    """

    if not query or not re.search(r"综合日报|渠道日报|日报", query):
        return None
    if re.search(r"ROI|投入产出|投放回收|累计收入", query, re.IGNORECASE):
        return None

    supplies = _normalize_external_dependency_supply_map(supplied_external_dependencies)
    if not supplies:
        return None

    params = _extract_template_parameters_from_query(
        query,
        [
            "tenant_plat_id",
            "channel_id",
            "start_date",
            "end_date",
        ],
    )
    tenant_plat_id = params.get("tenant_plat_id")
    channel_id = params.get("channel_id")
    if isinstance(channel_id, list):
        channel_id = channel_id[0] if channel_id else None
    start_date = params.get("start_date")
    end_date = params.get("end_date")
    if not all([tenant_plat_id, channel_id, start_date, end_date]):
        return None

    def sql_date(value: Any) -> Optional[str]:
        raw = str(value or "").strip()
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
            return None
        return raw

    def sql_number(value: Any) -> Optional[str]:
        raw = str(value or "").strip().replace(",", "")
        if not re.fullmatch(r"-?\d+(?:\.\d+)?", raw):
            return None
        return raw

    merged_rows: dict[tuple[str, str, str], dict[str, Any]] = {}
    for supply in supplies.values():
        if not isinstance(supply, dict):
            continue
        rows = supply.get("rows") or []
        if not isinstance(rows, list):
            continue
        for row in rows[:200]:
            if not isinstance(row, dict):
                continue
            normalized_row = {
                _normalize_external_supply_column_name(key): value
                for key, value in row.items()
            }
            biz_date = sql_date(
                normalized_row.get("date") or normalized_row.get("biz_date")
            )
            row_tenant = sql_number(
                normalized_row.get("tenant_plat_id") or tenant_plat_id
            )
            row_channel = sql_number(normalized_row.get("channel_id") or channel_id)
            if not biz_date or not row_tenant or not row_channel:
                continue
            if str(int(float(row_tenant))) != str(int(tenant_plat_id)):
                continue
            if str(int(float(row_channel))) != str(int(channel_id)):
                continue
            if str(start_date) <= biz_date <= str(end_date):
                merged_rows.setdefault((biz_date, row_tenant, row_channel), {}).update(
                    normalized_row
                )

    select_rows: list[str] = []
    for (biz_date, row_tenant, row_channel), row in sorted(merged_rows.items()):
        ad_spend = sql_number(row.get("ad_spend"))
        access_pv = sql_number(row.get("access_pv"))
        access_uv = sql_number(row.get("access_uv"))
        download_click_uv = sql_number(row.get("download_click_uv"))
        if not all([ad_spend, access_pv, access_uv, download_click_uv]):
            continue
        select_rows.append(
            "SELECT "
            f"DATE '{biz_date}' AS biz_date, "
            f"{int(float(row_tenant))} AS tenant_plat_id, "
            f"{int(float(row_channel))} AS channel_id, "
            f"{ad_spend} AS ad_spend, "
            f"{access_pv} AS access_pv, "
            f"{access_uv} AS access_uv, "
            f"{download_click_uv} AS download_click_uv"
        )

    if not select_rows:
        return None

    supplied_cte = "\n  UNION ALL\n  ".join(select_rows)
    tenant_id_sql = int(tenant_plat_id)
    channel_id_sql = int(channel_id)

    return f"""
WITH
external_metrics AS (
  {supplied_cte}
),
dim AS (
  SELECT
    COALESCE(tp.name, CAST({tenant_id_sql} AS VARCHAR)) AS site_name,
    COALESCE(ch.channel_partner_username, CAST(ch.channel_partner_id AS VARCHAR), '') AS channel_partner,
    COALESCE(ch.name, CAST({channel_id_sql} AS VARCHAR)) AS channel_name
  FROM (SELECT 1) x
  LEFT JOIN tidb_business_demo_tenant_plat tp ON tp.id = {tenant_id_sql}
  LEFT JOIN tidb_business_demo_channel ch ON ch.id = {channel_id_sql}
    AND ch.tenant_plat_id = {tenant_id_sql}
),
login_daily AS (
  SELECT CAST(l.create_time AS DATE) AS biz_date, l.channel_id, COUNT(DISTINCT l.player_id) AS login_user_count
  FROM tidb_business_demo_dwd_player_login_log l
  WHERE l.category = 1
    AND l.tenant_plat_id = {tenant_id_sql}
    AND l.channel_id = {channel_id_sql}
    AND l.create_time >= DATE '{start_date}'
    AND l.create_time < DATE_ADD('day', 1, DATE '{end_date}')
  GROUP BY CAST(l.create_time AS DATE), l.channel_id
),
register_daily AS (
  SELECT CAST(p.create_time AS DATE) AS biz_date, p.channel_id, COUNT(DISTINCT p.id) AS register_user_count
  FROM tidb_business_demo_dim_player p
  WHERE p.tenant_plat_id = {tenant_id_sql}
    AND p.channel_id = {channel_id_sql}
    AND p.create_time >= DATE '{start_date}'
    AND p.create_time < DATE_ADD('day', 1, DATE '{end_date}')
  GROUP BY CAST(p.create_time AS DATE), p.channel_id
),
deposit_daily AS (
  SELECT
    CAST(d.callback_time AS DATE) AS biz_date,
    d.channel_id,
    COUNT(DISTINCT d.player_id) AS deposit_user_count,
    SUM(d.actual_amount) AS deposit_amount,
    COUNT(DISTINCT CASE WHEN d.times = 1 THEN d.player_id END) AS first_deposit_user_count,
    SUM(CASE WHEN d.times = 1 THEN d.actual_amount ELSE 0 END) AS first_deposit_amount,
    COUNT(DISTINCT CASE WHEN d.times = 1 AND CAST(d.regist_time AS DATE) = CAST(d.callback_time AS DATE) THEN d.player_id END) AS new_customer_first_deposit_user_count,
    COUNT(DISTINCT CASE WHEN d.times = 1 AND CAST(d.regist_time AS DATE) <> CAST(d.callback_time AS DATE) THEN d.player_id END) AS develop_user_count,
    SUM(CASE WHEN d.regist_time >= DATE '{start_date}' AND d.regist_time < DATE_ADD('day', 1, DATE '{end_date}') THEN d.actual_amount ELSE 0 END) AS new_customer_deposit_amount
  FROM tidb_business_demo_dwd_order_deposit d
  WHERE d.status = 2
    AND d.tenant_plat_id = {tenant_id_sql}
    AND d.channel_id = {channel_id_sql}
    AND d.callback_time >= DATE '{start_date}'
    AND d.callback_time < DATE_ADD('day', 1, DATE '{end_date}')
  GROUP BY CAST(d.callback_time AS DATE), d.channel_id
),
withdraw_daily AS (
  SELECT CAST(w.callback_time AS DATE) AS biz_date, w.channel_id, COUNT(DISTINCT w.player_id) AS withdrawal_user_count, SUM(w.act_amount) AS withdrawal_amount
  FROM tidb_business_demo_dwd_order_withdrawal w
  WHERE w.status = 3
    AND w.tenant_plat_id = {tenant_id_sql}
    AND w.channel_id = {channel_id_sql}
    AND w.callback_time >= DATE '{start_date}'
    AND w.callback_time < DATE_ADD('day', 1, DATE '{end_date}')
  GROUP BY CAST(w.callback_time AS DATE), w.channel_id
),
bet_daily AS (
  SELECT CAST(b.settle_time AS DATE) AS biz_date, b.channel_id, COUNT(DISTINCT b.player_id) AS bet_user_count, SUM(b.valid_bet_amount) AS valid_bet_amount, SUM(b.win_loss_amount) AS win_loss_amount
  FROM tidb_business_demo_dwd_bet_order b
  WHERE b.settle_status = 1
    AND b.tenant_plat_id = {tenant_id_sql}
    AND b.channel_id = {channel_id_sql}
    AND b.settle_time >= DATE '{start_date}'
    AND b.settle_time < DATE_ADD('day', 1, DATE '{end_date}')
  GROUP BY CAST(b.settle_time AS DATE), b.channel_id
),
rebate_daily AS (
  SELECT CAST(r.receive_time AS DATE) AS biz_date, r.channel_id, SUM(r.amount) AS rebate_amount
  FROM tidb_business_demo_dwd_order_rebate r
  WHERE r.status = 1
    AND r.tenant_plat_id = {tenant_id_sql}
    AND r.channel_id = {channel_id_sql}
    AND r.receive_time >= DATE '{start_date}'
    AND r.receive_time < DATE_ADD('day', 1, DATE '{end_date}')
  GROUP BY CAST(r.receive_time AS DATE), r.channel_id
),
add_sub_daily AS (
  SELECT CAST(a.modify_time AS DATE) AS biz_date, a.channel_id,
         SUM(CASE WHEN a.add_or_sub_type_id IN (1207, 1209) THEN a.amount ELSE 0 END) -
         SUM(CASE WHEN a.add_or_sub_type_id IN (2204, 2207) THEN a.amount ELSE 0 END) AS discount_adjust_amount
  FROM tidb_business_demo_dwd_order_add_or_sub a
  WHERE a.status = 2
    AND a.add_or_sub_type_id IN (1207, 1209, 2204, 2207)
    AND a.tenant_plat_id = {tenant_id_sql}
    AND a.channel_id = {channel_id_sql}
    AND a.modify_time >= DATE '{start_date}'
    AND a.modify_time < DATE_ADD('day', 1, DATE '{end_date}')
  GROUP BY CAST(a.modify_time AS DATE), a.channel_id
),
vip_award_daily AS (
  SELECT CAST(v.modify_time AS DATE) AS biz_date, v.channel_id, SUM(v.amount) AS vip_award_amount
  FROM tidb_business_demo_dwd_order_vip_award v
  WHERE v.status = 2
    AND v.tenant_plat_id = {tenant_id_sql}
    AND v.channel_id = {channel_id_sql}
    AND v.modify_time >= DATE '{start_date}'
    AND v.modify_time < DATE_ADD('day', 1, DATE '{end_date}')
  GROUP BY CAST(v.modify_time AS DATE), v.channel_id
),
activity_daily AS (
  SELECT CAST(a.receive_time AS DATE) AS biz_date, a.channel_id, SUM(a.amount) AS activity_amount
  FROM tidb_business_demo_dwd_order_activity a
  WHERE a.status = 2
    AND a.tenant_plat_id = {tenant_id_sql}
    AND a.channel_id = {channel_id_sql}
    AND a.receive_time >= DATE '{start_date}'
    AND a.receive_time < DATE_ADD('day', 1, DATE '{end_date}')
  GROUP BY CAST(a.receive_time AS DATE), a.channel_id
),
task_daily AS (
  SELECT CAST(t.receive_time AS DATE) AS biz_date, t.channel_id, SUM(t.amount) AS task_amount
  FROM tidb_business_demo_dwd_order_task t
  WHERE t.status = 2
    AND t.tenant_plat_id = {tenant_id_sql}
    AND t.channel_id = {channel_id_sql}
    AND t.receive_time >= DATE '{start_date}'
    AND t.receive_time < DATE_ADD('day', 1, DATE '{end_date}')
  GROUP BY CAST(t.receive_time AS DATE), t.channel_id
),
promote_daily AS (
  SELECT CAST(p.send_time AS DATE) AS biz_date, p.channel_id, SUM(p.amount) AS promote_activity_amount
  FROM tidb_business_demo_dwd_order_promote_activity p
  WHERE p.status = 1
    AND p.tenant_plat_id = {tenant_id_sql}
    AND p.channel_id = {channel_id_sql}
    AND p.send_time >= DATE '{start_date}'
    AND p.send_time < DATE_ADD('day', 1, DATE '{end_date}')
  GROUP BY CAST(p.send_time AS DATE), p.channel_id
),
lottery_daily AS (
  SELECT CAST(l.delivery_time AS DATE) AS biz_date, l.channel_id, SUM(l.amount) AS lottery_amount
  FROM tidb_business_demo_dwd_order_lottery l
  WHERE l.status = 2
    AND l.tenant_plat_id = {tenant_id_sql}
    AND l.channel_id = {channel_id_sql}
    AND l.delivery_time >= DATE '{start_date}'
    AND l.delivery_time < DATE_ADD('day', 1, DATE '{end_date}')
  GROUP BY CAST(l.delivery_time AS DATE), l.channel_id
),
daily_base AS (
  SELECT
    e.biz_date,
    e.channel_id,
    (SELECT site_name FROM dim) AS site_name,
    (SELECT channel_partner FROM dim) AS channel_partner,
    (SELECT channel_name FROM dim) AS channel_name,
    e.ad_spend, e.access_pv, e.access_uv, e.download_click_uv,
    COALESCE(ld.login_user_count, 0) AS login_user_count,
    COALESCE(rd.register_user_count, 0) AS register_user_count,
    COALESCE(dd.deposit_user_count, 0) AS deposit_user_count,
    COALESCE(dd.deposit_amount, 0) AS deposit_amount,
    COALESCE(wd.withdrawal_user_count, 0) AS withdrawal_user_count,
    COALESCE(wd.withdrawal_amount, 0) AS withdrawal_amount,
    COALESCE(dd.first_deposit_user_count, 0) AS first_deposit_user_count,
    COALESCE(dd.new_customer_first_deposit_user_count, 0) AS new_customer_first_deposit_user_count,
    COALESCE(dd.develop_user_count, 0) AS develop_user_count,
    COALESCE(dd.first_deposit_amount, 0) AS first_deposit_amount,
    COALESCE(dd.new_customer_deposit_amount, 0) AS new_customer_deposit_amount,
    COALESCE(bd.bet_user_count, 0) AS bet_user_count,
    COALESCE(bd.valid_bet_amount, 0) AS valid_bet_amount,
    COALESCE(bd.win_loss_amount, 0) AS win_loss_amount,
    COALESCE(rb.rebate_amount, 0) AS rebate_amount,
    COALESCE(asd.discount_adjust_amount, 0) AS discount_adjust_amount,
    COALESCE(vad.vip_award_amount, 0) AS vip_award_amount,
    COALESCE(acd.activity_amount, 0) AS activity_amount,
    COALESCE(td.task_amount, 0) AS task_amount,
    COALESCE(pd.promote_activity_amount, 0) AS promote_activity_amount,
    COALESCE(ldy.lottery_amount, 0) AS lottery_amount
  FROM external_metrics e
  LEFT JOIN login_daily ld ON e.biz_date = ld.biz_date AND e.channel_id = ld.channel_id
  LEFT JOIN register_daily rd ON e.biz_date = rd.biz_date AND e.channel_id = rd.channel_id
  LEFT JOIN deposit_daily dd ON e.biz_date = dd.biz_date AND e.channel_id = dd.channel_id
  LEFT JOIN withdraw_daily wd ON e.biz_date = wd.biz_date AND e.channel_id = wd.channel_id
  LEFT JOIN bet_daily bd ON e.biz_date = bd.biz_date AND e.channel_id = bd.channel_id
  LEFT JOIN rebate_daily rb ON e.biz_date = rb.biz_date AND e.channel_id = rb.channel_id
  LEFT JOIN add_sub_daily asd ON e.biz_date = asd.biz_date AND e.channel_id = asd.channel_id
  LEFT JOIN vip_award_daily vad ON e.biz_date = vad.biz_date AND e.channel_id = vad.channel_id
  LEFT JOIN activity_daily acd ON e.biz_date = acd.biz_date AND e.channel_id = acd.channel_id
  LEFT JOIN task_daily td ON e.biz_date = td.biz_date AND e.channel_id = td.channel_id
  LEFT JOIN promote_daily pd ON e.biz_date = pd.biz_date AND e.channel_id = pd.channel_id
  LEFT JOIN lottery_daily ldy ON e.biz_date = ldy.biz_date AND e.channel_id = ldy.channel_id
),
report_rows AS (
  SELECT
    0 AS row_sort,
    '汇总' AS report_date,
    MAX(site_name) AS site_name,
    MAX(channel_partner) AS channel_partner,
    MAX(channel_name) AS channel_name,
    SUM(ad_spend) AS ad_spend,
    SUM(login_user_count) AS login_user_count,
    SUM(deposit_user_count) AS deposit_user_count,
    SUM(deposit_amount) AS deposit_amount,
    SUM(withdrawal_amount) AS withdrawal_amount,
    SUM(access_pv) AS access_pv,
    SUM(access_uv) AS access_uv,
    SUM(download_click_uv) AS download_click_uv,
    SUM(register_user_count) AS register_user_count,
    SUM(first_deposit_user_count) AS first_deposit_user_count,
    SUM(new_customer_first_deposit_user_count) AS new_customer_first_deposit_user_count,
    SUM(develop_user_count) AS develop_user_count,
    SUM(first_deposit_amount) AS first_deposit_amount,
    SUM(new_customer_deposit_amount) AS new_customer_deposit_amount,
    SUM(bet_user_count) AS bet_user_count,
    SUM(valid_bet_amount) AS valid_bet_amount,
    SUM(win_loss_amount) AS win_loss_amount,
    SUM(task_amount) AS task_amount,
    SUM(rebate_amount) AS rebate_amount,
    SUM(discount_adjust_amount) AS discount_adjust_amount,
    SUM(vip_award_amount + activity_amount + promote_activity_amount + lottery_amount) AS marketing_lottery_amount
  FROM daily_base
  UNION ALL
  SELECT
    1 AS row_sort,
    CAST(biz_date AS VARCHAR) AS report_date,
    site_name, channel_partner, channel_name,
    ad_spend, login_user_count, deposit_user_count, deposit_amount, withdrawal_amount,
    access_pv, access_uv, download_click_uv, register_user_count, first_deposit_user_count,
    new_customer_first_deposit_user_count, develop_user_count, first_deposit_amount,
    new_customer_deposit_amount, bet_user_count, valid_bet_amount, win_loss_amount,
    task_amount, rebate_amount, discount_adjust_amount,
    vip_award_amount + activity_amount + promote_activity_amount + lottery_amount AS marketing_lottery_amount
  FROM daily_base
)
SELECT
  report_date AS "日期",
  site_name AS "所属站点",
  channel_partner AS "所属渠道商",
  channel_name AS "渠道名称",
  ad_spend AS "投放金额",
  login_user_count AS "登陆人数",
  deposit_user_count AS "存款总人数",
  deposit_amount AS "存款总金额",
  withdrawal_amount AS "提现总金额",
  deposit_amount - withdrawal_amount AS "充提差",
  access_pv AS "PV",
  access_uv AS "UV",
  download_click_uv AS "下载点击UV",
  download_click_uv / NULLIF(access_uv, 0) AS "UV下载率",
  register_user_count AS "注册人数",
  register_user_count / NULLIF(access_uv, 0) AS "UV注册率",
  first_deposit_user_count AS "首存人数",
  new_customer_first_deposit_user_count AS "新客首存人数",
  develop_user_count AS "开发人数",
  ad_spend / NULLIF(first_deposit_user_count, 0) AS "首存成本",
  first_deposit_user_count / NULLIF(register_user_count, 0) AS "首存率",
  first_deposit_amount AS "首存总金额",
  first_deposit_amount / NULLIF(first_deposit_user_count, 0) AS "首存人均金额",
  new_customer_deposit_amount AS "新客存款金额",
  bet_user_count AS "投注人数",
  valid_bet_amount AS "有效投注",
  win_loss_amount AS "会员输赢",
  win_loss_amount / NULLIF(valid_bet_amount, 0) AS "杀率",
  task_amount AS "任务彩金",
  rebate_amount AS "洗码",
  discount_adjust_amount AS "优惠加扣款",
  marketing_lottery_amount AS "营销+彩票",
  task_amount + rebate_amount + discount_adjust_amount + marketing_lottery_amount AS "合计优惠"
FROM report_rows
ORDER BY row_sort, "日期"
""".strip()


def build_supplied_external_roi_sql(
    query: Optional[str],
    supplied_external_dependencies: Any,
) -> Optional[str]:
    """Build a deterministic Excel-shaped ROI SQL when ad spend is supplied.

    The normal LLM path can answer this, but it has two recurring failure modes
    in the strict Excel FULL cases: it may split ROI and period-over-period
    ratios into alternating columns, and it may generate D1..D360 as daily
    columns instead of the fixed Excel recovery checkpoints.  When the user has
    already supplied the missing ad spend rows, this narrow builder keeps the
    same external-data safety contract while producing the expected table shape.
    """

    if not query or not re.search(r"ROI|投入产出|投放回收", query, re.IGNORECASE):
        return None
    if re.search(r"累计收入表", query) and not re.search(r"ROI", query, re.IGNORECASE):
        return None

    supplies = _normalize_external_dependency_supply_map(supplied_external_dependencies)
    if not supplies:
        return None

    ad_spend_supply = next(
        (
            supply
            for supply in supplies.values()
            if isinstance(supply, dict)
            and any(
                _normalize_external_supply_column_name(column) == "ad_spend"
                for column in (supply.get("columns") or [])
            )
        ),
        None,
    )
    if not ad_spend_supply:
        return None

    rows = ad_spend_supply.get("rows") or []
    if not isinstance(rows, list) or not rows:
        return None

    params = _extract_template_parameters_from_query(
        query,
        [
            "tenant_plat_id",
            "channel_id",
            "cohort_start_date",
            "cohort_end_date",
            "top_n",
        ],
    )
    tenant_plat_id = params.get("tenant_plat_id")
    channel_id = params.get("channel_id")
    if isinstance(channel_id, list):
        channel_id = channel_id[0] if channel_id else None
    start_date = params.get("cohort_start_date")
    end_date = params.get("cohort_end_date")
    if not all([tenant_plat_id, channel_id, start_date, end_date]):
        return None

    top_n = int(params.get("top_n") or 3)
    topn_requested = _query_requests_topn_user_segment(query)
    user_type = f"TOP{top_n}" if topn_requested else "全部用户"

    def sql_date(value: Any) -> Optional[str]:
        raw = str(value or "").strip()
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
            return None
        return raw

    def sql_number(value: Any) -> Optional[str]:
        raw = str(value or "").strip().replace(",", "")
        if not re.fullmatch(r"-?\d+(?:\.\d+)?", raw):
            return None
        return raw

    select_rows: list[str] = []
    for row in rows[:200]:
        if not isinstance(row, dict):
            continue
        normalized_row = {
            _normalize_external_supply_column_name(key): value
            for key, value in row.items()
        }
        biz_date = sql_date(
            normalized_row.get("date") or normalized_row.get("biz_date")
        )
        ad_spend = sql_number(normalized_row.get("ad_spend"))
        row_channel_id = sql_number(normalized_row.get("channel_id") or channel_id)
        if not biz_date or not ad_spend:
            continue
        select_rows.append(
            "SELECT "
            f"DATE '{biz_date}' AS biz_date, "
            f"{row_channel_id or int(channel_id)} AS channel_id, "
            f"{ad_spend} AS ad_spend"
        )

    if not select_rows:
        return None

    supplied_cte = "\n  UNION ALL\n  ".join(select_rows)
    segment_filter = f"\n  WHERE bet_rank <= {top_n}" if topn_requested else ""

    return f"""
WITH RECURSIVE
seq AS (
  SELECT 1 AS n
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 360
),
first_deposit_all AS (
  SELECT
    d.tenant_plat_id,
    d.channel_id,
    d.player_id,
    CAST(MIN(d.callback_time) AS DATE) AS first_deposit_date
  FROM tidb_business_demo_dwd_order_deposit d
  WHERE d.status = 2
    AND d.times = 1
    AND d.tenant_plat_id = {int(tenant_plat_id)}
    AND d.channel_id = {int(channel_id)}
    AND d.callback_time >= DATE '{start_date}'
    AND d.callback_time < DATE_ADD('day', 1, DATE '{end_date}')
  GROUP BY d.tenant_plat_id, d.channel_id, d.player_id
),
rank_base AS (
  SELECT
    c.player_id,
    COALESCE(SUM(b.valid_bet_amount), 0) AS total_valid_bet_amount
  FROM first_deposit_all c
  LEFT JOIN tidb_business_demo_dwd_bet_order b
    ON b.player_id = c.player_id
   AND b.tenant_plat_id = c.tenant_plat_id
   AND b.channel_id = c.channel_id
   AND b.settle_status = 1
   AND b.settle_time >= c.first_deposit_date
   AND b.settle_time < DATE_ADD('day', 360, c.first_deposit_date)
  GROUP BY c.player_id
),
first_deposit AS (
  SELECT ranked.*
  FROM (
    SELECT
      c.*,
      ROW_NUMBER() OVER (ORDER BY rb.total_valid_bet_amount DESC, c.player_id) AS bet_rank
    FROM first_deposit_all c
    INNER JOIN rank_base rb ON rb.player_id = c.player_id
  ) ranked{segment_filter}
),
daily_revenue AS (
  SELECT
    c.player_id,
    c.first_deposit_date,
    DATE_DIFF('day', c.first_deposit_date, CAST(b.settle_time AS DATE)) + 1 AS relative_day_no,
    SUM(b.win_loss_amount) AS revenue_amount
  FROM first_deposit c
  INNER JOIN tidb_business_demo_dwd_bet_order b
    ON b.player_id = c.player_id
   AND b.tenant_plat_id = c.tenant_plat_id
   AND b.channel_id = c.channel_id
  WHERE b.settle_status = 1
    AND b.settle_time >= c.first_deposit_date
    AND b.settle_time < DATE_ADD('day', 360, c.first_deposit_date)
  GROUP BY c.player_id, c.first_deposit_date, DATE_DIFF('day', c.first_deposit_date, CAST(b.settle_time AS DATE)) + 1
),
player_day_grid AS (
  SELECT c.player_id, c.first_deposit_date, s.n AS relative_day_no
  FROM first_deposit c
  CROSS JOIN seq s
),
player_cumulative AS (
  SELECT
    g.player_id,
    g.first_deposit_date,
    g.relative_day_no,
    SUM(COALESCE(dr.revenue_amount, 0)) OVER (
      PARTITION BY g.player_id
      ORDER BY g.relative_day_no
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS cumulative_revenue
  FROM player_day_grid g
  LEFT JOIN daily_revenue dr
    ON dr.player_id = g.player_id
   AND dr.first_deposit_date = g.first_deposit_date
   AND dr.relative_day_no = g.relative_day_no
),
fixed_days AS (
  SELECT 1 AS rd UNION ALL SELECT 3 UNION ALL SELECT 7 UNION ALL SELECT 15
  UNION ALL SELECT 30 UNION ALL SELECT 60 UNION ALL SELECT 90 UNION ALL SELECT 120
  UNION ALL SELECT 150 UNION ALL SELECT 180 UNION ALL SELECT 210 UNION ALL SELECT 240
  UNION ALL SELECT 270 UNION ALL SELECT 300 UNION ALL SELECT 330 UNION ALL SELECT 360
),
cohort_revenue AS (
  SELECT pc.first_deposit_date, pc.relative_day_no AS rd, SUM(pc.cumulative_revenue) AS total_revenue
  FROM player_cumulative pc
  INNER JOIN fixed_days fd ON fd.rd = pc.relative_day_no
  GROUP BY pc.first_deposit_date, pc.relative_day_no
),
supplied_external_ad_spend AS (
  {supplied_cte}
),
dim AS (
  SELECT
    COALESCE(tp.name, CAST({int(tenant_plat_id)} AS VARCHAR)) AS site_name,
    COALESCE(ch.channel_partner_username, CAST(ch.channel_partner_id AS VARCHAR), '') AS channel_partner,
    COALESCE(ch.name, CAST({int(channel_id)} AS VARCHAR)) AS channel_name
  FROM (SELECT 1) x
  LEFT JOIN tidb_business_demo_tenant_plat tp ON tp.id = {int(tenant_plat_id)}
  LEFT JOIN tidb_business_demo_channel ch ON ch.id = {int(channel_id)}
    AND ch.tenant_plat_id = {int(tenant_plat_id)}
),
summary_revenue AS (
  SELECT rd, SUM(total_revenue) AS total_revenue
  FROM cohort_revenue
  GROUP BY rd
),
base_long AS (
  SELECT
    0 AS row_sort,
    '汇总' AS report_date,
    (SELECT site_name FROM dim) AS site_name,
    (SELECT channel_partner FROM dim) AS channel_partner,
    (SELECT channel_name FROM dim) AS channel_name,
    (SELECT SUM(ad_spend) FROM supplied_external_ad_spend) AS ad_spend,
    '{user_type}' AS user_type,
    fd.rd,
    sr.total_revenue / NULLIF((SELECT SUM(ad_spend) FROM supplied_external_ad_spend), 0) AS roi
  FROM fixed_days fd
  LEFT JOIN summary_revenue sr ON sr.rd = fd.rd
  UNION ALL
  SELECT
    2 AS row_sort,
    CAST(s.biz_date AS VARCHAR) AS report_date,
    (SELECT site_name FROM dim) AS site_name,
    (SELECT channel_partner FROM dim) AS channel_partner,
    (SELECT channel_name FROM dim) AS channel_name,
    s.ad_spend,
    '{user_type}' AS user_type,
    fd.rd,
    cr.total_revenue / NULLIF(s.ad_spend, 0) AS roi
  FROM supplied_external_ad_spend s
  CROSS JOIN fixed_days fd
  LEFT JOIN cohort_revenue cr ON cr.first_deposit_date = s.biz_date AND cr.rd = fd.rd
),
pivoted AS (
  SELECT
    row_sort,
    report_date AS "日期",
    site_name AS "站点名称",
    channel_partner AS "所属渠道商",
    channel_name AS "渠道名称",
    ad_spend AS "投放金额",
    user_type AS "用户类型",
    MAX(CASE WHEN rd = 1 THEN roi END) AS d1,
    MAX(CASE WHEN rd = 3 THEN roi END) AS d3,
    MAX(CASE WHEN rd = 7 THEN roi END) AS d7,
    MAX(CASE WHEN rd = 15 THEN roi END) AS d15,
    MAX(CASE WHEN rd = 30 THEN roi END) AS d30,
    MAX(CASE WHEN rd = 60 THEN roi END) AS d60,
    MAX(CASE WHEN rd = 90 THEN roi END) AS d90,
    MAX(CASE WHEN rd = 120 THEN roi END) AS d120,
    MAX(CASE WHEN rd = 150 THEN roi END) AS d150,
    MAX(CASE WHEN rd = 180 THEN roi END) AS d180,
    MAX(CASE WHEN rd = 210 THEN roi END) AS d210,
    MAX(CASE WHEN rd = 240 THEN roi END) AS d240,
    MAX(CASE WHEN rd = 270 THEN roi END) AS d270,
    MAX(CASE WHEN rd = 300 THEN roi END) AS d300,
    MAX(CASE WHEN rd = 330 THEN roi END) AS d330,
    MAX(CASE WHEN rd = 360 THEN roi END) AS d360
  FROM base_long
  GROUP BY row_sort, report_date, site_name, channel_partner, channel_name, ad_spend, user_type
),
ratio_row AS (
  SELECT
    1 AS row_sort,
    CAST(NULL AS VARCHAR) AS "日期",
    CAST(NULL AS VARCHAR) AS "站点名称",
    CAST(NULL AS VARCHAR) AS "所属渠道商",
    CAST(NULL AS VARCHAR) AS "渠道名称",
    CAST(NULL AS DOUBLE) AS "投放金额",
    CAST(NULL AS VARCHAR) AS "用户类型",
    '环比系数' AS d1,
    CAST((d3 - d1) / NULLIF(d1, 0) AS VARCHAR) AS d3,
    CAST((d7 - d3) / NULLIF(d3, 0) AS VARCHAR) AS d7,
    CAST((d15 - d7) / NULLIF(d7, 0) AS VARCHAR) AS d15,
    CAST((d30 - d15) / NULLIF(d15, 0) AS VARCHAR) AS d30,
    CAST((d60 - d30) / NULLIF(d30, 0) AS VARCHAR) AS d60,
    CAST((d90 - d60) / NULLIF(d60, 0) AS VARCHAR) AS d90,
    CAST((d120 - d90) / NULLIF(d90, 0) AS VARCHAR) AS d120,
    CAST((d150 - d120) / NULLIF(d120, 0) AS VARCHAR) AS d150,
    CAST((d180 - d150) / NULLIF(d150, 0) AS VARCHAR) AS d180,
    CAST((d210 - d180) / NULLIF(d180, 0) AS VARCHAR) AS d210,
    CAST((d240 - d210) / NULLIF(d210, 0) AS VARCHAR) AS d240,
    CAST((d270 - d240) / NULLIF(d240, 0) AS VARCHAR) AS d270,
    CAST((d300 - d270) / NULLIF(d270, 0) AS VARCHAR) AS d300,
    CAST((d330 - d300) / NULLIF(d300, 0) AS VARCHAR) AS d330,
    CAST((d360 - d330) / NULLIF(d330, 0) AS VARCHAR) AS d360
  FROM pivoted
  WHERE row_sort = 0
),
final_rows AS (
  SELECT row_sort, "日期", "站点名称", "所属渠道商", "渠道名称", "投放金额", "用户类型",
         CAST(d1 AS VARCHAR) AS "累计1天", CAST(d3 AS VARCHAR) AS "3天", CAST(d7 AS VARCHAR) AS "7天", CAST(d15 AS VARCHAR) AS "15天",
         CAST(d30 AS VARCHAR) AS "30天", CAST(d60 AS VARCHAR) AS "60天", CAST(d90 AS VARCHAR) AS "90天", CAST(d120 AS VARCHAR) AS "120天",
         CAST(d150 AS VARCHAR) AS "150天", CAST(d180 AS VARCHAR) AS "180天", CAST(d210 AS VARCHAR) AS "210天", CAST(d240 AS VARCHAR) AS "240天",
         CAST(d270 AS VARCHAR) AS "270天", CAST(d300 AS VARCHAR) AS "300天", CAST(d330 AS VARCHAR) AS "330天", CAST(d360 AS VARCHAR) AS "360天"
  FROM pivoted
  UNION ALL
  SELECT row_sort, "日期", "站点名称", "所属渠道商", "渠道名称", "投放金额", "用户类型",
         d1, d3, d7, d15, d30, d60, d90, d120, d150, d180, d210, d240, d270, d300, d330, d360
  FROM ratio_row
)
SELECT "日期", "站点名称", "所属渠道商", "渠道名称", "投放金额", "用户类型",
       "累计1天", "3天", "7天", "15天", "30天", "60天", "90天", "120天",
       "150天", "180天", "210天", "240天", "270天", "300天", "330天", "360天"
FROM final_rows
ORDER BY row_sort, "日期"
""".strip()


def _first_match(patterns: Sequence[str], query: str) -> Optional[str]:
    for pattern in patterns:
        match = re.search(pattern, query, flags=re.IGNORECASE)
        if match:
            return next((group for group in match.groups() if group), None)
    return None


def _extract_integer_values(patterns: Sequence[str], query: str) -> list[int]:
    values: list[int] = []

    for pattern in patterns:
        for match in re.finditer(pattern, query, flags=re.IGNORECASE):
            matched_value = next((group for group in match.groups() if group), None)
            if not matched_value:
                continue

            for candidate in re.findall(r"\d+", matched_value):
                parsed = int(candidate)
                if parsed not in values:
                    values.append(parsed)

    return values


def _collect_template_context_texts(value: Any) -> list[str]:
    texts: list[str] = []

    def append_text(text: Any) -> None:
        normalized_text = _normalize_instruction(text)
        if normalized_text and normalized_text not in texts:
            texts.append(normalized_text)

    if isinstance(value, str):
        append_text(value)
    elif isinstance(value, (list, tuple, set)):
        for item in value:
            append_text(item)

    return texts


def _get_business_signature(sample: Any) -> dict[str, Any]:
    business_signature = _get_sample_value(
        sample, "business_signature"
    ) or _get_sample_value(sample, "businessSignature")
    return business_signature if isinstance(business_signature, dict) else {}


def _get_sample_value(sample: Any, key: str, default: Any = None) -> Any:
    if isinstance(sample, dict):
        return sample.get(key, default)
    return getattr(sample, key, default)


def _get_sample_score(sample: Any) -> Optional[float]:
    score = _get_sample_value(sample, "score")
    return score if isinstance(score, (int, float)) else None


def _parse_template_temporal_value(
    value: Any, *, prefer_day_end: bool = False
) -> tuple[datetime, bool] | None:
    if value in (None, ""):
        return None

    normalized_value = str(value).strip()
    if not normalized_value:
        return None

    is_date_only = bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", normalized_value))
    if is_date_only:
        date_time_candidates = [
            f"{normalized_value}T23:59:59+00:00",
            f"{normalized_value}T00:00:00+00:00",
        ]
        candidate_values = (
            date_time_candidates
            if prefer_day_end
            else list(reversed(date_time_candidates))
        )
    else:
        candidate_values = [normalized_value, normalized_value.replace("Z", "+00:00")]

    for candidate_value in candidate_values:
        try:
            parsed_value = datetime.fromisoformat(candidate_value)
            if parsed_value.tzinfo is None:
                parsed_value = parsed_value.replace(tzinfo=UTC)
            return parsed_value, is_date_only
        except ValueError:
            continue

    return None


def _is_sample_effective_now(
    sample: Any, reference_time: Optional[datetime] = None
) -> bool:
    reference_time = reference_time or datetime.now(UTC)
    effective_from = _parse_template_temporal_value(
        _get_sample_value(sample, "effective_from")
        or _get_sample_value(sample, "effectiveFrom"),
        prefer_day_end=False,
    )
    effective_to = _parse_template_temporal_value(
        _get_sample_value(sample, "effective_to")
        or _get_sample_value(sample, "effectiveTo"),
        prefer_day_end=True,
    )

    if effective_from is not None:
        effective_from_value, _ = effective_from
        if effective_from_value > reference_time:
            return False

    if effective_to is not None:
        effective_to_value, is_date_only = effective_to
        if is_date_only:
            return reference_time.date() <= effective_to_value.date()
        if effective_to_value < reference_time:
            return False

    return True


def _is_sample_active(sample: Any) -> bool:
    status = str(_get_sample_value(sample, "status", "active") or "active").lower()
    if status != "active":
        return False

    return _is_sample_effective_now(sample)


def filter_active_sql_samples(
    sql_samples: Sequence[Any],
) -> tuple[list[Any], Any | None]:
    filtered_samples: list[Any] = []
    first_inactive_sample = None

    for sample in sql_samples:
        if _is_sample_active(sample):
            filtered_samples.append(sample)
            continue

        if first_inactive_sample is None:
            first_inactive_sample = sample

    return filtered_samples, first_inactive_sample


def _find_sql_placeholders(sql: Optional[str]) -> list[str]:
    if not sql:
        return []
    return sorted(set(SQL_TEMPLATE_PLACEHOLDER_PATTERN.findall(sql)))


def _find_optional_sql_placeholders(sql: Optional[str]) -> set[str]:
    if not sql:
        return set()

    optional_placeholders: set[str] = set()
    for placeholder in _find_sql_placeholders(sql):
        if re.search(
            rf"\(\s*:{re.escape(placeholder)}\s+IS\s+NULL\s+OR\b",
            sql,
            flags=re.IGNORECASE,
        ):
            optional_placeholders.add(placeholder)
            continue

        if re.search(
            rf"\b(?:COALESCE|IFNULL)\(\s*:{re.escape(placeholder)}\s*,",
            sql,
            flags=re.IGNORECASE,
        ):
            optional_placeholders.add(placeholder)

    return optional_placeholders


def _resolve_required_template_placeholders(sample: Any) -> tuple[list[str], list[str]]:
    sql = _get_sample_value(sample, "sql")
    all_placeholders = _find_sql_placeholders(sql)
    if not all_placeholders:
        return [], []

    optional_placeholders = _find_optional_sql_placeholders(sql)
    parameter_schema = _get_sample_value(sample, "parameter_schema") or {}
    schema_required = parameter_schema.get("required")
    required_from_schema = (
        [
            str(value)
            for value in schema_required
            if isinstance(value, str) and value in all_placeholders
        ]
        if isinstance(schema_required, list)
        else []
    )

    required_placeholders = required_from_schema or all_placeholders
    required_placeholders = [
        placeholder
        for placeholder in required_placeholders
        if placeholder not in optional_placeholders
    ]

    if not required_placeholders:
        required_placeholders = [
            placeholder
            for placeholder in all_placeholders
            if placeholder not in optional_placeholders
        ]

    return all_placeholders, sorted(set(required_placeholders))


def _get_history_question(history: Any) -> Optional[str]:
    if isinstance(history, dict):
        return _normalize_instruction(history.get("question"))
    return _normalize_instruction(getattr(history, "question", None))


def _get_history_sql(history: Any) -> Optional[str]:
    if isinstance(history, dict):
        return _normalize_instruction(history.get("sql"))
    return _normalize_instruction(getattr(history, "sql", None))


def _get_history_resolved_slots(history: Any) -> dict[str, Any]:
    if isinstance(history, dict):
        raw_slots = history.get("resolved_slots") or history.get("resolvedSlots")
    else:
        raw_slots = getattr(history, "resolved_slots", None) or getattr(
            history,
            "resolvedSlots",
            None,
        )
    return dict(raw_slots) if isinstance(raw_slots, dict) else {}


def _iter_history_questions(histories: Sequence[Any] | None) -> list[str]:
    if not histories:
        return []
    return [
        question
        for question in (_get_history_question(history) for history in histories)
        if question
    ]


def _iter_history_resolved_slots(
    histories: Sequence[Any] | None,
) -> list[dict[str, Any]]:
    if not histories:
        return []
    return [
        slots
        for slots in (_get_history_resolved_slots(history) for history in histories)
        if slots
    ]


def _extract_tenant_plat_ids_from_text(text: Optional[str]) -> list[int]:
    return _shared_extract_tenant_plat_ids(text)


def _extract_channel_ids_from_text(text: Optional[str]) -> list[int]:
    return _shared_extract_channel_ids(text)


def _query_requires_tenant_plat_id(query: Optional[str]) -> bool:
    if (
        not query
        or is_metadata_explanation_query(query)
        or _extract_tenant_plat_ids_from_text(query)
    ):
        return False
    return bool(_extract_channel_ids_from_text(query))


def _resolve_history_tenant_plat_ids(histories: Sequence[Any] | None) -> list[int]:
    tenant_ids: list[int] = []
    for slots in _iter_history_resolved_slots(histories):
        for tenant_id in _extract_slot_value_ids(slots, "tenant_plat_id"):
            if tenant_id not in tenant_ids:
                tenant_ids.append(tenant_id)
    for question in _iter_history_questions(histories):
        for tenant_id in _extract_tenant_plat_ids_from_text(question):
            if tenant_id not in tenant_ids:
                tenant_ids.append(tenant_id)
    return tenant_ids


def _resolve_history_channel_ids(histories: Sequence[Any] | None) -> list[int]:
    channel_ids: list[int] = []
    for slots in _iter_history_resolved_slots(histories):
        for channel_id in _extract_slot_value_ids(slots, "channel_id"):
            if channel_id not in channel_ids:
                channel_ids.append(channel_id)
    for question in _iter_history_questions(histories):
        for channel_id in _extract_channel_ids_from_text(question):
            if channel_id not in channel_ids:
                channel_ids.append(channel_id)
    return channel_ids


def _history_has_date_context(histories: Sequence[Any] | None) -> bool:
    if any(
        _slot_values_resolve_date_range(slots)
        for slots in _iter_history_resolved_slots(histories)
    ):
        return True
    return any(
        _extract_date_range_from_text(question)
        for question in _iter_history_questions(histories)
    )


def _resolve_history_date_range(histories: Sequence[Any] | None) -> dict[str, str]:
    for slots in reversed(_iter_history_resolved_slots(histories)):
        date_range = _extract_slot_value_date_range(slots)
        if date_range:
            return date_range
    for question in reversed(_iter_history_questions(histories)):
        date_range = _extract_date_range_from_text(question)
        if date_range:
            return date_range
    return {}


def detect_missing_tenant_plat_id_requirement(
    query: Optional[str],
    *,
    histories: Sequence[Any] | None = None,
    resolved_slots: dict[str, Any] | None = None,
) -> Optional[dict[str, Any]]:
    if not _tenant_slot_guard_enabled() or not _query_requires_tenant_plat_id(query):
        return None
    if _slot_value_is_present(resolved_slots, "tenant_plat_id"):
        return None

    history_tenant_ids = _resolve_history_tenant_plat_ids(histories)
    if len(history_tenant_ids) == 1:
        return None

    if len(history_tenant_ids) > 1:
        content = (
            "当前对话中出现了多个租户平台，无法唯一确定本次查询应使用哪个平台。"
            "请补充明确的租户平台 ID，例如：租户平台990001。"
        )
        reasoning = "缺少唯一租户平台：历史上下文存在多个 tenant_plat_id。"
    else:
        content = (
            "要继续生成 SQL，还需要确认租户平台 ID。"
            "请补充租户平台（例如：租户平台990001），我会按该平台和当前渠道继续查询。"
        )
        reasoning = "缺少必填业务参数：tenant_plat_id。"

    return {
        "slot": "tenant_plat_id",
        "missing_parameters": ["tenant_plat_id"],
        "content": content,
        "reasoning": reasoning,
    }


def _query_is_ambiguous_channel_performance_question(query: Optional[str]) -> bool:
    if not query:
        return False

    text = query.strip()
    if "渠道" not in text:
        return False

    vague_performance_cues = [
        r"最近.*(?:表现|效果|情况).*?(?:怎么样|如何)?",
        r"(?:表现|效果|情况).*?(?:怎么样|如何)",
        r"帮我看看.*渠道.*最近",
        r"看一下.*渠道.*最近",
    ]
    if not any(
        re.search(pattern, text, flags=re.IGNORECASE)
        for pattern in vague_performance_cues
    ):
        return False

    # If the user already named a concrete metric, let the normal slot/external
    # dependency guards handle it. This keeps focused questions like “这个渠道新客
    # 首充成本是多少” on the ROI/external-data path instead of over-clarifying.
    return not _extract_pattern_keys(text, _semantic_metric_patterns())


def detect_missing_ambiguous_channel_requirement(
    query: Optional[str],
    *,
    histories: Sequence[Any] | None = None,
    resolved_slots: dict[str, Any] | None = None,
) -> Optional[dict[str, Any]]:
    if not _query_is_ambiguous_channel_performance_question(query):
        return None

    missing_parameters: list[str] = []
    history_tenant_ids = _resolve_history_tenant_plat_ids(histories)
    history_channel_ids = _resolve_history_channel_ids(histories)

    if (
        not _extract_tenant_plat_ids_from_text(query)
        and not _slot_value_is_present(resolved_slots, "tenant_plat_id")
        and len(history_tenant_ids) != 1
    ):
        missing_parameters.append("tenant_plat_id")
    if (
        not _extract_channel_ids_from_text(query)
        and not _slot_value_is_present(resolved_slots, "channel_id")
        and len(history_channel_ids) != 1
    ):
        missing_parameters.append("channel_id")
    if (
        not _extract_date_range_from_text(query)
        and not _slot_values_resolve_date_range(resolved_slots)
        and not _history_has_date_context(histories)
    ):
        missing_parameters.append("date_range")
    if not _query_has_metric_focus(query) and not _slot_value_is_present(
        resolved_slots,
        "metric_focus",
    ):
        missing_parameters.append("metric_focus")

    if not missing_parameters:
        return None

    return {
        "slot": "channel_performance_context",
        "missing_parameters": missing_parameters,
        "content": (
            "这个问题还需要先明确查询范围，避免我默认猜测渠道、时间或指标。"
            "请补充租户平台、渠道 ID、时间范围，以及你更关注的指标方向"
            "（例如充值、投注、ROI、留存、流量或综合日报）。"
        ),
        "reasoning": "渠道表现类问题缺少明确范围：需要先澄清渠道、时间和关注指标。",
    }


def detect_missing_financial_ratio_scope_requirement(
    query: Optional[str],
    *,
    histories: Sequence[Any] | None = None,
    resolved_slots: dict[str, Any] | None = None,
) -> Optional[dict[str, Any]]:
    if not query:
        return None

    if not re.search(r"投充比|流水充值比|杀率|平台赢率", query, flags=re.IGNORECASE):
        return None

    missing_parameters: list[str] = []
    if (
        not _extract_tenant_plat_ids_from_text(query)
        and not _slot_value_is_present(resolved_slots, "tenant_plat_id")
        and len(_resolve_history_tenant_plat_ids(histories)) != 1
    ):
        missing_parameters.append("tenant_plat_id")
    if (
        not _extract_channel_ids_from_text(query)
        and not _slot_value_is_present(resolved_slots, "channel_id")
        and len(_resolve_history_channel_ids(histories)) != 1
    ):
        missing_parameters.append("channel_id")
    if (
        not _extract_date_range_from_text(query)
        and not _slot_values_resolve_date_range(resolved_slots)
        and not _history_has_date_context(histories)
    ):
        missing_parameters.append("date_range")

    if not missing_parameters:
        return None

    return {
        "slot": "financial_ratio_scope",
        "missing_parameters": missing_parameters,
        "content": (
            "投充比、流水充值比或杀率这类比例指标必须先明确统计范围，"
            "否则分母为 0 或无数据日期时容易误算。请补充租户平台、渠道 ID "
            "和时间范围后再继续。"
        ),
        "reasoning": "比例类问题缺少统计范围，需先澄清 tenant/channel/date 后再生成 SQL。",
    }


def detect_missing_distribution_scope_requirement(
    query: Optional[str],
    *,
    histories: Sequence[Any] | None = None,
    resolved_slots: dict[str, Any] | None = None,
) -> Optional[dict[str, Any]]:
    if not query:
        return None

    if not re.search(
        r"占比|分布|桶位|金额桶|游戏类型",
        query,
        flags=re.IGNORECASE,
    ):
        return None

    missing_parameters: list[str] = []
    if (
        not _extract_tenant_plat_ids_from_text(query)
        and not _slot_value_is_present(resolved_slots, "tenant_plat_id")
        and len(_resolve_history_tenant_plat_ids(histories)) != 1
    ):
        missing_parameters.append("tenant_plat_id")
    if (
        "渠道" in query
        and not _extract_channel_ids_from_text(query)
        and not _slot_value_is_present(resolved_slots, "channel_id")
        and len(_resolve_history_channel_ids(histories)) != 1
    ):
        missing_parameters.append("channel_id")
    if (
        not _extract_date_range_from_text(query)
        and not _slot_values_resolve_date_range(resolved_slots)
        and not _history_has_date_context(histories)
    ):
        missing_parameters.append("date_range")

    if not missing_parameters:
        return None

    return {
        "slot": "distribution_scope",
        "missing_parameters": missing_parameters,
        "content": (
            "占比、分布或金额桶这类指标需要先明确统计范围，"
            "否则分母口径不清。请补充租户平台、必要的渠道 ID 和时间范围后再继续。"
        ),
        "reasoning": "分布/占比类问题缺少统计范围，需先澄清后再生成 SQL。",
    }


def detect_missing_required_slot_requirement(
    query: Optional[str],
    *,
    histories: Sequence[Any] | None = None,
    resolved_slots: dict[str, Any] | None = None,
) -> Optional[dict[str, Any]]:
    return (
        detect_missing_tenant_plat_id_requirement(
            query,
            histories=histories,
            resolved_slots=resolved_slots,
        )
        or detect_missing_ambiguous_channel_requirement(
            query,
            histories=histories,
            resolved_slots=resolved_slots,
        )
        or detect_missing_financial_ratio_scope_requirement(
            query,
            histories=histories,
            resolved_slots=resolved_slots,
        )
        or detect_missing_distribution_scope_requirement(
            query,
            histories=histories,
            resolved_slots=resolved_slots,
        )
    )


def detect_missing_template_parameter_requirement(
    query: Optional[str],
    template_decision: Optional[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    if not query or not template_decision:
        return None

    missing_parameters = list(template_decision.get("missing_parameters") or [])
    if not missing_parameters:
        return None

    has_explicit_date = bool(_extract_date_range_from_text(query))
    missing_cohort_dates = [
        parameter
        for parameter in ("cohort_start_date", "cohort_end_date")
        if parameter in missing_parameters
    ]
    if missing_cohort_dates and not has_explicit_date:
        return {
            "slot": "cohort_date_range",
            "missing_parameters": missing_cohort_dates,
            "content": (
                "这类首存 cohort 趋势需要明确首存用户的起止日期，"
                "否则无法判断从哪一批首存用户开始计算 D1、D3 或 D30。"
                "请补充首存 cohort 日期范围，例如：2026-04-01 到 2026-04-30。"
            ),
            "reasoning": "模板缺少首存 cohort 起止日期，需先澄清日期范围。",
        }

    required_context_slots = [
        parameter
        for parameter in (
            "tenant_plat_id",
            "channel_id",
            "start_date",
            "end_date",
        )
        if parameter in missing_parameters
    ]
    if len(required_context_slots) >= 2:
        return {
            "slot": "template_required_context",
            "missing_parameters": required_context_slots,
            "content": (
                "这个问题匹配到的业务模板还缺少关键查询范围。"
                "请补充租户平台、渠道 ID 和时间范围后再继续，"
                "避免我用默认值或历史样例误生成结果。"
            ),
            "reasoning": "模板缺少多个关键上下文参数，需先澄清后再生成 SQL。",
        }

    missing_period_slot = next(
        (
            parameter
            for parameter in ("period_days", "n_days")
            if parameter in missing_parameters
        ),
        None,
    )
    if missing_period_slot:
        return {
            "slot": missing_period_slot,
            "missing_parameters": [missing_period_slot],
            "content": (
                "这个问题命中了首存 cohort 模板，还需要补充回收周期。"
                "请说明要累计到 D7、D30 还是其他天数，例如：首存后 D7。"
            ),
            "reasoning": f"模板缺少回收周期 {missing_period_slot}，需先澄清后再生成 SQL。",
        }

    return None


def _extract_date_range_from_text(text: Optional[str]) -> dict[str, str]:
    return _shared_extract_date_range(text)


def _collapse_single_or_list(values: list[Any]) -> Any:
    if len(values) == 1:
        return values[0]
    return values


def _slot_value_is_present(slot_values: dict[str, Any] | None, slot: str) -> bool:
    if not isinstance(slot_values, dict) or slot not in slot_values:
        return False

    value = slot_values.get(slot)
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple, set, dict)):
        return bool(value)
    return True


def _slot_values_resolve_date_range(slot_values: dict[str, Any] | None) -> bool:
    if not isinstance(slot_values, dict):
        return False
    if _slot_value_is_present(slot_values, "date_range"):
        return True
    return _slot_value_is_present(slot_values, "start_date") and _slot_value_is_present(
        slot_values,
        "end_date",
    )


def _extract_slot_value_ids(slot_values: dict[str, Any] | None, slot: str) -> list[int]:
    if not isinstance(slot_values, dict) or slot not in slot_values:
        return []

    value = slot_values.get(slot)
    if value is None:
        return []
    if isinstance(value, int):
        return [value]
    if isinstance(value, str):
        return _extract_integer_values(
            [r"((?:\d+\s*(?:,|，|、|和|与|及)?\s*)+)"], value
        )
    if isinstance(value, (list, tuple, set)):
        ids: list[int] = []
        for item in value:
            if isinstance(item, int):
                ids.append(item)
            elif isinstance(item, str):
                ids.extend(
                    _extract_integer_values(
                        [r"((?:\d+\s*(?:,|，|、|和|与|及)?\s*)+)"],
                        item,
                    )
                )
        return list(dict.fromkeys(ids))
    return []


def _extract_slot_value_date_range(
    slot_values: dict[str, Any] | None,
) -> dict[str, str]:
    if not isinstance(slot_values, dict):
        return {}

    raw_range = slot_values.get("date_range")
    if isinstance(raw_range, dict):
        start_date = raw_range.get("start_date")
        end_date = raw_range.get("end_date")
        single_date = raw_range.get("date")
        if start_date and end_date:
            return {"start_date": str(start_date), "end_date": str(end_date)}
        if single_date:
            return {"date": str(single_date)}
    elif isinstance(raw_range, str):
        parsed = _extract_date_range_from_text(raw_range)
        if parsed:
            return parsed

    start_date = slot_values.get("start_date")
    end_date = slot_values.get("end_date")
    if start_date and end_date:
        return {"start_date": str(start_date), "end_date": str(end_date)}
    if start_date:
        return {"date": str(start_date)}
    return {}


def _query_has_metric_focus(query: Optional[str]) -> bool:
    if not query:
        return False
    return bool(
        _extract_pattern_keys(query, _semantic_metric_patterns())
        or re.search(
            r"(?:关注指标|指标方向|metric_focus)\s*[=:：]?\s*[\\w\\u4e00-\\u9fff]+",
            query,
            flags=re.IGNORECASE,
        )
    )


def _extract_semantic_features(query: Optional[str]) -> list[str]:
    if not query:
        return []

    features: list[str] = []
    for feature, patterns in _template_feature_patterns().items():
        if any(re.search(pattern, query, flags=re.IGNORECASE) for pattern in patterns):
            features.append(feature)
    return features


def _template_feature_patterns() -> dict[str, tuple[str, ...]]:
    return _load_regex_pattern_config(
        "WREN_TEMPLATE_FEATURE_PATTERNS",
        DEFAULT_TEMPLATE_FEATURE_PATTERNS,
    )


def _semantic_metric_patterns() -> dict[str, tuple[str, ...]]:
    return _load_regex_pattern_config(
        "WREN_SEMANTIC_METRIC_PATTERNS",
        DEFAULT_SEMANTIC_METRIC_PATTERNS,
    )


def _semantic_dimension_patterns() -> dict[str, tuple[str, ...]]:
    return _load_regex_pattern_config(
        "WREN_SEMANTIC_DIMENSION_PATTERNS",
        DEFAULT_SEMANTIC_DIMENSION_PATTERNS,
    )


DATA_QUERY_ACTION_PATTERN = re.compile(
    r"查询|统计|输出|生成|列出|找出|查看|看一下|看看|计算|汇总|对比",
    flags=re.IGNORECASE,
)
BUSINESS_RULE_ATTACHMENT_PATTERN = re.compile(
    r"并?(?:说明|检查|解释|确认).{0,32}(?:是否|如何|怎么|规则|口径|计入|混入|分母|处理)",
    flags=re.IGNORECASE,
)
PLAYER_ID_PATTERN = re.compile(
    r"(?:玩家|用户|player[_\s-]?id)\s*[:：#]?\s*(\d{3,})",
    flags=re.IGNORECASE,
)


def should_override_general_intent_to_text_to_sql(query: Optional[str]) -> bool:
    """Recover data queries that include an attached business-rule explanation.

    The intent classifier should keep pure rule-definition questions on the
    GENERAL / data-assistance path, but regression cases such as “查询成功充值金额，
    并说明失败充值是否计入” still need SQL first and rule explanation second.
    This deterministic guard only overrides GENERAL when the query has a clear
    data action, concrete business metrics, and executable filters.
    """

    if not query:
        return False

    text = str(query).strip()
    if not text or is_metadata_explanation_query(text):
        return False
    if not DATA_QUERY_ACTION_PATTERN.search(text):
        return False
    if not _extract_pattern_keys(text, _semantic_metric_patterns()):
        return False
    if not BUSINESS_RULE_ATTACHMENT_PATTERN.search(text):
        return False

    has_tenant = bool(_extract_tenant_plat_ids_from_text(text))
    has_channel_or_player = bool(
        _extract_channel_ids_from_text(text) or PLAYER_ID_PATTERN.search(text)
    )
    has_date = bool(_extract_date_range_from_text(text))
    return has_tenant and has_channel_or_player and has_date


def _extract_pattern_keys(
    query: Optional[str],
    patterns_by_key: dict[str, tuple[str, ...]],
) -> list[str]:
    if not query:
        return []
    return [
        key
        for key, patterns in patterns_by_key.items()
        if any(re.search(pattern, query, flags=re.IGNORECASE) for pattern in patterns)
    ]


def _infer_semantic_subject(
    query: Optional[str], features: Sequence[str]
) -> Optional[str]:
    text = query or ""
    if "cohort" in features or re.search(r"首存|首充", text, flags=re.IGNORECASE):
        return "cohort"
    if re.search(r"玩家|用户|player", text, flags=re.IGNORECASE):
        return "player"
    if re.search(r"渠道|channel", text, flags=re.IGNORECASE):
        return "channel"
    if re.search(r"游戏类型|game", text, flags=re.IGNORECASE):
        return "game"
    return None


def _extract_template_decision_grain(
    template_decision: Optional[dict[str, Any]],
) -> Optional[str]:
    if not isinstance(template_decision, dict):
        return None

    signature = template_decision.get("business_signature")
    if not isinstance(signature, dict):
        return None

    grain = _get_mapping_value(
        signature,
        "expectedGrain",
        "expected_grain",
        "resultGrain",
        "result_grain",
    )
    return str(grain) if grain else None


def _infer_semantic_grain(
    *,
    dimensions: Sequence[str],
    template_decision: Optional[dict[str, Any]],
) -> Optional[str]:
    template_grain = _extract_template_decision_grain(template_decision)
    if template_grain:
        return template_grain

    ordered_dimensions = [
        dimension
        for dimension in (
            "tenant_plat_id",
            "biz_date",
            "first_deposit_date",
            "channel_id",
            "player_id",
            "game_type",
            "segment",
            "cohort_age",
        )
        if dimension in dimensions
    ]
    if ordered_dimensions:
        return " + ".join(ordered_dimensions)
    return None


def _build_template_plan_fragment(
    template_decision: Optional[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    if not isinstance(template_decision, dict):
        return None

    return {
        "template_id": template_decision.get("template_id"),
        "template_title": template_decision.get("template_title"),
        "mode": template_decision.get("mode"),
        "sql_source": template_decision.get("sql_source"),
        "fallback_reason": template_decision.get("fallback_reason"),
        "missing_parameters": template_decision.get("missing_parameters") or [],
        "required_external_dependencies": template_decision.get(
            "required_external_dependencies"
        )
        or [],
    }


def _build_semantic_route_decision(
    *,
    missing_slots: Sequence[str],
    template_decision: Optional[dict[str, Any]],
    route_override: Optional[str] = None,
    reason_codes: Sequence[str] | None = None,
    external_dependencies: Sequence[str] | None = None,
) -> dict[str, Any]:
    collected_reason_codes = list(reason_codes or [])

    if route_override:
        route = route_override
    elif missing_slots:
        route = "clarification_required"
        if "missing_required_slot" not in collected_reason_codes:
            collected_reason_codes.append("missing_required_slot")
    else:
        mode = (template_decision or {}).get("mode")
        sql_source = (template_decision or {}).get("sql_source")
        fallback_reason = (template_decision or {}).get("fallback_reason")
        template_id = (template_decision or {}).get("template_id")
        if mode in TEMPLATE_ANCHORED_MODES and sql_source in {
            "anchored_template",
            "rendered_template",
        }:
            route = "template_answer"
        elif fallback_reason in {
            "policy_forbidden_template",
            "template_guard_plain_sql_requested",
        }:
            route = "normal_text_to_sql"
        elif template_decision and (
            mode == "trusted_reference"
            or (
                template_id is not None
                and sql_source in {"anchored_generated", "generated"}
            )
        ):
            route = "template_reference_sql"
        else:
            route = "normal_text_to_sql"
        if fallback_reason and fallback_reason not in collected_reason_codes:
            collected_reason_codes.append(str(fallback_reason))

    if (
        external_dependencies
        and "external_dependency_missing" not in collected_reason_codes
    ):
        collected_reason_codes.append("external_dependency_missing")

    return {
        "route": route,
        "sql_source": (template_decision or {}).get("sql_source"),
        "selected_template_id": (template_decision or {}).get("template_id"),
        "selected_template_type": (template_decision or {}).get("mode"),
        "reason_codes": collected_reason_codes,
        "external_dependencies": list(external_dependencies or []),
    }


SLOT_LABELS = {
    "tenant_plat_id": "租户平台",
    "channel_id": "渠道 ID",
    "date_range": "时间范围",
    "start_date": "开始日期",
    "end_date": "结束日期",
    "cohort_start_date": "首存 cohort 开始日期",
    "cohort_end_date": "首存 cohort 结束日期",
    "period_days": "回收周期",
    "metric_focus": "关注指标",
}


def _build_slot_details(slots: Sequence[str], *, source: str) -> list[dict[str, Any]]:
    return [
        {
            "slot": slot,
            "label": SLOT_LABELS.get(slot, slot),
            "required": True,
            "source": source,
        }
        for slot in slots
    ]


def _build_policy_clarification_prompt(slots: Sequence[str]) -> str:
    labels = [SLOT_LABELS.get(slot, slot) for slot in slots]
    if labels == ["租户平台"]:
        return (
            "当前问数策略要求先确认租户平台，避免跨租户平台误查。"
            "请补充租户平台（例如：租户平台990001），我会继续查询。"
        )

    return (
        "当前问数策略要求先补充必填信息，避免系统默认猜测业务口径。"
        f"请补充：{'、'.join(labels)}。"
    )


def _build_policy_clarification_request(slots: Sequence[str]) -> dict[str, Any]:
    missing_slots = list(slots)
    return {
        "slot": (
            missing_slots[0] if len(missing_slots) == 1 else "ask_policy_required_slots"
        ),
        "prompt": _build_policy_clarification_prompt(missing_slots),
        "hint_values": [],
        "blocking": True,
        "resume_strategy": "resubmit_with_slot_value",
        "pending_slots": _build_slot_details(
            missing_slots,
            source="ask_policy",
        ),
    }


def _build_resolved_slot(
    *,
    value: Any,
    source: str,
) -> dict[str, Any]:
    return {
        "value": value,
        "source": source,
    }


def _build_candidate_template_plan(
    *,
    template_decision: Optional[dict[str, Any]],
    route: Optional[str],
) -> list[dict[str, Any]]:
    if not template_decision:
        return []

    mode = template_decision.get("mode")
    fallback_reason = template_decision.get("fallback_reason")
    decision = "accepted" if route == "template_answer" else "referenced"
    if fallback_reason:
        decision = "rejected"

    reason_codes = []
    if fallback_reason:
        reason_codes.append(str(fallback_reason))
    if template_decision.get("decision_reason"):
        reason_codes.append(str(template_decision["decision_reason"]))

    return [
        {
            "id": template_decision.get("template_id"),
            "title": template_decision.get("template_title"),
            "template_type": mode,
            "decision": decision,
            "sql_source": template_decision.get("sql_source"),
            "reason_codes": reason_codes,
            "missing_parameters": template_decision.get("missing_parameters") or [],
        }
    ]


def build_minimal_semantic_plan(
    query: Optional[str],
    *,
    histories: Sequence[Any] | None = None,
    template_decision: Optional[dict[str, Any]] = None,
    resolved_slot_values: dict[str, Any] | None = None,
    intent: Optional[str] = None,
    route_override: Optional[str] = None,
    reason_codes: Sequence[str] | None = None,
    external_dependencies: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Build a deterministic structured SemanticPlan for diagnostics and routing.

    This intentionally avoids a new LLM call. The deterministic plan gives the
    runtime a stable contract for slots, coarse metrics/dimensions, route
    decisions, and clarification state while P1 semantic parsing evolves.
    """

    explicit_tenant_ids = _extract_tenant_plat_ids_from_text(query)
    slot_tenant_ids = _extract_slot_value_ids(
        resolved_slot_values,
        "tenant_plat_id",
    )
    history_tenant_ids: list[int] = []
    tenant_ids = explicit_tenant_ids or slot_tenant_ids
    if not tenant_ids:
        history_tenant_ids = _resolve_history_tenant_plat_ids(histories)
        tenant_ids = history_tenant_ids
    explicit_channel_ids = _extract_channel_ids_from_text(query)
    slot_channel_ids = _extract_slot_value_ids(
        resolved_slot_values,
        "channel_id",
    )
    history_channel_ids: list[int] = []
    channel_ids = explicit_channel_ids or slot_channel_ids
    if not channel_ids:
        history_channel_ids = _resolve_history_channel_ids(histories)
        channel_ids = history_channel_ids
    explicit_date_range = _extract_date_range_from_text(query)
    slot_date_range = _extract_slot_value_date_range(resolved_slot_values)
    history_date_range: dict[str, str] = {}
    date_range = explicit_date_range or slot_date_range
    if not date_range:
        history_date_range = _resolve_history_date_range(histories)
        date_range = history_date_range
    missing_slot_requirement = detect_missing_required_slot_requirement(
        query,
        histories=histories,
        resolved_slots=resolved_slot_values,
    ) or detect_missing_template_parameter_requirement(
        query,
        template_decision,
    )
    missing_slots = (
        missing_slot_requirement.get("missing_parameters", [])
        if missing_slot_requirement
        else []
    )

    filters: dict[str, Any] = {}
    if tenant_ids:
        filters["tenant_plat_id"] = _collapse_single_or_list(tenant_ids)
    if channel_ids:
        filters["channel_id"] = _collapse_single_or_list(channel_ids)
    filters.update(date_range)
    features = _extract_semantic_features(query)
    metrics = _extract_pattern_keys(query, _semantic_metric_patterns())
    dimensions = _extract_pattern_keys(query, _semantic_dimension_patterns())
    if tenant_ids and "tenant_plat_id" not in dimensions:
        dimensions.append("tenant_plat_id")
    if channel_ids and "channel_id" not in dimensions:
        dimensions.append("channel_id")
    if date_range and "biz_date" not in dimensions:
        dimensions.append("biz_date")

    resolved_slots: dict[str, dict[str, Any]] = {}
    if tenant_ids:
        resolved_slots["tenant_plat_id"] = _build_resolved_slot(
            value=_collapse_single_or_list(tenant_ids),
            source=(
                "explicit_user_input"
                if explicit_tenant_ids
                else (
                    "clarification_reply"
                    if slot_tenant_ids
                    else "history_context" if history_tenant_ids else "unknown"
                )
            ),
        )
    if channel_ids:
        resolved_slots["channel_id"] = _build_resolved_slot(
            value=_collapse_single_or_list(channel_ids),
            source=(
                "explicit_user_input"
                if explicit_channel_ids
                else (
                    "clarification_reply"
                    if slot_channel_ids
                    else "history_context" if history_channel_ids else "unknown"
                )
            ),
        )
    for key, value in date_range.items():
        resolved_slots[key] = _build_resolved_slot(
            value=value,
            source=(
                "explicit_user_input"
                if explicit_date_range
                else (
                    "clarification_reply"
                    if slot_date_range
                    else "history_context" if history_date_range else "unknown"
                )
            ),
        )
    if _slot_value_is_present(resolved_slot_values, "metric_focus"):
        resolved_slots["metric_focus"] = _build_resolved_slot(
            value=(resolved_slot_values or {}).get("metric_focus"),
            source="clarification_reply",
        )

    missing_slot_details = _build_slot_details(
        missing_slots,
        source=(missing_slot_requirement or {}).get("slot", "slot_guard"),
    )
    clarification_request = None
    if missing_slot_requirement:
        clarification_request = {
            "slot": missing_slot_requirement["slot"],
            "prompt": missing_slot_requirement["content"],
            "hint_values": [],
            "blocking": True,
            "resume_strategy": "resubmit_with_slot_value",
            "pending_slots": missing_slot_details,
        }
    decision = _build_semantic_route_decision(
        missing_slots=missing_slots,
        template_decision=template_decision,
        route_override=route_override,
        reason_codes=reason_codes,
        external_dependencies=external_dependencies,
    )
    decision["missing_slots"] = missing_slots
    decision["resolved_slots"] = resolved_slots
    decision["candidate_templates"] = _build_candidate_template_plan(
        template_decision=template_decision,
        route=decision.get("route"),
    )

    return {
        "version": "p1_structured_v1",
        "source": "deterministic",
        "intent": intent or "TEXT_TO_SQL",
        "subject": _infer_semantic_subject(query, features),
        "features": features,
        "metrics": metrics,
        "dimensions": dimensions,
        "filters": filters,
        "grain": _infer_semantic_grain(
            dimensions=dimensions,
            template_decision=template_decision,
        ),
        "missing_slots": missing_slots,
        "missing_slot_details": missing_slot_details,
        "resolved_slots": resolved_slots,
        "clarification_request": clarification_request,
        "template": _build_template_plan_fragment(template_decision),
        "decision": decision,
        "confidence": 1.0,
    }


def _get_latest_history_sql(histories: Sequence[Any] | None) -> Optional[str]:
    if not histories:
        return None
    for history in reversed(histories):
        sql = _get_history_sql(history)
        if sql:
            return sql
    return None


def _build_retrieval_query(
    query: Optional[str], histories: Sequence[Any] | None = None
) -> str:
    normalized_query = _normalize_instruction(query) or ""
    history_questions = _iter_history_questions(histories)
    if not normalized_query or not history_questions:
        return normalized_query

    latest_question = history_questions[-1]
    if latest_question == normalized_query:
        return normalized_query
    if normalized_query in latest_question or latest_question in normalized_query:
        return normalized_query
    return f"{latest_question}\n{normalized_query}"


def _extract_query_features(text: Optional[str]) -> set[str]:
    if not text:
        return set()

    return {
        feature
        for feature, patterns in _template_feature_patterns().items()
        if any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in patterns)
    }


def _query_requests_player_level_detail(query: Optional[str]) -> bool:
    if not query:
        return False

    return bool(
        re.search(
            r"玩家\s*ID|player[_\s-]?id|用户\s*ID|名单|明细|给出玩家|列出",
            query,
            flags=re.IGNORECASE,
        )
    )


def _query_requests_retention_deposit(query: Optional[str]) -> bool:
    if not query:
        return False

    return bool(
        re.search(
            r"续存|复存|留存|[二三四五六]\s*存|[2-6]\s*存|2\s*(?:~|-|到|至)\s*6\s*存",
            query,
            flags=re.IGNORECASE,
        )
    )


def _sample_supports_retention_deposit(sample: Any) -> bool:
    business_signature = _get_business_signature(sample)
    positive_values: list[str] = []
    for key in (
        "templateId",
        "template_id",
        "concepts",
        "features",
        "metrics",
        "positiveCues",
        "positive_cues",
        "expectedGrain",
        "expected_grain",
        "resultGrain",
        "result_grain",
    ):
        value = business_signature.get(key)
        if isinstance(value, str):
            positive_values.append(value)
        else:
            positive_values.extend(_normalize_string_list(value))

    sample_text = " ".join(
        filter(
            None,
            [
                str(_get_sample_value(sample, "question", "")),
                str(_get_sample_value(sample, "title", "")),
                " ".join(positive_values),
            ],
        )
    )
    return bool(
        re.search(
            r"\\bT08\\b|retention[_\\s-]?deposit|\\bretention\\b|续存|复存|[二三四五六]\\s*存|[2-6]\\s*存|2\\s*(?:~|-|到|至)\\s*6\\s*存",
            sample_text,
            flags=re.IGNORECASE,
        )
    )


def _resolve_sample_result_grain(sample: Any) -> str:
    business_signature = _get_business_signature(sample)
    result_grain = business_signature.get("resultGrain") or business_signature.get(
        "result_grain"
    )
    if result_grain:
        return str(result_grain).strip().lower()

    fallback_result_grain = _get_sample_value(
        sample, "result_grain"
    ) or _get_sample_value(
        sample,
        "resultGrain",
    )
    return str(fallback_result_grain or "").strip().lower()


def _sample_supports_player_level_detail(sample: Any) -> bool:
    result_grain = _resolve_sample_result_grain(sample)
    if "player_id" in result_grain or "player id" in result_grain:
        return True

    sample_text = " ".join(
        filter(
            None,
            [
                str(_get_sample_value(sample, "question", "")),
                str(_get_sample_value(sample, "title", "")),
            ],
        )
    )
    return bool(
        re.search(
            r"名单|玩家\s*ID|player[_\s-]?id|首存用户|用户名单|明细",
            sample_text,
            flags=re.IGNORECASE,
        )
    )


def _collect_sample_signature_text(sample: Any) -> str:
    business_signature = _get_business_signature(sample)
    signature_values: list[str] = []
    for key in (
        "concepts",
        "features",
        "metrics",
        "dimensions",
        "positiveCues",
        "positive_cues",
        "negativeCues",
        "negative_cues",
        "expectedGrain",
        "expected_grain",
        "resultGrain",
        "result_grain",
    ):
        signature_values.extend(_normalize_string_list(business_signature.get(key)))

    return " ".join(
        filter(
            None,
            [
                str(_get_sample_value(sample, "question", "")),
                str(_get_sample_value(sample, "title", "")),
                str(_get_sample_value(sample, "sql", "")),
                _resolve_sample_result_grain(sample),
                " ".join(signature_values),
            ],
        )
    )


def _query_requests_channel_period_recharge_summary(query: Optional[str]) -> bool:
    if not query:
        return False

    channel_ids = _extract_channel_ids_from_text(query)
    has_channel_comparison = len(channel_ids) > 1 or bool(
        re.search(r"对比|各渠道|按渠道|分渠道", query, flags=re.IGNORECASE)
    )
    has_recharge_summary_metric = bool(
        re.search(
            r"成功充值|充值订单|充值.*(?:笔数|笔|金额)|订单笔数|充值金额",
            query,
            flags=re.IGNORECASE,
        )
    )
    asks_daily_grain = bool(
        re.search(r"每日|每天|按天|逐日|日级|日报|日期", query, flags=re.IGNORECASE)
    )
    return (
        has_channel_comparison and has_recharge_summary_metric and not asks_daily_grain
    )


def _sample_has_daily_grain(sample: Any) -> bool:
    result_grain = _resolve_sample_result_grain(sample)
    if any(token in result_grain for token in ("biz_date", "date", "day", "日")):
        return True

    sample_text = _collect_sample_signature_text(sample)
    return bool(
        re.search(
            r"日报|每日|每天|按天|逐日|日级|日期", sample_text, flags=re.IGNORECASE
        )
    )


def _sample_has_specialized_recharge_grain(sample: Any) -> bool:
    sample_text = _collect_sample_signature_text(sample)
    return bool(
        re.search(
            (
                r"TOP\d+|top[_\s-]?n|user[_\s-]?segment|segment_sort|"
                r"非TOP|分层|cohort|首存|首充|首次存款|续存|复存|"
                r"二存|三存|四存|五存|六存|金额分桶|amount[_\s-]?bucket|"
                r"游戏类型|game[_\s-]?type|投充比|杀率|ROI|PV|UV"
            ),
            sample_text,
            flags=re.IGNORECASE,
        )
    )


def _query_requests_login_without_successful_deposit(query: Optional[str]) -> bool:
    if not query:
        return False

    return bool(
        re.search(
            r"登录过?.*(?:没有|未|无).*成功?充值|(?:没有|未|无).*成功?充值.*登录|登录未充值|未充值玩家|无充值玩家",
            query,
            flags=re.IGNORECASE,
        )
    )


def _sample_supports_login_without_successful_deposit(sample: Any) -> bool:
    sample_text = _collect_sample_signature_text(sample)
    return bool(
        re.search(
            r"登录.*(?:没有|未|无).*成功?充值|(?:没有|未|无).*成功?充值.*登录|登录未充值|未充值玩家|无充值玩家|not\s+exists|anti[_\s-]?join",
            sample_text,
            flags=re.IGNORECASE,
        )
    )


def _query_requests_plain_sql_generation(query: Optional[str]) -> bool:
    if not query:
        return False

    return bool(
        re.search(
            (
                r"不(?:用|使用|要|采用).{0,10}(?:业务)?(?:报表)?模板|"
                r"不(?:按|套用).{0,10}模板|"
                r"避免.{0,10}(?:业务)?(?:报表)?模板|"
                r"(?:直接|只|仅)基于.{0,18}(?:原始表|明细表|订单表|日志表|事实表)|"
                r"(?:直接|只|仅)(?:查|查询|统计).{0,24}(?:原始表|明细表|订单表|日志表|事实表)|"
                r"(?:直接|只|仅)(?:查|查询|统计).{0,24}(?:原始|明细).{0,12}(?:订单|记录|数据)"
            ),
            query,
            flags=re.IGNORECASE,
        )
    )


def _sample_is_business_template(sample: Any) -> bool:
    return bool(
        _get_sample_value(sample, "asset_kind") == "sql_template"
        or _get_sample_value(sample, "template_mode")
        or _get_sample_value(sample, "templateMode")
        or _get_business_signature(sample).get("templateId")
        or _get_business_signature(sample).get("template_id")
    )


def _resolve_template_route_guard_failure(
    query: Optional[str], sample: Any
) -> Optional[str]:
    if not _template_route_guards_enabled() or not query:
        return None

    if _query_requests_plain_sql_generation(query) and _sample_is_business_template(
        sample
    ):
        return "template_guard_plain_sql_requested"

    if _query_requests_channel_period_recharge_summary(query) and (
        _sample_has_daily_grain(sample)
        or _sample_has_specialized_recharge_grain(sample)
    ):
        return "template_guard_channel_period_summary_mismatch"

    if _query_requests_login_without_successful_deposit(
        query
    ) and not _sample_supports_login_without_successful_deposit(sample):
        return "template_guard_login_without_deposit_mismatch"

    if _query_requests_retention_deposit(
        query
    ) and not _sample_supports_retention_deposit(
        sample,
    ):
        return "template_guard_retention_mismatch"

    return None


def _extract_relation_names(sql: Optional[str]) -> set[str]:
    normalized_sql = _normalize_sql_for_signature(sql)
    if not normalized_sql:
        return set()

    relation_names = set()
    for from_relation, join_relation in re.findall(
        r"\bfrom\s+([a-zA-Z_]\w*)|\bjoin\s+([a-zA-Z_]\w*)",
        normalized_sql,
    ):
        relation_name = from_relation or join_relation
        if relation_name:
            relation_names.add(relation_name)

    return relation_names


def _normalize_relation_name_against(
    relation_name: str,
    reference_relation_names: Iterable[str],
) -> str:
    lowered_relation_name = relation_name.lower()
    lowered_references = [
        str(name).lower() for name in reference_relation_names if name
    ]
    if lowered_relation_name in lowered_references:
        return lowered_relation_name

    suffix_matches = [
        reference
        for reference in lowered_references
        if lowered_relation_name.endswith(f"_{reference}")
        or lowered_relation_name.endswith(f".{reference}")
    ]
    if suffix_matches:
        return max(suffix_matches, key=len)

    return lowered_relation_name


def _normalize_relation_names_against(
    relation_names: Iterable[str],
    reference_relation_names: Iterable[str],
) -> set[str]:
    reference_relation_names = list(reference_relation_names)
    return {
        _normalize_relation_name_against(relation_name, reference_relation_names)
        for relation_name in relation_names
        if relation_name
    }


def _relation_name_sets_overlap(
    left_relation_names: Iterable[str],
    right_relation_names: Iterable[str],
) -> bool:
    left_relation_names = {str(name).lower() for name in left_relation_names if name}
    right_relation_names = {str(name).lower() for name in right_relation_names if name}
    if not left_relation_names or not right_relation_names:
        return False

    normalized_left = _normalize_relation_names_against(
        left_relation_names,
        right_relation_names,
    )
    normalized_right = _normalize_relation_names_against(
        right_relation_names,
        left_relation_names,
    )
    return bool(
        normalized_left & right_relation_names or left_relation_names & normalized_right
    )


def _relation_name_set_is_subset(
    possible_subset: Iterable[str],
    possible_superset: Iterable[str],
) -> bool:
    possible_subset = {str(name).lower() for name in possible_subset if name}
    possible_superset = {str(name).lower() for name in possible_superset if name}
    if not possible_subset or not possible_superset:
        return False

    normalized_subset = _normalize_relation_names_against(
        possible_subset,
        possible_superset,
    )
    return normalized_subset.issubset(possible_superset)


def _matches_history_template_context(
    template_sql: Optional[str], history_sql: Optional[str]
) -> bool:
    if not template_sql or not history_sql:
        return False

    if is_template_core_preserved(
        template_sql, history_sql
    ) or is_template_core_preserved(
        history_sql,
        template_sql,
    ):
        return True

    template_ctes = set(_extract_cte_names(template_sql))
    history_ctes = set(_extract_cte_names(history_sql))
    if (
        template_ctes
        and history_ctes
        and _relation_name_sets_overlap(
            template_ctes,
            history_ctes,
        )
    ):
        if _relation_name_set_is_subset(
            history_ctes,
            template_ctes,
        ) or _relation_name_set_is_subset(template_ctes, history_ctes):
            return True

    history_relations = _extract_relation_names(history_sql)
    if (
        template_ctes
        and history_relations
        and _relation_name_sets_overlap(
            template_ctes,
            history_relations,
        )
    ):
        return True

    template_relations = _extract_relation_names(template_sql)
    return bool(
        template_relations
        and history_relations
        and _relation_name_sets_overlap(template_relations, history_relations)
    )


def _score_sql_sample_for_query(
    query: Optional[str],
    sample: Any,
    *,
    histories: Sequence[Any] | None = None,
) -> float:
    base_score = float(_get_sample_score(sample) or 0.0)
    sample_text = " ".join(
        filter(
            None,
            [
                str(_get_sample_value(sample, "question", "")),
                str(_get_sample_value(sample, "title", "")),
            ],
        )
    )
    query_features = _extract_query_features(query)
    sample_features = _extract_query_features(sample_text)
    business_signature = _get_business_signature(sample)
    signature_positive_cues = _extract_business_signature_list(
        business_signature, "positiveCues", "positive_cues"
    )
    signature_negative_cues = _extract_business_signature_list(
        business_signature, "negativeCues", "negative_cues"
    )
    signature_features = set(
        _extract_business_signature_list(business_signature, "features")
    )
    score = base_score

    for cue in signature_positive_cues:
        if query and _query_matches_any_text(query, [cue]):
            score += 0.45

    for cue in signature_negative_cues:
        if query and _query_matches_any_text(query, [cue]):
            score -= 1.2

    for feature in query_features & signature_features:
        score += TEMPLATE_FEATURE_WEIGHTS.get(feature, 0.5) * 0.45

    for feature, weight in TEMPLATE_FEATURE_WEIGHTS.items():
        if feature in query_features and feature in sample_features:
            score += weight
        elif (
            feature in query_features
            and feature not in sample_features
            and feature in DISCRIMINATIVE_TEMPLATE_FEATURES
        ):
            score -= weight * 0.6

    query_skeleton = normalize_question_skeleton(query)
    sample_skeleton = normalize_question_skeleton(sample_text)
    if (
        query_skeleton
        and sample_skeleton
        and "[" in query_skeleton
        and "[" in sample_skeleton
    ):
        if query_skeleton == sample_skeleton:
            score += 0.2
        else:
            skeleton_similarity = SequenceMatcher(
                None,
                query_skeleton,
                sample_skeleton,
            ).ratio()
            if skeleton_similarity >= 0.72:
                score += 0.1 * skeleton_similarity

    if _query_requests_player_level_detail(query):
        if _sample_supports_player_level_detail(sample):
            score += 2.5
        else:
            score -= 3.0

    if _query_requests_retention_deposit(query):
        if _sample_supports_retention_deposit(sample):
            score += 2.0
        else:
            score -= 2.5

    if _resolve_template_route_guard_failure(query, sample):
        score -= 6.0

    all_placeholders, required_placeholders = _resolve_required_template_placeholders(
        sample
    )
    parameters = _extract_template_parameters(
        query,
        all_placeholders,
        histories=histories,
        sample=sample,
    )
    matched_required_placeholders = sum(
        1 for placeholder in required_placeholders if placeholder in parameters
    )
    score += 0.04 * matched_required_placeholders
    score -= 0.06 * max(
        len(required_placeholders) - matched_required_placeholders,
        0,
    )

    if _get_sample_value(sample, "asset_kind") == "sql_template":
        score += 0.1

    latest_history_sql = _get_latest_history_sql(histories)
    if latest_history_sql:
        if is_template_core_preserved(
            _get_sample_value(sample, "sql"),
            latest_history_sql,
        ):
            score += 1.4
        elif _matches_history_template_context(
            _get_sample_value(sample, "sql"),
            latest_history_sql,
        ):
            score += 1.0

    return score


def rerank_sql_samples(
    query: Optional[str],
    sql_samples: Sequence[Any],
    *,
    histories: Sequence[Any] | None = None,
) -> list[Any]:
    if not sql_samples:
        return []

    ranked_samples = sorted(
        enumerate(sql_samples),
        key=lambda item: (
            -_score_sql_sample_for_query(
                query,
                item[1],
                histories=histories,
            ),
            item[0],
        ),
    )
    return [sample for _index, sample in ranked_samples]


def _normalize_document_identity_value(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()


def _query_requests_topn_user_segment(query: Optional[str]) -> bool:
    if not query:
        return False

    return bool(
        re.search(
            (
                r"TOP\s*\d+|TOPN|"
                r"前\s*\d+\s*(?:名|个)?(?:大户|用户|玩家)?|"
                r"大户|头部用户|高流水用户|投注流水最高"
            ),
            query,
            flags=re.IGNORECASE,
        )
    )


def _query_requests_non_topn_user_segment(query: Optional[str]) -> bool:
    if not query:
        return False

    if re.search(r"非\s*TOP\s*\d*|NON[_\s-]?TOPN", query, flags=re.IGNORECASE):
        return True

    return bool(
        _query_requests_topn_user_segment(query)
        and re.search(
            r"其他用户|其余用户|剩余用户|非头部用户|非大户",
            query,
            flags=re.IGNORECASE,
        )
    )


def _build_document_identity(document: Any) -> tuple[str, str]:
    for key in (
        "id",
        "template_id",
        "sqlpairId",
        "sqlpair_id",
        "question",
        "instruction",
        "sql",
        "title",
    ):
        value = _get_sample_value(document, key)
        if value not in (None, ""):
            return key, _normalize_document_identity_value(value)

    return "repr", _normalize_document_identity_value(document)


def merge_unique_documents(*document_groups: Sequence[Any] | None) -> list[Any]:
    merged_documents: list[Any] = []
    seen_documents: set[tuple[str, str]] = set()

    for document_group in document_groups:
        if not document_group:
            continue

        for document in document_group:
            identity = _build_document_identity(document)
            if identity in seen_documents:
                continue

            seen_documents.add(identity)
            merged_documents.append(document)

    return merged_documents


def _extract_template_parameters_from_query(
    query: Optional[str],
    placeholders: Sequence[str],
) -> dict[str, Any]:
    if not query or not placeholders:
        return {}

    placeholder_set = set(placeholders)
    parameters: dict[str, Any] = {}
    dates = DATE_PATTERN.findall(query)
    if len(dates) >= 2:
        for start_key, end_key in (
            ("start_date", "end_date"),
            ("cohort_start_date", "cohort_end_date"),
        ):
            if start_key in placeholder_set:
                parameters[start_key] = dates[0]
            if end_key in placeholder_set:
                parameters[end_key] = dates[1]
    elif len(dates) == 1:
        for key in (
            "start_date",
            "end_date",
            "cohort_start_date",
            "cohort_end_date",
        ):
            if key in placeholder_set:
                parameters[key] = dates[0]

    if "tenant_plat_id" in placeholder_set:
        tenant_plat_id = _first_match(
            [
                r"tenant_plat_id\s*[=:：]?\s*(\d+)",
                r"租户平台\s*(\d+)",
                r"平台\s*(\d+)",
            ],
            query,
        )
        if tenant_plat_id:
            parameters["tenant_plat_id"] = int(tenant_plat_id)

    if "channel_id" in placeholder_set:
        channel_ids = _extract_integer_values(
            [
                r"channel_id\s*[=:：]?\s*((?:\d+\s*(?:,|，|、|和|与|or|OR)?\s*)+)",
                r"渠道(?:id|ID)?\s*((?:\d+\s*(?:,|，|、|和|与|or|OR)?\s*)+)",
                r"channel_id\s*[=:：]?\s*(\d+)",
                r"渠道(?:id|ID)?\s*(\d+)",
            ],
            query,
        )
        if channel_ids:
            parameters["channel_id"] = (
                channel_ids[0] if len(channel_ids) == 1 else channel_ids
            )

    if "channel_partner_id" in placeholder_set:
        channel_partner_ids = _extract_integer_values(
            [
                r"channel_partner_id\s*[=:：]?\s*((?:\d+\s*(?:,|，|、|和|与|or|OR)?\s*)+)",
                r"渠道商(?:id|ID)?\s*((?:\d+\s*(?:,|，|、|和|与|or|OR)?\s*)+)",
                r"channel_partner_id\s*[=:：]?\s*(\d+)",
                r"渠道商(?:id|ID)?\s*(\d+)",
            ],
            query,
        )
        if channel_partner_ids:
            parameters["channel_partner_id"] = (
                channel_partner_ids[0]
                if len(channel_partner_ids) == 1
                else channel_partner_ids
            )

    for key in ("top_n", "n_days", "period_days"):
        if key not in placeholder_set:
            continue

        value = None
        if key == "top_n":
            value = _first_match(
                [
                    r"TOP\s*(\d+)",
                    r"top\s*(\d+)",
                    r"前\s*(\d+)\s*(?:名|个)?",
                ],
                query,
            )
        elif key == "n_days":
            value = _first_match(
                [
                    r"D\s*1\s*(?:~|-|到|至)\s*D?\s*(\d+)",
                    r"第\s*1\s*(?:日|天)\s*(?:~|-|到|至)\s*第?\s*(\d+)\s*(?:日|天)",
                    r"首日\s*(?:~|-|到|至)\s*第?\s*(\d+)\s*(?:日|天)",
                    r"(?:到|至|截至|截止|直到)\s*第\s*(\d+)\s*(?:日|天)",
                    r"(\d+)\s*天内",
                    r"前\s*(\d+)\s*天",
                    r"N\s*[=:：]\s*(\d+)",
                ],
                query,
            )
            if not value:
                explicit_days = [
                    int(match)
                    for match in (
                        re.findall(r"D\s*(\d+)", query, flags=re.IGNORECASE)
                        + re.findall(r"第\s*(\d+)\s*(?:日|天)", query)
                    )
                ]
                if explicit_days:
                    parameters[key] = max(explicit_days)
                    continue
        else:
            explicit_period_days = [
                int(value)
                for value in re.findall(r"D\s*(\d+)", query, flags=re.IGNORECASE)
            ]
            has_period_range = re.search(
                r"D\s*\d+\s*(?:~|-|到|至)\s*D?\s*\d+",
                query,
                flags=re.IGNORECASE,
            )
            if len(explicit_period_days) > 1 and not has_period_range:
                parameters[key] = sorted(set(explicit_period_days))
                continue
            if len(explicit_period_days) == 1 and not has_period_range:
                parameters[key] = explicit_period_days[0]
                continue
            value = _first_match(
                [
                    r"D\s*1\s*(?:~|-|到|至)\s*D?\s*(\d+)",
                    r"(\d+)\s*天(?:回收|周期|内)",
                    r"period_days\s*[=:：]?\s*(\d+)",
                ],
                query,
            )
        if value:
            parameters[key] = int(value)

    if "user_segment" in placeholder_set:
        requested_segments: list[str] = []
        if re.search(r"ALL|全部|所有用户|全量", query, flags=re.IGNORECASE):
            requested_segments.append("ALL")

        query_without_non_top = re.sub(
            r"非\s*TOP\s*\d*|NON[_\s-]?TOPN|非大户|非头部用户",
            "",
            query,
            flags=re.IGNORECASE,
        )
        if _query_requests_topn_user_segment(query_without_non_top):
            requested_segments.append("TOPN")
        if _query_requests_non_topn_user_segment(query):
            requested_segments.append("NON_TOPN")
        if requested_segments:
            parameters["user_segment"] = (
                requested_segments[0]
                if len(requested_segments) == 1
                else requested_segments
            )

    return parameters


def _query_requests_segment_breakdown(query: Optional[str]) -> bool:
    if not query:
        return False

    return bool(
        re.search(
            r"(?:全部|所有|全量)用户\s*[／/]\s*分层(?:用户)?",
            query,
            flags=re.IGNORECASE,
        )
        or (
            re.search(r"(?:全部|所有|全量)用户", query, flags=re.IGNORECASE)
            and re.search(r"分层(?:用户)?", query, flags=re.IGNORECASE)
        )
    )


def _extract_top_n_hints_from_text(text: Optional[str]) -> set[int]:
    if not text:
        return set()

    hints: set[int] = set()
    for match in re.finditer(
        r"TOP\s*(\d+)\s*/\s*(\d+)|前\s*(\d+)\s*/\s*(\d+)",
        text,
        flags=re.IGNORECASE,
    ):
        hints.update(int(group) for group in match.groups() if group)

    for match in re.finditer(
        r"TOP\s*(\d+)|前\s*(\d+)\s*(?:名|个)?",
        text,
        flags=re.IGNORECASE,
    ):
        hints.update(int(group) for group in match.groups() if group)

    return hints


def _extract_template_context_texts(sample: Any) -> list[str]:
    if sample is None:
        return []

    texts: list[str] = []
    for key in (
        "question",
        "title",
        "description",
        "question_variants",
        "questionVariants",
    ):
        texts.extend(_collect_template_context_texts(_get_sample_value(sample, key)))

    business_signature = _get_business_signature(sample)
    if isinstance(business_signature, dict):
        for key in (
            "question",
            "title",
            "description",
            "question_variants",
            "questionVariants",
            "questions",
            "examples",
        ):
            texts.extend(_collect_template_context_texts(business_signature.get(key)))

    unique_texts: list[str] = []
    for text in texts:
        if text not in unique_texts:
            unique_texts.append(text)
    return unique_texts


def _collect_related_template_context_samples(
    sample: Any,
    related_samples: Sequence[Any] | None = None,
) -> list[Any]:
    if sample is None:
        return []

    context_samples = [sample]
    anchor_sql = _normalize_sql_for_signature(_get_sample_value(sample, "sql"))
    anchor_signature = _get_business_signature(sample)
    anchor_template_id = str(anchor_signature.get("templateId") or "").strip()

    for candidate in related_samples or []:
        if candidate is sample:
            continue

        candidate_sql = _normalize_sql_for_signature(
            _get_sample_value(candidate, "sql")
        )
        candidate_signature = _get_business_signature(candidate)
        candidate_template_id = str(candidate_signature.get("templateId") or "").strip()
        if (anchor_sql and candidate_sql and candidate_sql == anchor_sql) or (
            anchor_template_id
            and candidate_template_id
            and candidate_template_id == anchor_template_id
        ):
            context_samples.append(candidate)

    return context_samples


def _resolve_template_family_id(sample: Any) -> str:
    business_signature = _get_business_signature(sample)
    return str(business_signature.get("templateId") or "").strip().lower()


def _samples_share_template_family(primary_sample: Any, candidate_sample: Any) -> bool:
    if primary_sample is None or candidate_sample is None:
        return False

    primary_template_family = _resolve_template_family_id(primary_sample)
    candidate_template_family = _resolve_template_family_id(candidate_sample)
    if (
        primary_template_family
        and candidate_template_family
        and primary_template_family == candidate_template_family
    ):
        return True

    primary_sql = _normalize_sql_for_signature(_get_sample_value(primary_sample, "sql"))
    candidate_sql = _normalize_sql_for_signature(
        _get_sample_value(candidate_sample, "sql")
    )
    return bool(primary_sql and candidate_sql and primary_sql == candidate_sql)


def _infer_unambiguous_template_top_n(
    sample: Any,
    *,
    related_samples: Sequence[Any] | None = None,
) -> Optional[int]:
    hinted_top_ns: set[int] = set()
    for context_sample in _collect_related_template_context_samples(
        sample,
        related_samples=related_samples,
    ):
        for text in _extract_template_context_texts(context_sample):
            hinted_top_ns.update(_extract_top_n_hints_from_text(text))
            if len(hinted_top_ns) > 1:
                return None

    return next(iter(hinted_top_ns), None) if hinted_top_ns else None


def _normalize_user_segments(value: Any) -> list[str]:
    if value is None:
        return []

    raw_segments = value if isinstance(value, list) else [value]
    segments: list[str] = []
    for raw_segment in raw_segments:
        normalized_segment = str(raw_segment or "").strip().upper().replace("-", "_")
        if normalized_segment and normalized_segment not in segments:
            segments.append(normalized_segment)

    return segments


def _serialize_user_segments(segments: Sequence[str]) -> str | list[str]:
    return segments[0] if len(segments) == 1 else list(segments)


def _backfill_template_parameters(
    query: Optional[str],
    placeholders: Sequence[str],
    parameters: dict[str, Any],
    *,
    sample: Any | None = None,
    related_samples: Sequence[Any] | None = None,
) -> dict[str, Any]:
    if not placeholders:
        return parameters

    placeholder_set = set(placeholders)
    if "user_segment" in placeholder_set and _query_requests_segment_breakdown(query):
        parameters["user_segment"] = ["ALL", "TOPN", "NON_TOPN"]

    if "top_n" in placeholder_set and "top_n" not in parameters:
        user_segments = _normalize_user_segments(parameters.get("user_segment"))
        if {"TOPN", "NON_TOPN"} & set(user_segments):
            inferred_top_n = _infer_unambiguous_template_top_n(
                sample,
                related_samples=related_samples,
            )
            if inferred_top_n is not None:
                parameters["top_n"] = inferred_top_n

    normalized_segments = _normalize_user_segments(parameters.get("user_segment"))
    if normalized_segments:
        parameters["user_segment"] = _serialize_user_segments(normalized_segments)

    return parameters


def _extract_template_parameters_from_slot_values(
    slot_values: dict[str, Any],
    placeholders: Sequence[str],
) -> dict[str, Any]:
    if not slot_values or not placeholders:
        return {}

    placeholder_set = set(placeholders)
    parameters: dict[str, Any] = {}
    if "tenant_plat_id" in placeholder_set:
        tenant_ids = _extract_slot_value_ids(slot_values, "tenant_plat_id")
        if tenant_ids:
            parameters["tenant_plat_id"] = (
                tenant_ids[0] if len(tenant_ids) == 1 else tenant_ids
            )
    if "channel_id" in placeholder_set:
        channel_ids = _extract_slot_value_ids(slot_values, "channel_id")
        if channel_ids:
            parameters["channel_id"] = (
                channel_ids[0] if len(channel_ids) == 1 else channel_ids
            )

    date_range = _extract_slot_value_date_range(slot_values)
    if date_range:
        if "date" in date_range:
            for key in (
                "start_date",
                "end_date",
                "cohort_start_date",
                "cohort_end_date",
            ):
                if key in placeholder_set:
                    parameters[key] = date_range["date"]
        else:
            start_date = date_range.get("start_date")
            end_date = date_range.get("end_date")
            if start_date:
                for key in ("start_date", "cohort_start_date"):
                    if key in placeholder_set:
                        parameters[key] = start_date
            if end_date:
                for key in ("end_date", "cohort_end_date"):
                    if key in placeholder_set:
                        parameters[key] = end_date

    for key in ("top_n", "n_days", "period_days"):
        if key in placeholder_set and _slot_value_is_present(slot_values, key):
            raw_value = slot_values.get(key)
            try:
                parameters[key] = int(str(raw_value).strip().lstrip("Dd"))
            except (TypeError, ValueError):
                parameters[key] = raw_value
    return parameters


def _extract_template_parameters(
    query: Optional[str],
    placeholders: Sequence[str],
    *,
    histories: Sequence[Any] | None = None,
    sample: Any | None = None,
    related_samples: Sequence[Any] | None = None,
) -> dict[str, Any]:
    if not placeholders:
        return {}

    parameters = _extract_template_parameters_from_query(query, placeholders)
    parameters = _backfill_template_parameters(
        query,
        placeholders,
        parameters,
        sample=sample,
        related_samples=related_samples,
    )
    for history_question in reversed(_iter_history_questions(histories)):
        fallback_parameters = _extract_template_parameters_from_query(
            history_question,
            placeholders,
        )
        for key, value in fallback_parameters.items():
            parameters.setdefault(key, value)
    for history_slots in reversed(_iter_history_resolved_slots(histories)):
        fallback_parameters = _extract_template_parameters_from_slot_values(
            history_slots,
            placeholders,
        )
        for key, value in fallback_parameters.items():
            parameters.setdefault(key, value)

    return parameters


def _is_legacy_governed_template(sample: Any) -> bool:
    source_type = str(_get_sample_value(sample, "source_type", "") or "").lower()
    if source_type:
        return False

    template_level = _get_sample_value(sample, "template_level", "L0")
    return _is_anchored_template_candidate(sample) and (
        _get_sample_value(sample, "asset_kind", "sql_pair") == "sql_template"
        or TEMPLATE_LEVEL_RANK.get(str(template_level), 0) >= 2
    )


def _has_template_approval(sample: Any) -> bool:
    source_type = str(_get_sample_value(sample, "source_type", "") or "").lower()
    return bool(
        source_type in TEMPLATE_APPROVED_SOURCE_TYPES
        or _is_legacy_governed_template(sample)
        or _get_sample_value(sample, "approved_at")
        or _get_sample_value(sample, "approvedAt")
        or _get_sample_value(sample, "approved_by")
        or _get_sample_value(sample, "approvedBy")
    )


def _is_anchored_template_candidate(sample: Any) -> bool:
    template_mode = _get_sample_value(sample, "template_mode", "reference")
    template_level = _get_sample_value(sample, "template_level", "L0")
    asset_kind = _get_sample_value(sample, "asset_kind", "sql_pair")
    return (
        template_mode in TEMPLATE_ANCHORED_MODES
        or TEMPLATE_LEVEL_RANK.get(str(template_level), 0) >= 2
        or asset_kind == "sql_template"
    )


def _is_trusted_template_candidate(sample: Any) -> bool:
    template_mode = _get_sample_value(sample, "template_mode", "reference")
    template_level = _get_sample_value(sample, "template_level", "L0")
    return (
        _is_anchored_template_candidate(sample)
        or template_mode in TEMPLATE_TRUSTED_MODES
        or TEMPLATE_LEVEL_RANK.get(str(template_level), 0) >= 1
    )


def _resolve_template_source_score(sample: Any) -> float:
    source_type = str(_get_sample_value(sample, "source_type", "user_saved") or "")
    if source_type in TEMPLATE_APPROVED_SOURCE_TYPES:
        return 1.0
    if _is_legacy_governed_template(sample):
        return 1.0
    if _has_template_approval(sample):
        return 0.75
    if source_type == "user_saved":
        return 0.15
    return 0.35


def _resolve_parameter_coverage_score(
    placeholders: Sequence[str], parameters: dict[str, Any]
) -> float:
    if not placeholders:
        return 1.0
    return len(parameters) / len(placeholders)


def _resolve_margin_score(
    top_adjusted_score: float, second_adjusted_score: Optional[float]
) -> float:
    if second_adjusted_score is None:
        return 1.0
    baseline = max(abs(top_adjusted_score), 1.0)
    return max(0.0, min(1.0, (top_adjusted_score - second_adjusted_score) / baseline))


def _has_min_retrieval_support(
    raw_score: Optional[float], adjusted_score: float
) -> bool:
    if raw_score is None:
        return adjusted_score > 0
    return (raw_score or 0.0) >= TEMPLATE_MIN_RETRIEVAL_SCORE or (
        adjusted_score >= TEMPLATE_MIN_ADJUSTED_SCORE
    )


def _build_template_decision_payload(
    *,
    decision_reason: str,
    fallback_reason: Optional[str],
    margin: Optional[float],
    missing_parameters: list[str],
    mode: str,
    parameters: dict[str, Any],
    sample: Any,
    score: Optional[float],
    sql_source: str,
    history_backed_template_continuity: bool = False,
) -> dict[str, Any]:
    return {
        "mode": mode,
        "template_id": _get_sample_value(sample, "id"),
        "template_title": _get_sample_value(sample, "question"),
        "score": score,
        "margin": margin,
        "parameters": parameters,
        "missing_parameters": missing_parameters,
        "decision_reason": decision_reason,
        "fallback_reason": fallback_reason,
        "history_backed_template_continuity": history_backed_template_continuity,
        "sql_source": sql_source,
        "source_type": _get_sample_value(sample, "source_type"),
        "template_level": _get_sample_value(sample, "template_level", "L0"),
        "template_mode": _get_sample_value(sample, "template_mode", "reference"),
        "instruction_count": None,
        "retrieved_table_count": None,
        "retrieved_ddl_count": None,
        "correction_retries": 0,
        "schema_compatible": None,
        "dialect_compatible": None,
        "dry_run_compatible": None,
        "validation_error": None,
        "business_signature": _get_business_signature(sample),
        "detected_concepts": _extract_business_signature_list(
            _get_business_signature(sample),
            "concepts",
            "businessConcepts",
            "business_concepts",
        ),
        "required_external_dependencies": _extract_business_signature_list(
            _get_business_signature(sample),
            "externalDependencies",
            "external_dependencies",
        ),
    }


def _update_template_runtime_metrics(
    template_decision: Optional[dict[str, Any]],
    *,
    correction_retries: Optional[int] = None,
    dialect_compatible: Optional[bool] = None,
    dry_run_compatible: Optional[bool] = None,
    instruction_count: Optional[int] = None,
    retrieved_ddl_count: Optional[int] = None,
    retrieved_table_count: Optional[int] = None,
    schema_compatible: Optional[bool] = None,
    validation_error: Optional[str] = None,
) -> None:
    if not template_decision:
        return

    if instruction_count is not None:
        template_decision["instruction_count"] = instruction_count
    if retrieved_table_count is not None:
        template_decision["retrieved_table_count"] = retrieved_table_count
    if retrieved_ddl_count is not None:
        template_decision["retrieved_ddl_count"] = retrieved_ddl_count
    if correction_retries is not None:
        template_decision["correction_retries"] = correction_retries
    if schema_compatible is not None:
        template_decision["schema_compatible"] = schema_compatible
    if dialect_compatible is not None:
        template_decision["dialect_compatible"] = dialect_compatible
    if dry_run_compatible is not None:
        template_decision["dry_run_compatible"] = dry_run_compatible
    if validation_error is not None:
        template_decision["validation_error"] = validation_error


def detect_missing_external_source_requirement(
    query: Optional[str],
    *,
    sql_samples: Sequence[Any] | None = None,
    instructions: Sequence[Any] | None = None,
    supplied_external_dependencies: Any = None,
) -> Optional[dict[str, Any]]:
    if not query:
        return None

    configured_dependencies = _extract_configured_external_dependencies(
        sql_samples=sql_samples,
        instructions=instructions,
    )
    supplied_dependencies = _normalize_external_dependency_supply_map(
        supplied_external_dependencies
    )

    def build_requirement(
        dependencies: Sequence[dict[str, Any]],
        *,
        source: str,
        granularity_hint: Optional[str] = None,
    ) -> Optional[dict[str, Any]]:
        missing_dependencies = []
        invalid_supply_evaluations = []
        for dependency in dependencies:
            is_missing = str(dependency.get("source_status") or "missing").lower() in {
                "missing",
                "partial",
                "manual_input",
            }
            should_block = str(
                dependency.get("missing_behavior") or "ask_user"
            ).lower() in {"ask_user", "block_answer"}
            if not is_missing or not should_block:
                continue

            supplied_evaluation = _evaluate_supplied_external_dependency(
                dependency,
                supplied_dependencies,
            )
            if supplied_evaluation["satisfied"]:
                continue
            if (
                supplied_dependencies
                and supplied_evaluation.get("missing_dependency") is None
            ):
                invalid_supply_evaluations.append(
                    {
                        "dependency_id": dependency.get("id"),
                        **supplied_evaluation,
                    }
                )
            missing_dependencies.append(dependency)
        if not missing_dependencies:
            return None

        required_metrics = []
        required_dependency_ids = []
        prompts = []
        required_grain_values: list[str] = []
        for dependency in missing_dependencies:
            name = str(dependency.get("name") or dependency.get("id") or "").strip()
            dependency_id = str(dependency.get("id") or "").strip()
            if name and name not in required_metrics:
                required_metrics.append(name)
            if dependency_id and dependency_id not in required_dependency_ids:
                required_dependency_ids.append(dependency_id)
            prompt = _normalize_instruction(dependency.get("ask_user_prompt"))
            if prompt and prompt not in prompts:
                prompts.append(prompt)
            for grain in _normalize_string_list(dependency.get("required_grain")):
                if grain not in required_grain_values:
                    required_grain_values.append(grain)

        if not required_metrics:
            return None

        required_grain_label = ""
        example_columns: list[str] = []
        if granularity_hint is None:
            if required_grain_values:
                required_grain_label = "、".join(required_grain_values)
                granularity_hint = (
                    "请按以下统计粒度提供：" + "、".join(required_grain_values) + "。"
                )
            elif re.search(r"cohort|ROI|回收|首存成本", query, flags=re.IGNORECASE):
                required_grain_label = "对应统计周期"
                granularity_hint = "请按对应统计周期提供这些外部指标。"
            elif re.search(r"日报|趋势|按天|日期|渠道", query, flags=re.IGNORECASE):
                required_grain_label = "日期、渠道"
                granularity_hint = "请按每个日期、每个渠道提供这些外部指标。"
            else:
                required_grain_label = "当前问题对应统计粒度"
                granularity_hint = "请按当前问题对应的统计粒度提供这些外部指标。"
        elif required_grain_values:
            required_grain_label = "、".join(required_grain_values)
        elif re.search(r"cohort|ROI|回收|首存成本", query, flags=re.IGNORECASE):
            required_grain_label = "对应统计周期"
        elif re.search(r"日报|趋势|按天|日期|渠道", query, flags=re.IGNORECASE):
            required_grain_label = "日期、渠道"
        else:
            required_grain_label = "当前问题对应统计粒度"

        if required_grain_values:
            example_columns = [*required_grain_values, *required_metrics]
        elif "日期" in required_grain_label and "渠道" in required_grain_label:
            example_columns = ["日期", "渠道ID", *required_metrics]
        elif "周期" in required_grain_label:
            example_columns = ["统计周期", *required_metrics]
        else:
            example_columns = ["统计粒度", *required_metrics]

        missing_metrics = "、".join(required_metrics)
        missing_supply_columns = list(
            dict.fromkeys(
                column
                for evaluation in invalid_supply_evaluations
                for column in evaluation.get("missing_columns", [])
            )
        )
        missing_supply_grain = list(
            dict.fromkeys(
                grain
                for evaluation in invalid_supply_evaluations
                for grain in evaluation.get("missing_grain", [])
            )
        )
        invalid_supply_hint = ""
        if missing_supply_columns or missing_supply_grain:
            invalid_supply_hint = (
                "\n- 已补充数据校验未通过："
                + (
                    f"缺少必需列 {', '.join(missing_supply_columns)}；"
                    if missing_supply_columns
                    else ""
                )
                + (
                    f"缺少粒度 {', '.join(missing_supply_grain)}；"
                    if missing_supply_grain
                    else ""
                )
            )
        prompt_suffix = "" if not prompts else " " + " ".join(prompts)
        content = (
            "当前知识库还缺少外部数据，不能直接输出或并表这些结果，也不能编造。\n"
            f"- 缺失指标：{missing_metrics}\n"
            f"- 需要粒度：{required_grain_label}\n"
            f"- 示例表头：{', '.join(example_columns)}\n"
            f"{invalid_supply_hint}\n"
            "- 下一步：请在外部数据依赖/业务知识中补充以上指标，或在对话中按示例表头提供数据；"
            f"补充后我再和现有 SQL 可查询的内部指标一起输出。{granularity_hint}"
            f"{prompt_suffix}"
        )
        return {
            "reasoning": (
                f"问题依赖当前知识库中缺失的外部指标：{missing_metrics}。"
                "在用户补充这些指标前，不能直接编造结果。"
            ),
            "content": content,
            "instruction": {
                "instruction": (
                    "当前知识库缺少以下外部指标："
                    f"{missing_metrics}。请先明确告知用户当前无法直接计算，并要求用户补充这些指标；"
                    "不能编造，也不能用其他字段替代。"
                    f"{granularity_hint}"
                ),
                "source": source,
                "required_metrics": required_metrics,
                "required_external_dependencies": required_dependency_ids,
                "required_grain": required_grain_values,
                "required_grain_hint": required_grain_label,
                "example_columns": example_columns,
                "missing_supplied_columns": missing_supply_columns,
                "missing_supplied_grain": missing_supply_grain,
            },
            "required_external_dependencies": required_dependency_ids,
            "pending_external_dependency_slots": [
                _external_dependency_slot_name(dependency_id)
                for dependency_id in required_dependency_ids
            ],
            "external_dependency_request": {
                "required_metrics": required_metrics,
                "required_external_dependencies": required_dependency_ids,
                "required_grain": required_grain_values,
                "required_grain_hint": required_grain_label,
                "example_columns": example_columns,
            },
        }

    configured_matches = _match_configured_external_dependencies(
        query,
        configured_dependencies,
    )

    configured_requirement = build_requirement(
        configured_matches,
        source="configured_external_dependency",
    )
    if configured_requirement:
        return configured_requirement
    if configured_matches:
        return None

    if _query_requests_internal_only(query):
        return None

    if not _legacy_external_dependency_fallback_enabled():
        return None

    required_metrics: list[str] = []
    # “ROI回收表” can be a report/sheet name. Do not treat that label alone as
    # a request for ad_spend; only block when the business metric itself asks
    # for ROI/cost/ad-spend.
    external_metric_query = re.sub(
        r"ROI\s*回收表",
        "回收表",
        query,
        flags=re.IGNORECASE,
    )
    normalized_query = external_metric_query.upper()

    def append_metric(metric_key: str, dependency_id: Optional[str] = None) -> None:
        dependency_id = dependency_id or {
            "download_click_uv": "download_click_uv",
            "pv": "access_pv",
            "spend_amount": "ad_spend",
            "uv": "access_uv",
        }.get(metric_key)
        if dependency_id and _query_excludes_external_dependency(
            query,
            {
                "id": dependency_id,
                "name": MISSING_SOURCE_PROMPTS.get(metric_key, dependency_id),
            },
        ):
            return
        metric = MISSING_SOURCE_PROMPTS[metric_key]
        if metric not in required_metrics:
            required_metrics.append(metric)

    if re.search(
        r"ROI|投放回收|回本|首存成本|首充成本|新客.*成本|投放金额|投放成本|买量成本|广告费",
        normalized_query,
        flags=re.IGNORECASE,
    ):
        append_metric("spend_amount")

    if re.search(r"UV下载率", query, flags=re.IGNORECASE):
        append_metric("uv")
        append_metric("download_click_uv")

    if re.search(r"UV注册率", query, flags=re.IGNORECASE):
        append_metric("uv")

    if re.search(r"下载点击\s*(?:UV|人数|人次)?", query, flags=re.IGNORECASE):
        append_metric("download_click_uv")

    if re.search(
        r"(?<![A-Z0-9])PV(?![A-Z0-9])|访问PV|访问量",
        normalized_query,
        flags=re.IGNORECASE,
    ):
        append_metric("pv")

    access_uv_query = re.sub(
        r"下载点击\s*UV",
        "",
        query,
        flags=re.IGNORECASE,
    )
    if re.search(
        r"(?<![A-Z0-9])UV(?![A-Z0-9])|访问UV|独立访客",
        access_uv_query,
        flags=re.IGNORECASE,
    ):
        append_metric("uv")

    if not required_metrics:
        return None

    if re.search(
        r"cohort|ROI|投放回收|回本|回收|首存成本|首充成本",
        query,
        flags=re.IGNORECASE,
    ):
        granularity_hint = "请按对应统计周期提供这些外部指标。"
    elif re.search(r"日报|趋势|按天|日期|渠道", query, flags=re.IGNORECASE):
        granularity_hint = "请按每个日期、每个渠道提供这些外部指标。"
    else:
        granularity_hint = "请按当前问题对应的统计粒度提供这些外部指标。"

    return build_requirement(
        [
            {
                "id": metric,
                "name": metric,
                "source_status": "missing",
                "missing_behavior": "ask_user",
            }
            for metric in required_metrics
        ],
        source="missing_source_rule",
        granularity_hint=granularity_hint,
    )


def _format_template_parameter(value: Any) -> str:
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    escaped_value = str(value).replace("'", "''")
    return f"'{escaped_value}'"


def _render_template_sql_once(sql: str, parameters: dict[str, Any]) -> str:
    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in parameters:
            return match.group(0)
        return _format_template_parameter(parameters[name])

    return SQL_TEMPLATE_PLACEHOLDER_PATTERN.sub(replace, sql)


def render_template_sql(sql: Optional[str], parameters: dict[str, Any]) -> str:
    if not sql:
        return ""

    list_parameters = {
        key: value
        for key, value in parameters.items()
        if isinstance(value, list) and value
    }
    if not list_parameters:
        return _render_template_sql_once(sql, parameters)

    scalar_parameters = {
        key: value for key, value in parameters.items() if key not in list_parameters
    }
    keys = list(list_parameters)
    rendered_sqls = []
    for index, values in enumerate(
        itertools.product(*(list_parameters[key] for key in keys))
    ):
        expanded_parameters = {
            **scalar_parameters,
            **dict(zip(keys, values)),
        }
        rendered = _render_template_sql_once(
            sql.strip().rstrip(";"), expanded_parameters
        )
        rendered_sqls.append(f"SELECT * FROM (\n{rendered}\n) AS template_{index}")

    return "\nUNION ALL\n".join(rendered_sqls)


def build_template_decision(
    sql_samples: Sequence[Any],
    query: Optional[str] = None,
    *,
    histories: Sequence[Any] | None = None,
    inactive_sample: Any | None = None,
) -> dict[str, Any]:
    if not sql_samples:
        if inactive_sample is not None:
            return _build_template_decision_payload(
                decision_reason="reference_sql_pair_selected",
                fallback_reason="inactive_template",
                margin=None,
                missing_parameters=[],
                mode="reference",
                parameters={},
                sample=inactive_sample,
                score=_get_sample_score(inactive_sample),
                sql_source="generated",
            )
        return {
            "mode": "reference",
            "template_id": None,
            "template_title": None,
            "score": None,
            "margin": None,
            "parameters": {},
            "missing_parameters": [],
            "decision_reason": "no_sql_pair_candidates",
            "fallback_reason": None,
            "sql_source": "generated",
            "source_type": None,
            "template_level": "L0",
            "template_mode": "reference",
            "instruction_count": None,
            "retrieved_table_count": None,
            "retrieved_ddl_count": None,
            "correction_retries": 0,
            "schema_compatible": None,
            "dialect_compatible": None,
            "dry_run_compatible": None,
            "validation_error": None,
            "business_signature": {},
            "detected_concepts": [],
            "required_external_dependencies": [],
        }

    top_sample = sql_samples[0]
    second_sample = sql_samples[1] if len(sql_samples) > 1 else None
    raw_score = _get_sample_score(top_sample)
    top_adjusted_score = _score_sql_sample_for_query(
        query,
        top_sample,
        histories=histories,
    )
    second_adjusted_score = (
        _score_sql_sample_for_query(
            query,
            second_sample,
            histories=histories,
        )
        if second_sample is not None
        else None
    )
    margin = (
        top_adjusted_score - second_adjusted_score
        if second_adjusted_score is not None
        else None
    )
    placeholders, required_placeholders = _resolve_required_template_placeholders(
        top_sample
    )
    parameters = _extract_template_parameters(
        query,
        placeholders,
        histories=histories,
        sample=top_sample,
        related_samples=sql_samples,
    )
    missing_parameters = [
        placeholder
        for placeholder in required_placeholders
        if placeholder not in parameters
    ]
    confidence = min(
        1.0,
        (0.45 * _resolve_template_source_score(top_sample))
        + (0.20 * max(0.0, min(raw_score or 0.0, 1.0)))
        + (0.05 * _resolve_parameter_coverage_score(required_placeholders, parameters))
        + (0.15 * _resolve_margin_score(top_adjusted_score, second_adjusted_score))
        + (0.15 if _has_template_approval(top_sample) else 0.0),
    )
    is_same_template_family_conflict = _samples_share_template_family(
        top_sample,
        second_sample,
    )
    has_low_margin_conflict = bool(
        second_sample is not None
        and margin is not None
        and margin < TEMPLATE_MIN_CONFLICT_MARGIN
        and _is_trusted_template_candidate(second_sample)
        and not is_same_template_family_conflict
    )
    latest_history_sql = _get_latest_history_sql(histories)
    has_history_backed_template_continuity = bool(
        latest_history_sql
        and not missing_parameters
        and _matches_history_template_context(
            _get_sample_value(top_sample, "sql"),
            latest_history_sql,
        )
    )
    has_min_retrieval_support = _has_min_retrieval_support(
        raw_score, top_adjusted_score
    )
    route_guard_failure = _resolve_template_route_guard_failure(query, top_sample)

    if route_guard_failure and _is_trusted_template_candidate(top_sample):
        return _build_template_decision_payload(
            decision_reason="reference_sql_pair_selected",
            fallback_reason=route_guard_failure,
            margin=margin,
            missing_parameters=[],
            mode="reference",
            parameters={},
            sample=top_sample,
            score=confidence,
            sql_source="generated",
        )

    if _is_anchored_template_candidate(top_sample):
        if (
            not has_min_retrieval_support
            or confidence < TEMPLATE_MIN_ANCHORED_CONFIDENCE
        ):
            fallback_reason = "template_confidence_below_threshold"
            if (
                _is_trusted_template_candidate(top_sample)
                and confidence >= TEMPLATE_MIN_TRUSTED_CONFIDENCE
            ):
                return _build_template_decision_payload(
                    decision_reason="trusted_reference_selected",
                    fallback_reason=fallback_reason,
                    margin=margin,
                    missing_parameters=[],
                    mode="trusted_reference",
                    parameters={},
                    sample=top_sample,
                    score=confidence,
                    sql_source="generated",
                )
            return _build_template_decision_payload(
                decision_reason="reference_sql_pair_selected",
                fallback_reason=fallback_reason,
                margin=margin,
                missing_parameters=[],
                mode="reference",
                parameters={},
                sample=top_sample,
                score=confidence,
                sql_source="generated",
            )

        if has_low_margin_conflict and not has_history_backed_template_continuity:
            return _build_template_decision_payload(
                decision_reason="trusted_reference_selected",
                fallback_reason="template_conflict_low_margin",
                margin=margin,
                missing_parameters=[],
                mode="trusted_reference",
                parameters={},
                sample=top_sample,
                score=confidence,
                sql_source="generated",
            )

        template_mode = (
            _get_sample_value(top_sample, "template_mode", "reference") or "reference"
        )
        sql_source = (
            "rendered_template"
            if (
                template_mode == "executable_template"
                and confidence >= TEMPLATE_MIN_EXECUTABLE_CONFIDENCE
                and not missing_parameters
            )
            else "anchored_template" if not missing_parameters else "anchored_generated"
        )
        return _build_template_decision_payload(
            decision_reason="explicit_business_template_selected",
            fallback_reason=(
                "missing_template_parameters" if missing_parameters else None
            ),
            history_backed_template_continuity=has_history_backed_template_continuity,
            margin=margin,
            missing_parameters=missing_parameters,
            mode=(
                "executable_template"
                if template_mode == "executable_template"
                and confidence >= TEMPLATE_MIN_EXECUTABLE_CONFIDENCE
                else "anchored_template"
            ),
            parameters=parameters,
            sample=top_sample,
            score=confidence,
            sql_source=sql_source,
        )

    if (
        _is_trusted_template_candidate(top_sample)
        and has_min_retrieval_support
        and confidence >= TEMPLATE_MIN_TRUSTED_CONFIDENCE
    ):
        return _build_template_decision_payload(
            decision_reason="trusted_reference_selected",
            fallback_reason=(
                "template_conflict_low_margin" if has_low_margin_conflict else None
            ),
            margin=margin,
            missing_parameters=[],
            mode="trusted_reference",
            parameters={},
            sample=top_sample,
            score=confidence,
            sql_source="generated",
        )

    return _build_template_decision_payload(
        decision_reason="reference_sql_pair_selected",
        fallback_reason=None,
        margin=margin,
        missing_parameters=[],
        mode="reference",
        parameters={},
        sample=top_sample,
        score=confidence,
        sql_source="generated",
    )


def build_template_instruction(template_decision: Optional[dict[str, Any]]) -> list:
    if not template_decision:
        return []
    if template_decision.get("mode") not in {
        "trusted_reference",
        "anchored_template",
        "executable_template",
    }:
        return []

    if template_decision.get("mode") == "trusted_reference":
        instruction = (
            "The matched SQL pair is a trusted reference. Prefer its business "
            "definitions and calculation pattern unless the user question clearly "
            "asks for a different metric, grain, or filter."
        )
    else:
        instruction = (
            "The matched SQL pair is an anchored business template. Preserve its "
            "CTE hierarchy, aggregation grain, GROUP BY level, CASE bucket logic, "
            "cohort/TOPN logic, date grain, and core business filters. Only adapt "
            "parameters, identifiers, aliases, quotes, or dialect-compatible "
            "syntax when necessary."
        )

    return [
        {
            "instruction": instruction,
            "source": "template_decision",
            "template_id": template_decision.get("template_id"),
            "template_mode": template_decision.get("mode"),
            "sql_source": template_decision.get("sql_source"),
        }
    ]


def strip_template_decision_instructions(instructions: Sequence[Any]) -> list[Any]:
    return [
        instruction
        for instruction in instructions
        if not (
            isinstance(instruction, dict)
            and instruction.get("source") == "template_decision"
        )
    ]


def _can_retry_template_core_rejection_as_reference(
    template_decision: Optional[dict[str, Any]],
    *,
    retry_used: bool,
) -> bool:
    return bool(
        not retry_used
        and template_decision
        and template_decision.get("mode") == "anchored_template"
        and template_decision.get("template_mode") != "executable_template"
        and not template_decision.get("missing_parameters")
    )


def _mark_template_core_reference_retry(
    template_decision: Optional[dict[str, Any]],
) -> None:
    if not template_decision:
        return

    template_decision["mode"] = "reference"
    template_decision["sql_source"] = "generated"
    template_decision["fallback_reason"] = "template_core_protection_reference_retry"
    template_decision["decision_reason"] = (
        template_decision.get("decision_reason") or "reference_sql_pair_selected"
    )
    template_decision["validation_error"] = (
        "SQL correction changed the protected template core; retried as reference"
    )


def _reference_retry_sql_samples(sql_samples: Sequence[Any]) -> list[Any]:
    return [
        sample for sample in sql_samples if not _is_anchored_template_candidate(sample)
    ]


def can_reuse_template_sql(template_decision: Optional[dict[str, Any]]) -> bool:
    return bool(
        template_decision
        and template_decision.get("mode")
        in {"anchored_template", "executable_template"}
        and template_decision.get("sql_source")
        in {"anchored_template", "rendered_template"}
        and not template_decision.get("missing_parameters")
    )


def build_reusable_template_sql(
    selected_template: Any, template_decision: Optional[dict[str, Any]]
) -> str:
    sql = _get_sample_value(selected_template, "sql")
    parameters = (template_decision or {}).get("parameters") or {}
    rendered_sql = render_template_sql(sql, parameters)
    optional_placeholders = _find_optional_sql_placeholders(sql)
    if not optional_placeholders:
        return rendered_sql

    def replace_optional(match: re.Match[str]) -> str:
        name = match.group(1)
        if name in optional_placeholders:
            return "NULL"
        return match.group(0)

    return SQL_TEMPLATE_PLACEHOLDER_PATTERN.sub(replace_optional, rendered_sql)


def _extract_template_source_tables(selected_template: Any) -> list[str]:
    business_signature = _get_sample_value(
        selected_template, "business_signature"
    ) or _get_sample_value(selected_template, "businessSignature")
    if not isinstance(business_signature, dict):
        business_signature = {}

    raw_source_tables = business_signature.get(
        "sourceTables"
    ) or business_signature.get("source_tables")
    if not isinstance(raw_source_tables, list):
        raw_source_tables = []

    source_tables: list[str] = []
    for raw_table_name in raw_source_tables:
        if not isinstance(raw_table_name, str):
            continue
        normalized_table_name = raw_table_name.strip().strip('`"')
        if normalized_table_name and normalized_table_name not in source_tables:
            source_tables.append(normalized_table_name)

    if source_tables:
        return source_tables

    referenced_tables: list[str] = []
    for matched_table_name in re.findall(
        r"\b(?:FROM|JOIN)\s+[`\"]?([A-Za-z_][A-Za-z0-9_\.]*)[`\"]?",
        _get_sample_value(selected_template, "sql") or "",
        flags=re.IGNORECASE,
    ):
        normalized_table_name = matched_table_name.strip().strip('`"')
        if normalized_table_name and normalized_table_name not in referenced_tables:
            referenced_tables.append(normalized_table_name)

    return referenced_tables


def _resolve_template_table_name_mapping(
    selected_template: Any, retrieved_table_names: Sequence[Any]
) -> dict[str, str]:
    source_tables = _extract_template_source_tables(selected_template)
    available_table_names = [
        str(table_name).strip()
        for table_name in retrieved_table_names
        if str(table_name).strip()
    ]
    lowered_available_names = {
        table_name.lower(): table_name for table_name in available_table_names
    }

    resolved_mapping: dict[str, str] = {}
    for source_table_name in source_tables:
        lowered_source_table_name = source_table_name.lower()
        exact_match = lowered_available_names.get(lowered_source_table_name)
        if exact_match:
            resolved_mapping[source_table_name] = exact_match
            continue

        suffix_matches = [
            table_name
            for table_name in available_table_names
            if table_name.lower().endswith(f"_{lowered_source_table_name}")
            or table_name.lower().endswith(f".{lowered_source_table_name}")
        ]
        if len(suffix_matches) == 1:
            resolved_mapping[source_table_name] = suffix_matches[0]

    inferred_prefix: Optional[str] = None
    for logical_table_name, physical_table_name in resolved_mapping.items():
        if physical_table_name.lower().endswith(logical_table_name.lower()):
            candidate_prefix = physical_table_name[: -len(logical_table_name)]
            if candidate_prefix.endswith(("_", ".")):
                if inferred_prefix is None:
                    inferred_prefix = candidate_prefix
                elif inferred_prefix != candidate_prefix:
                    inferred_prefix = None
                    break

    if inferred_prefix is None and available_table_names:
        common_prefix = os.path.commonprefix(available_table_names)
        separator_index = max(common_prefix.rfind("_"), common_prefix.rfind("."))
        if separator_index >= 0:
            candidate_prefix = common_prefix[: separator_index + 1]
            if candidate_prefix:
                inferred_prefix = candidate_prefix

    if inferred_prefix:
        for source_table_name in source_tables:
            if source_table_name in resolved_mapping or "." in source_table_name:
                continue
            resolved_mapping[source_table_name] = (
                f"{inferred_prefix}{source_table_name}"
            )

    return resolved_mapping


def ground_template_sql_to_retrieved_tables(
    sql: Optional[str],
    *,
    selected_template: Any,
    retrieved_table_names: Sequence[Any],
) -> str:
    if not sql:
        return ""

    grounded_sql = sql
    table_name_mapping = _resolve_template_table_name_mapping(
        selected_template, retrieved_table_names
    )
    for logical_table_name, physical_table_name in sorted(
        table_name_mapping.items(), key=lambda item: len(item[0]), reverse=True
    ):
        grounded_sql = re.sub(
            rf"(?<![A-Za-z0-9_]){re.escape(logical_table_name)}(?![A-Za-z0-9_])",
            physical_table_name,
            grounded_sql,
        )

    return grounded_sql


def _normalize_sql_for_signature(sql: Optional[str]) -> str:
    if not sql:
        return ""
    try:
        formatted = sqlparse.format(sql, strip_comments=True)
    except Exception:
        formatted = sql
    return re.sub(r"\s+", " ", formatted).strip().lower()


def _normalize_sql_expression(value: str) -> str:
    normalized = _normalize_sql_for_signature(value)
    normalized = normalized.replace("`", "").replace('"', "")
    normalized = re.sub(r"\b[a-zA-Z_]\w*\.", "", normalized)
    normalized = re.sub(r"\s*,\s*", ",", normalized)
    normalized = re.sub(r"\s*\(\s*", "(", normalized)
    normalized = re.sub(r"\s*\)\s*", ")", normalized)
    return normalized.strip()


def _extract_cte_names(sql: Optional[str]) -> list[str]:
    normalized = _normalize_sql_for_signature(sql)
    if not normalized.startswith("with "):
        return []
    return re.findall(
        r"(?:with\s+(?:recursive\s+)?|,)\s*([a-zA-Z_]\w*)\s+as\s*\(",
        normalized,
    )


def _count_keyword(sql: Optional[str], keyword_pattern: str) -> int:
    return len(re.findall(keyword_pattern, _normalize_sql_for_signature(sql)))


def _split_sql_expressions(value: str) -> list[str]:
    expressions: list[str] = []
    current: list[str] = []
    depth = 0
    quote: str | None = None

    for char in value:
        if quote:
            current.append(char)
            if char == quote:
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
            depth = max(0, depth - 1)
            current.append(char)
            continue
        if char == "," and depth == 0:
            expression = "".join(current).strip()
            if expression:
                expressions.append(expression)
            current = []
            continue
        current.append(char)

    expression = "".join(current).strip()
    if expression:
        expressions.append(expression)
    return expressions


def _extract_clause_expressions(sql: Optional[str], clause: str) -> list[str]:
    normalized = _normalize_sql_for_signature(sql)
    if not normalized:
        return []
    pattern = (
        rf"\b{clause}\b\s+(.+?)"
        r"(?=\s+\bhaving\b|\s+\border\s+by\b|\s+\bqualify\b|\s+\blimit\b|"
        r"\s+\bunion\b|\s+\bexcept\b|\s+\bintersect\b|$)"
    )
    expressions: list[str] = []
    for match in re.finditer(pattern, normalized, flags=re.IGNORECASE):
        expressions.extend(
            _normalize_sql_expression(expression)
            for expression in _split_sql_expressions(match.group(1))
            if _normalize_sql_expression(expression)
        )
    return expressions


def _extract_source_tables(sql: Optional[str]) -> list[str]:
    normalized = _normalize_sql_for_signature(sql)
    if not normalized:
        return []

    source_tables: list[str] = []
    for match in re.finditer(
        r"\b(?:from|join)\s+(?!\()([`\"\[]?[a-zA-Z_]\w*(?:[`\"\]]?\.[`\"\[]?[a-zA-Z_]\w*){0,2})",
        normalized,
        flags=re.IGNORECASE,
    ):
        table_name = match.group(1).strip('`"[]')
        table_name = table_name.replace("`", "").replace('"', "").replace("[", "")
        table_name = table_name.replace("]", "")
        if table_name and table_name not in source_tables:
            source_tables.append(table_name)
    return source_tables


def _extract_aggregate_signature(sql: Optional[str]) -> dict[str, int]:
    normalized = _normalize_sql_for_signature(sql)
    aggregate_counts: dict[str, int] = {}
    for function_name in re.findall(
        r"\b(count|sum|avg|min|max|median|count_if|approx_count_distinct)\s*\(",
        normalized,
        flags=re.IGNORECASE,
    ):
        key = function_name.lower()
        aggregate_counts[key] = aggregate_counts.get(key, 0) + 1
    return dict(sorted(aggregate_counts.items()))


def _normalize_source_table_for_signature(table_name: str) -> str:
    normalized = table_name.strip('`"[]').replace("`", "").replace('"', "")
    normalized = normalized.replace("[", "").replace("]", "").lower()
    normalized = normalized.split(".")[-1]
    parts = [part for part in normalized.split("_") if part]
    for index, part in enumerate(parts):
        if part in {"ods", "dwd", "dws", "ads", "dim", "fact"}:
            return "_".join(parts[index:])
    return normalized


def build_sql_core_signature(sql: Optional[str]) -> dict[str, Any]:
    return {
        "ctes": _extract_cte_names(sql),
        "source_tables": [
            _normalize_source_table_for_signature(table_name)
            for table_name in _extract_source_tables(sql)
        ],
        "group_by": _extract_clause_expressions(sql, "group\\s+by"),
        "aggregates": _extract_aggregate_signature(sql),
        "join_count": _count_keyword(sql, r"\bjoin\b"),
        "case_count": _count_keyword(sql, r"\bcase\b"),
        "window_count": _count_keyword(sql, r"\bover\s*\("),
        "partition_count": _count_keyword(sql, r"\bpartition\s+by\b"),
        "order_count": _count_keyword(sql, r"\border\s+by\b"),
    }


def is_template_core_preserved(
    template_sql: Optional[str], candidate_sql: Optional[str]
) -> bool:
    if not template_sql or not candidate_sql:
        return True

    return build_sql_core_signature(template_sql) == build_sql_core_signature(
        candidate_sql
    )


class NL2SQLToolset:
    def __init__(
        self,
        pipelines: dict[str, BasicPipeline],
        *,
        allow_sql_functions_retrieval: bool = True,
        allow_sql_diagnosis: bool = True,
        allow_sql_knowledge_retrieval: bool = True,
    ):
        self._pipelines = pipelines
        self._allow_sql_functions_retrieval = allow_sql_functions_retrieval
        self._allow_sql_diagnosis = allow_sql_diagnosis
        self._allow_sql_knowledge_retrieval = allow_sql_knowledge_retrieval

    async def retrieve_historical_question(
        self,
        *,
        query: str,
        retrieval_scope_id: Optional[str],
        build_ask_result: ResultBuilder,
    ) -> list[Any]:
        historical_question = await self._pipelines["historical_question"].run(
            query=query,
            runtime_scope_id=retrieval_scope_id,
        )
        historical_question_result = historical_question.get(
            "formatted_output", {}
        ).get("documents", [])[:1]

        return [
            build_ask_result(
                **{
                    "sql": result.get("statement"),
                    "type": "view" if result.get("viewId") else "llm",
                    "viewId": result.get("viewId"),
                }
            )
            for result in historical_question_result
        ]

    async def retrieve_sql_pairs(
        self,
        *,
        query: str,
        retrieval_scope_id: Optional[str],
    ) -> list[Any]:
        result = await self._pipelines["sql_pairs_retrieval"].run(
            query=query,
            runtime_scope_id=retrieval_scope_id,
        )
        return result["formatted_output"].get("documents", [])

    async def retrieve_instructions(
        self,
        *,
        query: str,
        retrieval_scope_id: Optional[str],
    ) -> list[Any]:
        instructions_pipeline = self._pipelines.get("instructions_retrieval")
        if instructions_pipeline is None:
            return []

        result = await instructions_pipeline.run(
            query=query,
            runtime_scope_id=retrieval_scope_id,
            scope="sql",
        )
        return result["formatted_output"].get("documents", [])

    async def classify_intent(
        self,
        *,
        query: str,
        histories: Sequence[AskHistoryLike],
        sql_samples: Sequence[Any],
        instructions: Sequence[Any],
        runtime_scope_id: Optional[str],
        configuration: Any,
    ) -> dict[str, Any]:
        return (
            await self._pipelines["intent_classification"].run(
                query=query,
                histories=histories,
                sql_samples=sql_samples,
                instructions=instructions,
                runtime_scope_id=runtime_scope_id,
                configuration=configuration,
            )
        ).get("post_process", {})

    async def generate_semantic_plan(
        self,
        *,
        query: str,
        histories: Sequence[AskHistoryLike],
        sql_samples: Sequence[Any],
        instructions: Sequence[Any],
        deterministic_plan: Optional[dict[str, Any]],
        configuration: Any,
    ) -> Optional[dict[str, Any]]:
        semantic_plan_pipeline = self._pipelines.get("semantic_plan")
        if semantic_plan_pipeline is None:
            return None

        return (
            await semantic_plan_pipeline.run(
                query=query,
                histories=histories,
                sql_samples=sql_samples,
                instructions=instructions,
                deterministic_plan=deterministic_plan,
                configuration=configuration,
            )
        ).get("post_process", {})

    async def retrieve_schema(
        self,
        *,
        query: str,
        histories: Sequence[AskHistoryLike],
        runtime_scope_id: Optional[str],
        enable_column_pruning: bool,
    ) -> dict[str, Any]:
        return await self._pipelines["db_schema_retrieval"].run(
            query=query,
            histories=histories,
            runtime_scope_id=runtime_scope_id,
            enable_column_pruning=enable_column_pruning,
        )

    async def reason_sql_generation(
        self,
        *,
        query: str,
        contexts: Sequence[Any],
        histories: Sequence[AskHistoryLike],
        sql_samples: Sequence[Any],
        instructions: Sequence[Any],
        configuration: Any,
        query_id: str,
    ) -> Any:
        if histories:
            return (
                await self._pipelines["followup_sql_generation_reasoning"].run(
                    query=query,
                    contexts=contexts,
                    histories=histories,
                    sql_samples=sql_samples,
                    instructions=instructions,
                    configuration=configuration,
                    query_id=query_id,
                )
            ).get("post_process", {})

        return (
            await self._pipelines["sql_generation_reasoning"].run(
                query=query,
                contexts=contexts,
                sql_samples=sql_samples,
                instructions=instructions,
                configuration=configuration,
                query_id=query_id,
            )
        ).get("post_process", {})

    async def retrieve_sql_functions(self, *, runtime_scope_id: Optional[str]) -> Any:
        if not self._allow_sql_functions_retrieval:
            return []
        return await self._pipelines["sql_functions_retrieval"].run(
            runtime_scope_id=runtime_scope_id
        )

    async def retrieve_sql_knowledge(self, *, runtime_scope_id: Optional[str]) -> Any:
        if not self._allow_sql_knowledge_retrieval:
            return None
        return await self._pipelines["sql_knowledge_retrieval"].run(
            runtime_scope_id=runtime_scope_id
        )

    async def generate_sql(
        self,
        *,
        query: str,
        contexts: Sequence[Any],
        sql_generation_reasoning: Any,
        histories: Sequence[AskHistoryLike],
        runtime_scope_id: Optional[str],
        sql_samples: Sequence[Any],
        instructions: Sequence[Any],
        has_calculated_field: bool,
        has_metric: bool,
        has_json_field: bool,
        sql_functions: Any,
        use_dry_plan: bool,
        allow_dry_plan_fallback: bool,
        sql_knowledge: Any,
        allow_data_preview: bool = False,
    ) -> dict[str, Any]:
        if histories:
            return await self._pipelines["followup_sql_generation"].run(
                query=query,
                contexts=contexts,
                sql_generation_reasoning=sql_generation_reasoning,
                histories=histories,
                runtime_scope_id=runtime_scope_id,
                sql_samples=sql_samples,
                instructions=instructions,
                has_calculated_field=has_calculated_field,
                has_metric=has_metric,
                has_json_field=has_json_field,
                sql_functions=sql_functions,
                use_dry_plan=use_dry_plan,
                allow_dry_plan_fallback=allow_dry_plan_fallback,
                sql_knowledge=sql_knowledge,
                allow_data_preview=allow_data_preview,
            )

        return await self._pipelines["sql_generation"].run(
            query=query,
            contexts=contexts,
            sql_generation_reasoning=sql_generation_reasoning,
            runtime_scope_id=runtime_scope_id,
            sql_samples=sql_samples,
            instructions=instructions,
            has_calculated_field=has_calculated_field,
            has_metric=has_metric,
            has_json_field=has_json_field,
            sql_functions=sql_functions,
            use_dry_plan=use_dry_plan,
            allow_dry_plan_fallback=allow_dry_plan_fallback,
            sql_knowledge=sql_knowledge,
            allow_data_preview=allow_data_preview,
        )

    async def generate_sql_candidates(
        self,
        *,
        query: str,
        contexts: Sequence[Any],
        sql_generation_reasoning: Any,
        histories: Sequence[AskHistoryLike],
        runtime_scope_id: Optional[str],
        sql_samples: Sequence[Any],
        instructions: Sequence[Any],
        has_calculated_field: bool,
        has_metric: bool,
        has_json_field: bool,
        sql_functions: Any,
        use_dry_plan: bool,
        allow_dry_plan_fallback: bool,
        sql_knowledge: Any,
        candidate_count: int,
    ) -> list[dict[str, Any]]:
        candidate_count = max(
            1, min(candidate_count, len(SQL_GENERATION_STRATEGY_HINTS))
        )

        async def _run_candidate(
            index: int,
            strategy_name: str,
            strategy_hint: str,
        ) -> Optional[dict[str, Any]]:
            candidate_instructions = [
                *list(instructions or []),
                _build_sql_generation_candidate_instruction(
                    candidate_index=index + 1,
                    candidate_count=candidate_count,
                    strategy_name=strategy_name,
                    strategy_hint=strategy_hint,
                ),
            ]
            try:
                result = await self.generate_sql(
                    query=query,
                    contexts=contexts,
                    sql_generation_reasoning=sql_generation_reasoning,
                    histories=histories,
                    runtime_scope_id=runtime_scope_id,
                    sql_samples=sql_samples,
                    instructions=candidate_instructions,
                    has_calculated_field=has_calculated_field,
                    has_metric=has_metric,
                    has_json_field=has_json_field,
                    sql_functions=sql_functions,
                    use_dry_plan=use_dry_plan,
                    allow_dry_plan_fallback=allow_dry_plan_fallback,
                    sql_knowledge=sql_knowledge,
                )
                result["candidate_strategy"] = strategy_name
                result["candidate_index"] = index
                return result
            except Exception as exc:
                logger.warning(
                    "SQL generation candidate failed; trying remaining candidates: %s",
                    exc,
                    exc_info=True,
                )
                return None

        results = await asyncio.gather(
            *[
                _run_candidate(index, strategy_name, strategy_hint)
                for index, (strategy_name, strategy_hint) in enumerate(
                    SQL_GENERATION_STRATEGY_HINTS[:candidate_count]
                )
            ]
        )
        return [result for result in results if result]

    async def preview_sql_execution(
        self,
        *,
        sql: str,
        runtime_scope_id: Optional[str],
        limit: int = 20,
    ) -> dict[str, Any]:
        sql_generation_pipeline = self._pipelines.get(
            "followup_sql_generation"
        ) or self._pipelines.get("sql_generation")
        components = getattr(sql_generation_pipeline, "_components", {}) or {}
        post_processor = (
            components.get("post_processor") if isinstance(components, dict) else None
        )
        engine = getattr(post_processor, "_engine", None)
        if engine is None:
            return {"success": False, "result": None, "error": "engine_unavailable"}

        async with aiohttp.ClientSession() as session:
            success, result, addition = await engine.execute_sql(
                sql,
                session,
                runtime_scope_id=runtime_scope_id,
                dry_run=False,
                limit=limit,
                sql_mode="dialect",
            )
        return {
            "success": success,
            "result": result,
            "signature": _build_execution_result_signature(result),
            "error": (addition or {}).get("error_message", ""),
            "correlation_id": (addition or {}).get("correlation_id", ""),
        }

    async def select_best_sql_generation_result(
        self,
        generation_results: Sequence[dict[str, Any]],
        *,
        runtime_scope_id: Optional[str],
        template_sql: Optional[str] = None,
    ) -> tuple[Optional[dict[str, Any]], Optional[dict[str, Any]]]:
        first_invalid_result: Optional[dict[str, Any]] = None
        valid_candidates: list[dict[str, Any]] = []
        seen_sql: set[str] = set()
        for generation_result in generation_results:
            post_process = generation_result.get("post_process") or {}
            valid_generation_result = post_process.get("valid_generation_result") or {}
            if valid_generation_result:
                sql = str(valid_generation_result.get("sql") or "").strip()
                normalized_sql = _normalize_sql_for_signature(sql)
                if sql and normalized_sql not in seen_sql:
                    seen_sql.add(normalized_sql)
                    valid_candidates.append(generation_result)
                continue

            invalid_generation_result = (
                post_process.get("invalid_generation_result") or {}
            )
            if invalid_generation_result and first_invalid_result is None:
                first_invalid_result = invalid_generation_result

        if not valid_candidates:
            return None, first_invalid_result

        if len(valid_candidates) == 1:
            return valid_candidates[0], first_invalid_result

        preview_results = await asyncio.gather(
            *[
                self.preview_sql_execution(
                    sql=str(
                        (candidate.get("post_process") or {})
                        .get("valid_generation_result", {})
                        .get("sql")
                        or ""
                    ),
                    runtime_scope_id=runtime_scope_id,
                )
                for candidate in valid_candidates
            ],
            return_exceptions=True,
        )
        vote_counts: dict[str, int] = {}
        preview_metadata: list[dict[str, Any]] = []
        for preview_result in preview_results:
            if isinstance(preview_result, Exception):
                metadata = {
                    "success": False,
                    "signature": {},
                    "error": str(preview_result),
                }
            else:
                metadata = preview_result
            key = (
                _execution_signature_key(metadata.get("signature") or {})
                if metadata.get("success")
                else ""
            )
            if key:
                vote_counts[key] = vote_counts.get(key, 0) + 1
            preview_metadata.append(metadata)

        best_result: Optional[dict[str, Any]] = None
        best_score = float("-inf")
        for index, candidate in enumerate(valid_candidates):
            valid_generation_result = (candidate.get("post_process") or {}).get(
                "valid_generation_result",
                {},
            )
            sql = str(valid_generation_result.get("sql") or "")
            metadata = preview_metadata[index]
            signature_key = (
                _execution_signature_key(metadata.get("signature") or {})
                if metadata.get("success")
                else ""
            )
            score = _score_sql_generation_candidate(
                sql=sql,
                candidate_index=int(candidate.get("candidate_index") or index),
                execution_success=bool(metadata.get("success")),
                execution_vote_count=vote_counts.get(signature_key, 0),
                template_sql=template_sql,
            )
            candidate["execution_vote"] = {
                "success": bool(metadata.get("success")),
                "vote_count": vote_counts.get(signature_key, 0),
                "signature": metadata.get("signature") or {},
                "error": metadata.get("error") or "",
                "score": score,
            }
            if best_result is None or score > best_score:
                best_score = score
                best_result = candidate

        return best_result, first_invalid_result

    async def diagnose_sql(
        self,
        *,
        contexts: Sequence[Any],
        original_sql: str,
        invalid_sql: str,
        error_message: str,
        language: Optional[str],
    ) -> Optional[str]:
        if not self._allow_sql_diagnosis:
            return None

        try:
            sql_diagnosis_results = await self._pipelines["sql_diagnosis"].run(
                contexts=contexts,
                original_sql=original_sql,
                invalid_sql=invalid_sql,
                error_message=error_message,
                language=language,
            )
        except Exception as exc:
            logger.warning(
                "SQL diagnosis failed; continuing SQL correction with the original validation error: %s",
                exc,
                exc_info=True,
            )
            return None

        return sql_diagnosis_results["post_process"].get("reasoning")

    async def correct_sql(
        self,
        *,
        contexts: Sequence[Any],
        instructions: Sequence[Any],
        invalid_generation_result: dict[str, Any],
        runtime_scope_id: Optional[str],
        use_dry_plan: bool,
        allow_dry_plan_fallback: bool,
        sql_functions: Any,
        sql_knowledge: Any,
    ) -> dict[str, Any]:
        return await self._pipelines["sql_correction"].run(
            contexts=contexts,
            instructions=instructions,
            invalid_generation_result=invalid_generation_result,
            runtime_scope_id=runtime_scope_id,
            use_dry_plan=use_dry_plan,
            allow_dry_plan_fallback=allow_dry_plan_fallback,
            sql_functions=sql_functions,
            sql_knowledge=sql_knowledge,
        )

    async def correct_sql_candidates(
        self,
        *,
        contexts: Sequence[Any],
        instructions: Sequence[Any],
        invalid_generation_results: Sequence[dict[str, Any]],
        runtime_scope_id: Optional[str],
        use_dry_plan: bool,
        allow_dry_plan_fallback: bool,
        sql_functions: Any,
        sql_knowledge: Any,
    ) -> list[dict[str, Any]]:
        async def _run_candidate(
            invalid_generation_result: dict[str, Any],
        ) -> Optional[dict[str, Any]]:
            try:
                return await self.correct_sql(
                    contexts=contexts,
                    instructions=instructions,
                    invalid_generation_result=invalid_generation_result,
                    runtime_scope_id=runtime_scope_id,
                    use_dry_plan=use_dry_plan,
                    allow_dry_plan_fallback=allow_dry_plan_fallback,
                    sql_functions=sql_functions,
                    sql_knowledge=sql_knowledge,
                )
            except Exception as exc:
                logger.warning(
                    "SQL correction candidate failed; trying remaining candidates: %s",
                    exc,
                    exc_info=True,
                )
                return None

        results = await asyncio.gather(
            *[
                _run_candidate(invalid_generation_result)
                for invalid_generation_result in invalid_generation_results
            ]
        )
        return [result for result in results if result]

    async def validate_template_sql(
        self,
        *,
        sql: str,
        runtime_scope_id: Optional[str],
        use_dry_plan: bool,
        allow_dry_plan_fallback: bool,
    ) -> dict[str, Any]:
        validation_pipeline = self._pipelines.get("template_sql_validation")
        if validation_pipeline is not None:
            return await validation_pipeline.run(
                sql=sql,
                runtime_scope_id=runtime_scope_id,
                use_dry_plan=use_dry_plan,
                allow_dry_plan_fallback=allow_dry_plan_fallback,
                sql_mode="dialect",
            )

        sql_generation_pipeline = self._pipelines.get(
            "followup_sql_generation"
        ) or self._pipelines.get("sql_generation")
        components = getattr(sql_generation_pipeline, "_components", {}) or {}
        post_processor = (
            components.get("post_processor") if isinstance(components, dict) else None
        )
        if post_processor is None:
            return {
                "valid_generation_result": {"sql": sql, "correlation_id": ""},
                "invalid_generation_result": {},
            }

        data_source = ""
        retriever = getattr(sql_generation_pipeline, "_retriever", None)
        if retriever is not None and use_dry_plan:
            data_source = await retrieve_data_source(runtime_scope_id, retriever)

        return await post_processor.run(
            [sql],
            runtime_scope_id=runtime_scope_id,
            use_dry_plan=use_dry_plan,
            allow_dry_plan_fallback=allow_dry_plan_fallback,
            data_source=data_source,
            allow_data_preview=False,
            sql_mode="dialect",
        )


class BaseFixedOrderAskRuntime:
    def __init__(
        self,
        *,
        toolset: NL2SQLToolset,
        mixed_answer_composer: Optional[MixedAnswerComposer] = None,
        allow_intent_classification: bool = True,
        allow_sql_generation_reasoning: bool = True,
        semantic_plan_mode: Optional[str] = None,
        allow_semantic_plan_llm: bool = False,
        ask_policy_file: Optional[str] = None,
        enable_column_pruning: bool = False,
        max_sql_correction_retries: int = 3,
    ):
        self._toolset = toolset
        self._mixed_answer_composer = mixed_answer_composer or MixedAnswerComposer()
        self._allow_intent_classification = allow_intent_classification
        self._allow_sql_generation_reasoning = allow_sql_generation_reasoning
        self._semantic_plan_mode = normalize_semantic_plan_mode(
            semantic_plan_mode,
            allow_semantic_plan_llm=allow_semantic_plan_llm,
        )
        self._allow_semantic_plan_llm = self._semantic_plan_mode in {
            "shadow",
            "enhanced",
        }
        self._ask_policy_file = ask_policy_file
        self._ask_policy_config = load_ask_policy_config(ask_policy_file)
        self._enable_column_pruning = enable_column_pruning
        self._max_sql_correction_retries = max_sql_correction_retries

    def _attach_result_metadata(
        self,
        result: dict[str, Any],
        *,
        ask_path: Optional[str],
        orchestrator: str,
        template_decision: Optional[dict[str, Any]] = None,
        semantic_plan: Optional[dict[str, Any]] = None,
        clarification_state: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        metadata = result.setdefault("metadata", {})
        metadata["orchestrator"] = orchestrator
        if ask_path:
            metadata["ask_path"] = ask_path
        if template_decision:
            metadata["template_decision"] = template_decision
        if semantic_plan:
            metadata["semantic_plan"] = semantic_plan
        if clarification_state:
            metadata["clarification_state"] = clarification_state
        return result

    def _resolve_text_to_sql_path(
        self,
        *,
        histories: Sequence[AskHistoryLike],
        sql_samples: Sequence[Any],
        instructions: Sequence[Any],
        current_sql_correction_retries: int,
    ) -> str:
        if current_sql_correction_retries > 0:
            return "correction"
        if histories:
            return "followup"
        if sql_samples:
            return "sql_pairs"
        if instructions:
            return "instructions"
        return "nl2sql"

    def _build_initial_state(self, ask_request: AskRequestLike) -> AskExecutionState:
        return AskExecutionState(
            user_query=ask_request.query,
            slot_values=dict(getattr(ask_request, "slot_values", {}) or {}),
        )

    def _sync_semantic_plan_state(
        self,
        state: AskExecutionState,
        *,
        histories: Sequence[AskHistoryLike],
        intent: Optional[str] = None,
        route_override: Optional[str] = None,
        reason_codes: Sequence[str] | None = None,
        external_dependencies: Sequence[str] | None = None,
    ) -> None:
        state.semantic_plan = build_minimal_semantic_plan(
            state.user_query,
            histories=histories,
            template_decision=state.template_decision,
            resolved_slot_values=state.slot_values,
            intent=intent,
            route_override=route_override,
            reason_codes=reason_codes,
            external_dependencies=external_dependencies,
        )

    def _append_semantic_plan_reason(
        self, state: AskExecutionState, reason: str
    ) -> None:
        if state.semantic_plan is None:
            return
        decision = state.semantic_plan.setdefault("decision", {})
        reason_codes = decision.setdefault("reason_codes", [])
        if reason not in reason_codes:
            reason_codes.append(reason)

    def _merge_llm_semantic_plan(
        self,
        *,
        deterministic_plan: dict[str, Any],
        llm_plan: dict[str, Any],
    ) -> dict[str, Any]:
        merged = {
            **deterministic_plan,
            **llm_plan,
            "version": "p1_semantic_plan_enhanced_v1",
            "source": "llm_enhanced",
        }
        merged["filters"] = {
            **(deterministic_plan.get("filters") or {}),
            **(llm_plan.get("filters") or {}),
        }
        merged["resolved_slots"] = {
            **(deterministic_plan.get("resolved_slots") or {}),
            **(llm_plan.get("resolved_slots") or {}),
        }

        deterministic_missing_slots = deterministic_plan.get("missing_slots") or []
        llm_missing_slots = llm_plan.get("missing_slots") or []
        merged["missing_slots"] = list(
            dict.fromkeys([*deterministic_missing_slots, *llm_missing_slots])
        )
        if deterministic_plan.get("missing_slot_details"):
            merged["missing_slot_details"] = deterministic_plan.get(
                "missing_slot_details"
            )
        if deterministic_plan.get("clarification_request"):
            merged["clarification_request"] = deterministic_plan.get(
                "clarification_request"
            )

        deterministic_decision = deterministic_plan.get("decision") or {}
        llm_decision = llm_plan.get("decision") or {}
        reason_codes = list(
            dict.fromkeys(
                [
                    *(deterministic_decision.get("reason_codes") or []),
                    *(llm_decision.get("reason_codes") or []),
                    "llm_semantic_plan_applied",
                ]
            )
        )
        merged["decision"] = {
            **deterministic_decision,
            **llm_decision,
            # Route is a safety decision derived from deterministic guards
            # (template lifecycle, required slots, external dependencies,
            # policy).  The LLM plan may enrich subject/metric/grain, but it
            # must not silently relax or upgrade the route.
            "route": deterministic_decision.get("route") or llm_decision.get("route"),
            "reason_codes": reason_codes,
            "missing_slots": merged["missing_slots"],
            "resolved_slots": merged["resolved_slots"],
            "candidate_templates": deterministic_decision.get("candidate_templates")
            or llm_decision.get("candidate_templates")
            or [],
        }
        return merged

    async def _maybe_enhance_semantic_plan_state(
        self,
        state: AskExecutionState,
        *,
        histories: Sequence[AskHistoryLike],
        configuration: Any,
    ) -> None:
        if not self._allow_semantic_plan_llm:
            return
        if state.semantic_plan is None:
            return

        deterministic_plan = state.semantic_plan
        try:
            llm_plan = await self._toolset.generate_semantic_plan(
                query=state.user_query,
                histories=histories,
                sql_samples=state.sql_samples,
                instructions=state.instructions,
                deterministic_plan=deterministic_plan,
                configuration=configuration,
            )
        except Exception:
            logger.exception("SemanticPlan LLM enhancement failed.")
            self._append_semantic_plan_reason(state, "llm_semantic_plan_failed")
            return

        if not llm_plan:
            self._append_semantic_plan_reason(state, "llm_semantic_plan_unavailable")
            return

        if self._semantic_plan_mode == "shadow":
            state.semantic_plan["llm_shadow_plan"] = llm_plan
            state.semantic_plan["semantic_plan_mode"] = "shadow"
            self._append_semantic_plan_reason(state, "llm_semantic_plan_shadowed")
            return

        state.semantic_plan = self._merge_llm_semantic_plan(
            deterministic_plan=deterministic_plan,
            llm_plan=llm_plan,
        )
        state.semantic_plan["semantic_plan_mode"] = "enhanced"

    def _apply_policy_state(
        self,
        state: AskExecutionState,
        *,
        request_policy: Optional[dict[str, Any]] = None,
    ) -> None:
        request_policy_config = (
            coerce_ask_policy_config(request_policy) if request_policy else None
        )
        policy_config = request_policy_config or self._ask_policy_config
        evaluation = evaluate_policy_context(
            query=state.user_query,
            semantic_plan=state.semantic_plan,
            template_decision=state.template_decision,
            config=policy_config,
        )
        metadata = evaluation.to_metadata()

        if state.semantic_plan is not None:
            decision = state.semantic_plan.setdefault("decision", {})
            decision.update(metadata)
            reason_codes = decision.setdefault("reason_codes", [])
            for reason_code in metadata["policy_reason_codes"]:
                if reason_code not in reason_codes:
                    reason_codes.append(reason_code)
            missing_required_slots = metadata["policy_missing_required_slots"]
            if missing_required_slots:
                missing_slots = state.semantic_plan.setdefault("missing_slots", [])
                for slot in missing_required_slots:
                    if slot not in missing_slots:
                        missing_slots.append(slot)
                decision["route"] = "clarification_required"
                decision["missing_slots"] = missing_slots
                if "missing_required_slot" not in reason_codes:
                    reason_codes.append("missing_required_slot")

                existing_details = {
                    detail.get("slot")
                    for detail in state.semantic_plan.get("missing_slot_details", [])
                    if isinstance(detail, dict)
                }
                policy_slot_details = [
                    detail
                    for detail in _build_slot_details(
                        missing_required_slots,
                        source="ask_policy",
                    )
                    if detail["slot"] not in existing_details
                ]
                if policy_slot_details:
                    state.semantic_plan.setdefault("missing_slot_details", []).extend(
                        policy_slot_details
                    )

                if not state.semantic_plan.get("clarification_request"):
                    state.semantic_plan["clarification_request"] = (
                        _build_policy_clarification_request(missing_required_slots)
                    )

        if state.template_decision is not None:
            state.template_decision.update(metadata)

        if evaluation.blocks_template and state.template_decision is not None:
            state.template_decision["fallback_reason"] = "policy_forbidden_template"
            state.template_decision["sql_source"] = "generated"
            if state.template_decision.get("mode") in {
                "anchored_template",
                "executable_template",
            }:
                state.template_decision["mode"] = "reference"
            if (
                state.semantic_plan is not None
                and not metadata["policy_missing_required_slots"]
            ):
                decision = state.semantic_plan.setdefault("decision", {})
                decision["route"] = "normal_text_to_sql"
                decision["fallback_reason"] = "policy_forbidden_template"

    def _build_policy_missing_slot_requirement(
        self, state: AskExecutionState
    ) -> Optional[dict[str, Any]]:
        decision = (
            state.semantic_plan.get("decision")
            if isinstance(state.semantic_plan, dict)
            else {}
        ) or {}
        missing_slots = list(
            decision.get("policy_missing_required_slots")
            or (state.template_decision or {}).get("policy_missing_required_slots")
            or []
        )
        if not missing_slots:
            return None

        return {
            "slot": (
                missing_slots[0]
                if len(missing_slots) == 1
                else "ask_policy_required_slots"
            ),
            "missing_parameters": missing_slots,
            "content": _build_policy_clarification_prompt(missing_slots),
            "reasoning": "问数策略要求补充必填业务槽位："
            + "、".join(missing_slots)
            + "。",
        }

    def _extract_general_answer_content(
        self, pipeline_result: Any, *, pipeline_name: str
    ) -> Optional[str]:
        def _extract(value: Any) -> Optional[str]:
            if value is None:
                return None

            if isinstance(value, str):
                normalized = value.strip()
                return normalized or None

            if isinstance(value, dict):
                if isinstance(value.get("replies"), list):
                    for reply in value["replies"]:
                        extracted = _extract(reply)
                        if extracted:
                            return extracted

                if pipeline_name in value:
                    extracted = _extract(value[pipeline_name])
                    if extracted:
                        return extracted

                for key in ("content", "message", "answer"):
                    if key in value:
                        extracted = _extract(value[key])
                        if extracted:
                            return extracted

                for nested_value in value.values():
                    extracted = _extract(nested_value)
                    if extracted:
                        return extracted

                return None

            if isinstance(value, (list, tuple)):
                for item in value:
                    extracted = _extract(item)
                    if extracted:
                        return extracted

            return None

        return _extract(pipeline_result)

    def _schedule_general_result_completion(
        self,
        *,
        pipeline_name: str,
        pipeline_kwargs: dict[str, Any],
        state: AskExecutionState,
        general_type: str,
        trace_id: Optional[str],
        is_followup: bool,
        is_stopped: StopChecker,
        set_result: ResultUpdater,
        build_ask_error: ResultBuilder,
    ) -> None:
        async def _runner():
            try:
                pipeline_result = await self._toolset._pipelines[pipeline_name].run(
                    **pipeline_kwargs
                )
                content = self._extract_general_answer_content(
                    pipeline_result,
                    pipeline_name=pipeline_name,
                )
                if not is_stopped():
                    set_result(
                        status="finished",
                        type="GENERAL",
                        rephrased_question=state.rephrased_question,
                        intent_reasoning=state.intent_reasoning,
                        content=content,
                        trace_id=trace_id,
                        is_followup=is_followup,
                        general_type=general_type,
                        ask_path=state.ask_path,
                        template_decision=state.template_decision,
                        semantic_plan=state.semantic_plan,
                    )
            except Exception as exc:
                logger.exception("general assistance pipeline - OTHERS: %s", exc)
                if not is_stopped():
                    set_result(
                        status="failed",
                        type="GENERAL",
                        rephrased_question=state.rephrased_question,
                        intent_reasoning=state.intent_reasoning,
                        content=state.intent_reasoning,
                        trace_id=trace_id,
                        is_followup=is_followup,
                        general_type=general_type,
                        ask_path=state.ask_path,
                        template_decision=state.template_decision,
                        semantic_plan=state.semantic_plan,
                        error=build_ask_error(code="OTHERS", message=str(exc)),
                    )

        asyncio.create_task(_runner())

    def _sync_template_decision_state_metrics(
        self,
        state: AskExecutionState,
        *,
        dialect_compatible: Optional[bool] = None,
        dry_run_compatible: Optional[bool] = None,
        schema_compatible: Optional[bool] = None,
        validation_error: Optional[str] = None,
    ) -> None:
        _update_template_runtime_metrics(
            state.template_decision,
            correction_retries=state.current_sql_correction_retries,
            dialect_compatible=dialect_compatible,
            dry_run_compatible=dry_run_compatible,
            instruction_count=len(state.instructions),
            retrieved_ddl_count=len(state.table_ddls),
            retrieved_table_count=len(state.table_names),
            schema_compatible=schema_compatible,
            validation_error=validation_error,
        )

    def _build_template_decision_state(
        self,
        state: AskExecutionState,
        *,
        histories: Sequence[AskHistoryLike],
    ) -> None:
        state.sql_samples, inactive_template_sample = filter_active_sql_samples(
            state.sql_samples
        )
        state.template_decision = build_template_decision(
            state.sql_samples,
            state.user_query,
            histories=histories,
            inactive_sample=inactive_template_sample,
        )
        self._sync_template_decision_state_metrics(state)

    async def _prepare_guidance_state(
        self,
        state: AskExecutionState,
        *,
        ask_request: AskRequestLike,
        histories: Sequence[AskHistoryLike],
        retrieval_scope_id: Optional[str],
    ) -> None:
        retrieval_query, state.sql_samples, state.instructions = (
            await self._retrieve_guidance_candidates(
                query=state.user_query,
                histories=histories,
                retrieval_scope_id=retrieval_scope_id,
            )
        )
        state.sql_samples = rerank_sql_samples(
            retrieval_query,
            state.sql_samples,
            histories=histories,
        )
        self._build_template_decision_state(
            state,
            histories=histories,
        )
        self._sync_semantic_plan_state(state, histories=histories)
        await self._maybe_enhance_semantic_plan_state(
            state,
            histories=histories,
            configuration=ask_request.configurations,
        )
        self._apply_policy_state(
            state,
            request_policy=getattr(ask_request, "ask_policy", None),
        )
        state.effective_instructions = [
            *state.instructions,
            *build_template_instruction(state.template_decision),
            *extract_skill_instructions(ask_request.skills),
        ]

    async def _maybe_prepare_direct_template_sql(
        self,
        *,
        state: AskExecutionState,
        ask_request: AskRequestLike,
        histories: Sequence[AskHistoryLike],
        runtime_scope_id: Optional[str],
        enable_column_pruning: bool,
        build_ask_result: ResultBuilder,
    ) -> None:
        if (
            state.api_results
            or not state.sql_samples
            or not can_reuse_template_sql(state.template_decision)
        ):
            return

        if not state.retrieval_result:
            retrieval_response = await self._toolset.retrieve_schema(
                query=state.user_query,
                histories=histories,
                runtime_scope_id=runtime_scope_id,
                enable_column_pruning=enable_column_pruning,
            )
            state.retrieval_result = retrieval_response.get(
                "construct_retrieval_results", {}
            )

        selected_template = state.sql_samples[0]
        documents = state.retrieval_result.get("retrieval_results", [])
        state.table_names = [document.get("table_name") for document in documents]
        state.table_ddls = [document.get("table_ddl") for document in documents]
        if not state.table_names:
            state.table_names = _extract_template_source_tables(selected_template)
        has_schema_support = bool(documents or state.table_names)
        self._sync_template_decision_state_metrics(
            state,
            schema_compatible=has_schema_support,
        )

        if not has_schema_support:
            if state.template_decision:
                state.template_decision["fallback_reason"] = (
                    "template_schema_retrieval_insufficient"
                )
                state.template_decision["sql_source"] = "generated"
            return

        rendered_sql = build_reusable_template_sql(
            selected_template, state.template_decision
        )
        grounded_sql = ground_template_sql_to_retrieved_tables(
            rendered_sql,
            selected_template=selected_template,
            retrieved_table_names=state.table_names,
        )
        validation_result = await self._toolset.validate_template_sql(
            sql=grounded_sql,
            runtime_scope_id=runtime_scope_id,
            use_dry_plan=ask_request.use_dry_plan,
            allow_dry_plan_fallback=ask_request.allow_dry_plan_fallback,
        )
        valid_generation_result = validation_result.get("valid_generation_result") or {}
        invalid_generation_result = (
            validation_result.get("invalid_generation_result") or {}
        )

        if valid_generation_result:
            self._sync_template_decision_state_metrics(
                state,
                schema_compatible=True,
                dry_run_compatible=True,
                dialect_compatible=True,
            )
            state.ask_path = "sql_pairs"
            state.api_results = [
                build_ask_result(
                    **{
                        "sql": valid_generation_result.get("sql") or grounded_sql,
                        "type": "sql_pair",
                        "sqlpairId": _get_sample_value(selected_template, "id"),
                    }
                )
            ]
            return

        if state.template_decision:
            state.template_decision["fallback_reason"] = "template_dry_run_failed"
            state.template_decision["sql_source"] = "generated"
        self._sync_template_decision_state_metrics(
            state,
            schema_compatible=True,
            dry_run_compatible=False,
            dialect_compatible=False,
            validation_error=(
                str(invalid_generation_result.get("error"))
                if invalid_generation_result.get("error")
                else None
            ),
        )

    async def _retrieve_guidance_candidates(
        self,
        *,
        query: str,
        histories: Sequence[AskHistoryLike],
        retrieval_scope_id: Optional[str],
    ) -> tuple[str, list[Any], list[Any]]:
        retrieval_query = _build_retrieval_query(query, histories)
        sql_samples, instructions = await asyncio.gather(
            self._toolset.retrieve_sql_pairs(
                query=retrieval_query,
                retrieval_scope_id=retrieval_scope_id,
            ),
            self._toolset.retrieve_instructions(
                query=retrieval_query,
                retrieval_scope_id=retrieval_scope_id,
            ),
        )

        latest_history_question = (
            _iter_history_questions(histories)[-1] if histories else None
        )
        if latest_history_question and latest_history_question != retrieval_query:
            history_sql_samples, history_instructions = await asyncio.gather(
                self._toolset.retrieve_sql_pairs(
                    query=latest_history_question,
                    retrieval_scope_id=retrieval_scope_id,
                ),
                self._toolset.retrieve_instructions(
                    query=latest_history_question,
                    retrieval_scope_id=retrieval_scope_id,
                ),
            )
            sql_samples = merge_unique_documents(sql_samples, history_sql_samples)
            instructions = merge_unique_documents(instructions, history_instructions)

        return retrieval_query, sql_samples, instructions

    def _build_thinking_step(
        self,
        *,
        key: str,
        status: str,
        message_params: Optional[dict[str, Any]] = None,
        phase: Optional[str] = None,
        started_at: Optional[str] = None,
        finished_at: Optional[str] = None,
        duration_ms: Optional[int] = None,
        detail: Optional[str] = None,
        error_code: Optional[str] = None,
        tags: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "key": key,
            "status": status,
            "message_key": key,
        }
        if message_params:
            payload["message_params"] = message_params
        if phase:
            payload["phase"] = phase
        if started_at:
            payload["started_at"] = started_at
        if finished_at:
            payload["finished_at"] = finished_at
        if duration_ms is not None:
            payload["duration_ms"] = duration_ms
        if detail:
            payload["detail"] = detail
        if error_code:
            payload["error_code"] = error_code
        if tags:
            payload["tags"] = tags
        return payload

    def _build_text_to_sql_thinking(
        self,
        *,
        state: AskExecutionState,
        status: str,
    ) -> dict[str, Any]:
        template_sql_source = (state.template_decision or {}).get("sql_source")
        is_direct_template_sql = (
            bool(state.template_decision)
            and template_sql_source in {"anchored_template", "rendered_template"}
            and not (state.template_decision or {}).get("missing_parameters")
        )
        retrieval_finished = bool(
            state.intent_reasoning
            or state.rephrased_question
            or status
            in {
                "searching",
                "planning",
                "generating",
                "correcting",
                "finished",
                "failed",
            }
        )

        sql_pairs_status = (
            "finished"
            if retrieval_finished
            else "running" if status == "understanding" else "pending"
        )
        sql_instructions_status = (
            "finished"
            if retrieval_finished
            else "running" if status == "understanding" else "pending"
        )
        template_decision_status = (
            "finished"
            if state.template_decision
            else "running" if status == "understanding" else "pending"
        )

        intent_status = (
            "running"
            if status == "understanding" and not state.intent_reasoning
            else (
                "finished"
                if state.intent_reasoning
                or status
                in {"searching", "planning", "generating", "correcting", "finished"}
                else "failed" if status == "failed" else "pending"
            )
        )

        candidate_models_status = (
            "running"
            if status == "searching" and not state.table_names
            else (
                "finished"
                if state.table_names
                or status in {"planning", "generating", "correcting", "finished"}
                else "failed" if status == "failed" else "pending"
            )
        )

        sql_reasoned_status = (
            "skipped"
            if is_direct_template_sql and (state.api_results or status == "finished")
            else (
                "running"
                if status == "planning" and not state.sql_generation_reasoning
                else (
                    "finished"
                    if state.sql_generation_reasoning
                    or status in {"generating", "correcting", "finished"}
                    else "failed" if status == "failed" else "pending"
                )
            )
        )

        sql_generated_status = (
            "running"
            if status in {"generating", "correcting"}
            else (
                "finished"
                if state.api_results or status == "finished"
                else "failed" if status == "failed" else "pending"
            )
        )

        steps = [
            self._build_thinking_step(
                key="ask.sql_pairs_retrieved",
                status=sql_pairs_status,
                message_params={"count": len(state.sql_samples)},
                phase="retrieval",
            ),
            self._build_thinking_step(
                key="ask.sql_instructions_retrieved",
                status=sql_instructions_status,
                message_params={"count": len(state.instructions)},
                phase="retrieval",
            ),
            self._build_thinking_step(
                key="ask.template_decision",
                status=template_decision_status,
                message_params={
                    "mode": (state.template_decision or {}).get("mode"),
                    "sqlSource": (state.template_decision or {}).get("sql_source"),
                    "decisionReason": (state.template_decision or {}).get(
                        "decision_reason"
                    ),
                    "fallbackReason": (state.template_decision or {}).get(
                        "fallback_reason"
                    ),
                    "missingParameters": ", ".join(
                        (state.template_decision or {}).get("missing_parameters") or []
                    )
                    or None,
                    "templateTitle": (state.template_decision or {}).get(
                        "template_title"
                    ),
                },
                phase="retrieval",
            ),
            self._build_thinking_step(
                key="ask.intent_recognized",
                status=intent_status,
                phase="intent",
            ),
            self._build_thinking_step(
                key="ask.candidate_models_selected",
                status=candidate_models_status,
                message_params={"count": len(state.table_names)},
                phase="retrieval",
                tags=state.table_names[:6],
            ),
            self._build_thinking_step(
                key="ask.sql_reasoned",
                status=sql_reasoned_status,
                phase="reasoning",
                detail=(
                    "当前 SQL 由已校验模板直接生成，无需额外组织 LLM 分析思路。"
                    if sql_reasoned_status == "skipped"
                    else state.sql_generation_reasoning
                ),
            ),
            self._build_thinking_step(
                key="ask.sql_generated",
                status=sql_generated_status,
                message_params={
                    "correcting": status == "correcting",
                    "retries": state.current_sql_correction_retries,
                },
                phase="generation",
            ),
        ]

        current_step_key = next(
            (step["key"] for step in steps if step["status"] == "running"),
            None,
        ) or next(
            (step["key"] for step in steps if step["status"] == "failed"),
            None,
        )

        return {
            "current_step_key": current_step_key,
            "steps": steps,
        }

    def _build_text_to_sql_result_payload(
        self,
        *,
        state: AskExecutionState,
        status: str,
        trace_id: Optional[str],
        is_followup: bool,
        **payload,
    ) -> dict[str, Any]:
        return {
            "status": status,
            "type": "TEXT_TO_SQL",
            "thinking": self._build_text_to_sql_thinking(
                state=state,
                status=status,
            ),
            "trace_id": trace_id,
            "is_followup": is_followup,
            "template_decision": state.template_decision,
            "semantic_plan": state.semantic_plan,
            **payload,
        }

    async def _maybe_handle_missing_source_rule(
        self,
        *,
        state: AskExecutionState,
        ask_request: AskRequestLike,
        histories: Sequence[AskHistoryLike],
        trace_id: Optional[str],
        is_followup: bool,
        is_stopped: StopChecker,
        set_result: ResultUpdater,
        build_ask_error: ResultBuilder,
        results: dict[str, Any],
        orchestrator: str,
    ) -> Optional[dict[str, Any]]:
        missing_source_requirement = detect_missing_external_source_requirement(
            state.user_query,
            sql_samples=state.sql_samples,
            instructions=state.effective_instructions or state.instructions,
            supplied_external_dependencies=state.slot_values,
        )
        if not missing_source_requirement:
            supplied_instruction = build_supplied_external_dependency_instruction(
                state.slot_values
            )
            if supplied_instruction:
                state.effective_instructions = [
                    *state.effective_instructions,
                    supplied_instruction,
                ]
                if state.semantic_plan is not None:
                    decision = state.semantic_plan.setdefault("decision", {})
                    reason_codes = decision.setdefault("reason_codes", [])
                    if "external_dependency_user_supplied" not in reason_codes:
                        reason_codes.append("external_dependency_user_supplied")
                    decision["provided_external_dependencies"] = (
                        supplied_instruction.get("provided_external_dependencies") or []
                    )

            supplied_coverage = detect_supplied_external_dependency_coverage(
                state.user_query,
                sql_samples=state.sql_samples,
                instructions=state.effective_instructions or state.instructions,
                supplied_external_dependencies=state.slot_values,
            )
            if supplied_coverage:
                if state.semantic_plan is not None:
                    decision = state.semantic_plan.setdefault("decision", {})
                    reason_codes = decision.setdefault("reason_codes", [])
                    if "external_dependency_user_supplied" not in reason_codes:
                        reason_codes.append("external_dependency_user_supplied")
                    decision["external_dependency_coverage"] = supplied_coverage
                    decision["external_dependencies"] = supplied_coverage.get(
                        "required_external_dependencies",
                        [],
                    )
            return None

        state.effective_instructions = [
            *state.effective_instructions,
            missing_source_requirement["instruction"],
        ]
        if state.template_decision is not None:
            state.template_decision["required_external_dependencies"] = (
                missing_source_requirement.get("required_external_dependencies")
                or state.template_decision.get("required_external_dependencies")
                or []
            )
        state.intent_reasoning = missing_source_requirement["reasoning"]
        state.ask_path = "general"
        pending_external_slots = list(
            missing_source_requirement.get("pending_external_dependency_slots") or []
        )
        if pending_external_slots:
            expires_at = datetime.now(UTC) + timedelta(minutes=30)
            clarification_session_id = str(
                getattr(ask_request, "query_id", None) or trace_id or "external-data"
            )
            state.clarification_state = {
                "status": "needs_clarification",
                "clarification_session_id": clarification_session_id,
                "original_question": state.user_query,
                "pending_slots": pending_external_slots,
                "resolved_slots": dict(state.slot_values or {}),
                "expires_at": expires_at.isoformat(),
                "external_dependency_request": missing_source_requirement.get(
                    "external_dependency_request"
                )
                or {},
            }
        self._sync_semantic_plan_state(
            state,
            histories=histories,
            route_override="blocked_missing_external_data",
            reason_codes=["external_dependency_missing"],
            external_dependencies=missing_source_requirement.get(
                "required_external_dependencies"
            )
            or [],
        )
        if state.semantic_plan is not None and state.clarification_state is not None:
            state.semantic_plan["clarification_state"] = state.clarification_state

        if not is_stopped():
            set_result(
                status="generating",
                type="GENERAL",
                rephrased_question=state.rephrased_question,
                intent_reasoning=state.intent_reasoning,
                trace_id=trace_id,
                is_followup=is_followup,
                general_type="DATA_ASSISTANCE",
                ask_path=state.ask_path,
                template_decision=state.template_decision,
                semantic_plan=state.semantic_plan,
                clarification_state=state.clarification_state,
            )
            set_result(
                status="finished",
                type="GENERAL",
                rephrased_question=state.rephrased_question,
                intent_reasoning=state.intent_reasoning,
                content=missing_source_requirement["content"],
                trace_id=trace_id,
                is_followup=is_followup,
                general_type="DATA_ASSISTANCE",
                ask_path=state.ask_path,
                template_decision=state.template_decision,
                semantic_plan=state.semantic_plan,
                clarification_state=state.clarification_state,
            )

        return self._attach_result_metadata(
            self._mixed_answer_composer.compose_general(results),
            ask_path=state.ask_path,
            orchestrator=orchestrator,
            template_decision=state.template_decision,
            semantic_plan=state.semantic_plan,
            clarification_state=state.clarification_state,
        )

    async def _maybe_handle_missing_slot_rule(
        self,
        *,
        state: AskExecutionState,
        query_id: str,
        histories: Sequence[AskHistoryLike],
        trace_id: Optional[str],
        is_followup: bool,
        is_stopped: StopChecker,
        set_result: ResultUpdater,
        results: dict[str, Any],
        orchestrator: str,
    ) -> Optional[dict[str, Any]]:
        missing_slot_requirement = (
            detect_missing_template_parameter_requirement(
                state.user_query,
                state.template_decision,
            )
            or self._build_policy_missing_slot_requirement(state)
            or detect_missing_required_slot_requirement(
                state.user_query,
                histories=histories,
                resolved_slots=state.slot_values,
            )
        )
        if not missing_slot_requirement:
            return None

        missing_parameters = missing_slot_requirement.get("missing_parameters") or []
        if state.template_decision is not None:
            existing_missing_parameters = list(
                state.template_decision.get("missing_parameters") or []
            )
            for parameter in missing_parameters:
                if parameter not in existing_missing_parameters:
                    existing_missing_parameters.append(parameter)
            state.template_decision["missing_parameters"] = existing_missing_parameters
            state.template_decision["fallback_reason"] = "missing_required_slot"
            state.template_decision["sql_source"] = "generated"

        state.intent_reasoning = missing_slot_requirement["reasoning"]
        state.ask_path = "general"
        expires_at = datetime.now(UTC) + timedelta(minutes=30)
        state.clarification_state = {
            "status": "needs_clarification",
            "clarification_session_id": query_id,
            "original_question": state.user_query,
            "pending_slots": missing_parameters,
            "resolved_slots": dict(state.slot_values or {}),
            "expires_at": expires_at.isoformat(),
        }
        self._sync_semantic_plan_state(
            state,
            histories=histories,
            route_override="clarification_required",
            reason_codes=["missing_required_slot"],
        )
        if state.semantic_plan is not None:
            state.semantic_plan["clarification_state"] = state.clarification_state

        if not is_stopped():
            set_result(
                status="generating",
                type="GENERAL",
                rephrased_question=state.rephrased_question,
                intent_reasoning=state.intent_reasoning,
                trace_id=trace_id,
                is_followup=is_followup,
                general_type="DATA_ASSISTANCE",
                ask_path=state.ask_path,
                template_decision=state.template_decision,
                semantic_plan=state.semantic_plan,
                clarification_state=state.clarification_state,
            )
            set_result(
                status="finished",
                type="GENERAL",
                rephrased_question=state.rephrased_question,
                intent_reasoning=state.intent_reasoning,
                content=missing_slot_requirement["content"],
                trace_id=trace_id,
                is_followup=is_followup,
                general_type="DATA_ASSISTANCE",
                ask_path=state.ask_path,
                template_decision=state.template_decision,
                semantic_plan=state.semantic_plan,
                clarification_state=state.clarification_state,
            )

        return self._attach_result_metadata(
            self._mixed_answer_composer.compose_general(results),
            ask_path=state.ask_path,
            orchestrator=orchestrator,
            template_decision=state.template_decision,
            semantic_plan=state.semantic_plan,
            clarification_state=state.clarification_state,
        )

    async def _handle_intent_result(
        self,
        *,
        state: AskExecutionState,
        intent_classification_result: dict[str, Any],
        ask_request: AskRequestLike,
        histories: Sequence[AskHistoryLike],
        trace_id: Optional[str],
        is_followup: bool,
        is_stopped: StopChecker,
        set_result: ResultUpdater,
        build_ask_error: ResultBuilder,
        results: dict[str, Any],
        orchestrator: str,
    ) -> Optional[dict[str, Any]]:
        intent = intent_classification_result.get("intent")
        state.rephrased_question = intent_classification_result.get(
            "rephrased_question"
        )
        state.intent_reasoning = intent_classification_result.get("reasoning")

        if state.rephrased_question:
            state.user_query = state.rephrased_question
        if intent == "GENERAL" and should_override_general_intent_to_text_to_sql(
            state.user_query,
        ):
            intent = "TEXT_TO_SQL"
            state.intent_reasoning = (
                f"{state.intent_reasoning or '业务规则附带数据查询'}；"
                "已识别为带业务规则说明的完整数据查询，继续生成 SQL。"
            )
        self._sync_semantic_plan_state(state, histories=histories, intent=intent)

        if intent == "MISLEADING_QUERY":
            state.ask_path = "general"
            self._schedule_general_result_completion(
                pipeline_name="misleading_assistance",
                pipeline_kwargs={
                    "query": state.user_query,
                    "histories": histories,
                    "db_schemas": intent_classification_result.get("db_schemas"),
                    "language": ask_request.configurations.language,
                    "query_id": ask_request.query_id,
                    "custom_instruction": ask_request.custom_instruction,
                },
                state=state,
                general_type="MISLEADING_QUERY",
                trace_id=trace_id,
                is_followup=is_followup,
                is_stopped=is_stopped,
                set_result=set_result,
                build_ask_error=build_ask_error,
            )

            if not is_stopped():
                set_result(
                    status="generating",
                    type="GENERAL",
                    rephrased_question=state.rephrased_question,
                    intent_reasoning=state.intent_reasoning,
                    trace_id=trace_id,
                    is_followup=is_followup,
                    general_type="MISLEADING_QUERY",
                    ask_path=state.ask_path,
                    template_decision=state.template_decision,
                    semantic_plan=state.semantic_plan,
                )
            return self._attach_result_metadata(
                self._mixed_answer_composer.compose_general(
                    results,
                    metadata_type="MISLEADING_QUERY",
                ),
                ask_path=state.ask_path,
                orchestrator=orchestrator,
                template_decision=state.template_decision,
                semantic_plan=state.semantic_plan,
            )

        if intent == "GENERAL":
            state.ask_path = "general"
            self._schedule_general_result_completion(
                pipeline_name="data_assistance",
                pipeline_kwargs={
                    "query": state.user_query,
                    "histories": histories,
                    "db_schemas": intent_classification_result.get("db_schemas"),
                    "language": ask_request.configurations.language,
                    "query_id": ask_request.query_id,
                    "custom_instruction": ask_request.custom_instruction,
                    "instructions": state.effective_instructions,
                },
                state=state,
                general_type="DATA_ASSISTANCE",
                trace_id=trace_id,
                is_followup=is_followup,
                is_stopped=is_stopped,
                set_result=set_result,
                build_ask_error=build_ask_error,
            )

            if not is_stopped():
                set_result(
                    status="generating",
                    type="GENERAL",
                    rephrased_question=state.rephrased_question,
                    intent_reasoning=state.intent_reasoning,
                    trace_id=trace_id,
                    is_followup=is_followup,
                    general_type="DATA_ASSISTANCE",
                    ask_path=state.ask_path,
                    template_decision=state.template_decision,
                    semantic_plan=state.semantic_plan,
                )
            return self._attach_result_metadata(
                self._mixed_answer_composer.compose_general(results),
                ask_path=state.ask_path,
                orchestrator=orchestrator,
                template_decision=state.template_decision,
                semantic_plan=state.semantic_plan,
            )

        if intent == "USER_GUIDE":
            state.ask_path = "general"
            self._schedule_general_result_completion(
                pipeline_name="user_guide_assistance",
                pipeline_kwargs={
                    "query": state.user_query,
                    "language": ask_request.configurations.language,
                    "query_id": ask_request.query_id,
                    "custom_instruction": ask_request.custom_instruction,
                },
                state=state,
                general_type="USER_GUIDE",
                trace_id=trace_id,
                is_followup=is_followup,
                is_stopped=is_stopped,
                set_result=set_result,
                build_ask_error=build_ask_error,
            )

            if not is_stopped():
                set_result(
                    status="generating",
                    type="GENERAL",
                    rephrased_question=state.rephrased_question,
                    intent_reasoning=state.intent_reasoning,
                    trace_id=trace_id,
                    is_followup=is_followup,
                    general_type="USER_GUIDE",
                    ask_path=state.ask_path,
                    template_decision=state.template_decision,
                    semantic_plan=state.semantic_plan,
                )
            return self._attach_result_metadata(
                self._mixed_answer_composer.compose_general(results),
                ask_path=state.ask_path,
                orchestrator=orchestrator,
                template_decision=state.template_decision,
                semantic_plan=state.semantic_plan,
            )

        if not is_stopped():
            set_result(
                **self._build_text_to_sql_result_payload(
                    state=state,
                    status="understanding",
                    rephrased_question=state.rephrased_question,
                    intent_reasoning=state.intent_reasoning,
                    trace_id=trace_id,
                    is_followup=is_followup,
                )
            )

        return None

    async def _run_text_to_sql_resolution(
        self,
        *,
        state: AskExecutionState,
        ask_request: AskRequestLike,
        query_id: str,
        trace_id: Optional[str],
        histories: Sequence[AskHistoryLike],
        runtime_scope_id: Optional[str],
        is_followup: bool,
        is_stopped: StopChecker,
        set_result: ResultUpdater,
        build_ask_result: ResultBuilder,
        build_ask_error: ResultBuilder,
        results: dict[str, Any],
        orchestrator: str,
        allow_sql_generation_reasoning: bool,
        enable_column_pruning: bool,
    ) -> dict[str, Any]:
        use_dry_plan = ask_request.use_dry_plan
        allow_dry_plan_fallback = ask_request.allow_dry_plan_fallback

        if not is_stopped() and not state.api_results:
            set_result(
                **self._build_text_to_sql_result_payload(
                    state=state,
                    status="searching",
                    rephrased_question=state.rephrased_question,
                    intent_reasoning=state.intent_reasoning,
                    trace_id=trace_id,
                    is_followup=is_followup,
                )
            )

            if not state.retrieval_result:
                retrieval_response = await self._toolset.retrieve_schema(
                    query=state.user_query,
                    histories=histories,
                    runtime_scope_id=runtime_scope_id,
                    enable_column_pruning=enable_column_pruning,
                )
                state.retrieval_result = retrieval_response.get(
                    "construct_retrieval_results", {}
                )
            documents = state.retrieval_result.get("retrieval_results", [])
            state.table_names = [document.get("table_name") for document in documents]
            state.table_ddls = [document.get("table_ddl") for document in documents]
            self._sync_template_decision_state_metrics(
                state,
                schema_compatible=bool(documents),
            )

            if not documents and not state.sql_samples:
                logger.exception(
                    "ask pipeline - NO_RELEVANT_DATA: %s", state.user_query
                )
                if not is_stopped():
                    set_result(
                        **self._build_text_to_sql_result_payload(
                            state=state,
                            status="failed",
                            error=build_ask_error(
                                code="NO_RELEVANT_DATA",
                                message="No relevant data",
                            ),
                            rephrased_question=state.rephrased_question,
                            intent_reasoning=state.intent_reasoning,
                            trace_id=trace_id,
                            is_followup=is_followup,
                        )
                    )
                return self._attach_result_metadata(
                    self._mixed_answer_composer.compose_text_to_sql_failure(
                        results,
                        error_type="NO_RELEVANT_DATA",
                    ),
                    ask_path=state.ask_path
                    or self._resolve_text_to_sql_path(
                        histories=histories,
                        sql_samples=state.sql_samples,
                        instructions=state.effective_instructions,
                        current_sql_correction_retries=state.current_sql_correction_retries,
                    ),
                    orchestrator=orchestrator,
                    template_decision=state.template_decision,
                    semantic_plan=state.semantic_plan,
                )
            if not documents and state.sql_samples:
                logger.info(
                    "ask pipeline - proceeding with SQL samples only for query: %s",
                    state.user_query,
                )

        if not state.query_decomposition:
            state.query_decomposition = build_query_decomposition_plan(
                state.user_query,
                semantic_plan=state.semantic_plan,
                table_names=state.table_names,
            )
            if state.semantic_plan is not None:
                state.semantic_plan["query_decomposition"] = state.query_decomposition
            decomposition_instruction = _format_query_decomposition_instruction(
                state.query_decomposition
            )
            if decomposition_instruction:
                state.effective_instructions = [
                    *state.effective_instructions,
                    _build_runtime_instruction(
                        decomposition_instruction,
                        source="runtime_query_decomposition",
                    ),
                ]

        supplied_external_builders_enabled = _supplied_external_sql_builders_enabled()
        supplied_external_daily_report_sql = (
            None
            if is_stopped()
            or state.api_results
            or not supplied_external_builders_enabled
            else build_supplied_external_daily_report_sql(
                state.user_query, state.slot_values
            )
        )
        if supplied_external_daily_report_sql:
            state.sql_generation_reasoning = (
                "用户已补充投放金额、PV、UV、下载点击UV，直接生成 Excel "
                "综合日报同形 SQL：包含汇总行、日明细、内部指标和外部派生率。"
            )
            if state.template_decision:
                state.template_decision["sql_source"] = "rendered_template"
                state.template_decision["decision_reason"] = (
                    "supplied_external_daily_report_sql_selected"
                )
            if state.semantic_plan is not None:
                decision = state.semantic_plan.setdefault("decision", {})
                reason_codes = decision.setdefault("reason_codes", [])
                if "supplied_external_daily_report_sql_selected" not in reason_codes:
                    reason_codes.append("supplied_external_daily_report_sql_selected")
            state.api_results = [
                build_ask_result(
                    **{
                        "sql": supplied_external_daily_report_sql,
                        "type": "llm",
                    }
                )
            ]

        supplied_external_roi_sql = (
            None
            if is_stopped()
            or state.api_results
            or not supplied_external_builders_enabled
            else build_supplied_external_roi_sql(state.user_query, state.slot_values)
        )
        if supplied_external_roi_sql:
            state.sql_generation_reasoning = (
                "用户已补充投放金额，直接生成 Excel ROI 回收表同形 SQL："
                "列为日期/站点名称/所属渠道商/渠道名称/投放金额/用户类型/"
                "累计1天/3天/.../360天，环比系数作为单独一行输出。"
            )
            if state.template_decision:
                state.template_decision["sql_source"] = "rendered_template"
                state.template_decision["decision_reason"] = (
                    "supplied_external_roi_sql_selected"
                )
            if state.semantic_plan is not None:
                decision = state.semantic_plan.setdefault("decision", {})
                reason_codes = decision.setdefault("reason_codes", [])
                if "supplied_external_roi_sql_selected" not in reason_codes:
                    reason_codes.append("supplied_external_roi_sql_selected")
            state.api_results = [
                build_ask_result(
                    **{
                        "sql": supplied_external_roi_sql,
                        "type": "llm",
                    }
                )
            ]

        if (
            not is_stopped()
            and not state.api_results
            and allow_sql_generation_reasoning
        ):
            set_result(
                **self._build_text_to_sql_result_payload(
                    state=state,
                    status="planning",
                    rephrased_question=state.rephrased_question,
                    intent_reasoning=state.intent_reasoning,
                    retrieved_tables=state.table_names,
                    trace_id=trace_id,
                    is_followup=is_followup,
                )
            )

            state.sql_generation_reasoning = await self._toolset.reason_sql_generation(
                query=state.user_query,
                contexts=state.table_ddls,
                histories=histories,
                sql_samples=state.sql_samples,
                instructions=state.effective_instructions,
                configuration=ask_request.configurations,
                query_id=query_id,
            )

            set_result(
                **self._build_text_to_sql_result_payload(
                    state=state,
                    status="planning",
                    rephrased_question=state.rephrased_question,
                    intent_reasoning=state.intent_reasoning,
                    retrieved_tables=state.table_names,
                    sql_generation_reasoning=state.sql_generation_reasoning,
                    trace_id=trace_id,
                    is_followup=is_followup,
                )
            )

        if not is_stopped() and not state.api_results:
            set_result(
                **self._build_text_to_sql_result_payload(
                    state=state,
                    status="generating",
                    rephrased_question=state.rephrased_question,
                    intent_reasoning=state.intent_reasoning,
                    retrieved_tables=state.table_names,
                    sql_generation_reasoning=state.sql_generation_reasoning,
                    trace_id=trace_id,
                    is_followup=is_followup,
                )
            )

            sql_functions, sql_knowledge = await asyncio.gather(
                self._toolset.retrieve_sql_functions(runtime_scope_id=runtime_scope_id),
                self._toolset.retrieve_sql_knowledge(runtime_scope_id=runtime_scope_id),
            )

            has_calculated_field = state.retrieval_result.get(
                "has_calculated_field", False
            )
            has_metric = state.retrieval_result.get("has_metric", False)
            has_json_field = state.retrieval_result.get("has_json_field", False)

            template_core_reference_retry_used = False
            generation_sql_samples = list(state.sql_samples)
            while not is_stopped() and not state.api_results:
                retry_as_reference = False
                candidate_count = _sql_generation_candidate_count_for_state(state)
                if candidate_count > 1:
                    text_to_sql_generation_candidates = (
                        await self._toolset.generate_sql_candidates(
                            query=state.user_query,
                            contexts=state.table_ddls,
                            sql_generation_reasoning=state.sql_generation_reasoning,
                            histories=histories,
                            runtime_scope_id=runtime_scope_id,
                            sql_samples=generation_sql_samples,
                            instructions=state.effective_instructions,
                            has_calculated_field=has_calculated_field,
                            has_metric=has_metric,
                            has_json_field=has_json_field,
                            sql_functions=sql_functions,
                            use_dry_plan=use_dry_plan,
                            allow_dry_plan_fallback=allow_dry_plan_fallback,
                            sql_knowledge=sql_knowledge,
                            candidate_count=candidate_count,
                        )
                    )
                    (
                        text_to_sql_generation_results,
                        first_generation_invalid_result,
                    ) = await self._toolset.select_best_sql_generation_result(
                        text_to_sql_generation_candidates,
                        runtime_scope_id=runtime_scope_id,
                        template_sql=(
                            _get_sample_value(generation_sql_samples[0], "sql")
                            if generation_sql_samples
                            else None
                        ),
                    )
                    if text_to_sql_generation_results is None:
                        text_to_sql_generation_results = {
                            "post_process": {
                                "valid_generation_result": {},
                                "invalid_generation_result": first_generation_invalid_result
                                or {},
                            }
                        }
                    elif state.template_decision:
                        execution_vote = text_to_sql_generation_results.get(
                            "execution_vote"
                        )
                        if execution_vote:
                            state.template_decision["execution_vote"] = execution_vote
                            state.template_decision["sql_generation_strategy"] = (
                                text_to_sql_generation_results.get("candidate_strategy")
                            )
                else:
                    text_to_sql_generation_results = await self._toolset.generate_sql(
                        query=state.user_query,
                        contexts=state.table_ddls,
                        sql_generation_reasoning=state.sql_generation_reasoning,
                        histories=histories,
                        runtime_scope_id=runtime_scope_id,
                        sql_samples=generation_sql_samples,
                        instructions=state.effective_instructions,
                        has_calculated_field=has_calculated_field,
                        has_metric=has_metric,
                        has_json_field=has_json_field,
                        sql_functions=sql_functions,
                        use_dry_plan=use_dry_plan,
                        allow_dry_plan_fallback=allow_dry_plan_fallback,
                        sql_knowledge=sql_knowledge,
                    )

                if sql_valid_result := text_to_sql_generation_results["post_process"][
                    "valid_generation_result"
                ]:
                    if (
                        state.template_decision
                        and state.template_decision.get("mode")
                        in {"anchored_template", "executable_template"}
                        and state.template_decision.get("sql_source") == "generated"
                    ):
                        state.template_decision["sql_source"] = "anchored_generated"
                    state.api_results = [
                        build_ask_result(
                            **{
                                "sql": sql_valid_result.get("sql"),
                                "type": "llm",
                            }
                        )
                    ]
                    break
                elif failed_dry_run_result := text_to_sql_generation_results[
                    "post_process"
                ]["invalid_generation_result"]:
                    while (
                        state.current_sql_correction_retries
                        < self._max_sql_correction_retries
                    ):
                        if failed_dry_run_result["type"] == "TIME_OUT":
                            break

                        original_sql = failed_dry_run_result["original_sql"]
                        state.invalid_sql = failed_dry_run_result["sql"]
                        state.error_message = failed_dry_run_result["error"]
                        state.current_sql_correction_retries += 1
                        self._sync_template_decision_state_metrics(state)

                        set_result(
                            **self._build_text_to_sql_result_payload(
                                state=state,
                                status="correcting",
                                rephrased_question=state.rephrased_question,
                                intent_reasoning=state.intent_reasoning,
                                retrieved_tables=state.table_names,
                                sql_generation_reasoning=state.sql_generation_reasoning,
                                trace_id=trace_id,
                                is_followup=is_followup,
                            )
                        )

                        sql_diagnosis_reasoning = await self._toolset.diagnose_sql(
                            contexts=state.table_ddls,
                            original_sql=original_sql,
                            invalid_sql=state.invalid_sql,
                            error_message=state.error_message,
                            language=ask_request.configurations.language,
                        )

                        sql_correction_candidates = await self._toolset.correct_sql_candidates(
                            contexts=state.table_ddls,
                            instructions=state.effective_instructions,
                            invalid_generation_results=_build_sql_correction_candidate_inputs(
                                original_sql=original_sql,
                                error_message=state.error_message,
                                diagnosis_reasoning=sql_diagnosis_reasoning,
                            ),
                            runtime_scope_id=runtime_scope_id,
                            use_dry_plan=use_dry_plan,
                            allow_dry_plan_fallback=allow_dry_plan_fallback,
                            sql_functions=sql_functions,
                            sql_knowledge=sql_knowledge,
                        )
                        (
                            sql_correction_results,
                            first_failed_correction_result,
                        ) = _select_best_sql_correction_result(
                            sql_correction_candidates,
                            original_sql=original_sql,
                        )

                        if not sql_correction_results:
                            failed_dry_run_result = first_failed_correction_result
                            if not failed_dry_run_result:
                                break
                            continue

                        if valid_generation_result := sql_correction_results[
                            "post_process"
                        ]["valid_generation_result"]:
                            corrected_sql = valid_generation_result.get("sql")
                            if (
                                state.template_decision
                                and state.template_decision.get("mode")
                                in {"anchored_template", "executable_template"}
                                and generation_sql_samples
                                and not is_template_core_preserved(
                                    _get_sample_value(generation_sql_samples[0], "sql"),
                                    corrected_sql,
                                )
                            ):
                                if _can_retry_template_core_rejection_as_reference(
                                    state.template_decision,
                                    retry_used=template_core_reference_retry_used,
                                ):
                                    template_core_reference_retry_used = True
                                    retry_as_reference = True
                                    _mark_template_core_reference_retry(
                                        state.template_decision
                                    )
                                    state.effective_instructions = (
                                        strip_template_decision_instructions(
                                            state.effective_instructions
                                        )
                                    )
                                    generation_sql_samples = (
                                        _reference_retry_sql_samples(
                                            generation_sql_samples
                                        )
                                    )
                                    state.error_message = None
                                    break

                                state.template_decision["fallback_reason"] = (
                                    "template_core_protection_rejected_correction"
                                )
                                state.error_message = (
                                    "SQL correction changed the protected template core"
                                )
                                break

                            if state.template_decision:
                                state.template_decision["sql_source"] = "corrected"
                            state.api_results = [
                                build_ask_result(
                                    **{
                                        "sql": corrected_sql,
                                        "type": "llm",
                                    }
                                )
                            ]
                            break

                        failed_dry_run_result = sql_correction_results["post_process"][
                            "invalid_generation_result"
                        ]

                        # The multi-candidate selector should only return a selected
                        # result when it is valid. This fallback keeps the previous
                        # retry behavior if the selector contract is changed later.
                        if failed_dry_run_result:
                            continue
                        break

                if retry_as_reference:
                    continue
                break

        if state.api_results:
            if not is_stopped():
                set_result(
                    **self._build_text_to_sql_result_payload(
                        state=state,
                        status="finished",
                        response=state.api_results,
                        rephrased_question=state.rephrased_question,
                        intent_reasoning=state.intent_reasoning,
                        retrieved_tables=state.table_names,
                        sql_generation_reasoning=state.sql_generation_reasoning,
                        trace_id=trace_id,
                        is_followup=is_followup,
                    )
                )
            self._mixed_answer_composer.compose_text_to_sql_success(
                results,
                api_results=state.api_results,
            )
        else:
            logger.exception("ask pipeline - NO_RELEVANT_SQL: %s", state.user_query)
            if not is_stopped():
                set_result(
                    **self._build_text_to_sql_result_payload(
                        state=state,
                        status="failed",
                        error=build_ask_error(
                            code="NO_RELEVANT_SQL",
                            message=state.error_message or "No relevant SQL",
                        ),
                        rephrased_question=state.rephrased_question,
                        intent_reasoning=state.intent_reasoning,
                        retrieved_tables=state.table_names,
                        sql_generation_reasoning=state.sql_generation_reasoning,
                        invalid_sql=state.invalid_sql,
                        trace_id=trace_id,
                        is_followup=is_followup,
                    )
                )
            self._mixed_answer_composer.compose_text_to_sql_failure(
                results,
                error_type="NO_RELEVANT_SQL",
                error_message=state.error_message,
            )

        return self._attach_result_metadata(
            results,
            ask_path=state.ask_path
            or self._resolve_text_to_sql_path(
                histories=histories,
                sql_samples=state.sql_samples,
                instructions=state.effective_instructions,
                current_sql_correction_retries=state.current_sql_correction_retries,
            ),
            orchestrator=orchestrator,
            template_decision=state.template_decision,
            semantic_plan=state.semantic_plan,
        )


class LegacyFixedOrderAskRuntime(BaseFixedOrderAskRuntime):
    async def run(
        self,
        *,
        ask_request: AskRequestLike,
        query_id: str,
        trace_id: Optional[str],
        histories: Sequence[AskHistoryLike],
        runtime_scope_id: Optional[str],
        retrieval_scope_id: Optional[str],
        is_followup: bool,
        is_stopped: StopChecker,
        set_result: ResultUpdater,
        build_ask_result: ResultBuilder,
        build_ask_error: ResultBuilder,
        orchestrator: str,
    ) -> dict[str, Any]:
        retrieval_scope_id = retrieval_scope_id or runtime_scope_id
        results = self._mixed_answer_composer.start(
            request_from=ask_request.request_from
        )
        state = self._build_initial_state(ask_request)
        allow_sql_generation_reasoning = (
            self._allow_sql_generation_reasoning
            and not ask_request.ignore_sql_generation_reasoning
        )
        enable_column_pruning = (
            self._enable_column_pruning or ask_request.enable_column_pruning
        )

        try:
            if not is_stopped():
                set_result(
                    status="understanding",
                    trace_id=trace_id,
                    is_followup=is_followup,
                )
                state.api_results = await self._toolset.retrieve_historical_question(
                    query=state.user_query,
                    retrieval_scope_id=retrieval_scope_id,
                    build_ask_result=build_ask_result,
                )

                if state.api_results:
                    state.ask_path = "historical"
                    state.sql_generation_reasoning = ""
                else:
                    await self._prepare_guidance_state(
                        state,
                        ask_request=ask_request,
                        histories=histories,
                        retrieval_scope_id=retrieval_scope_id,
                    )

                    missing_source_result = (
                        await self._maybe_handle_missing_source_rule(
                            state=state,
                            ask_request=ask_request,
                            histories=histories,
                            trace_id=trace_id,
                            is_followup=is_followup,
                            is_stopped=is_stopped,
                            set_result=set_result,
                            build_ask_error=build_ask_error,
                            results=results,
                            orchestrator=orchestrator,
                        )
                    )
                    if missing_source_result is not None:
                        return missing_source_result

                    missing_slot_result = await self._maybe_handle_missing_slot_rule(
                        state=state,
                        query_id=ask_request.query_id,
                        histories=histories,
                        trace_id=trace_id,
                        is_followup=is_followup,
                        is_stopped=is_stopped,
                        set_result=set_result,
                        results=results,
                        orchestrator=orchestrator,
                    )
                    if missing_slot_result is not None:
                        return missing_slot_result

                    if self._allow_intent_classification:
                        early_result = await self._handle_intent_result(
                            state=state,
                            intent_classification_result=await self._toolset.classify_intent(
                                query=state.user_query,
                                histories=histories,
                                sql_samples=state.sql_samples,
                                instructions=state.effective_instructions,
                                runtime_scope_id=runtime_scope_id,
                                configuration=ask_request.configurations,
                            ),
                            ask_request=ask_request,
                            histories=histories,
                            trace_id=trace_id,
                            is_followup=is_followup,
                            is_stopped=is_stopped,
                            set_result=set_result,
                            build_ask_error=build_ask_error,
                            results=results,
                            orchestrator=orchestrator,
                        )
                        if early_result is not None:
                            return early_result

                    await self._maybe_prepare_direct_template_sql(
                        state=state,
                        ask_request=ask_request,
                        histories=histories,
                        runtime_scope_id=runtime_scope_id,
                        enable_column_pruning=enable_column_pruning,
                        build_ask_result=build_ask_result,
                    )

            return await self._run_text_to_sql_resolution(
                state=state,
                ask_request=ask_request,
                query_id=query_id,
                trace_id=trace_id,
                histories=histories,
                runtime_scope_id=runtime_scope_id,
                is_followup=is_followup,
                is_stopped=is_stopped,
                set_result=set_result,
                build_ask_result=build_ask_result,
                build_ask_error=build_ask_error,
                results=results,
                orchestrator=orchestrator,
                allow_sql_generation_reasoning=allow_sql_generation_reasoning,
                enable_column_pruning=enable_column_pruning,
            )
        except Exception as e:
            logger.exception("ask pipeline - OTHERS: %s", e)

            set_result(
                **self._build_text_to_sql_result_payload(
                    state=state,
                    status="failed",
                    error=build_ask_error(
                        code="OTHERS",
                        message=str(e),
                    ),
                    trace_id=trace_id,
                    is_followup=is_followup,
                )
            )

            return self._attach_result_metadata(
                self._mixed_answer_composer.compose_text_to_sql_failure(
                    results,
                    error_type="OTHERS",
                    error_message=str(e),
                ),
                ask_path=state.ask_path
                or self._resolve_text_to_sql_path(
                    histories=histories,
                    sql_samples=state.sql_samples,
                    instructions=state.effective_instructions,
                    current_sql_correction_retries=state.current_sql_correction_retries,
                ),
                orchestrator=orchestrator,
                template_decision=state.template_decision,
                semantic_plan=state.semantic_plan,
            )


class DeepAgentsFixedOrderAskRuntime(BaseFixedOrderAskRuntime):
    async def run(
        self,
        *,
        ask_request: AskRequestLike,
        query_id: str,
        trace_id: Optional[str],
        histories: Sequence[AskHistoryLike],
        runtime_scope_id: Optional[str],
        retrieval_scope_id: Optional[str],
        is_followup: bool,
        is_stopped: StopChecker,
        set_result: ResultUpdater,
        build_ask_result: ResultBuilder,
        build_ask_error: ResultBuilder,
        orchestrator: str,
    ) -> dict[str, Any]:
        retrieval_scope_id = retrieval_scope_id or runtime_scope_id
        results = self._mixed_answer_composer.start(
            request_from=ask_request.request_from
        )
        state = self._build_initial_state(ask_request)
        allow_sql_generation_reasoning = (
            self._allow_sql_generation_reasoning
            and not ask_request.ignore_sql_generation_reasoning
        )
        enable_column_pruning = (
            self._enable_column_pruning or ask_request.enable_column_pruning
        )

        try:
            if not is_stopped():
                set_result(
                    status="understanding",
                    trace_id=trace_id,
                    is_followup=is_followup,
                )
                await self._prepare_guidance_state(
                    state,
                    ask_request=ask_request,
                    histories=histories,
                    retrieval_scope_id=retrieval_scope_id,
                )

                missing_source_result = await self._maybe_handle_missing_source_rule(
                    state=state,
                    ask_request=ask_request,
                    histories=histories,
                    trace_id=trace_id,
                    is_followup=is_followup,
                    is_stopped=is_stopped,
                    set_result=set_result,
                    build_ask_error=build_ask_error,
                    results=results,
                    orchestrator=orchestrator,
                )
                if missing_source_result is not None:
                    return missing_source_result

                missing_slot_result = await self._maybe_handle_missing_slot_rule(
                    state=state,
                    query_id=ask_request.query_id,
                    histories=histories,
                    trace_id=trace_id,
                    is_followup=is_followup,
                    is_stopped=is_stopped,
                    set_result=set_result,
                    results=results,
                    orchestrator=orchestrator,
                )
                if missing_slot_result is not None:
                    return missing_slot_result

                if self._allow_intent_classification:
                    early_result = await self._handle_intent_result(
                        state=state,
                        intent_classification_result=await self._toolset.classify_intent(
                            query=state.user_query,
                            histories=histories,
                            sql_samples=state.sql_samples,
                            instructions=state.effective_instructions,
                            runtime_scope_id=runtime_scope_id,
                            configuration=ask_request.configurations,
                        ),
                        ask_request=ask_request,
                        histories=histories,
                        trace_id=trace_id,
                        is_followup=is_followup,
                        is_stopped=is_stopped,
                        set_result=set_result,
                        build_ask_error=build_ask_error,
                        results=results,
                        orchestrator=orchestrator,
                    )
                    if early_result is not None:
                        return early_result

                await self._maybe_prepare_direct_template_sql(
                    state=state,
                    ask_request=ask_request,
                    histories=histories,
                    runtime_scope_id=runtime_scope_id,
                    enable_column_pruning=enable_column_pruning,
                    build_ask_result=build_ask_result,
                )

            if not is_stopped() and not state.api_results:
                set_result(
                    **self._build_text_to_sql_result_payload(
                        state=state,
                        status="searching",
                        rephrased_question=state.rephrased_question,
                        intent_reasoning=state.intent_reasoning,
                        trace_id=trace_id,
                        is_followup=is_followup,
                    )
                )

                state.api_results = await self._toolset.retrieve_historical_question(
                    query=state.user_query,
                    retrieval_scope_id=retrieval_scope_id,
                    build_ask_result=build_ask_result,
                )

                if state.api_results:
                    state.ask_path = "historical"
                    state.sql_generation_reasoning = ""

            return await self._run_text_to_sql_resolution(
                state=state,
                ask_request=ask_request,
                query_id=query_id,
                trace_id=trace_id,
                histories=histories,
                runtime_scope_id=runtime_scope_id,
                is_followup=is_followup,
                is_stopped=is_stopped,
                set_result=set_result,
                build_ask_result=build_ask_result,
                build_ask_error=build_ask_error,
                results=results,
                orchestrator=orchestrator,
                allow_sql_generation_reasoning=allow_sql_generation_reasoning,
                enable_column_pruning=enable_column_pruning,
            )
        except Exception as e:
            logger.exception("ask pipeline - OTHERS: %s", e)

            set_result(
                **self._build_text_to_sql_result_payload(
                    state=state,
                    status="failed",
                    error=build_ask_error(
                        code="OTHERS",
                        message=str(e),
                    ),
                    trace_id=trace_id,
                    is_followup=is_followup,
                )
            )

            return self._attach_result_metadata(
                self._mixed_answer_composer.compose_text_to_sql_failure(
                    results,
                    error_type="OTHERS",
                    error_message=str(e),
                ),
                ask_path=state.ask_path
                or self._resolve_text_to_sql_path(
                    histories=histories,
                    sql_samples=state.sql_samples,
                    instructions=state.effective_instructions,
                    current_sql_correction_retries=state.current_sql_correction_retries,
                ),
                orchestrator=orchestrator,
                template_decision=state.template_decision,
                semantic_plan=state.semantic_plan,
            )


FixedOrderAskRuntime = LegacyFixedOrderAskRuntime
