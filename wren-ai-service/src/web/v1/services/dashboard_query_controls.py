import logging
from typing import Literal, Optional

from pydantic import BaseModel

from src.web.v1.services import BaseRequest

logger = logging.getLogger("wren-ai-service")


class DashboardQueryControlsProposalRequest(BaseRequest):
    query: Optional[str] = None
    sql: str
    timezone: Optional[str] = None


class DashboardQueryControlsTimeFilter(BaseModel):
    field: str
    kind: Literal["between", "gte_lte", "gte_lt"]
    start_literal: str
    end_literal: str
    end_literal_offset_days: int = 0


class DashboardQueryControlsProposalPayload(BaseModel):
    confidence: Literal["high", "medium", "low"]
    reason: Optional[str] = None
    time_filter: Optional[DashboardQueryControlsTimeFilter] = None


class DashboardQueryControlsProposalResponse(BaseModel):
    response: DashboardQueryControlsProposalPayload
    trace_id: Optional[str] = None


class DashboardQueryControlsProposalService:
    def __init__(self, pipelines: dict, **kwargs):
        self._pipelines = pipelines

    async def propose(
        self,
        request: DashboardQueryControlsProposalRequest,
    ) -> DashboardQueryControlsProposalResponse:
        result = await self._pipelines["dashboard_query_controls_proposal"].run(
            query=request.query or "",
            sql=request.sql,
            timezone=request.timezone or request.configurations.timezone.name or "UTC",
        )
        payload = DashboardQueryControlsProposalPayload.model_validate(
            result["post_process"]
        )
        return DashboardQueryControlsProposalResponse(response=payload)
