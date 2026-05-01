from fastapi import APIRouter, Depends

from src.globals import ServiceContainer, get_service_container
from src.web.v1.services.dashboard_query_controls import (
    DashboardQueryControlsProposalRequest,
    DashboardQueryControlsProposalResponse,
)

router = APIRouter()


@router.post(
    "/dashboard-query-controls/proposal",
    response_model=DashboardQueryControlsProposalResponse,
)
async def propose(
    request: DashboardQueryControlsProposalRequest,
    service_container: ServiceContainer = Depends(get_service_container),
) -> DashboardQueryControlsProposalResponse:
    return await service_container.dashboard_query_controls_proposal_service.propose(
        request
    )
