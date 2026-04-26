import asyncio
import itertools
import logging
import os
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Callable, Optional, Protocol, Sequence

from src.core.mixed_answer_composer import MixedAnswerComposer
from src.core.pipeline import BasicPipeline
from src.pipelines.common import retrieve_data_source

logger = logging.getLogger("wren-ai-service")


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
    if template_ctes and history_ctes and template_ctes & history_ctes:
        if history_ctes.issubset(template_ctes) or template_ctes.issubset(history_ctes):
            return True

    history_relations = _extract_relation_names(history_sql)
    if template_ctes and history_relations and template_ctes & history_relations:
        return True

    template_relations = _extract_relation_names(template_sql)
    return bool(
        template_relations and history_relations and template_relations & history_relations
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
    score = base_score

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
            r"非\s*TOP\s*\d*|NON[_\s-]?TOPN",
            "",
            query,
            flags=re.IGNORECASE,
        )
        if re.search(r"TOP\s*\d+|TOPN", query_without_non_top, flags=re.IGNORECASE):
            requested_segments.append("TOPN")
        if re.search(r"非\s*TOP\s*\d*|NON[_\s-]?TOPN", query, flags=re.IGNORECASE):
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
) -> Optional[dict[str, Any]]:
    if not query:
        return None

    required_metrics: list[str] = []
    normalized_query = query.upper()

    def append_metric(metric_key: str) -> None:
        metric = MISSING_SOURCE_PROMPTS[metric_key]
        if metric not in required_metrics:
            required_metrics.append(metric)

    if re.search(r"ROI|首存成本|投放金额", normalized_query, flags=re.IGNORECASE):
        append_metric("spend_amount")

    if re.search(r"UV下载率", query, flags=re.IGNORECASE):
        append_metric("uv")
        append_metric("download_click_uv")

    if re.search(r"UV注册率", query, flags=re.IGNORECASE):
        append_metric("uv")

    if re.search(r"下载点击\s*UV", query, flags=re.IGNORECASE):
        append_metric("download_click_uv")

    if re.search(
        r"(?<![A-Z0-9])PV(?![A-Z0-9])|访问PV",
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
        r"(?<![A-Z0-9])UV(?![A-Z0-9])|访问UV",
        access_uv_query,
        flags=re.IGNORECASE,
    ):
        append_metric("uv")

    if not required_metrics:
        return None

    if re.search(r"cohort|ROI|回收|首存成本", query, flags=re.IGNORECASE):
        granularity_hint = "请按对应统计周期提供这些外部指标。"
    elif re.search(r"日报|趋势|按天|日期|渠道", query, flags=re.IGNORECASE):
        granularity_hint = "请按每个日期、每个渠道提供这些外部指标。"
    else:
        granularity_hint = "请按当前问题对应的统计粒度提供这些外部指标。"

    missing_metrics = "、".join(required_metrics)
    content = (
        "当前知识库还缺少以下外部指标："
        f"{missing_metrics}。所以现在不能直接输出或并表这些结果，也不能编造。"
        f"{granularity_hint}"
        "请先把这些指标补充给我后，我再和现有 SQL 可查询的内部指标一起输出。"
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
            "source": "missing_source_rule",
            "required_metrics": required_metrics,
        },
    }


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
    has_min_retrieval_support = _has_min_retrieval_support(raw_score, top_adjusted_score)

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

        if has_low_margin_conflict:
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
    return re.sub(r"\s+", " ", sql or "").strip().lower()


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


def is_template_core_preserved(
    template_sql: Optional[str], candidate_sql: Optional[str]
) -> bool:
    if not template_sql or not candidate_sql:
        return True

    template_ctes = _extract_cte_names(template_sql)
    candidate_ctes = _extract_cte_names(candidate_sql)
    if (template_ctes or candidate_ctes) and template_ctes != candidate_ctes:
        return False

    signature_patterns = [
        r"\bcase\b",
        r"\bgroup\s+by\b",
        r"\bpartition\s+by\b",
        r"\border\s+by\b",
    ]
    return all(
        _count_keyword(template_sql, pattern) == _count_keyword(candidate_sql, pattern)
        for pattern in signature_patterns
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

        sql_diagnosis_results = await self._pipelines["sql_diagnosis"].run(
            contexts=contexts,
            original_sql=original_sql,
            invalid_sql=invalid_sql,
            error_message=error_message,
            language=language,
        )
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
        enable_column_pruning: bool = False,
        max_sql_correction_retries: int = 3,
    ):
        self._toolset = toolset
        self._mixed_answer_composer = mixed_answer_composer or MixedAnswerComposer()
        self._allow_intent_classification = allow_intent_classification
        self._allow_sql_generation_reasoning = allow_sql_generation_reasoning
        self._enable_column_pruning = enable_column_pruning
        self._max_sql_correction_retries = max_sql_correction_retries

    def _attach_result_metadata(
        self,
        result: dict[str, Any],
        *,
        ask_path: Optional[str],
        orchestrator: str,
        template_decision: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        metadata = result.setdefault("metadata", {})
        metadata["orchestrator"] = orchestrator
        if ask_path:
            metadata["ask_path"] = ask_path
        if template_decision:
            metadata["template_decision"] = template_decision
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
        return AskExecutionState(user_query=ask_request.query)

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

        documents = state.retrieval_result.get("retrieval_results", [])
        state.table_names = [document.get("table_name") for document in documents]
        state.table_ddls = [document.get("table_ddl") for document in documents]
        has_schema_support = bool(documents)
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

        selected_template = state.sql_samples[0]
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
                detail=state.sql_generation_reasoning,
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
            state.user_query
        )
        if not missing_source_requirement:
            return None

        state.effective_instructions = [
            *state.effective_instructions,
            missing_source_requirement["instruction"],
        ]
        state.intent_reasoning = missing_source_requirement["reasoning"]
        state.ask_path = "general"

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
            )

        return self._attach_result_metadata(
            self._mixed_answer_composer.compose_general(results),
            ask_path=state.ask_path,
            orchestrator=orchestrator,
            template_decision=state.template_decision,
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
                )
            return self._attach_result_metadata(
                self._mixed_answer_composer.compose_general(
                    results,
                    metadata_type="MISLEADING_QUERY",
                ),
                ask_path=state.ask_path,
                orchestrator=orchestrator,
                template_decision=state.template_decision,
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
                )
            return self._attach_result_metadata(
                self._mixed_answer_composer.compose_general(results),
                ask_path=state.ask_path,
                orchestrator=orchestrator,
                template_decision=state.template_decision,
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
                )
            return self._attach_result_metadata(
                self._mixed_answer_composer.compose_general(results),
                ask_path=state.ask_path,
                orchestrator=orchestrator,
                template_decision=state.template_decision,
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
            )


FixedOrderAskRuntime = LegacyFixedOrderAskRuntime
