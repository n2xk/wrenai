import asyncio
import itertools
import logging
import os
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Callable, Iterable, Literal, Optional, Protocol, Sequence

import sqlparse

from src.core.ask_policy import (
    coerce_ask_policy_config,
    evaluate_policy_context,
    is_metadata_explanation_query,
    load_ask_policy_config,
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
DATE_PATTERN = re.compile(r"(20\d{2}-\d{2}-\d{2})")


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


TEMPLATE_FEATURE_PATTERNS: dict[str, tuple[str, ...]] = {
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

    exclusion_cue = "|".join(re.escape(cue) for cue in EXTERNAL_DEPENDENCY_EXCLUSION_CUES)
    for text in _external_dependency_exclusion_texts(dependency):
        if not text:
            continue
        escaped_text = re.escape(text)
        if re.search(
            rf"(?:{exclusion_cue}).{{0,80}}{escaped_text}",
            query,
            flags=re.IGNORECASE,
        ):
            return True
        if re.search(
            rf"{escaped_text}.{{0,40}}(?:{exclusion_cue})",
            query,
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
        asset_type = _get_sample_value(instruction, "knowledge_asset_type") or _get_sample_value(
            instruction, "knowledgeAssetType"
        )
        if asset_type != "external_dependency":
            continue

        dependency_id = (
            _get_sample_value(instruction, "external_dependency_id")
            or _get_sample_value(instruction, "externalDependencyId")
        )
        metadata = _get_sample_value(instruction, "metadata") or {}
        if not isinstance(metadata, dict):
            metadata = {}
        upsert_dependency(
            dependency_id,
            name=_canonical_dependency_name(_normalize_dependency_id(dependency_id))
            if not _get_sample_value(instruction, "name")
            else _get_sample_value(instruction, "name"),
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
            input_modes=metadata.get("input_modes")
            or metadata.get("inputModes")
            or [],
            lifecycle=metadata.get("lifecycle") or "per_question",
            validation=metadata.get("validation") or {},
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
        if not isinstance(raw_supply, dict):
            return []
        columns = (
            raw_supply.get("columns")
            or raw_supply.get("headers")
            or raw_supply.get("fields")
            or raw_supply.get("schema")
            or []
        )
        normalized_columns = _normalize_string_list(columns)
        rows = raw_supply.get("rows")
        if isinstance(rows, list) and rows and isinstance(rows[0], dict):
            normalized_columns = [
                *normalized_columns,
                *[str(key) for key in rows[0].keys()],
            ]
        return list(dict.fromkeys(normalized_columns))

    def collect_grain(raw_supply: Any) -> list[str]:
        if not isinstance(raw_supply, dict):
            return []
        return _normalize_string_list(
            raw_supply.get("grain")
            or raw_supply.get("granularity")
            or raw_supply.get("required_grain")
            or raw_supply.get("requiredGrain")
            or []
        )

    def add_supply(dependency_id: Any, raw_supply: Any) -> None:
        normalized_dependency_id = _normalize_dependency_id(str(dependency_id or ""))
        if not normalized_dependency_id:
            return
        supply = supplies.setdefault(
            normalized_dependency_id,
            {"columns": [], "grain": []},
        )
        for column in collect_columns(raw_supply):
            if column not in supply["columns"]:
                supply["columns"].append(column)
        for grain in collect_grain(raw_supply):
            if grain not in supply["grain"]:
                supply["grain"].append(grain)

    if isinstance(raw_dependencies, dict):
        for key, raw_supply in raw_dependencies.items():
            if isinstance(raw_supply, dict):
                dependency_id = (
                    raw_supply.get("id")
                    or raw_supply.get("external_dependency_id")
                    or raw_supply.get("externalDependencyId")
                    or raw_supply.get("dependency_id")
                    or raw_supply.get("dependencyId")
                    or key
                )
                add_supply(dependency_id, raw_supply)
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
    required_columns = _normalize_string_list(
        validation.get("required_columns") or validation.get("requiredColumns") or []
    )
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
    if not evaluations or not all(evaluation["satisfied"] for evaluation in evaluations):
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
    }


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
    business_signature = _get_sample_value(sample, "business_signature") or _get_sample_value(
        sample, "businessSignature"
    )
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


def _iter_history_questions(histories: Sequence[Any] | None) -> list[str]:
    if not histories:
        return []
    return [
        question
        for question in (_get_history_question(history) for history in histories)
        if question
    ]


def _extract_tenant_plat_ids_from_text(text: Optional[str]) -> list[int]:
    if not text:
        return []

    return _extract_integer_values(
        [
            r"tenant_plat_id\s*[=:：]?\s*((?:\d+\s*(?:,|，|、|和|与|及)?\s*)+)",
            r"租户平台\s*((?:\d+\s*(?:,|，|、|和|与|及)?\s*)+)",
            r"平台\s*((?:\d+\s*(?:,|，|、|和|与|及)?\s*)+)",
        ],
        text,
    )


def _extract_channel_ids_from_text(text: Optional[str]) -> list[int]:
    if not text:
        return []

    return _extract_integer_values(
        [
            r"channel_id\s*[=:：]?\s*((?:\d+\s*(?:,|，|、|和|与|及)?\s*)+)",
            r"渠道(?:ID|id)?\s*[=:：]?\s*((?:\d+\s*(?:,|，|、|和|与|及)?\s*)+)",
        ],
        text,
    )


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
    for question in _iter_history_questions(histories):
        for tenant_id in _extract_tenant_plat_ids_from_text(question):
            if tenant_id not in tenant_ids:
                tenant_ids.append(tenant_id)
    return tenant_ids


def _resolve_history_channel_ids(histories: Sequence[Any] | None) -> list[int]:
    channel_ids: list[int] = []
    for question in _iter_history_questions(histories):
        for channel_id in _extract_channel_ids_from_text(question):
            if channel_id not in channel_ids:
                channel_ids.append(channel_id)
    return channel_ids


def _history_has_date_context(histories: Sequence[Any] | None) -> bool:
    return any(_extract_date_range_from_text(question) for question in _iter_history_questions(histories))


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
    if not any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in vague_performance_cues):
        return False

    # If the user already named a concrete metric, let the normal slot/external
    # dependency guards handle it. This keeps focused questions like “这个渠道新客
    # 首充成本是多少” on the ROI/external-data path instead of over-clarifying.
    return not _extract_pattern_keys(text, SEMANTIC_METRIC_PATTERNS)


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
    return detect_missing_tenant_plat_id_requirement(
        query,
        histories=histories,
        resolved_slots=resolved_slots,
    ) or detect_missing_ambiguous_channel_requirement(
        query,
        histories=histories,
        resolved_slots=resolved_slots,
    ) or detect_missing_financial_ratio_scope_requirement(
        query,
        histories=histories,
        resolved_slots=resolved_slots,
    ) or detect_missing_distribution_scope_requirement(
        query,
        histories=histories,
        resolved_slots=resolved_slots,
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

    if "period_days" in missing_parameters:
        return {
            "slot": "period_days",
            "missing_parameters": ["period_days"],
            "content": (
                "这个问题命中了首存 cohort 模板，还需要补充回收周期。"
                "请说明要累计到 D7、D30 还是其他天数，例如：首存后 D7。"
            ),
            "reasoning": "模板缺少回收周期 period_days，需先澄清后再生成 SQL。",
        }

    return None


def _extract_date_range_from_text(text: Optional[str]) -> dict[str, str]:
    dates = DATE_PATTERN.findall(text or "")
    if len(dates) >= 2:
        return {"start_date": dates[0], "end_date": dates[1]}
    if len(dates) == 1:
        return {"date": dates[0]}
    return {}


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
        return _extract_integer_values([r"((?:\d+\s*(?:,|，|、|和|与|及)?\s*)+)"], value)
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
        _extract_pattern_keys(query, SEMANTIC_METRIC_PATTERNS)
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
    for feature, patterns in TEMPLATE_FEATURE_PATTERNS.items():
        if any(re.search(pattern, query, flags=re.IGNORECASE) for pattern in patterns):
            features.append(feature)
    return features


SEMANTIC_METRIC_PATTERNS: dict[str, tuple[str, ...]] = {
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
    "roi": (r"\bROI\b", r"投放回收", r"回本"),
    "uv": (r"\bUV\b", r"独立访客", r"访问UV"),
    "withdraw_amount": (r"提现金额", r"提款金额"),
    "win_loss": (r"输赢", r"平台输赢"),
}


SEMANTIC_DIMENSION_PATTERNS: dict[str, tuple[str, ...]] = {
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


def _infer_semantic_subject(query: Optional[str], features: Sequence[str]) -> Optional[str]:
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
        "slot": missing_slots[0]
        if len(missing_slots) == 1
        else "ask_policy_required_slots",
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
    channel_ids = _extract_channel_ids_from_text(query) or _extract_slot_value_ids(
        resolved_slot_values,
        "channel_id",
    )
    date_range = _extract_date_range_from_text(query) or _extract_slot_value_date_range(
        resolved_slot_values,
    )
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
    metrics = _extract_pattern_keys(query, SEMANTIC_METRIC_PATTERNS)
    dimensions = _extract_pattern_keys(query, SEMANTIC_DIMENSION_PATTERNS)
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
            source="explicit_user_input"
            if explicit_tenant_ids
            else "clarification_reply"
            if slot_tenant_ids
            else "history_context"
            if history_tenant_ids
            else "unknown",
        )
    if channel_ids:
        resolved_slots["channel_id"] = _build_resolved_slot(
            value=_collapse_single_or_list(channel_ids),
            source="explicit_user_input",
        )
    for key, value in date_range.items():
        resolved_slots[key] = _build_resolved_slot(
            value=value,
            source="explicit_user_input"
            if _extract_date_range_from_text(query)
            else "clarification_reply",
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
        for feature, patterns in TEMPLATE_FEATURE_PATTERNS.items()
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

    fallback_result_grain = _get_sample_value(sample, "result_grain") or _get_sample_value(
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
    return has_channel_comparison and has_recharge_summary_metric and not asks_daily_grain


def _sample_has_daily_grain(sample: Any) -> bool:
    result_grain = _resolve_sample_result_grain(sample)
    if any(token in result_grain for token in ("biz_date", "date", "day", "日")):
        return True

    sample_text = _collect_sample_signature_text(sample)
    return bool(
        re.search(r"日报|每日|每天|按天|逐日|日级|日期", sample_text, flags=re.IGNORECASE)
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
        _sample_has_daily_grain(sample) or _sample_has_specialized_recharge_grain(sample)
    ):
        return "template_guard_channel_period_summary_mismatch"

    if (
        _query_requests_login_without_successful_deposit(query)
        and not _sample_supports_login_without_successful_deposit(sample)
    ):
        return "template_guard_login_without_deposit_mismatch"

    if _query_requests_retention_deposit(query) and not _sample_supports_retention_deposit(
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
    lowered_references = [str(name).lower() for name in reference_relation_names if name]
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

    if is_template_core_preserved(template_sql, history_sql) or is_template_core_preserved(
        history_sql,
        template_sql,
    ):
        return True

    template_ctes = set(_extract_cte_names(template_sql))
    history_ctes = set(_extract_cte_names(history_sql))
    if template_ctes and history_ctes and _relation_name_sets_overlap(
        template_ctes,
        history_ctes,
    ):
        if _relation_name_set_is_subset(
            history_ctes,
            template_ctes,
        ) or _relation_name_set_is_subset(template_ctes, history_ctes):
            return True

    history_relations = _extract_relation_names(history_sql)
    if template_ctes and history_relations and _relation_name_sets_overlap(
        template_ctes,
        history_relations,
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
                    r"(\d+)\s*天内",
                    r"前\s*(\d+)\s*天",
                    r"N\s*[=:：]\s*(\d+)",
                ],
                query,
            )
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

        candidate_sql = _normalize_sql_for_signature(_get_sample_value(candidate, "sql"))
        candidate_signature = _get_business_signature(candidate)
        candidate_template_id = str(candidate_signature.get("templateId") or "").strip()
        if (
            anchor_sql
            and candidate_sql
            and candidate_sql == anchor_sql
        ) or (
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


def _has_min_retrieval_support(raw_score: Optional[float], adjusted_score: float) -> bool:
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
            should_block = (
                str(dependency.get("missing_behavior") or "ask_user").lower()
                in {"ask_user", "block_answer"}
            )
            if not is_missing or not should_block:
                continue

            supplied_evaluation = _evaluate_supplied_external_dependency(
                dependency,
                supplied_dependencies,
            )
            if supplied_evaluation["satisfied"]:
                continue
            if supplied_dependencies and supplied_evaluation.get("missing_dependency") is None:
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
                granularity_hint = "请按以下统计粒度提供：" + "、".join(required_grain_values) + "。"
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

    required_metrics: list[str] = []
    normalized_query = query.upper()

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
        + (
            0.05
            * _resolve_parameter_coverage_score(required_placeholders, parameters)
        )
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
    has_min_retrieval_support = _has_min_retrieval_support(raw_score, top_adjusted_score)
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
        if not has_min_retrieval_support or confidence < TEMPLATE_MIN_ANCHORED_CONFIDENCE:
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
            else "anchored_template"
            if not missing_parameters
            else "anchored_generated"
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

    raw_source_tables = business_signature.get("sourceTables") or business_signature.get(
        "source_tables"
    )
    if not isinstance(raw_source_tables, list):
        raw_source_tables = []

    source_tables: list[str] = []
    for raw_table_name in raw_source_tables:
        if not isinstance(raw_table_name, str):
            continue
        normalized_table_name = raw_table_name.strip().strip("`\"")
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
        normalized_table_name = matched_table_name.strip().strip("`\"")
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
        table_name = match.group(1).strip("`\"[]")
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


def build_sql_core_signature(sql: Optional[str]) -> dict[str, Any]:
    return {
        "ctes": _extract_cte_names(sql),
        "source_tables": _extract_source_tables(sql),
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
        )

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
            components.get("post_processor")
            if isinstance(components, dict)
            else None
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

    def _append_semantic_plan_reason(self, state: AskExecutionState, reason: str) -> None:
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
            "reason_codes": reason_codes,
            "missing_slots": merged["missing_slots"],
            "resolved_slots": merged["resolved_slots"],
            "candidate_templates": deterministic_decision.get(
                "candidate_templates"
            )
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
            "slot": missing_slots[0]
            if len(missing_slots) == 1
            else "ask_policy_required_slots",
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
        valid_generation_result = (
            validation_result.get("valid_generation_result") or {}
        )
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
            in {"searching", "planning", "generating", "correcting", "finished", "failed"}
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
            else "finished"
            if state.intent_reasoning
            or status
            in {"searching", "planning", "generating", "correcting", "finished"}
            else "failed"
            if status == "failed"
            else "pending"
        )

        candidate_models_status = (
            "running"
            if status == "searching" and not state.table_names
            else "finished"
            if state.table_names
            or status in {"planning", "generating", "correcting", "finished"}
            else "failed"
            if status == "failed"
            else "pending"
        )

        sql_reasoned_status = (
            "skipped"
            if is_direct_template_sql and (state.api_results or status == "finished")
            else
            "running"
            if status == "planning" and not state.sql_generation_reasoning
            else "finished"
            if state.sql_generation_reasoning
            or status in {"generating", "correcting", "finished"}
            else "failed"
            if status == "failed"
            else "pending"
        )

        sql_generated_status = (
            "running"
            if status in {"generating", "correcting"}
            else "finished"
            if state.api_results or status == "finished"
            else "failed"
            if status == "failed"
            else "pending"
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
            supplied_coverage = detect_supplied_external_dependency_coverage(
                state.user_query,
                sql_samples=state.sql_samples,
                instructions=state.effective_instructions or state.instructions,
                supplied_external_dependencies=state.slot_values,
            )
            if supplied_coverage and state.semantic_plan is not None:
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
        missing_slot_requirement = detect_missing_required_slot_requirement(
            state.user_query,
            histories=histories,
            resolved_slots=state.slot_values,
        ) or detect_missing_template_parameter_requirement(
            state.user_query,
            state.template_decision,
        ) or self._build_policy_missing_slot_requirement(state)
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
            "resolved_slots": {},
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
                logger.exception("ask pipeline - NO_RELEVANT_DATA: %s", state.user_query)
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

        if not is_stopped() and not state.api_results and allow_sql_generation_reasoning:
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

            text_to_sql_generation_results = await self._toolset.generate_sql(
                query=state.user_query,
                contexts=state.table_ddls,
                sql_generation_reasoning=state.sql_generation_reasoning,
                histories=histories,
                runtime_scope_id=runtime_scope_id,
                sql_samples=state.sql_samples,
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
            elif failed_dry_run_result := text_to_sql_generation_results[
                "post_process"
            ]["invalid_generation_result"]:
                while state.current_sql_correction_retries < self._max_sql_correction_retries:
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

                    sql_correction_results = await self._toolset.correct_sql(
                        contexts=state.table_ddls,
                        instructions=state.effective_instructions,
                        invalid_generation_result={
                            "sql": original_sql,
                            "error": sql_diagnosis_reasoning
                            or state.error_message,
                        },
                        runtime_scope_id=runtime_scope_id,
                        use_dry_plan=use_dry_plan,
                        allow_dry_plan_fallback=allow_dry_plan_fallback,
                        sql_functions=sql_functions,
                        sql_knowledge=sql_knowledge,
                    )

                    if valid_generation_result := sql_correction_results[
                        "post_process"
                    ]["valid_generation_result"]:
                        corrected_sql = valid_generation_result.get("sql")
                        if (
                            state.template_decision
                            and state.template_decision.get("mode")
                            in {"anchored_template", "executable_template"}
                            and state.sql_samples
                            and not is_template_core_preserved(
                                _get_sample_value(state.sql_samples[0], "sql"),
                                corrected_sql,
                            )
                        ):
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
                self._sync_semantic_plan_state(state, histories=histories)
                self._apply_policy_state(
                    state,
                    request_policy=getattr(ask_request, "ask_policy", None),
                )
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

                state.api_results = await self._toolset.retrieve_historical_question(
                    query=state.user_query,
                    retrieval_scope_id=retrieval_scope_id,
                    build_ask_result=build_ask_result,
                )

                if state.api_results:
                    state.ask_path = "historical"
                    state.sql_generation_reasoning = ""
                else:
                    (
                        retrieval_query,
                        state.sql_samples,
                        state.instructions,
                    ) = await self._retrieve_guidance_candidates(
                        query=state.user_query,
                        histories=histories,
                        retrieval_scope_id=retrieval_scope_id,
                    )
                    state.sql_samples = rerank_sql_samples(
                        retrieval_query,
                        state.sql_samples,
                        histories=histories,
                    )
                    inactive_template_sample = None
                    state.sql_samples, inactive_template_sample = (
                        filter_active_sql_samples(state.sql_samples)
                    )
                    state.template_decision = build_template_decision(
                        state.sql_samples,
                        state.user_query,
                        histories=histories,
                        inactive_sample=inactive_template_sample,
                    )
                    self._sync_template_decision_state_metrics(state)
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
                self._sync_semantic_plan_state(state, histories=histories)
                self._apply_policy_state(
                    state,
                    request_policy=getattr(ask_request, "ask_policy", None),
                )
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

                (
                    retrieval_query,
                    state.sql_samples,
                    state.instructions,
                ) = await self._retrieve_guidance_candidates(
                    query=state.user_query,
                    histories=histories,
                    retrieval_scope_id=retrieval_scope_id,
                )
                state.sql_samples = rerank_sql_samples(
                    retrieval_query,
                    state.sql_samples,
                    histories=histories,
                )
                state.template_decision = build_template_decision(
                    state.sql_samples,
                    state.user_query,
                    histories=histories,
                )
                self._sync_template_decision_state_metrics(state)
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
