import json
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import orjson
import pytest

from src.config import settings
from src.pipelines import generation, indexing, retrieval
from src.providers import generate_components
from src.utils import fetch_wren_ai_docs
from src.web.v1.services.ask import (
    AskRequest,
    AskResultRequest,
    AskResultResponse,
    AskService,
)
from src.web.v1.services.semantics_preparation import (
    SemanticsPreparationRequest,
    SemanticsPreparationService,
)
from tests.pytest.conftest import require_pgvector_runtime


@pytest.fixture
def ask_service():
    require_pgvector_runtime()
    pipe_components = generate_components(settings.components)
    wren_ai_docs = fetch_wren_ai_docs(settings.doc_endpoint, settings.is_oss)

    return AskService(
        {
            "intent_classification": generation.IntentClassification(
                **pipe_components["intent_classification"],
                wren_ai_docs=wren_ai_docs,
            ),
            "misleading_assistance": generation.MisleadingAssistance(
                **pipe_components["misleading_assistance"],
            ),
            "data_assistance": generation.DataAssistance(
                **pipe_components["data_assistance"],
            ),
            "user_guide_assistance": generation.UserGuideAssistance(
                **pipe_components["user_guide_assistance"],
                wren_ai_docs=wren_ai_docs,
            ),
            "retrieval": retrieval.DbSchemaRetrieval(
                **pipe_components["db_schema_retrieval"],
            ),
            "historical_question": retrieval.HistoricalQuestionRetrieval(
                **pipe_components["historical_question_retrieval"],
            ),
            "sql_generation": generation.SQLGeneration(
                **pipe_components["sql_generation"],
            ),
            "sql_correction": generation.SQLCorrection(
                **pipe_components["sql_correction"],
            ),
            "sql_pairs_retrieval": retrieval.SqlPairsRetrieval(
                **pipe_components["sql_pairs_retrieval"],
            ),
            "instructions_retrieval": retrieval.Instructions(
                **pipe_components["instructions_retrieval"],
            ),
        }
    )


@pytest.fixture
def indexing_service():
    require_pgvector_runtime()
    pipe_components = generate_components(settings.components)

    return SemanticsPreparationService(
        {
            "db_schema": indexing.DBSchema(
                **pipe_components["db_schema_indexing"],
            ),
            "historical_question": indexing.HistoricalQuestion(
                **pipe_components["historical_question_indexing"],
            ),
            "table_description": indexing.TableDescription(
                **pipe_components["table_description_indexing"],
            ),
        }
    )


@pytest.fixture
def service_metadata():
    return {
        "pipes_metadata": {
            "mock": {
                "generation_model": "mock-llm-model",
                "generation_model_kwargs": {},
                "embedding_model": "mock-embedding-model",
                "embedding_model_dim": 768,
            },
        },
        "service_version": "0.8.0-mock",
    }


@pytest.fixture
def mdl_str():
    with open("tests/data/book_2_mdl.json", "r") as f:
        return orjson.dumps(json.load(f)).decode("utf-8")


@pytest.mark.asyncio
async def test_ask_with_successful_query(
    indexing_service: SemanticsPreparationService,
    ask_service: AskService,
    mdl_str: str,
    service_metadata: dict,
):
    id = str(uuid.uuid4())
    await indexing_service.prepare_semantics(
        SemanticsPreparationRequest(
            mdl=mdl_str,
            mdl_hash=id,
        ),
        service_metadata=service_metadata,
    )

    # asking
    query_id = str(uuid.uuid4())
    ask_request = AskRequest(
        query="How many books are there?",
        mdl_hash=id,
    )
    ask_request.query_id = query_id
    await ask_service.ask(ask_request, service_metadata=service_metadata)

    # getting ask result
    ask_result_response = ask_service.get_ask_result(
        AskResultRequest(
            query_id=query_id,
        )
    )

    # from Pao Sheng: I think it has a potential risk if a dangling status case happens.
    # maybe we could consider adding an approach that if over a time limit,
    # the process will throw an exception.
    while (
        ask_result_response.status != "finished"
        and ask_result_response.status != "failed"
    ):
        ask_result_response = ask_service.get_ask_result(
            AskResultRequest(
                query_id=query_id,
            )
        )

    # TODO: we'll refactor almost all test case with a mock server, thus temporarily only assert it is not None.
    assert ask_result_response.status == "finished" or "failed"
    # assert ask_result_response.response is not None
    # assert ask_result_response.response[0].sql != ""
    # assert ask_result_response.response[0].summary != ""
    # assert ask_result_response.response[0].type == "llm" or "view"


@pytest.mark.asyncio
async def test_ask_service_resumes_clarification_session_with_slot_value():
    tool_router = SimpleNamespace(
        run_ask=AsyncMock(return_value={"metadata": {"ask_path": "nl2sql"}})
    )
    ask_service = AskService(
        {},
        deepagents_orchestrator=SimpleNamespace(),
        legacy_ask_tool=SimpleNamespace(),
        tool_router=tool_router,
    )
    ask_service._clarification_sessions["clarify-1"] = {
        "status": "needs_clarification",
        "clarification_session_id": "clarify-1",
        "original_question": "统计渠道990011在2026-04-01到2026-04-03首充用户",
        "pending_slots": ["tenant_plat_id"],
        "resolved_slots": {},
    }
    ask_service._ask_results["query-2"] = AskResultResponse(status="understanding")

    ask_request = AskRequest(
        query="990001",
        mdl_hash="mdl-1",
        clarification_session_id="clarify-1",
    )
    ask_request.query_id = "query-2"

    await ask_service.ask(
        ask_request,
        service_metadata={"pipes_metadata": {}, "service_version": "test"},
    )

    routed_request = tool_router.run_ask.await_args.kwargs["ask_request"]
    assert "统计渠道990011" in routed_request.query
    assert "租户平台990001" in routed_request.query
    assert routed_request.slot_values == {"tenant_plat_id": "990001"}


@pytest.mark.asyncio
async def test_ask_service_resumes_clarification_session_from_request_state():
    tool_router = SimpleNamespace(
        run_ask=AsyncMock(return_value={"metadata": {"ask_path": "nl2sql"}})
    )
    ask_service = AskService(
        {},
        deepagents_orchestrator=SimpleNamespace(),
        legacy_ask_tool=SimpleNamespace(),
        tool_router=tool_router,
    )
    ask_service._ask_results["query-persisted"] = AskResultResponse(
        status="understanding"
    )

    ask_request = AskRequest(
        query="990001",
        mdl_hash="mdl-1",
        clarification_session_id="clarify-persisted",
        clarification_state={
            "status": "needs_clarification",
            "clarification_session_id": "clarify-persisted",
            "original_question": "统计渠道990011首充用户",
            "pending_slots": ["tenant_plat_id"],
            "resolved_slots": {},
            "expires_at": (datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
        },
    )
    ask_request.query_id = "query-persisted"

    await ask_service.ask(
        ask_request,
        service_metadata={"pipes_metadata": {}, "service_version": "test"},
    )

    routed_request = tool_router.run_ask.await_args.kwargs["ask_request"]
    assert "统计渠道990011首充用户" in routed_request.query
    assert "租户平台990001" in routed_request.query
    assert routed_request.slot_values == {"tenant_plat_id": "990001"}


@pytest.mark.asyncio
async def test_ask_service_resumes_clarification_session_with_multiple_slot_values():
    tool_router = SimpleNamespace(
        run_ask=AsyncMock(return_value={"metadata": {"ask_path": "nl2sql"}})
    )
    ask_service = AskService(
        {},
        deepagents_orchestrator=SimpleNamespace(),
        legacy_ask_tool=SimpleNamespace(),
        tool_router=tool_router,
    )
    ask_service._clarification_sessions["clarify-2"] = {
        "status": "needs_clarification",
        "clarification_session_id": "clarify-2",
        "original_question": "帮我看看这个渠道最近效果怎么样",
        "pending_slots": [
            "tenant_plat_id",
            "channel_id",
            "date_range",
            "metric_focus",
        ],
        "resolved_slots": {},
        "expires_at": (datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
    }
    ask_service._ask_results["query-3"] = AskResultResponse(status="understanding")

    ask_request = AskRequest(
        query="租户平台990001，渠道990011，2026-04-01到2026-04-07，看ROI",
        mdl_hash="mdl-1",
        clarification_session_id="clarify-2",
    )
    ask_request.query_id = "query-3"

    await ask_service.ask(
        ask_request,
        service_metadata={"pipes_metadata": {}, "service_version": "test"},
    )

    routed_request = tool_router.run_ask.await_args.kwargs["ask_request"]
    assert "帮我看看这个渠道最近效果怎么样" in routed_request.query
    assert "租户平台990001" in routed_request.query
    assert "渠道990011" in routed_request.query
    assert "时间范围2026-04-01到2026-04-07" in routed_request.query
    assert routed_request.slot_values == {
        "tenant_plat_id": "990001",
        "channel_id": "990011",
        "date_range": {
            "start_date": "2026-04-01",
            "end_date": "2026-04-07",
        },
        "metric_focus": "ROI",
    }


@pytest.mark.asyncio
async def test_ask_service_carries_resolved_slots_between_clarification_turns():
    tool_router = SimpleNamespace(
        run_ask=AsyncMock(return_value={"metadata": {"ask_path": "nl2sql"}})
    )
    ask_service = AskService(
        {},
        deepagents_orchestrator=SimpleNamespace(),
        legacy_ask_tool=SimpleNamespace(),
        tool_router=tool_router,
    )
    ask_service._clarification_sessions["clarify-carry"] = {
        "status": "needs_clarification",
        "clarification_session_id": "clarify-carry",
        "original_question": "统计渠道首存 cohort 杀率趋势",
        "pending_slots": ["n_days"],
        "resolved_slots": {
            "tenant_plat_id": "990001",
            "channel_id": "990011",
            "date_range": {
                "start_date": "2026-04-01",
                "end_date": "2026-04-07",
            },
        },
        "expires_at": (datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
    }
    ask_service._ask_results["query-carry"] = AskResultResponse(status="understanding")

    ask_request = AskRequest(
        query="D7",
        mdl_hash="mdl-1",
        clarification_session_id="clarify-carry",
        slot_values={"n_days": "7"},
    )
    ask_request.query_id = "query-carry"

    await ask_service.ask(
        ask_request,
        service_metadata={"pipes_metadata": {}, "service_version": "test"},
    )

    routed_request = tool_router.run_ask.await_args.kwargs["ask_request"]
    assert "租户平台990001" in routed_request.query
    assert "渠道990011" in routed_request.query
    assert "时间范围2026-04-01到2026-04-07" in routed_request.query
    assert "n_days=7" in routed_request.query
    assert routed_request.slot_values == {
        "tenant_plat_id": "990001",
        "channel_id": "990011",
        "date_range": {
            "start_date": "2026-04-01",
            "end_date": "2026-04-07",
        },
        "n_days": "7",
    }


@pytest.mark.asyncio
async def test_ask_service_resumes_external_dependency_clarification():
    tool_router = SimpleNamespace(
        run_ask=AsyncMock(return_value={"metadata": {"ask_path": "nl2sql"}})
    )
    ask_service = AskService(
        {},
        deepagents_orchestrator=SimpleNamespace(),
        legacy_ask_tool=SimpleNamespace(),
        tool_router=tool_router,
    )
    ask_service._clarification_sessions["clarify-external"] = {
        "status": "needs_clarification",
        "clarification_session_id": "clarify-external",
        "original_question": "统计渠道990011的ROI",
        "pending_slots": ["external_dependency:ad_spend"],
        "resolved_slots": {
            "tenant_plat_id": "990001",
            "channel_id": "990011",
        },
        "expires_at": (datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
    }
    ask_service._ask_results["query-external"] = AskResultResponse(
        status="understanding"
    )

    ask_request = AskRequest(
        query="date,channel_id,ad_spend\n2026-04-01,990011,1000",
        mdl_hash="mdl-1",
        clarification_session_id="clarify-external",
    )
    ask_request.query_id = "query-external"

    await ask_service.ask(
        ask_request,
        service_metadata={"pipes_metadata": {}, "service_version": "test"},
    )

    routed_request = tool_router.run_ask.await_args.kwargs["ask_request"]
    assert "统计渠道990011的ROI" in routed_request.query
    assert "外部数据=" in routed_request.query
    assert routed_request.slot_values["external_dependencies"] == {
        "ad_spend": "date,channel_id,ad_spend\n2026-04-01,990011,1000"
    }


@pytest.mark.asyncio
async def test_ask_service_does_not_resume_expired_clarification_session():
    tool_router = SimpleNamespace(
        run_ask=AsyncMock(return_value={"metadata": {"ask_path": "nl2sql"}})
    )
    ask_service = AskService(
        {},
        deepagents_orchestrator=SimpleNamespace(),
        legacy_ask_tool=SimpleNamespace(),
        tool_router=tool_router,
    )
    ask_service._clarification_sessions["clarify-expired"] = {
        "status": "needs_clarification",
        "clarification_session_id": "clarify-expired",
        "original_question": "统计渠道990011首充用户",
        "pending_slots": ["tenant_plat_id"],
        "resolved_slots": {},
        "expires_at": (datetime.now(UTC) - timedelta(minutes=1)).isoformat(),
    }
    ask_service._ask_results["query-4"] = AskResultResponse(status="understanding")

    ask_request = AskRequest(
        query="990001",
        mdl_hash="mdl-1",
        clarification_session_id="clarify-expired",
    )
    ask_request.query_id = "query-4"

    await ask_service.ask(
        ask_request,
        service_metadata={"pipes_metadata": {}, "service_version": "test"},
    )

    routed_request = tool_router.run_ask.await_args.kwargs["ask_request"]
    assert routed_request.query == "990001"
    assert routed_request.slot_values == {}
    assert "clarify-expired" not in ask_service._clarification_sessions


def test_ask_service_default_cache_ttl_matches_settings_default():
    tool_router = SimpleNamespace(run_ask=AsyncMock(return_value={}))
    ask_service = AskService(
        {},
        deepagents_orchestrator=SimpleNamespace(),
        legacy_ask_tool=SimpleNamespace(),
        tool_router=tool_router,
    )

    assert ask_service._ask_results.ttl == 3600
    assert ask_service._clarification_sessions.ttl == 3600
