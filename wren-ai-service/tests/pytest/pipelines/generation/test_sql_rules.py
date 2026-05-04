import pytest
from haystack.components.builders.prompt_builder import PromptBuilder

import src.pipelines.generation.sql_generation_reasoning as reasoning_module
from src.pipelines.generation.data_assistance import (
    data_assistance_user_prompt_template,
)
from src.pipelines.generation.data_assistance import (
    prompt as data_assistance_prompt,
)
from src.pipelines.generation.followup_sql_generation import (
    prompt as followup_sql_generation_prompt,
)
from src.pipelines.generation.followup_sql_generation import (
    text_to_sql_with_followup_user_prompt_template,
)
from src.pipelines.generation.followup_sql_generation_reasoning import (
    prompt as followup_sql_generation_reasoning_prompt,
)
from src.pipelines.generation.followup_sql_generation_reasoning import (
    sql_generation_reasoning_user_prompt_template as followup_reasoning_user_prompt_template,
)
from src.pipelines.generation.intent_classification import (
    intent_classification_user_prompt_template,
)
from src.pipelines.generation.intent_classification import (
    prompt as intent_classification_prompt,
)
from src.pipelines.generation.semantic_plan import (
    prompt as semantic_plan_prompt,
)
from src.pipelines.generation.semantic_plan import (
    semantic_plan_user_prompt_template,
)
from src.pipelines.generation.sql_correction import (
    get_sql_correction_system_prompt,
    sql_correction_user_prompt_template,
)
from src.pipelines.generation.sql_correction import (
    prompt as sql_correction_prompt,
)
from src.pipelines.generation.sql_generation import (
    prompt,
    sql_generation_user_prompt_template,
)
from src.pipelines.generation.sql_generation_reasoning import (
    SQLGenerationReasoning,
    prompt as sql_generation_reasoning_prompt,
)
from src.pipelines.generation.sql_generation_reasoning import (
    sql_generation_reasoning_user_prompt_template,
)
from src.pipelines.generation.sql_regeneration import (
    prompt as sql_regeneration_prompt,
)
from src.pipelines.generation.sql_regeneration import (
    sql_regeneration_user_prompt_template,
)
from src.pipelines.generation.utils.sql import (
    construct_instructions,
    get_sql_generation_system_prompt,
    get_text_to_sql_rules,
    normalize_mysql_backtick_identifiers,
    normalize_mysql_date_interval_functions,
)
from src.web.v1.services import Configuration

INSTRUCTION_FIXTURE = [
    {
        "instruction": "首充用户指首次成功存款用户",
        "knowledge_asset_type": "business_term",
    },
    {
        "instruction": "存款统计必须过滤 status = 'success'",
        "knowledge_asset_type": "sql_rule",
    },
    {
        "instruction": "充值渠道释义来自外部支付台账",
        "knowledge_asset_type": "external_dependency",
    },
]


def assert_rendered_instruction_asset_sections(rendered_prompt: str):
    assert "#### BUSINESS GLOSSARY ####" in rendered_prompt
    assert "1. 首充用户指首次成功存款用户" in rendered_prompt
    assert "#### QUERY RULES ####" in rendered_prompt
    assert "1. 存款统计必须过滤 status = 'success'" in rendered_prompt
    assert "#### CONTEXT NOTES ####" in rendered_prompt
    assert "1. 充值渠道释义来自外部支付台账" in rendered_prompt


def test_trino_text_to_sql_rules_append_dialect_specific_guidance():
    rules = get_text_to_sql_rules(data_source="trino")

    assert "### TRINO DIALECT RULES ###" in rules
    assert (
        "Use `CAST(<expr> AS <type>)` instead of PostgreSQL-style `::<type>` casts."
        in rules
    )
    assert (
        "Do not use BigQuery-only features such as backtick identifiers, `SAFE_CAST`, or `QUALIFY`."
        in rules
    )


def test_non_trino_text_to_sql_rules_do_not_append_trino_guidance():
    rules = get_text_to_sql_rules(data_source="postgres")

    assert "### TRINO DIALECT RULES ###" not in rules


def test_mysql_text_to_sql_rules_append_tidb_compatible_guidance():
    rules = get_text_to_sql_rules(data_source="mysql")

    assert "### MYSQL / TIDB DIALECT RULES ###" in rules
    assert 'do NOT use double-quoted identifiers like "table"."column"' in rules
    assert "DATE_ADD(<date_expr>, INTERVAL <n> DAY)" in rules
    assert "DON'T USE INTERVAL or generate INTERVAL-like expression" not in rules
    assert "Do not use PostgreSQL-only or BigQuery-only features" in rules


def test_tidb_text_to_sql_rules_reuse_mysql_compatible_guidance():
    rules = get_text_to_sql_rules(data_source="tidb")

    assert "### MYSQL / TIDB DIALECT RULES ###" in rules


def test_generation_and_correction_prompts_share_trino_rules():
    generation_prompt = get_sql_generation_system_prompt(data_source="trino")
    correction_prompt = get_sql_correction_system_prompt(data_source="trino")

    assert "### TRINO DIALECT RULES ###" in generation_prompt
    assert "### TRINO DIALECT RULES ###" in correction_prompt


def test_generation_and_correction_prompts_share_mysql_rules():
    generation_prompt = get_sql_generation_system_prompt(data_source="mysql")
    correction_prompt = get_sql_correction_system_prompt(data_source="mysql")

    assert "### MYSQL / TIDB DIALECT RULES ###" in generation_prompt
    assert "### MYSQL / TIDB DIALECT RULES ###" in correction_prompt


def test_normalize_mysql_date_interval_functions_for_engine_preview_retry():
    sql = (
        "SELECT * FROM dwd_order_deposit WHERE callback_time < "
        "DATE_ADD('2026-04-07', INTERVAL 1 DAY) "
        "AND callback_time >= DATE_SUB('2026-04-07', INTERVAL 7 DAY) "
        "AND settle_time < CAST(DATE_ADD(first_deposit_date, INTERVAL 8 DAY) "
        "AS TIMESTAMP WITH TIME ZONE) "
        "AND DATEDIFF(event_date, first_deposit_date) + 1 BETWEEN 1 AND 7"
    )

    normalized = normalize_mysql_date_interval_functions(sql)

    assert "DATE_ADD('day', 1, DATE '2026-04-07')" in normalized
    assert "DATE_ADD('day', -7, DATE '2026-04-07')" in normalized
    assert "DATE_ADD('day', 8, first_deposit_date)" in normalized
    assert "DATE_DIFF('day', first_deposit_date, event_date) + 1" in normalized
    assert "INTERVAL 8 DAY" not in normalized
    assert "DATEDIFF(" not in normalized


def test_normalize_mysql_backtick_identifiers_for_engine_preview_retry():
    sql = (
        "SELECT callback_time AS `日期`, '`不要改字符串里的反引号`' AS literal_value, "
        "amount AS `累计1天` FROM dwd_order_deposit"
    )

    normalized = normalize_mysql_backtick_identifiers(sql)

    assert 'callback_time AS "日期"' in normalized
    assert 'amount AS "累计1天"' in normalized
    assert "'`不要改字符串里的反引号`' AS literal_value" in normalized


def test_mysql_preview_normalization_rewrites_dates_and_backticks():
    sql = (
        "SELECT DATE_ADD('2026-04-07', INTERVAL 1 DAY) AS `截止日期`, "
        "DATEDIFF(event_date, first_deposit_date) AS `日龄`"
    )

    normalized = normalize_mysql_date_interval_functions(sql)

    assert "DATE_ADD('day', 1, DATE '2026-04-07') AS \"截止日期\"" in normalized
    assert "DATE_DIFF('day', first_deposit_date, event_date) AS \"日龄\"" in normalized


@pytest.mark.asyncio
async def test_sql_reasoning_streaming_timeout_yields_observable_message(monkeypatch):
    pipeline = object.__new__(SQLGenerationReasoning)
    pipeline._user_queues = {}
    monkeypatch.setattr(reasoning_module, "STREAMING_TIMEOUT_SECONDS", 0.001)

    chunks = [chunk async for chunk in pipeline.get_streaming_results("query-timeout")]

    assert chunks == [reasoning_module.STREAMING_TIMEOUT_MESSAGE]


def test_construct_instructions_groups_by_knowledge_asset_type():
    grouped = construct_instructions(
        [
            {
                "instruction": "首充用户指首次成功存款用户",
                "knowledge_asset_type": "business_term",
            },
            {
                "instruction": "存款统计必须过滤 status = 'success'",
                "knowledge_asset_type": "sql_rule",
            },
            {
                "instruction": "充值渠道释义来自外部支付台账",
                "knowledge_asset_type": "external_dependency",
            },
            {"instruction": "缺失类型的旧规则仍应注入"},
            "纯字符串旧规则仍应注入",
        ],
        group_by_asset_type=True,
    )

    assert grouped == {
        "business_glossary": ["首充用户指首次成功存款用户"],
        "query_rules": [
            "存款统计必须过滤 status = 'success'",
            "缺失类型的旧规则仍应注入",
            "纯字符串旧规则仍应注入",
        ],
        "context_notes": ["充值渠道释义来自外部支付台账"],
    }


def test_construct_instructions_keeps_legacy_list_output_by_default():
    assert construct_instructions(
        [
            {
                "instruction": "首充用户指首次成功存款用户",
                "knowledge_asset_type": "business_term",
            },
            "纯字符串旧规则仍应注入",
        ]
    ) == ["首充用户指首次成功存款用户", "纯字符串旧规则仍应注入"]


def test_sql_generation_prompt_renders_instruction_asset_sections():
    result = prompt(
        query="统计首充用户",
        documents=["CREATE TABLE dwd_order_deposit (status varchar, times int);"],
        prompt_builder=PromptBuilder(template=sql_generation_user_prompt_template),
        instructions=INSTRUCTION_FIXTURE,
    )

    assert_rendered_instruction_asset_sections(result["prompt"])


def test_sql_generation_prompt_keeps_sql_samples_before_instructions_by_default(
    monkeypatch,
):
    monkeypatch.delenv("WREN_PROMPT_INSTRUCTION_FIRST_ENABLED", raising=False)

    result = prompt(
        query="统计首充用户",
        documents=["CREATE TABLE dwd_order_deposit (status varchar, times int);"],
        prompt_builder=PromptBuilder(template=sql_generation_user_prompt_template),
        sql_samples=[{"question": "示例问题", "sql": "SELECT 1"}],
        instructions=INSTRUCTION_FIXTURE,
    )

    rendered_prompt = result["prompt"]
    assert rendered_prompt.index("### SQL SAMPLES ###") < rendered_prompt.index(
        "### USER INSTRUCTIONS ###"
    )


def test_sql_generation_prompt_can_put_instructions_before_sql_samples(monkeypatch):
    monkeypatch.setenv("WREN_PROMPT_INSTRUCTION_FIRST_ENABLED", "1")

    result = prompt(
        query="统计首充用户",
        documents=["CREATE TABLE dwd_order_deposit (status varchar, times int);"],
        prompt_builder=PromptBuilder(template=sql_generation_user_prompt_template),
        sql_samples=[{"question": "示例问题", "sql": "SELECT 1"}],
        instructions=INSTRUCTION_FIXTURE,
    )

    rendered_prompt = result["prompt"]
    assert rendered_prompt.index("### USER INSTRUCTIONS ###") < rendered_prompt.index(
        "### SQL SAMPLES ###"
    )


def test_related_generation_prompts_render_instruction_asset_sections():
    configuration = Configuration()
    db_schema = "CREATE TABLE dwd_order_deposit (status varchar, times int);"

    rendered_prompts = [
        sql_generation_reasoning_prompt(
            query="统计首充用户",
            documents=[db_schema],
            sql_samples=[],
            instructions=INSTRUCTION_FIXTURE,
            prompt_builder=PromptBuilder(
                template=sql_generation_reasoning_user_prompt_template
            ),
            configuration=configuration,
        )["prompt"],
        followup_sql_generation_prompt(
            query="继续按渠道拆分",
            documents=[db_schema],
            sql_generation_reasoning="按渠道聚合。",
            instructions=INSTRUCTION_FIXTURE,
            prompt_builder=PromptBuilder(
                template=text_to_sql_with_followup_user_prompt_template
            ),
            sql_samples=[],
        )["prompt"],
        followup_sql_generation_reasoning_prompt(
            query="继续按渠道拆分",
            documents=[db_schema],
            histories=[],
            sql_samples=[],
            instructions=INSTRUCTION_FIXTURE,
            prompt_builder=PromptBuilder(
                template=followup_reasoning_user_prompt_template
            ),
            configuration=configuration,
        )["prompt"],
        intent_classification_prompt(
            query="首充用户是什么意思",
            wren_ai_docs=[],
            construct_db_schemas=[db_schema],
            histories=[],
            prompt_builder=PromptBuilder(
                template=intent_classification_user_prompt_template
            ),
            instructions=INSTRUCTION_FIXTURE,
            configuration=configuration,
        )["prompt"],
        sql_correction_prompt(
            documents=[db_schema],
            invalid_generation_result={
                "sql": "SELECT * FROM dwd_order_deposit",
                "error": "syntax error",
            },
            prompt_builder=PromptBuilder(template=sql_correction_user_prompt_template),
            instructions=INSTRUCTION_FIXTURE,
        )["prompt"],
        sql_regeneration_prompt(
            documents=[db_schema],
            sql_generation_reasoning="原 SQL 需要重写。",
            sql="SELECT * FROM dwd_order_deposit",
            prompt_builder=PromptBuilder(
                template=sql_regeneration_user_prompt_template
            ),
            instructions=INSTRUCTION_FIXTURE,
        )["prompt"],
        semantic_plan_prompt(
            query="统计首充用户",
            histories=[],
            prompt_builder=PromptBuilder(template=semantic_plan_user_prompt_template),
            instructions=INSTRUCTION_FIXTURE,
            configuration=configuration,
        )["prompt"],
        data_assistance_prompt(
            query="首充用户是什么意思",
            db_schemas=[db_schema],
            language="zh-CN",
            histories=[],
            prompt_builder=PromptBuilder(template=data_assistance_user_prompt_template),
            custom_instruction="",
            instructions=INSTRUCTION_FIXTURE,
        )["prompt"],
    ]

    for rendered_prompt in rendered_prompts:
        assert_rendered_instruction_asset_sections(rendered_prompt)
