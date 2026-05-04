from src.core.slot_extractor import (
    extract_channel_ids,
    extract_slot_values_from_clarification_reply,
    extract_tenant_plat_ids,
    normalize_question_skeleton,
)


def test_shared_slot_extractor_parses_core_business_slots():
    query = "租户平台990001，渠道990011，2026-04-01到2026-04-07，看ROI"

    assert extract_tenant_plat_ids(query) == [990001]
    assert extract_channel_ids(query) == [990011]
    assert extract_slot_values_from_clarification_reply(
        query=query,
        pending_slots=["tenant_plat_id", "channel_id", "date_range", "metric_focus"],
    ) == {
        "tenant_plat_id": "990001",
        "channel_id": "990011",
        "date_range": {
            "start_date": "2026-04-01",
            "end_date": "2026-04-07",
        },
        "metric_focus": "ROI",
    }


def test_shared_slot_extractor_carries_base_values_and_external_supply():
    values = extract_slot_values_from_clarification_reply(
        query="date,channel_id,ad_spend\n2026-04-01,990011,1000",
        pending_slots=["external_dependency:ad_spend"],
        base_slot_values={"tenant_plat_id": "990001"},
    )

    assert values == {
        "tenant_plat_id": "990001",
        "external_dependencies": {
            "ad_spend": "date,channel_id,ad_spend\n2026-04-01,990011,1000"
        },
    }


def test_question_skeleton_masks_literals_but_keeps_structure():
    assert normalize_question_skeleton(
        "统计渠道990011在2026-04-01充值金额"
    ) == normalize_question_skeleton("统计渠道880001在2025-01-01充值金额")
