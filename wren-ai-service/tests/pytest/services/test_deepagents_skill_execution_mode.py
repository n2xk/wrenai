from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.core import DeepAgentsAskOrchestrator


class PipelineStub(SimpleNamespace):
    def __init__(self, result=None):
        super().__init__(run=AsyncMock(return_value=result if result is not None else {}))


def make_pipelines(
    *,
    historical_documents=None,
    sql_pairs_documents=None,
    instructions_documents=None,
    schema_documents=None,
    valid_sql="SELECT 1",
):
    return {
        "historical_question": PipelineStub(
            {"formatted_output": {"documents": historical_documents or []}}
        ),
        "sql_pairs_retrieval": PipelineStub(
            {"formatted_output": {"documents": sql_pairs_documents or []}}
        ),
        "instructions_retrieval": PipelineStub(
            {"formatted_output": {"documents": instructions_documents or []}}
        ),
        "intent_classification": PipelineStub(
            {
                "post_process": {
                    "intent": "TEXT_TO_SQL",
                    "reasoning": "needs sql",
                    "db_schemas": [],
                }
            }
        ),
        "db_schema_retrieval": PipelineStub(
            {
                "construct_retrieval_results": {
                    "retrieval_results": schema_documents
                    or [
                        {
                            "table_name": "orders",
                            "table_ddl": "CREATE TABLE orders (id bigint);",
                        }
                    ],
                    "has_calculated_field": False,
                    "has_metric": False,
                    "has_json_field": False,
                }
            }
        ),
        "sql_generation_reasoning": PipelineStub({"post_process": "reasoning"}),
        "followup_sql_generation_reasoning": PipelineStub(
            {"post_process": "followup reasoning"}
        ),
        "sql_generation": PipelineStub(
            {
                "post_process": {
                    "valid_generation_result": {"sql": valid_sql},
                    "invalid_generation_result": None,
                }
            }
        ),
        "followup_sql_generation": PipelineStub(
            {
                "post_process": {
                    "valid_generation_result": {"sql": "SELECT 2"},
                    "invalid_generation_result": None,
                }
            }
        ),
        "sql_functions_retrieval": PipelineStub([]),
        "sql_knowledge_retrieval": PipelineStub([]),
        "sql_diagnosis": PipelineStub({"post_process": {"reasoning": "diagnosis"}}),
        "sql_correction": PipelineStub(
            {
                "post_process": {
                    "valid_generation_result": {"sql": "SELECT 3"},
                    "invalid_generation_result": None,
                }
            }
        ),
        "misleading_assistance": PipelineStub({"status": "ok"}),
        "data_assistance": PipelineStub({"status": "ok"}),
        "user_guide_assistance": PipelineStub({"status": "ok"}),
    }


def make_request(*, skills=None, query="本月 GMV"):
    return SimpleNamespace(
        query=query,
        query_id="query-1",
        configurations=SimpleNamespace(language="zh-CN"),
        custom_instruction=None,
        ignore_sql_generation_reasoning=False,
        enable_column_pruning=False,
        use_dry_plan=False,
        allow_dry_plan_fallback=True,
        request_from="ui",
        skills=skills or [],
    )


async def run_orchestrator(*, pipelines, ask_request, histories=None):
    orchestrator = DeepAgentsAskOrchestrator(pipelines=pipelines)
    updates = []

    result = await orchestrator.run(
        ask_request=ask_request,
        query_id=ask_request.query_id,
        trace_id="trace-1",
        histories=histories or [],
        runtime_scope_id="kb-1",
        retrieval_scope_id="kb-1",
        is_followup=bool(histories),
        is_stopped=lambda: False,
        set_result=lambda **payload: updates.append(payload),
        build_ask_result=lambda **payload: payload,
        build_ask_error=lambda **payload: payload,
    )

    return result, updates


@pytest.mark.asyncio
async def test_deepagents_prepares_sql_pairs_and_skill_instructions_before_intent():
    pipelines = make_pipelines(
        sql_pairs_documents=[{"question": "GMV", "sql": "SELECT amount FROM orders"}],
        instructions_documents=[{"instruction": "已有规则"}],
    )
    ask_request = make_request(
        skills=[
            SimpleNamespace(
                skill_id="skill-1",
                skill_name="gmv_skill",
                instruction="只返回 GMV 相关 SQL",
            )
        ]
    )

    result, _ = await run_orchestrator(pipelines=pipelines, ask_request=ask_request)

    expected_instructions = [
        {"instruction": "已有规则"},
        {
            "instruction": "只返回 GMV 相关 SQL",
            "source": "skill_definition",
            "skill_id": "skill-1",
            "skill_name": "gmv_skill",
            "execution_mode": "inject_only",
        },
    ]

    assert pipelines["intent_classification"].run.await_args.kwargs["sql_samples"] == [
        {"question": "GMV", "sql": "SELECT amount FROM orders"}
    ]
    assert pipelines["intent_classification"].run.await_args.kwargs["instructions"] == (
        expected_instructions
    )
    assert pipelines["sql_generation"].run.await_args.kwargs["instructions"] == (
        expected_instructions
    )
    assert result["metadata"]["orchestrator"] == "deepagents"
    assert result["metadata"]["ask_path"] == "sql_pairs"
    assert result["ask_result"][0]["sql"] == "SELECT 1"


@pytest.mark.asyncio
async def test_deepagents_reuses_anchored_template_without_placeholders():
    pipelines = make_pipelines(
        sql_pairs_documents=[
            {
                "id": "template-1",
                "question": "首存金额分桶",
                "sql": "SELECT bucket, COUNT(*) FROM deposits GROUP BY bucket",
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "score": 0.92,
            }
        ],
    )

    result, updates = await run_orchestrator(
        pipelines=pipelines,
        ask_request=make_request(),
    )

    assert result["metadata"]["ask_path"] == "sql_pairs"
    assert result["metadata"]["template_decision"]["mode"] == "anchored_template"
    assert result["metadata"]["template_decision"]["sql_source"] == "anchored_template"
    assert result["ask_result"] == [
        {
            "sql": "SELECT bucket, COUNT(*) FROM deposits GROUP BY bucket",
            "type": "sql_pair",
            "sqlpairId": "template-1",
        }
    ]
    assert updates[-1]["response"][0]["type"] == "sql_pair"


@pytest.mark.asyncio
async def test_deepagents_injects_anchored_template_instruction_when_params_missing():
    pipelines = make_pipelines(
        sql_pairs_documents=[
            {
                "id": "template-2",
                "question": "首存用户日龄趋势",
                "sql": "SELECT * FROM deposits WHERE dt >= :start_date",
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
            }
        ],
        valid_sql="SELECT * FROM deposits WHERE dt >= DATE '2026-01-01'",
    )

    result, _ = await run_orchestrator(
        pipelines=pipelines,
        ask_request=make_request(),
    )

    generated_instructions = pipelines["sql_generation"].run.await_args.kwargs[
        "instructions"
    ]
    assert any(
        instruction.get("source") == "template_decision"
        and "Preserve its CTE hierarchy" in instruction["instruction"]
        for instruction in generated_instructions
    )
    assert result["metadata"]["template_decision"]["mode"] == "anchored_template"
    assert result["metadata"]["template_decision"]["missing_parameters"] == [
        "start_date"
    ]
    assert result["metadata"]["template_decision"]["fallback_reason"] == (
        "missing_template_parameters"
    )


@pytest.mark.asyncio
async def test_deepagents_renders_anchored_template_when_params_are_extracted():
    pipelines = make_pipelines(
        sql_pairs_documents=[
            {
                "id": "template-9",
                "question": "所有用户区间汇总",
                "sql": (
                    "SELECT :tenant_plat_id AS tenant_plat_id, "
                    ":channel_id AS channel_id, :start_date AS start_date, "
                    ":end_date AS end_date, :user_segment AS user_segment, "
                    ":top_n AS top_n"
                ),
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "score": 0.94,
            }
        ],
    )

    result, _ = await run_orchestrator(
        pipelines=pipelines,
        ask_request=make_request(
            query=(
                "统计租户平台990001下渠道990011在2026-04-01到"
                "2026-04-07的TOP3用户汇总"
            )
        ),
    )

    assert result["metadata"]["ask_path"] == "sql_pairs"
    assert result["metadata"]["template_decision"]["missing_parameters"] == []
    assert result["metadata"]["template_decision"]["parameters"] == {
        "channel_id": 990011,
        "end_date": "2026-04-07",
        "start_date": "2026-04-01",
        "tenant_plat_id": 990001,
        "top_n": 3,
        "user_segment": "TOPN",
    }
    assert result["ask_result"] == [
        {
            "sql": (
                "SELECT 990001 AS tenant_plat_id, 990011 AS channel_id, "
                "'2026-04-01' AS start_date, '2026-04-07' AS end_date, "
                "'TOPN' AS user_segment, 3 AS top_n"
            ),
            "type": "sql_pair",
            "sqlpairId": "template-9",
        }
    ]


@pytest.mark.asyncio
async def test_deepagents_expands_multi_value_template_parameters():
    pipelines = make_pipelines(
        sql_pairs_documents=[
            {
                "id": "template-9",
                "question": "所有用户区间汇总",
                "sql": "SELECT :user_segment AS user_segment",
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
            }
        ],
    )

    result, _ = await run_orchestrator(
        pipelines=pipelines,
        ask_request=make_request(query="统计ALL、TOP3和非TOP3用户分层汇总"),
    )

    sql = result["ask_result"][0]["sql"]
    assert result["metadata"]["template_decision"]["parameters"] == {
        "user_segment": ["ALL", "TOPN", "NON_TOPN"]
    }
    assert "'ALL' AS user_segment" in sql
    assert "'TOPN' AS user_segment" in sql
    assert "'NON_TOPN' AS user_segment" in sql
    assert sql.count("UNION ALL") == 2


@pytest.mark.asyncio
async def test_deepagents_renders_cohort_revenue_template_with_period_days():
    pipelines = make_pipelines(
        sql_pairs_documents=[
            {
                "id": "template-4",
                "question": "统计某渠道首存 cohort 在指定回收周期内的累计渠道收入。",
                "sql": (
                    "SELECT :tenant_plat_id AS tenant_plat_id, "
                    ":channel_id AS channel_id, :cohort_start_date AS cohort_start_date, "
                    ":cohort_end_date AS cohort_end_date, :period_days AS period_days"
                ),
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "score": 0.93,
            }
        ],
    )

    result, _ = await run_orchestrator(
        pipelines=pipelines,
        ask_request=make_request(
            query=(
                "统计租户平台990001下渠道990011在2026-04-01到"
                "2026-04-03首存cohort从D1到D7的累计收入"
            )
        ),
    )

    assert result["metadata"]["ask_path"] == "sql_pairs"
    assert result["metadata"]["template_decision"]["missing_parameters"] == []
    assert result["metadata"]["template_decision"]["parameters"] == {
        "channel_id": 990011,
        "cohort_end_date": "2026-04-03",
        "cohort_start_date": "2026-04-01",
        "period_days": 7,
        "tenant_plat_id": 990001,
    }
    assert result["ask_result"] == [
        {
            "sql": (
                "SELECT 990001 AS tenant_plat_id, 990011 AS channel_id, "
                "'2026-04-01' AS cohort_start_date, "
                "'2026-04-03' AS cohort_end_date, 7 AS period_days"
            ),
            "type": "sql_pair",
            "sqlpairId": "template-4",
        }
    ]


@pytest.mark.asyncio
async def test_deepagents_inherits_followup_template_parameters_from_history():
    pipelines = make_pipelines(
        sql_pairs_documents=[
            {
                "id": "template-10",
                "question": "统计首存 cohort 从首日开始的 D1~DN 投充比/杀率趋势",
                "sql": (
                    "WITH RECURSIVE seq AS ("
                    "SELECT 1 AS relative_day_no "
                    "UNION ALL "
                    "SELECT relative_day_no + 1 FROM seq WHERE relative_day_no < :n_days"
                    ") "
                    "SELECT :tenant_plat_id AS tenant_plat_id, "
                    ":channel_id AS channel_id, :cohort_start_date AS cohort_start_date, "
                    ":cohort_end_date AS cohort_end_date, :n_days AS n_days "
                    "FROM seq"
                ),
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "score": 0.95,
            },
            {
                "id": "template-4",
                "question": "统计某渠道首存 cohort 在指定回收周期内的累计渠道收入。",
                "sql": (
                    "WITH revenue_cohort AS ("
                    "SELECT :tenant_plat_id AS tenant_plat_id, "
                    ":channel_id AS channel_id, :cohort_start_date AS cohort_start_date, "
                    ":cohort_end_date AS cohort_end_date, :period_days AS period_days"
                    ") "
                    "SELECT * FROM revenue_cohort"
                ),
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "score": 0.9,
            },
        ],
    )

    histories = [
        SimpleNamespace(
            question=(
                "统计租户平台990001下渠道990011在2026-04-01到"
                "2026-04-03首存cohort从D1到D7的累计收入"
            ),
            sql=(
                "WITH revenue_cohort AS ("
                "SELECT 990001 AS tenant_plat_id, 990011 AS channel_id, "
                "'2026-04-01' AS cohort_start_date, "
                "'2026-04-03' AS cohort_end_date, 7 AS period_days"
                ") "
                "SELECT * FROM revenue_cohort"
            ),
        )
    ]

    result, _ = await run_orchestrator(
        pipelines=pipelines,
        ask_request=make_request(query="那只看 2026-04-02 的首存 cohort 呢？"),
        histories=histories,
    )

    retrieval_query = pipelines["sql_pairs_retrieval"].run.await_args.kwargs["query"]
    assert "2026-04-03首存cohort从D1到D7的累计收入" in retrieval_query
    assert result["metadata"]["template_decision"]["template_id"] == "template-4"
    assert result["metadata"]["template_decision"]["parameters"] == {
        "channel_id": 990011,
        "cohort_end_date": "2026-04-02",
        "cohort_start_date": "2026-04-02",
        "period_days": 7,
        "tenant_plat_id": 990001,
    }
    assert result["ask_result"] == [
        {
            "sql": (
                "WITH revenue_cohort AS (SELECT 990001 AS tenant_plat_id, "
                "990011 AS channel_id, '2026-04-02' AS cohort_start_date, "
                "'2026-04-02' AS cohort_end_date, 7 AS period_days) "
                "SELECT * FROM revenue_cohort"
            ),
            "type": "sql_pair",
            "sqlpairId": "template-4",
        }
    ]


@pytest.mark.asyncio
async def test_deepagents_reranks_game_type_templates_ahead_of_generic_segment_templates():
    pipelines = make_pipelines(
        sql_pairs_documents=[
            {
                "id": "template-9",
                "question": "统计某渠道在指定区间内全部用户/分层用户的存款、充提差、有效投注、输赢、投充比、杀率",
                "sql": "SELECT :user_segment AS user_segment",
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "score": 0.97,
            },
            {
                "id": "template-12",
                "question": "对比某渠道 TOPN 与非TOPN 用户在各游戏类型上的投注分布",
                "sql": "SELECT :top_n AS top_n, :tenant_plat_id AS tenant_plat_id",
                "asset_kind": "sql_pair",
                "template_level": "L0",
                "template_mode": "reference",
                "source_type": "user_saved",
                "score": 0.82,
            },
        ],
    )

    await run_orchestrator(
        pipelines=pipelines,
        ask_request=make_request(
            query=(
                "对比租户平台990001下渠道990011在2026-04-01到2026-04-07"
                "TOP3与非TOP3用户在各游戏类型上的投注分布"
            )
        ),
    )

    generation_sql_samples = pipelines["sql_generation"].run.await_args.kwargs[
        "sql_samples"
    ]
    assert generation_sql_samples[0]["id"] == "template-12"


@pytest.mark.asyncio
async def test_deepagents_routes_missing_external_source_questions_to_general():
    pipelines = make_pipelines(
        instructions_documents=[{"instruction": "已有缺失数据源规则"}],
    )

    result, updates = await run_orchestrator(
        pipelines=pipelines,
        ask_request=make_request(query="按渠道/日期把 PV、UV 和下载点击UV 并入综合日报"),
    )
    await __import__("asyncio").sleep(0)

    assert pipelines["intent_classification"].run.await_count == 0
    assert pipelines["data_assistance"].run.await_count == 0
    assert result["metadata"]["ask_path"] == "general"
    assert updates[-1]["status"] == "finished"
    assert updates[-1]["type"] == "GENERAL"
    assert "缺失的外部指标" in (updates[-1]["intent_reasoning"] or "")
    assert "访问PV" in (updates[-1]["content"] or "")
    assert "访问UV" in (updates[-1]["content"] or "")
    assert "下载点击UV" in (updates[-1]["content"] or "")


@pytest.mark.asyncio
async def test_deepagents_routes_missing_tenant_slot_to_general_clarification():
    pipelines = make_pipelines(
        sql_pairs_documents=[
            {
                "id": "template-8",
                "question": "统计某日/某段首存 cohort 的 2~6 存人数、率、人均金额",
                "sql": (
                    "SELECT :tenant_plat_id AS tenant_plat_id, "
                    ":channel_id AS channel_id, :cohort_start_date AS start_date, "
                    ":cohort_end_date AS end_date"
                ),
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "business_signature": {
                    "templateId": "T08",
                    "features": ["cohort", "retention"],
                },
                "score": 0.92,
                "status": "active",
            }
        ],
    )

    result, updates = await run_orchestrator(
        pipelines=pipelines,
        ask_request=make_request(
            query=(
                "统计渠道990011在2026-04-01到2026-04-03"
                "首充用户的二存到六存情况"
            )
        ),
    )

    assert pipelines["intent_classification"].run.await_count == 0
    assert pipelines["sql_generation"].run.await_count == 0
    assert result["metadata"]["ask_path"] == "general"
    assert result["metadata"]["template_decision"]["fallback_reason"] == (
        "missing_required_slot"
    )
    assert result["metadata"]["template_decision"]["missing_parameters"] == [
        "tenant_plat_id"
    ]
    assert updates[-1]["status"] == "finished"
    assert updates[-1]["type"] == "GENERAL"
    assert updates[-1]["general_type"] == "DATA_ASSISTANCE"
    assert "租户平台" in (updates[-1]["content"] or "")


@pytest.mark.asyncio
async def test_deepagents_historical_hit_short_circuits_schema_and_generation():
    pipelines = make_pipelines(
        historical_documents=[
            {
                "statement": "SELECT 99",
                "viewId": "view-1",
            }
        ],
        instructions_documents=[{"instruction": "已有规则"}],
    )

    result, updates = await run_orchestrator(
        pipelines=pipelines,
        ask_request=make_request(
            skills=[
                SimpleNamespace(
                    skill_id="skill-1",
                    skill_name="gmv_skill",
                    instruction="仅统计已支付订单",
                )
            ]
        ),
    )

    assert pipelines["intent_classification"].run.await_count == 1
    assert pipelines["historical_question"].run.await_count == 1
    assert pipelines["db_schema_retrieval"].run.await_count == 0
    assert pipelines["sql_generation"].run.await_count == 0
    assert result["metadata"]["ask_path"] == "historical"
    assert result["ask_result"] == [
        {
            "sql": "SELECT 99",
            "type": "view",
            "viewId": "view-1",
        }
    ]
    assert updates[-1]["status"] == "finished"
    assert updates[-1]["type"] == "TEXT_TO_SQL"


@pytest.mark.asyncio
async def test_deepagents_passes_retrieved_instructions_to_general_data_assistance():
    pipelines = make_pipelines(
        instructions_documents=[{"instruction": "首存定义为成功存款且 times = 1"}],
    )
    pipelines["intent_classification"].run.return_value = {
        "post_process": {
            "intent": "GENERAL",
            "reasoning": "业务定义问题",
            "rephrased_question": "首充用户怎么定义？",
            "db_schemas": ["CREATE TABLE dwd_order_deposit (times int, status int);"],
        }
    }

    result, updates = await run_orchestrator(
        pipelines=pipelines,
        ask_request=make_request(),
    )
    await __import__("asyncio").sleep(0)

    assert pipelines["data_assistance"].run.await_args.kwargs["instructions"] == [
        {"instruction": "首存定义为成功存款且 times = 1"}
    ]
    assert result["metadata"]["ask_path"] == "general"
    assert updates[-1]["type"] == "GENERAL"


@pytest.mark.asyncio
async def test_deepagents_finishes_general_result_with_generated_content():
    pipelines = make_pipelines(
        instructions_documents=[{"instruction": "首存定义为成功存款且 times = 1"}],
    )
    pipelines["intent_classification"].run.return_value = {
        "post_process": {
            "intent": "GENERAL",
            "reasoning": "业务定义问题",
            "rephrased_question": "首充用户怎么定义？",
            "db_schemas": ["CREATE TABLE dwd_order_deposit (times int, status int);"],
        }
    }
    pipelines["data_assistance"].run.return_value = {
        "data_assistance": (
            {"replies": ["首存定义为成功存款且 times = 1。"]},
            "model",
        )
    }

    _, updates = await run_orchestrator(
        pipelines=pipelines,
        ask_request=make_request(query="首存人数按什么口径统计？"),
    )
    await __import__("asyncio").sleep(0)

    assert updates[0]["status"] == "understanding"
    assert any(update["status"] == "generating" for update in updates)
    assert updates[-1]["status"] == "finished"
    assert updates[-1]["type"] == "GENERAL"
    assert updates[-1]["content"] == "首存定义为成功存款且 times = 1。"
    assert updates[-1]["intent_reasoning"] == "业务定义问题"
