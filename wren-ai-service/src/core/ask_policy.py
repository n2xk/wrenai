import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import yaml

DEFAULT_POLICY_ID = "semantic_governance"
DEFAULT_POLICY_VERSION = "semantic_governance_v1"


@dataclass(frozen=True)
class AskPolicyRule:
    id: str
    reason_code: str
    query_contains_any: tuple[str, ...] = ()
    template_ids: tuple[str, ...] = ()
    forbidden_templates: tuple[str, ...] = ()
    required_slots: tuple[str, ...] = ()


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


def _parse_rule(raw_rule: dict[str, Any], index: int) -> AskPolicyRule:
    when = raw_rule.get("when") if isinstance(raw_rule.get("when"), dict) else {}
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
