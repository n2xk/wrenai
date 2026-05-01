import pytest

from src.pipelines.generation.dashboard_query_controls import (
    post_process,
)


@pytest.mark.asyncio
async def test_dashboard_query_controls_post_process_accepts_valid_json():
    result = await post_process(
        {
            "replies": [
                '{"confidence":"high","reason":"order date range","time_filter":{"field":"order_date","kind":"between","start_literal":"2026-04-03","end_literal":"2026-04-07","end_literal_offset_days":0}}'
            ]
        }
    )

    assert result["confidence"] == "high"
    assert result["time_filter"]["field"] == "order_date"
    assert result["time_filter"]["start_literal"] == "2026-04-03"


@pytest.mark.asyncio
async def test_dashboard_query_controls_post_process_falls_back_on_invalid_json():
    result = await post_process({"replies": ["not json"]})

    assert result["confidence"] == "low"
    assert result["time_filter"] is None
    assert result["reason"] == "invalid_dashboard_query_controls_proposal_response"
