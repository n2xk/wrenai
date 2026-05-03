from haystack.components.builders.prompt_builder import PromptBuilder

from src.pipelines.generation.sql_correction import get_sql_correction_system_prompt
from src.pipelines.generation.sql_generation import (
    prompt,
    sql_generation_user_prompt_template,
)
from src.pipelines.generation.utils.sql import (
    construct_instructions,
    get_sql_generation_system_prompt,
    get_text_to_sql_rules,
    normalize_mysql_backtick_identifiers,
    normalize_mysql_date_interval_functions,
)


def test_trino_text_to_sql_rules_append_dialect_specific_guidance():
    rules = get_text_to_sql_rules(data_source="trino")

    assert "### TRINO DIALECT RULES ###" in rules
    assert "Use `CAST(<expr> AS <type>)` instead of PostgreSQL-style `::<type>` casts." in rules
    assert "Do not use BigQuery-only features such as backtick identifiers, `SAFE_CAST`, or `QUALIFY`." in rules


def test_non_trino_text_to_sql_rules_do_not_append_trino_guidance():
    rules = get_text_to_sql_rules(data_source="postgres")

    assert "### TRINO DIALECT RULES ###" not in rules


def test_mysql_text_to_sql_rules_append_tidb_compatible_guidance():
    rules = get_text_to_sql_rules(data_source="mysql")

    assert "### MYSQL / TIDB DIALECT RULES ###" in rules
    assert 'do NOT use double-quoted identifiers like "table"."column"' in rules
    assert "DATE_ADD(<date_expr>, INTERVAL <n> DAY)" in rules
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

    assert 'DATE_ADD(\'day\', 1, DATE \'2026-04-07\') AS "截止日期"' in normalized
    assert 'DATE_DIFF(\'day\', first_deposit_date, event_date) AS "日龄"' in normalized


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
        instructions=[
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
        ],
    )

    rendered_prompt = result["prompt"]

    assert "#### BUSINESS GLOSSARY ####" in rendered_prompt
    assert "1. 首充用户指首次成功存款用户" in rendered_prompt
    assert "#### QUERY RULES ####" in rendered_prompt
    assert "1. 存款统计必须过滤 status = 'success'" in rendered_prompt
    assert "#### CONTEXT NOTES ####" in rendered_prompt
    assert "1. 充值渠道释义来自外部支付台账" in rendered_prompt
