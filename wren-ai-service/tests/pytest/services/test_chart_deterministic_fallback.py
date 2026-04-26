from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.web.v1.services.chart import ChartRequest, ChartResultRequest, ChartService


class RecordingPipeline(SimpleNamespace):
    def __init__(self, result=None):
        super().__init__(run=AsyncMock(return_value=result if result is not None else {}))


@pytest.mark.asyncio
async def test_chart_service_falls_back_to_grouped_bar_when_ai_returns_no_chart():
    chart_generation = RecordingPipeline(
        {"post_process": {"results": {"reasoning": "", "chart_type": "", "chart_schema": {}}}}
    )
    service = ChartService(
        pipelines={
            "chart_generation": chart_generation,
        }
    )

    request = ChartRequest.model_validate(
        {
            "query": "生成一张图表给我",
            "sql": "SELECT user_segment, deposit_amount, withdrawal_amount, valid_bet_amount FROM t",
            "data": {
                "columns": [
                    {"name": "user_segment", "type": "string"},
                    {"name": "deposit_amount", "type": "string"},
                    {"name": "withdrawal_amount", "type": "string"},
                    {"name": "valid_bet_amount", "type": "string"},
                ],
                "data": [
                    ["ALL", "3248.0000", "160.0000", "7300.0000"],
                    ["TOP3", "1160.0000", "60.0000", "7000.0000"],
                    ["NON_TOP3", "2088.0000", "100.0000", "300.0000"],
                ],
            },
            "configurations": {"language": "Traditional Chinese"},
        }
    )
    request.query_id = "chart-fallback-grouped-bar"

    result = await service.chart(request)
    chart_result = service.get_chart_result(
        ChartResultRequest(query_id=request.query_id)
    )

    assert chart_result.status == "finished"
    assert chart_result.response is not None
    assert chart_result.response.chart_type == "grouped_bar"
    assert chart_result.response.reasoning
    assert chart_result.response.chart_schema["encoding"]["x"]["field"] == "user_segment"
    assert chart_result.response.chart_schema["encoding"]["xOffset"]["field"] == "Metric"
    assert chart_result.response.chart_schema["transform"][0]["fold"] == [
        "deposit_amount",
        "withdrawal_amount",
        "valid_bet_amount",
    ]
    assert result["chart_result"]["chart_type"] == "grouped_bar"
    assert chart_generation.run.await_count == 1


@pytest.mark.asyncio
async def test_chart_service_falls_back_to_line_chart_for_temporal_series():
    chart_generation = RecordingPipeline(
        {"post_process": {"results": {"reasoning": "", "chart_type": "", "chart_schema": {}}}}
    )
    service = ChartService(
        pipelines={
            "chart_generation": chart_generation,
        }
    )

    request = ChartRequest.model_validate(
        {
            "query": "Plot the trend for me",
            "sql": "SELECT stat_date, revenue FROM t ORDER BY stat_date",
            "data": {
                "columns": [
                    {"name": "stat_date", "type": "date"},
                    {"name": "revenue", "type": "string"},
                ],
                "data": [
                    ["2026-04-01", "120.5"],
                    ["2026-04-02", "128.0"],
                    ["2026-04-03", "140.2"],
                ],
            },
            "configurations": {"language": "English"},
        }
    )
    request.query_id = "chart-fallback-line"

    await service.chart(request)
    chart_result = service.get_chart_result(
        ChartResultRequest(query_id=request.query_id)
    )

    assert chart_result.status == "finished"
    assert chart_result.response is not None
    assert chart_result.response.chart_type == "line"
    assert chart_result.response.chart_schema["encoding"]["x"]["field"] == "stat_date"
    assert chart_result.response.chart_schema["encoding"]["x"]["type"] == "temporal"
    assert chart_result.response.chart_schema["encoding"]["y"]["field"] == "revenue"
