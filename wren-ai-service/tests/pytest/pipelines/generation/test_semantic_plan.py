from src.pipelines.generation.semantic_plan import (
    normalize_semantic_plan_response,
    post_process,
)


def test_normalize_semantic_plan_response_preserves_deterministic_guardrails():
    plan = normalize_semantic_plan_response(
        {
            "subject": "channel",
            "metrics": ["roi"],
            "filters": {"channel_id": 990011},
            "decision": {"reason_codes": ["llm_subject_match"]},
            "confidence": 0.77,
        },
        deterministic_plan={
            "intent": "TEXT_TO_SQL",
            "filters": {"tenant_plat_id": 990001},
            "missing_slots": ["tenant_plat_id"],
            "resolved_slots": {"tenant_plat_id": {"value": 990001}},
            "decision": {"route": "clarification_required"},
        },
    )

    assert plan["source"] == "llm"
    assert plan["subject"] == "channel"
    assert plan["filters"] == {"tenant_plat_id": 990001, "channel_id": 990011}
    assert plan["missing_slots"] == ["tenant_plat_id"]
    assert plan["resolved_slots"]["tenant_plat_id"]["value"] == 990001
    assert plan["decision"]["route"] == "clarification_required"
    assert plan["decision"]["reason_codes"] == ["llm_subject_match"]


def test_post_process_falls_back_to_deterministic_plan_on_invalid_reply():
    plan = post_process(
        {"replies": ["not-json"]},
        deterministic_plan={
            "version": "p1_structured_v1",
            "source": "deterministic",
            "intent": "TEXT_TO_SQL",
        },
    )

    assert plan["source"] == "deterministic"
    assert plan["intent"] == "TEXT_TO_SQL"
    assert plan["llm_error"] == "invalid_semantic_plan_response"
