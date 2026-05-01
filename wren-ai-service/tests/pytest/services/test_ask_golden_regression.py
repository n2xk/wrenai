import asyncio
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.web.v1.services.ask import AskRequest, AskResultRequest, AskService


class RecordingPipeline(SimpleNamespace):
    def __init__(self, result=None):
        super().__init__(run=AsyncMock(return_value=result if result is not None else {}))


def _sql_generation_result(valid_sql=None, invalid_generation_result=None):
    return {
        "post_process": {
            "valid_generation_result": {"sql": valid_sql} if valid_sql else None,
            "invalid_generation_result": invalid_generation_result,
        }
    }


def _template_validation_result(valid_sql=None, invalid_generation_result=None):
    return {
        "valid_generation_result": {"sql": valid_sql} if valid_sql else {},
        "invalid_generation_result": invalid_generation_result or {},
    }


def build_ask_pipelines(scenario: dict) -> dict[str, RecordingPipeline]:
    pipelines = {
        "historical_question": RecordingPipeline(
            {"formatted_output": {"documents": scenario.get("historical_documents", [])}}
        ),
        "sql_pairs_retrieval": RecordingPipeline(
            {"formatted_output": {"documents": scenario.get("sql_pairs_documents", [])}}
        ),
        "instructions_retrieval": RecordingPipeline(
            {
                "formatted_output": {
                    "documents": scenario.get("instructions_documents", [])
                }
            }
        ),
        "intent_classification": RecordingPipeline(
            {
                "post_process": {
                    "intent": scenario.get("intent", "TEXT_TO_SQL"),
                    "db_schemas": scenario.get("db_schemas", []),
                    "reasoning": scenario.get("intent_reasoning", "needs sql"),
                    "rephrased_question": scenario.get("rephrased_question"),
                }
            }
        ),
        "db_schema_retrieval": RecordingPipeline(
            {
                "construct_retrieval_results": {
                    "retrieval_results": scenario.get("schema_documents", []),
                    "has_calculated_field": scenario.get(
                        "has_calculated_field", False
                    ),
                    "has_metric": scenario.get("has_metric", False),
                    "has_json_field": scenario.get("has_json_field", False),
                }
            }
        ),
        "sql_generation_reasoning": RecordingPipeline(
            {"post_process": scenario.get("sql_generation_reasoning", "reasoning")}
        ),
        "followup_sql_generation_reasoning": RecordingPipeline(
            {
                "post_process": scenario.get(
                    "followup_sql_generation_reasoning", "followup reasoning"
                )
            }
        ),
        "sql_generation": RecordingPipeline(
            _sql_generation_result(
                valid_sql=scenario.get("sql_generation", {}).get("valid_sql"),
                invalid_generation_result=scenario.get("sql_generation", {}).get(
                    "invalid_generation_result"
                ),
            )
        ),
        "followup_sql_generation": RecordingPipeline(
            _sql_generation_result(
                valid_sql=scenario.get("followup_sql_generation", {}).get("valid_sql"),
                invalid_generation_result=scenario.get(
                    "followup_sql_generation", {}
                ).get("invalid_generation_result"),
            )
        ),
        "sql_functions_retrieval": RecordingPipeline([]),
        "sql_knowledge_retrieval": RecordingPipeline([]),
        "sql_diagnosis": RecordingPipeline(
            {
                "post_process": {
                    "reasoning": scenario.get("sql_diagnosis_reasoning", "diagnosis")
                }
            }
        ),
        "sql_correction": RecordingPipeline(
            _sql_generation_result(
                valid_sql=scenario.get("sql_correction", {}).get("valid_sql"),
                invalid_generation_result=scenario.get("sql_correction", {}).get(
                    "invalid_generation_result"
                ),
            )
        ),
        "misleading_assistance": RecordingPipeline({"status": "ok"}),
        "data_assistance": RecordingPipeline({"status": "ok"}),
        "user_guide_assistance": RecordingPipeline({"status": "ok"}),
    }
    if "template_sql_validation" in scenario:
        pipelines["template_sql_validation"] = RecordingPipeline(
            _template_validation_result(
                valid_sql=scenario.get("template_sql_validation", {}).get("valid_sql"),
                invalid_generation_result=scenario.get(
                    "template_sql_validation", {}
                ).get("invalid_generation_result"),
            )
        )
    return pipelines


def make_request(case: dict) -> AskRequest:
    request = AskRequest.model_validate(
        {
            "query": case["query"],
            "mdl_hash": "mdl-1",
            "histories": case.get("histories", []),
            "skills": case.get("skills", []),
        }
    )
    request.query_id = str(uuid.uuid4())
    return request


ASK_CASES = [
    {
        "name": "historical",
        "query": "本月 GMV",
        "scenario": {
            "historical_documents": [{"statement": "SELECT 1", "viewId": None}],
        },
        "expected": {
            "status": "finished",
            "type": "TEXT_TO_SQL",
            "path": "historical",
            "sql": "SELECT 1",
        },
    },
    {
        "name": "sql_pairs",
        "query": "本月 GMV",
        "scenario": {
            "sql_pairs_documents": [{"question": "GMV", "sql": "SELECT amount"}],
            "schema_documents": [
                {"table_name": "orders", "table_ddl": "CREATE TABLE orders(id bigint);"}
            ],
            "sql_generation": {"valid_sql": "SELECT amount FROM orders"},
        },
        "expected": {
            "status": "finished",
            "type": "TEXT_TO_SQL",
            "path": "sql_pairs",
            "sql": "SELECT amount FROM orders",
        },
    },
    {
        "name": "sql_pairs_without_schema",
        "query": "本月 GMV",
        "scenario": {
            "sql_pairs_documents": [{"question": "GMV", "sql": "SELECT amount"}],
            "schema_documents": [],
            "sql_generation": {"valid_sql": "SELECT amount FROM orders"},
        },
        "expected": {
            "status": "finished",
            "type": "TEXT_TO_SQL",
            "path": "sql_pairs",
            "sql": "SELECT amount FROM orders",
        },
    },
    {
        "name": "instructions",
        "query": "本月 GMV",
        "scenario": {
            "instructions_documents": [{"instruction": "仅统计已支付订单"}],
            "schema_documents": [
                {"table_name": "orders", "table_ddl": "CREATE TABLE orders(id bigint);"}
            ],
            "sql_generation": {"valid_sql": "SELECT paid_amount FROM orders"},
        },
        "expected": {
            "status": "finished",
            "type": "TEXT_TO_SQL",
            "path": "instructions",
            "sql": "SELECT paid_amount FROM orders",
        },
    },
    {
        "name": "nl2sql",
        "query": "本月 GMV",
        "scenario": {
            "schema_documents": [
                {"table_name": "orders", "table_ddl": "CREATE TABLE orders(id bigint);"}
            ],
            "sql_generation": {"valid_sql": "SELECT count(*) FROM orders"},
        },
        "expected": {
            "status": "finished",
            "type": "TEXT_TO_SQL",
            "path": "nl2sql",
            "sql": "SELECT count(*) FROM orders",
        },
    },
    {
        "name": "followup",
        "query": "那上个月呢",
        "histories": [{"question": "本月 GMV", "sql": "SELECT 1"}],
        "scenario": {
            "schema_documents": [
                {"table_name": "orders", "table_ddl": "CREATE TABLE orders(id bigint);"}
            ],
            "followup_sql_generation": {"valid_sql": "SELECT 2"},
        },
        "expected": {
            "status": "finished",
            "type": "TEXT_TO_SQL",
            "path": "followup",
            "sql": "SELECT 2",
            "isFollowup": True,
        },
    },
    {
        "name": "correction",
        "query": "本月 GMV",
        "scenario": {
            "schema_documents": [
                {"table_name": "orders", "table_ddl": "CREATE TABLE orders(id bigint);"}
            ],
            "sql_generation": {
                "invalid_generation_result": {
                    "type": "EXECUTION_ERROR",
                    "original_sql": "SELECT broken",
                    "sql": "SELECT broken",
                    "error": "syntax error",
                }
            },
            "sql_correction": {"valid_sql": "SELECT fixed_sql"},
        },
        "expected": {
            "status": "finished",
            "type": "TEXT_TO_SQL",
            "path": "correction",
            "sql": "SELECT fixed_sql",
        },
    },
    {
        "name": "general",
        "query": "你是谁",
        "scenario": {
            "intent": "GENERAL",
        },
        "expected": {
            "status": "finished",
            "type": "GENERAL",
            "path": "general",
            "generalType": "DATA_ASSISTANCE",
        },
    },
]


def assert_runtime_metadata(metadata: dict) -> None:
    assert metadata["ask_runtime_mode"] == "deepagents"
    assert metadata["primary_runtime"] == "deepagents"
    assert metadata["resolved_runtime"] == "deepagents"
    assert metadata["deepagents_fallback"] is False
    assert metadata.get("fallback_reason") is None


@pytest.mark.asyncio
@pytest.mark.parametrize("case", ASK_CASES, ids=lambda case: case["name"])
async def test_ask_golden_regression_baseline(case: dict):
    pipelines = build_ask_pipelines(case["scenario"])
    service = AskService(
        pipelines=pipelines,
        ask_runtime_mode="deepagents",
    )
    request = make_request(case)

    result = await service.ask(request)
    await asyncio.sleep(0)
    ask_result = service.get_ask_result(AskResultRequest(query_id=request.query_id))
    expected = case["expected"]

    assert ask_result.status == expected["status"]
    assert ask_result.type == expected["type"]
    assert result["metadata"]["type"] == expected["type"]
    assert result["metadata"]["ask_path"] == expected["path"]
    assert ask_result.ask_path == expected["path"]

    if expected["type"] == "TEXT_TO_SQL":
        assert ask_result.response is not None
        assert ask_result.response[0].sql == expected["sql"]
    else:
        assert ask_result.response is None
        assert ask_result.general_type == expected["generalType"]

    if expected.get("isFollowup") is not None:
        assert ask_result.is_followup == expected["isFollowup"]

    assert_runtime_metadata(result["metadata"])


@pytest.mark.asyncio
async def test_sql_correction_continues_when_sql_diagnosis_parsing_fails():
    case = {
        "query": "本月 GMV",
        "scenario": {
            "schema_documents": [
                {"table_name": "orders", "table_ddl": "CREATE TABLE orders(id bigint);"}
            ],
            "sql_generation": {
                "invalid_generation_result": {
                    "type": "EXECUTION_ERROR",
                    "original_sql": "SELECT broken",
                    "sql": "SELECT broken",
                    "error": "syntax error",
                }
            },
            "sql_correction": {"valid_sql": "SELECT fixed_sql"},
        },
    }
    pipelines = build_ask_pipelines(case["scenario"])
    pipelines["sql_diagnosis"].run.side_effect = ValueError(
        "unexpected character: line 2 column 69 (char 70)"
    )
    service = AskService(pipelines=pipelines, ask_runtime_mode="deepagents")
    request = make_request(case)

    result = await service.ask(request)
    ask_result = service.get_ask_result(AskResultRequest(query_id=request.query_id))

    assert result["metadata"]["ask_path"] == "correction"
    assert ask_result.status == "finished"
    assert ask_result.response is not None
    assert ask_result.response[0].sql == "SELECT fixed_sql"
    correction_kwargs = pipelines["sql_correction"].run.await_args.kwargs
    assert correction_kwargs["invalid_generation_result"]["error"] == "syntax error"


@pytest.mark.asyncio
async def test_ask_reports_template_decision_for_sql_pairs():
    case = {
        "query": "首存金额分桶",
        "scenario": {
            "sql_pairs_documents": [
                {
                    "id": "template-13",
                    "question": "首存金额分桶",
                    "sql": "SELECT bucket, COUNT(*) FROM deposits GROUP BY bucket",
                    "asset_kind": "sql_template",
                    "template_level": "L2",
                    "template_mode": "anchored_template",
                    "source_type": "business_import",
                    "score": 0.95,
                }
            ],
            "schema_documents": [
                {
                    "table_name": "deposits",
                    "table_ddl": "CREATE TABLE deposits(amount int, bucket varchar);",
                }
            ],
            "template_sql_validation": {
                "valid_sql": "SELECT bucket, COUNT(*) FROM deposits GROUP BY bucket"
            },
        },
    }
    pipelines = build_ask_pipelines(case["scenario"])
    service = AskService(pipelines=pipelines, ask_runtime_mode="deepagents")
    request = make_request(case)

    result = await service.ask(request)
    ask_result = service.get_ask_result(AskResultRequest(query_id=request.query_id))

    assert result["metadata"]["ask_path"] == "sql_pairs"
    assert result["metadata"]["template_decision"]["mode"] == "anchored_template"
    assert result["metadata"]["template_decision"]["template_id"] == "template-13"
    assert result["metadata"]["template_decision"]["instruction_count"] == 0
    assert result["metadata"]["template_decision"]["retrieved_table_count"] == 1
    assert result["metadata"]["template_decision"]["dry_run_compatible"] is True
    assert ask_result.template_decision is not None
    assert ask_result.template_decision.mode == "anchored_template"
    assert ask_result.template_decision.retrieved_table_count == 1
    assert ask_result.template_decision.dry_run_compatible is True
    assert ask_result.response[0].type == "sql_pair"
    assert ask_result.response[0].sqlpairId == "template-13"
    assert (
        pipelines["template_sql_validation"].run.await_args.kwargs["sql_mode"]
        == "dialect"
    )


@pytest.mark.asyncio
async def test_ask_renders_generic_segment_breakdown_from_template_context_top_n():
    template_sql = (
        "SELECT :tenant_plat_id AS tenant_plat_id, "
        ":channel_id AS channel_id, :start_date AS start_date, "
        ":end_date AS end_date, :user_segment AS user_segment, "
        ":top_n AS top_n"
    )
    case = {
        "query": (
            "统计 tenant_plat_id=990001、channel_id=990011 在 2026-04-01 到 "
            "2026-04-07 指定区间内全部用户/分层用户的存款、充提差、"
            "有效投注、输赢、投充比、杀率。"
        ),
        "scenario": {
            "sql_pairs_documents": [
                {
                    "id": "template-09-generic",
                    "question": "统计某渠道在指定区间内全部用户/分层用户的存款、充提差、有效投注、输赢、投充比、杀率",
                    "sql": template_sql,
                    "asset_kind": "sql_template",
                    "template_level": "L2",
                    "template_mode": "anchored_template",
                    "source_type": "business_import",
                    "score": 0.97,
                },
                {
                    "id": "template-09-canonical",
                    "title": "所有用户区间汇总",
                    "question": (
                        "所有用户区间汇总；统计某渠道在指定区间内全部用户的投充比和杀率；"
                        "统计某渠道 TOP3 用户的投充比和杀率；"
                        "统计某渠道在指定区间内全部用户/分层用户的存款、充提差、"
                        "有效投注、输赢、投充比、杀率"
                    ),
                    "sql": template_sql,
                        "asset_kind": "sql_template",
                        "template_level": "L2",
                        "template_mode": "anchored_template",
                        "source_type": "business_import",
                        "score": 0.10,
                        "business_signature": {
                        "templateId": "T09",
                        "questionVariants": [
                            "统计某渠道在指定区间内全部用户的投充比和杀率",
                            "统计某渠道 TOP3 用户的投充比和杀率",
                            "统计某渠道在指定区间内全部用户/分层用户的存款、充提差、有效投注、输赢、投充比、杀率",
                        ],
                    },
                }
            ],
            "schema_documents": [
                {
                    "table_name": "dwd_bet_order",
                    "table_ddl": "CREATE TABLE dwd_bet_order(player_id bigint);",
                }
            ],
            "template_sql_validation": {"valid_sql": "SELECT 1"},
        },
    }
    pipelines = build_ask_pipelines(case["scenario"])

    async def _validate_template_sql(**kwargs):
        sql = kwargs["sql"]
        assert kwargs["sql_mode"] == "dialect"
        assert sql.count("UNION ALL") == 2
        assert "'ALL' AS user_segment" in sql
        assert "'TOPN' AS user_segment" in sql
        assert "'NON_TOPN' AS user_segment" in sql
        assert "3 AS top_n" in sql
        return _template_validation_result(valid_sql=sql)

    pipelines["template_sql_validation"].run.side_effect = _validate_template_sql
    service = AskService(pipelines=pipelines, ask_runtime_mode="deepagents")
    request = make_request(case)

    result = await service.ask(request)
    ask_result = service.get_ask_result(AskResultRequest(query_id=request.query_id))

    assert result["metadata"]["ask_path"] == "sql_pairs"
    assert result["metadata"]["template_decision"]["mode"] == "anchored_template"
    assert result["metadata"]["template_decision"]["sql_source"] == "anchored_template"
    assert result["metadata"]["template_decision"]["fallback_reason"] is None
    assert result["metadata"]["template_decision"]["parameters"] == {
        "tenant_plat_id": 990001,
        "channel_id": 990011,
        "start_date": "2026-04-01",
        "end_date": "2026-04-07",
        "user_segment": ["ALL", "TOPN", "NON_TOPN"],
        "top_n": 3,
    }
    assert ask_result.template_decision is not None
    assert ask_result.template_decision.sql_source == "anchored_template"
    assert ask_result.response is not None
    assert ask_result.response[0].type == "sql_pair"
    assert ask_result.response[0].sqlpairId == "template-09-generic"
    assert "'NON_TOPN' AS user_segment" in ask_result.response[0].sql


@pytest.mark.asyncio
async def test_ask_rewrites_direct_template_to_retrieved_physical_tables():
    template_sql = (
        "SELECT p.id, d.player_id "
        "FROM dim_player p "
        "JOIN dwd_order_deposit d ON d.player_id = p.id "
        "WHERE p.tenant_plat_id = :tenant_plat_id "
        "AND p.channel_id = :channel_id "
        "AND p.create_time >= :start_date "
        "AND p.create_time < DATE_ADD(:end_date, INTERVAL 1 DAY)"
    )
    case = {
        "query": (
            "统计 tenant_plat_id=990001、channel_id=990011 在 "
            "2026-04-01 到 2026-04-07 的注册与存款关联数据。"
        ),
        "scenario": {
            "sql_pairs_documents": [
                {
                    "id": "template-01",
                    "question": "注册与存款关联数据",
                    "sql": template_sql,
                    "asset_kind": "sql_template",
                    "template_level": "L2",
                    "template_mode": "anchored_template",
                    "source_type": "business_import",
                    "score": 0.95,
                    "business_signature": {
                        "sourceTables": ["dim_player", "dwd_order_deposit"],
                    },
                }
            ],
            "schema_documents": [
                {
                    "table_name": "tidb_business_demo_dim_player",
                    "table_ddl": "CREATE TABLE tidb_business_demo_dim_player(id bigint);",
                },
                {
                    "table_name": "tidb_business_demo_dwd_order_deposit",
                    "table_ddl": "CREATE TABLE tidb_business_demo_dwd_order_deposit(player_id bigint);",
                },
            ],
            "template_sql_validation": {
                "valid_sql": (
                    "SELECT p.id, d.player_id "
                    "FROM tidb_business_demo_dim_player p "
                    "JOIN tidb_business_demo_dwd_order_deposit d ON d.player_id = p.id "
                    "WHERE p.tenant_plat_id = 990001 "
                    "AND p.channel_id = 990011 "
                    "AND p.create_time >= '2026-04-01' "
                    "AND p.create_time < DATE_ADD('2026-04-07', INTERVAL 1 DAY)"
                )
            },
        },
    }
    pipelines = build_ask_pipelines(case["scenario"])

    async def _validate_template_sql(**kwargs):
        assert "FROM tidb_business_demo_dim_player p" in kwargs["sql"]
        assert "JOIN tidb_business_demo_dwd_order_deposit d" in kwargs["sql"]
        assert "FROM dim_player p" not in kwargs["sql"]
        return _template_validation_result(valid_sql=kwargs["sql"])

    pipelines["template_sql_validation"].run.side_effect = _validate_template_sql
    service = AskService(pipelines=pipelines, ask_runtime_mode="deepagents")
    request = make_request(case)

    result = await service.ask(request)
    ask_result = service.get_ask_result(AskResultRequest(query_id=request.query_id))

    assert result["metadata"]["ask_path"] == "sql_pairs"
    assert ask_result.status == "finished"
    assert ask_result.response is not None
    assert ask_result.response[0].type == "sql_pair"
    assert "tidb_business_demo_dim_player" in ask_result.response[0].sql
    assert "tidb_business_demo_dwd_order_deposit" in ask_result.response[0].sql


@pytest.mark.asyncio
async def test_ask_validates_direct_template_when_schema_retrieval_is_empty():
    template_sql = (
        "SELECT d.player_id, SUM(d.actual_amount) AS deposit_amount "
        "FROM dwd_order_deposit d "
        "WHERE d.tenant_plat_id = :tenant_plat_id "
        "AND d.channel_id = :channel_id "
        "AND d.callback_time >= :start_date "
        "AND d.callback_time < DATE_ADD(:end_date, INTERVAL 1 DAY) "
        "GROUP BY d.player_id"
    )
    case = {
        "query": (
            "统计租户平台990001下渠道990011在2026-04-01到2026-04-07"
            "的充值用户和金额"
        ),
        "scenario": {
            "sql_pairs_documents": [
                {
                    "id": "template-direct-no-schema",
                    "question": "充值用户和金额",
                    "sql": template_sql,
                    "asset_kind": "sql_template",
                    "template_level": "L2",
                    "template_mode": "anchored_template",
                    "source_type": "business_import",
                    "score": 0.95,
                    "business_signature": {
                        "sourceTables": ["dwd_order_deposit"],
                    },
                }
            ],
            "schema_documents": [],
            "template_sql_validation": {"valid_sql": "SELECT 1"},
        },
    }
    pipelines = build_ask_pipelines(case["scenario"])

    async def _validate_template_sql(**kwargs):
        assert "FROM dwd_order_deposit d" in kwargs["sql"]
        assert "tenant_plat_id = 990001" in kwargs["sql"]
        assert "channel_id = 990011" in kwargs["sql"]
        return _template_validation_result(valid_sql=kwargs["sql"])

    pipelines["template_sql_validation"].run.side_effect = _validate_template_sql
    service = AskService(pipelines=pipelines, ask_runtime_mode="deepagents")
    request = make_request(case)

    result = await service.ask(request)
    ask_result = service.get_ask_result(AskResultRequest(query_id=request.query_id))

    assert result["metadata"]["ask_path"] == "sql_pairs"
    assert result["metadata"]["template_decision"]["schema_compatible"] is True
    assert ask_result.status == "finished"
    assert ask_result.response is not None
    assert ask_result.response[0].type == "sql_pair"
    assert ask_result.response[0].sqlpairId == "template-direct-no-schema"
    pipelines["sql_generation"].run.assert_not_called()


@pytest.mark.asyncio
async def test_ask_rewrites_direct_template_with_inferred_workspace_prefix():
    template_sql = (
        "SELECT p.id, d.player_id, l.player_id "
        "FROM dim_player p "
        "JOIN dwd_order_deposit d ON d.player_id = p.id "
        "JOIN dwd_player_login_log l ON l.player_id = p.id "
        "WHERE p.tenant_plat_id = :tenant_plat_id "
        "AND p.channel_id = :channel_id "
        "AND p.create_time >= :start_date "
        "AND p.create_time < DATE_ADD(:end_date, INTERVAL 1 DAY)"
    )
    case = {
        "query": (
            "统计 tenant_plat_id=990001、channel_id=990011 在 "
            "2026-04-01 到 2026-04-07 的注册、登录与存款关联数据。"
        ),
        "scenario": {
            "sql_pairs_documents": [
                {
                    "id": "template-01",
                    "question": "注册、登录与存款关联数据",
                    "sql": template_sql,
                    "asset_kind": "sql_template",
                    "template_level": "L2",
                    "template_mode": "anchored_template",
                    "source_type": "business_import",
                    "score": 0.95,
                    "business_signature": {
                        "sourceTables": [
                            "dim_player",
                            "dwd_order_deposit",
                            "dwd_player_login_log",
                            "dwd_order_rebate",
                        ],
                    },
                }
            ],
            "schema_documents": [
                {
                    "table_name": "tidb_business_demo_dwd_order_rebate",
                    "table_ddl": "CREATE TABLE tidb_business_demo_dwd_order_rebate(id bigint);",
                },
                {
                    "table_name": "tidb_business_demo_dwd_order_task",
                    "table_ddl": "CREATE TABLE tidb_business_demo_dwd_order_task(id bigint);",
                },
                {
                    "table_name": "tidb_business_demo_dwd_bet_order",
                    "table_ddl": "CREATE TABLE tidb_business_demo_dwd_bet_order(id bigint);",
                },
            ],
            "template_sql_validation": {
                "valid_sql": (
                    "SELECT p.id, d.player_id, l.player_id "
                    "FROM tidb_business_demo_dim_player p "
                    "JOIN tidb_business_demo_dwd_order_deposit d ON d.player_id = p.id "
                    "JOIN tidb_business_demo_dwd_player_login_log l ON l.player_id = p.id "
                    "WHERE p.tenant_plat_id = 990001 "
                    "AND p.channel_id = 990011 "
                    "AND p.create_time >= '2026-04-01' "
                    "AND p.create_time < DATE_ADD('2026-04-07', INTERVAL 1 DAY)"
                )
            },
        },
    }
    pipelines = build_ask_pipelines(case["scenario"])

    async def _validate_template_sql(**kwargs):
        assert "FROM tidb_business_demo_dim_player p" in kwargs["sql"]
        assert "JOIN tidb_business_demo_dwd_order_deposit d" in kwargs["sql"]
        assert "JOIN tidb_business_demo_dwd_player_login_log l" in kwargs["sql"]
        assert "FROM dim_player p" not in kwargs["sql"]
        return _template_validation_result(valid_sql=kwargs["sql"])

    pipelines["template_sql_validation"].run.side_effect = _validate_template_sql
    service = AskService(pipelines=pipelines, ask_runtime_mode="deepagents")
    request = make_request(case)

    result = await service.ask(request)
    ask_result = service.get_ask_result(AskResultRequest(query_id=request.query_id))

    assert result["metadata"]["ask_path"] == "sql_pairs"
    assert ask_result.status == "finished"
    assert ask_result.response is not None
    assert ask_result.response[0].type == "sql_pair"
    assert "tidb_business_demo_dim_player" in ask_result.response[0].sql
    assert "tidb_business_demo_dwd_order_deposit" in ask_result.response[0].sql
    assert "tidb_business_demo_dwd_player_login_log" in ask_result.response[0].sql


@pytest.mark.asyncio
async def test_ask_rejects_correction_that_changes_anchored_template_core():
    template_sql = """
    WITH base AS (
      SELECT
        CASE WHEN amount < 100 THEN 'low' ELSE 'high' END AS bucket
      FROM deposits
      WHERE dt >= :start_date
    )
    SELECT bucket, COUNT(*) AS users
    FROM base
    GROUP BY bucket
    """
    case = {
        "query": "首存金额分桶",
        "scenario": {
            "sql_pairs_documents": [
                {
                    "id": "template-13",
                    "question": "首存金额分桶",
                    "sql": template_sql,
                    "asset_kind": "sql_template",
                    "template_level": "L2",
                    "template_mode": "anchored_template",
                }
            ],
            "schema_documents": [
                {
                    "table_name": "deposits",
                    "table_ddl": "CREATE TABLE deposits(amount int, dt date);",
                }
            ],
            "sql_generation": {
                "invalid_generation_result": {
                    "type": "EXECUTION_ERROR",
                    "original_sql": template_sql,
                    "sql": template_sql,
                    "error": "syntax error",
                }
            },
            "sql_correction": {
                "valid_sql": "SELECT COUNT(*) AS users FROM deposits"
            },
        },
    }
    pipelines = build_ask_pipelines(case["scenario"])
    service = AskService(pipelines=pipelines, ask_runtime_mode="deepagents")
    request = make_request(case)

    result = await service.ask(request)
    ask_result = service.get_ask_result(AskResultRequest(query_id=request.query_id))

    assert ask_result.status == "failed"
    assert ask_result.template_decision is not None
    assert ask_result.template_decision.fallback_reason == (
        "template_core_protection_rejected_correction"
    )
    assert result["metadata"]["template_decision"]["fallback_reason"] == (
        "template_core_protection_rejected_correction"
    )


@pytest.mark.asyncio
async def test_followup_merges_history_retrieval_candidates_before_reranking():
    history_question = (
        "统计租户平台990001下渠道990011在2026-04-01到2026-04-03"
        "首存cohort从D1到D7的累计收入"
    )
    followup_question = "那只看 2026-04-02 的首存 cohort 呢？"
    wrong_template = {
        "id": "template-13",
        "question": "按首存金额固定档位输出人数与占比",
        "sql": (
            "SELECT * FROM deposits "
            "WHERE tenant_plat_id = :tenant_plat_id "
            "AND channel_id = :channel_id "
            "AND dt >= :start_date "
            "AND dt < DATE_ADD(:end_date, INTERVAL 1 DAY)"
        ),
        "asset_kind": "sql_template",
        "template_level": "L2",
        "template_mode": "executable_template",
        "source_type": "business_import",
        "score": 0.94,
    }
    correct_template = {
        "id": "template-04",
        "question": "统计某渠道首存 cohort 在指定回收周期内的累计渠道收入",
        "sql": (
            "WITH RECURSIVE seq AS ("
            " SELECT 1 AS relative_day_no"
            " UNION ALL"
            " SELECT relative_day_no + 1 FROM seq WHERE relative_day_no < :period_days"
            "), first_deposit_cohort AS ("
            " SELECT d.player_id, DATE(MIN(d.callback_time)) AS first_deposit_date"
            " FROM dwd_order_deposit d"
            " WHERE d.tenant_plat_id = :tenant_plat_id"
            "   AND d.channel_id = :channel_id"
            "   AND d.callback_time >= :cohort_start_date"
            "   AND d.callback_time < DATE_ADD(:cohort_end_date, INTERVAL 1 DAY)"
            " GROUP BY d.player_id"
            ") SELECT * FROM first_deposit_cohort"
        ),
        "asset_kind": "sql_template",
        "template_level": "L2",
        "template_mode": "executable_template",
        "source_type": "business_import",
        "score": 0.22,
    }

    pipelines = build_ask_pipelines(
        {
            "schema_documents": [
                {
                    "table_name": "dwd_order_deposit",
                    "table_ddl": "CREATE TABLE dwd_order_deposit(player_id bigint);",
                }
            ],
        }
    )
    pipelines["sql_pairs_retrieval"].run = AsyncMock(
        side_effect=lambda **kwargs: {
            "formatted_output": {
                "documents": (
                    [correct_template]
                    if kwargs["query"] == history_question
                    else [wrong_template]
                )
            }
        }
    )
    pipelines["instructions_retrieval"].run = AsyncMock(
        return_value={"formatted_output": {"documents": []}}
    )

    service = AskService(pipelines=pipelines, ask_runtime_mode="deepagents")
    request = AskRequest.model_validate(
        {
            "query": followup_question,
            "mdl_hash": "mdl-1",
            "histories": [
                {
                    "question": history_question,
                    "sql": (
                        "WITH RECURSIVE seq AS (SELECT 1 AS relative_day_no"
                        " UNION ALL SELECT relative_day_no + 1 FROM seq WHERE relative_day_no < 7)"
                        " SELECT * FROM first_deposit_cohort"
                    ),
                }
            ],
        }
    )
    request.query_id = str(uuid.uuid4())

    result = await service.ask(request)
    ask_result = service.get_ask_result(AskResultRequest(query_id=request.query_id))

    assert result["metadata"]["ask_path"] == "sql_pairs"
    assert result["metadata"]["template_decision"]["template_id"] == "template-04"
    assert ask_result.template_decision is not None
    assert ask_result.template_decision.template_id == "template-04"
    assert ask_result.response is not None
    assert ask_result.response[0].sqlpairId == "template-04"
    assert "'2026-04-02'" in ask_result.response[0].sql
    assert ":cohort_start_date" not in ask_result.response[0].sql


@pytest.mark.asyncio
async def test_ask_falls_back_when_direct_template_sql_fails_validation():
    case = {
        "query": "首存金额分桶",
        "scenario": {
            "sql_pairs_documents": [
                {
                    "id": "template-13",
                    "question": "首存金额分桶",
                    "sql": "SELECT bucket, COUNT(*) FROM deposits GROUP BY bucket",
                    "asset_kind": "sql_template",
                    "template_level": "L2",
                    "template_mode": "anchored_template",
                    "source_type": "business_import",
                    "score": 0.95,
                }
            ],
            "schema_documents": [
                {
                    "table_name": "deposits",
                    "table_ddl": "CREATE TABLE deposits(amount int, bucket varchar);",
                }
            ],
            "template_sql_validation": {
                "invalid_generation_result": {
                    "type": "DRY_RUN",
                    "sql": "SELECT bucket, COUNT(*) FROM deposits GROUP BY bucket",
                    "original_sql": "SELECT bucket, COUNT(*) FROM deposits GROUP BY bucket",
                    "error": "Unknown column bucket_label",
                }
            },
            "sql_generation": {
                "valid_sql": "SELECT bucket, COUNT(*) FROM deposits GROUP BY bucket"
            },
        },
    }
    pipelines = build_ask_pipelines(case["scenario"])
    service = AskService(pipelines=pipelines, ask_runtime_mode="deepagents")
    request = make_request(case)

    result = await service.ask(request)
    ask_result = service.get_ask_result(AskResultRequest(query_id=request.query_id))

    assert ask_result.response is not None
    assert ask_result.response[0].type == "llm"
    assert ask_result.template_decision is not None
    assert ask_result.template_decision.fallback_reason == "template_dry_run_failed"
    assert ask_result.template_decision.sql_source == "anchored_generated"
    assert ask_result.template_decision.dry_run_compatible is False
    assert ask_result.template_decision.dialect_compatible is False
    assert (
        ask_result.template_decision.validation_error
        == "Unknown column bucket_label"
    )
    assert result["metadata"]["template_decision"]["fallback_reason"] == (
        "template_dry_run_failed"
    )
