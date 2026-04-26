from src.pipelines.generation.sql_correction import get_sql_correction_system_prompt
from src.pipelines.generation.utils.sql import (
    get_sql_generation_system_prompt,
    get_text_to_sql_rules,
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
