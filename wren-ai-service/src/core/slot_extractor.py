"""Shared slot extraction helpers for ask clarification and runtime planning.

The service layer and fixed-order runtime both need to understand the same
business slots (tenant, channel, dates, metric focus, and external dependency
supply).  Keeping the deterministic regex surface here prevents clarification
turns from parsing a value one way while the runtime parses it another way.
"""

from __future__ import annotations

import re
from typing import Any, Iterable, Optional, Sequence

DATE_PATTERN = re.compile(r"(20\d{2}-\d{2}-\d{2})")

_TENANT_PATTERNS = (
    r"tenant_plat_id\s*[=:：]?\s*((?:\d+\s*(?:,|，|、|和|与|及)?\s*)+)",
    r"租户平台\s*((?:\d+\s*(?:,|，|、|和|与|及)?\s*)+)",
    r"平台\s*((?:\d+\s*(?:,|，|、|和|与|及)?\s*)+)",
)
_CHANNEL_PATTERNS = (
    r"channel_id\s*[=:：]?\s*((?:\d+\s*(?:,|，|、|和|与|及|or|OR)?\s*)+)",
    r"渠道(?:ID|id)?\s*[=:：]?\s*((?:\d+\s*(?:,|，|、|和|与|及|or|OR)?\s*)+)",
)
_METRIC_FOCUS_PATTERN = re.compile(
    r"(ROI|投放|回本|充值|存款|投注|流水|首存|首充|续存|留存|流量|综合日报)",
    flags=re.IGNORECASE,
)


def _extract_integer_values(patterns: Sequence[str], text: str) -> list[int]:
    values: list[int] = []
    for pattern in patterns:
        for match in re.finditer(pattern, text, flags=re.IGNORECASE):
            matched_value = next((group for group in match.groups() if group), None)
            if not matched_value:
                continue
            for candidate in re.findall(r"\d+", matched_value):
                parsed = int(candidate)
                if parsed not in values:
                    values.append(parsed)
    return values


def extract_tenant_plat_ids(text: Optional[str]) -> list[int]:
    if not text:
        return []
    return _extract_integer_values(_TENANT_PATTERNS, DATE_PATTERN.sub(" ", text))


def extract_channel_ids(text: Optional[str]) -> list[int]:
    if not text:
        return []
    return _extract_integer_values(_CHANNEL_PATTERNS, DATE_PATTERN.sub(" ", text))


def extract_date_range(text: Optional[str]) -> dict[str, str]:
    dates = DATE_PATTERN.findall(text or "")
    if len(dates) >= 2:
        return {"start_date": dates[0], "end_date": dates[1]}
    if len(dates) == 1:
        return {"date": dates[0]}
    return {}


def external_dependency_id_from_slot(slot: str) -> str:
    for prefix in (
        "external_dependency:",
        "external_dependency.",
        "external_dependencies.",
    ):
        if slot.startswith(prefix):
            return slot[len(prefix) :].strip()
    return ""


def extract_slot_values_from_clarification_reply(
    *,
    query: str,
    pending_slots: Iterable[str],
    base_slot_values: Optional[dict[str, Any]] = None,
    request_slot_values: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Extract deterministic slot values from a clarification reply.

    Explicit request slot_values win over base session state.  Regex extraction
    only fills slots that are still absent, so multi-turn clarification carries
    earlier answers forward.
    """

    pending_slots = list(pending_slots or [])
    slot_values = {
        **dict(base_slot_values or {}),
        **dict(request_slot_values or {}),
    }
    query = query or ""

    if "tenant_plat_id" in pending_slots and "tenant_plat_id" not in slot_values:
        tenant_ids = extract_tenant_plat_ids(query)
        if not tenant_ids and "channel_id" not in pending_slots:
            tenant_ids = _extract_integer_values([r"([0-9]{4,})"], query)
        if tenant_ids:
            slot_values["tenant_plat_id"] = str(tenant_ids[0])

    if "channel_id" in pending_slots and "channel_id" not in slot_values:
        channel_ids = extract_channel_ids(query)
        if not channel_ids and "tenant_plat_id" not in pending_slots:
            channel_ids = _extract_integer_values([r"([0-9]{3,})"], query)
        if channel_ids:
            slot_values["channel_id"] = str(channel_ids[0])

    dates = DATE_PATTERN.findall(query)
    if "date_range" in pending_slots and "date_range" not in slot_values:
        if len(dates) >= 2:
            slot_values["date_range"] = {
                "start_date": dates[0],
                "end_date": dates[1],
            }
        elif len(dates) == 1:
            slot_values["date_range"] = {"date": dates[0]}

    if (
        "cohort_start_date" in pending_slots
        and "cohort_start_date" not in slot_values
        and dates
    ):
        slot_values["cohort_start_date"] = dates[0]
    if (
        "cohort_end_date" in pending_slots
        and "cohort_end_date" not in slot_values
        and len(dates) >= 2
    ):
        slot_values["cohort_end_date"] = dates[1]

    if "metric_focus" in pending_slots and "metric_focus" not in slot_values:
        metric_match = _METRIC_FOCUS_PATTERN.search(query)
        if metric_match:
            slot_values["metric_focus"] = metric_match.group(1)

    for pending_slot in pending_slots:
        dependency_id = external_dependency_id_from_slot(pending_slot)
        if not dependency_id:
            continue
        external_dependencies = slot_values.setdefault("external_dependencies", {})
        if not isinstance(external_dependencies, dict):
            external_dependencies = {}
            slot_values["external_dependencies"] = external_dependencies
        existing_supply = external_dependencies.get(dependency_id)
        raw_supply = slot_values.pop(pending_slot, None)
        if existing_supply:
            continue
        if raw_supply:
            external_dependencies[dependency_id] = raw_supply
        elif query.strip():
            external_dependencies[dependency_id] = query.strip()

    return slot_values


def normalize_question_skeleton(text: Optional[str]) -> str:
    """Mask volatile literal values while preserving question structure."""

    if not text:
        return ""
    normalized = str(text).strip().lower()
    normalized = DATE_PATTERN.sub(" [date] ", normalized)
    normalized = re.sub(r"\b20\d{6}\b", " [date] ", normalized)
    normalized = re.sub(r"\btop\s*\d+\b", " top[n] ", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"前\s*\d+\s*(名|个)?", "前[n]", normalized)
    normalized = re.sub(
        r"(tenant[_\s-]?plat[_\s-]?id|租户平台|平台)\s*[:：#=]?\s*\d+",
        r"\1 [tenant_id]",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(
        r"(channel[_\s-]?id|渠道)\s*[:：#=]?\s*\d+",
        r"\1 [channel_id]",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(r"\bd\s*\d+\b", " d[n] ", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\b\d+(?:\.\d+)?\b", " [num] ", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()
