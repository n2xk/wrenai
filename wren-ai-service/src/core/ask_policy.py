import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import yaml

DEFAULT_POLICY_ID = "semantic_governance"
DEFAULT_POLICY_VERSION = "semantic_governance_v1"
logger = logging.getLogger("wren-ai-service")


@dataclass(frozen=True)
class AskPolicyRule:
    id: str
    reason_code: str
    query_contains_any: tuple[str, ...] = ()
    template_ids: tuple[str, ...] = ()
    forbidden_templates: tuple[str, ...] = ()
    required_slots: tuple[str, ...] = ()
    semantic_subjects: tuple[str, ...] = ()
    semantic_features: tuple[str, ...] = ()
    semantic_metrics: tuple[str, ...] = ()
    semantic_dimensions: tuple[str, ...] = ()
    semantic_grains: tuple[str, ...] = ()
    semantic_routes: tuple[str, ...] = ()
    semantic_external_dependencies: tuple[str, ...] = ()
    required_filters: tuple[str, ...] = ()


@dataclass(frozen=True)
class AskPolicyConfig:
    policy_id: str = DEFAULT_POLICY_ID
    version: str = DEFAULT_POLICY_VERSION
    rules: tuple[AskPolicyRule, ...] = ()


@dataclass(frozen=True)
class AskPolicyEvaluation:
    policy_id: str
    policy_version: str
    reason_codes: tuple[str, ...] = ()
    forbidden_template_ids: tuple[str, ...] = ()
    required_slots: tuple[str, ...] = ()
    missing_required_slots: tuple[str, ...] = ()
    violations: tuple[dict[str, Any], ...] = ()

    @property
    def blocks_template(self) -> bool:
        return bool(self.forbidden_template_ids)

    def to_metadata(self) -> dict[str, Any]:
        return {
            "policy_id": self.policy_id,
            "policy_version": self.policy_version,
            "policy_reason_codes": list(self.reason_codes),
            "policy_forbidden_template_ids": list(self.forbidden_template_ids),
            "policy_required_slots": list(self.required_slots),
            "policy_missing_required_slots": list(self.missing_required_slots),
            "policy_violations": list(self.violations),
        }


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple | set):
        return list(value)
    return [value]


def _as_tuple_of_str(value: Any) -> tuple[str, ...]:
    return tuple(str(item) for item in _as_list(value) if str(item).strip())


def _normalize_text(value: Any) -> str:
    return str(value or "").strip().lower()


def is_metadata_explanation_query(query: Optional[str]) -> bool:
    """Return True for schema/metadata inventory questions.

    Required business-slot policies are meant to protect metric SQL generation,
    not questions that ask what tables, models or fields exist. Without this
    guard a broad tenant policy can incorrectly block questions such as
    “充值/提现/投注相关的主要表有哪些”.
    """

    if not query:
        return False

    text = str(query).strip()
    if not text:
        return False

    metadata_patterns = (
        r"(?:有哪些|哪些|列出|说明|介绍|查看).{0,24}(?:表|数据表|模型|字段|schema|metadata|元数据)",
        r"(?:表|数据表|模型|字段).{0,24}(?:有哪些|记录什么|是干嘛|干什么|含义|说明|介绍)",
        r"(?:workspace|知识库|数据集|schema|metadata|元数据).{0,24}(?:表|数据表|模型|字段)",
        r"(?:充值|提现|提款|投注).{0,16}(?:相关|有关).{0,16}(?:主要)?(?:表|数据表|模型)",
    )
    return any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in metadata_patterns)


def _parse_rule(raw_rule: dict[str, Any], index: int) -> AskPolicyRule:
    when = raw_rule.get("when") if isinstance(raw_rule.get("when"), dict) else {}
    semantic = (
        raw_rule.get("semantic_conditions")
        or raw_rule.get("semanticConditions")
        or when.get("semantic_conditions")
        or when.get("semanticConditions")
        or when.get("semantic")
        or {}
    )
    if not isinstance(semantic, dict):
        semantic = {}
    rule_id = str(raw_rule.get("id") or f"rule_{index}")
    return AskPolicyRule(
        id=rule_id,
        reason_code=str(raw_rule.get("reason_code") or rule_id),
        query_contains_any=_as_tuple_of_str(
            raw_rule.get("query_contains_any") or when.get("query_contains_any")
        ),
        template_ids=_as_tuple_of_str(
            raw_rule.get("template_ids") or when.get("template_ids")
        ),
        forbidden_templates=_as_tuple_of_str(raw_rule.get("forbidden_templates")),
        required_slots=_as_tuple_of_str(raw_rule.get("required_slots")),
        semantic_subjects=_as_tuple_of_str(
            semantic.get("subjects") or semantic.get("subject")
        ),
        semantic_features=_as_tuple_of_str(
            semantic.get("features") or semantic.get("feature")
        ),
        semantic_metrics=_as_tuple_of_str(
            semantic.get("metrics") or semantic.get("metric")
        ),
        semantic_dimensions=_as_tuple_of_str(
            semantic.get("dimensions") or semantic.get("dimension")
        ),
        semantic_grains=_as_tuple_of_str(
            semantic.get("grains")
            or semantic.get("grain")
            or semantic.get("expected_grains")
            or semantic.get("expectedGrains")
        ),
        semantic_routes=_as_tuple_of_str(
            semantic.get("routes") or semantic.get("route")
        ),
        semantic_external_dependencies=_as_tuple_of_str(
            semantic.get("external_dependencies")
            or semantic.get("externalDependencies")
        ),
        required_filters=_as_tuple_of_str(
            semantic.get("required_filters") or semantic.get("requiredFilters")
        ),
    )


def load_ask_policy_config(policy_file: Optional[str] = None) -> AskPolicyConfig:
    if not policy_file:
        return AskPolicyConfig()

    path = Path(policy_file)
    try:
        raw_text = path.read_text(encoding="utf-8")
        raw = (
            json.loads(raw_text)
            if path.suffix.lower() == ".json"
            else yaml.safe_load(raw_text)
        )
    except FileNotFoundError:
        return AskPolicyConfig(
            rules=(
                AskPolicyRule(
                    id="policy_file_missing",
                    reason_code="policy_file_missing",
                ),
            )
        )

    if not isinstance(raw, dict):
        return AskPolicyConfig()

    return AskPolicyConfig(
        policy_id=str(raw.get("policy_id") or DEFAULT_POLICY_ID),
        version=str(raw.get("version") or DEFAULT_POLICY_VERSION),
        rules=tuple(
            _parse_rule(raw_rule, index)
            for index, raw_rule in enumerate(_as_list(raw.get("rules")), start=1)
            if isinstance(raw_rule, dict)
        ),
    )


def coerce_ask_policy_config(raw: Any) -> Optional[AskPolicyConfig]:
    """Build an ask policy config from request-level JSON.

    The file loader remains the default deployment-level contract. Productized
    UI governance sends the same schema inline per request so a workspace or
    knowledge base can evaluate different policies without rewriting the
    AI-service process environment.
    """

    if isinstance(raw, AskPolicyConfig):
        return raw

    if not isinstance(raw, dict):
        return None

    rules = tuple(
        _parse_rule(raw_rule, index)
        for index, raw_rule in enumerate(_as_list(raw.get("rules")), start=1)
        if isinstance(raw_rule, dict)
    )
    if not rules:
        logger.warning(
            "Request-level ask_policy has no valid rules; falling back to file-level policy."
        )
        return None

    return AskPolicyConfig(
        policy_id=str(raw.get("policy_id") or raw.get("policyId") or DEFAULT_POLICY_ID),
        version=str(raw.get("version") or DEFAULT_POLICY_VERSION),
        rules=rules,
    )


def _rule_matches_query(rule: AskPolicyRule, query: str) -> bool:
    if not rule.query_contains_any:
        return True
    normalized_query = _normalize_text(query)
    return any(_normalize_text(cue) in normalized_query for cue in rule.query_contains_any)


def _rule_matches_template(
    rule: AskPolicyRule,
    template_decision: Optional[dict[str, Any]],
) -> bool:
    if not rule.template_ids:
        return True
    template_id = str((template_decision or {}).get("template_id") or "")
    return template_id in rule.template_ids


def _normalized_set(values: Any) -> set[str]:
    return {
        _normalize_text(value)
        for value in _as_list(values)
        if _normalize_text(value)
    }


def _semantic_plan_values(
    semantic_plan: Optional[dict[str, Any]],
    key: str,
) -> set[str]:
    plan = semantic_plan or {}
    if key == "subject":
        return _normalized_set(plan.get("subject"))
    if key == "grain":
        return _normalized_set(plan.get("grain"))
    if key == "route":
        decision = (
            plan.get("decision") if isinstance(plan.get("decision"), dict) else {}
        )
        return _normalized_set(decision.get("route"))
    if key == "external_dependencies":
        decision = (
            plan.get("decision") if isinstance(plan.get("decision"), dict) else {}
        )
        return _normalized_set(
            [
                *(plan.get("external_dependencies") or []),
                *(decision.get("external_dependencies") or []),
            ]
        )
    return _normalized_set(plan.get(key) or [])


def _rule_values_match(rule_values: tuple[str, ...], plan_values: set[str]) -> bool:
    if not rule_values:
        return True
    normalized_rule_values = _normalized_set(rule_values)
    return bool(normalized_rule_values & plan_values)


def _rule_matches_semantic_plan(
    rule: AskPolicyRule,
    semantic_plan: Optional[dict[str, Any]],
) -> bool:
    return (
        _rule_values_match(
            rule.semantic_subjects,
            _semantic_plan_values(semantic_plan, "subject"),
        )
        and _rule_values_match(
            rule.semantic_features,
            _semantic_plan_values(semantic_plan, "features"),
        )
        and _rule_values_match(
            rule.semantic_metrics,
            _semantic_plan_values(semantic_plan, "metrics"),
        )
        and _rule_values_match(
            rule.semantic_dimensions,
            _semantic_plan_values(semantic_plan, "dimensions"),
        )
        and _rule_values_match(
            rule.semantic_grains,
            _semantic_plan_values(semantic_plan, "grain"),
        )
        and _rule_values_match(
            rule.semantic_routes,
            _semantic_plan_values(semantic_plan, "route"),
        )
        and _rule_values_match(
            rule.semantic_external_dependencies,
            _semantic_plan_values(semantic_plan, "external_dependencies"),
        )
        and all(
            _is_slot_resolved(semantic_plan, slot) for slot in rule.required_filters
        )
    )


def _is_slot_resolved(semantic_plan: Optional[dict[str, Any]], slot: str) -> bool:
    plan = semantic_plan or {}
    resolved_slots = plan.get("resolved_slots") or {}
    filters = plan.get("filters") or {}
    return slot in resolved_slots or slot in filters


def evaluate_policy_context(
    *,
    query: str,
    semantic_plan: Optional[dict[str, Any]] = None,
    template_decision: Optional[dict[str, Any]] = None,
    config: Optional[AskPolicyConfig] = None,
) -> AskPolicyEvaluation:
    config = config or AskPolicyConfig()
    reason_codes: list[str] = []
    forbidden_template_ids: list[str] = []
    required_slots: list[str] = []
    missing_required_slots: list[str] = []
    violations: list[dict[str, Any]] = []

    for rule in config.rules:
        if not _rule_matches_query(rule, query):
            continue
        if not _rule_matches_template(rule, template_decision):
            continue
        if not _rule_matches_semantic_plan(rule, semantic_plan):
            continue

        skip_required_slots = is_metadata_explanation_query(query) and bool(
            rule.required_slots
        )
        if skip_required_slots and not rule.forbidden_templates:
            continue

        if rule.reason_code not in reason_codes:
            reason_codes.append(rule.reason_code)

        current_template_id = str((template_decision or {}).get("template_id") or "")
        for template_id in rule.forbidden_templates:
            if current_template_id and current_template_id == template_id:
                forbidden_template_ids.append(template_id)
                violations.append(
                    {
                        "rule_id": rule.id,
                        "type": "forbidden_template",
                        "template_id": template_id,
                    }
                )

        if skip_required_slots:
            continue

        for slot in rule.required_slots:
            if slot not in required_slots:
                required_slots.append(slot)
            if not _is_slot_resolved(semantic_plan, slot):
                missing_required_slots.append(slot)
                violations.append(
                    {
                        "rule_id": rule.id,
                        "type": "missing_required_slot",
                        "slot": slot,
                    }
                )

    return AskPolicyEvaluation(
        policy_id=config.policy_id,
        policy_version=config.version,
        reason_codes=tuple(dict.fromkeys(reason_codes)),
        forbidden_template_ids=tuple(dict.fromkeys(forbidden_template_ids)),
        required_slots=tuple(dict.fromkeys(required_slots)),
        missing_required_slots=tuple(dict.fromkeys(missing_required_slots)),
        violations=tuple(violations),
    )
