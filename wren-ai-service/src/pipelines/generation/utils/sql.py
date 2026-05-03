import logging
import re
from typing import Any, Dict, List

import aiohttp
import orjson
from haystack import component
from haystack.dataclasses import ChatMessage
from pydantic import BaseModel

from src.core.engine import (
    Engine,
    clean_generation_result,
)
from src.pipelines.common import resolve_pipeline_runtime_scope_id
from src.pipelines.retrieval.sql_knowledge import SqlKnowledge
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")
MYSQL_INTERVAL_RE = re.compile(
    r"^INTERVAL\s+(.+?)\s+(DAY|HOUR|MINUTE|SECOND|MONTH|YEAR)\s*$",
    re.IGNORECASE,
)


def _normalize_sql_date_operand(expr: str) -> str:
    normalized = expr.strip()
    literal_match = re.fullmatch(r"['\"](\d{4}-\d{2}-\d{2})['\"]", normalized)
    if literal_match:
        return f"DATE '{literal_match.group(1)}'"
    return normalized


def _find_top_level_comma(input_value: str) -> int:
    depth = 0
    quote: str | None = None
    index = 0
    while index < len(input_value):
        char = input_value[index]
        next_char = input_value[index + 1] if index + 1 < len(input_value) else ""

        if quote:
            if char == quote:
                if next_char == quote:
                    index += 2
                    continue
                quote = None
            index += 1
            continue

        if char in {"'", '"'}:
            quote = char
            index += 1
            continue
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        elif char == "," and depth == 0:
            return index
        index += 1
    return -1


def _parse_function_call_arguments(
    sql: str,
    open_paren_index: int,
) -> tuple[str, int] | None:
    depth = 0
    quote: str | None = None
    index = open_paren_index
    while index < len(sql):
        char = sql[index]
        next_char = sql[index + 1] if index + 1 < len(sql) else ""

        if quote:
            if char == quote:
                if next_char == quote:
                    index += 2
                    continue
                quote = None
            index += 1
            continue

        if char in {"'", '"'}:
            quote = char
            index += 1
            continue
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return sql[open_paren_index + 1 : index], index
        index += 1
    return None


def _rewrite_function_calls(
    sql: str,
    function_name: str,
    rewrite,
) -> str:
    pattern = re.compile(rf"{function_name}\s*\(", re.IGNORECASE)
    result = ""
    cursor = 0
    search_start = 0

    while match := pattern.search(sql, search_start):
        open_paren_index = match.end() - 1
        parsed = _parse_function_call_arguments(sql, open_paren_index)
        if not parsed:
            search_start = match.end()
            continue

        inner, end_index = parsed
        rewritten = rewrite(inner)
        if not rewritten:
            search_start = match.end()
            continue

        result += sql[cursor : match.start()]
        result += rewritten
        cursor = end_index + 1
        search_start = cursor

    if cursor == 0:
        return sql
    return result + sql[cursor:]


def _negate_sql_interval_value(value: str) -> str:
    normalized = value.strip()
    if re.fullmatch(r"\d+(?:\.\d+)?", normalized):
        return f"-{normalized}"
    if normalized.startswith("-"):
        return normalized[1:].strip()
    return f"-({normalized})"


def _rewrite_mysql_date_add_call(inner: str) -> str | None:
    split_index = _find_top_level_comma(inner)
    if split_index == -1:
        return None

    base_expression = inner[:split_index].strip()
    interval_expression = inner[split_index + 1 :].strip()
    interval_match = MYSQL_INTERVAL_RE.match(interval_expression)
    if not interval_match:
        return None

    amount, unit = interval_match.groups()
    return (
        f"DATE_ADD('{unit.lower()}', {amount.strip()}, "
        f"{_normalize_sql_date_operand(base_expression)})"
    )


def _rewrite_mysql_date_sub_call(inner: str) -> str | None:
    split_index = _find_top_level_comma(inner)
    if split_index == -1:
        return None

    base_expression = inner[:split_index].strip()
    interval_expression = inner[split_index + 1 :].strip()
    interval_match = MYSQL_INTERVAL_RE.match(interval_expression)
    if not interval_match:
        return None

    amount, unit = interval_match.groups()
    return (
        f"DATE_ADD('{unit.lower()}', {_negate_sql_interval_value(amount)}, "
        f"{_normalize_sql_date_operand(base_expression)})"
    )


def _rewrite_mysql_datediff_call(inner: str) -> str | None:
    split_index = _find_top_level_comma(inner)
    if split_index == -1:
        return None

    left_expression = inner[:split_index].strip()
    right_expression = inner[split_index + 1 :].strip()
    return (
        "DATE_DIFF('day', "
        f"{_normalize_sql_date_operand(right_expression)}, "
        f"{_normalize_sql_date_operand(left_expression)})"
    )


def normalize_mysql_date_interval_functions(sql: str) -> str:
    """Convert common MySQL/TiDB date functions for Wren engine parsing.

    The SQL generation prompt intentionally favors MySQL/TiDB syntax, but the
    current preview path still validates through a Trino-style parser. This
    deterministic retry keeps generated SQL from failing on otherwise valid
    day-boundary filters such as DATE_ADD('2026-04-07', INTERVAL 1 DAY) or
    DATEDIFF(event_date, cohort_date).
    """

    return _rewrite_function_calls(
        _rewrite_function_calls(
            _rewrite_function_calls(sql, "DATE_ADD", _rewrite_mysql_date_add_call),
            "DATE_SUB",
            _rewrite_mysql_date_sub_call,
        ),
        "DATEDIFF",
        _rewrite_mysql_datediff_call,
    )


@component
class SQLGenPostProcessor:
    def __init__(self, engine: Engine):
        self._engine = engine

    @component.output_types(
        valid_generation_result=Dict[str, Any],
        invalid_generation_result=Dict[str, Any],
    )
    async def run(
        self,
        replies: List[str] | List[List[str]],
        runtime_scope_id: str | None = None,
        use_dry_plan: bool = False,
        allow_dry_plan_fallback: bool = True,
        data_source: str = "",
        allow_data_preview: bool = False,
        bridge_scope_id: str | None = None,
        sql_mode: str | None = None,
    ) -> dict:
        cleaned_generation_result = ""
        try:
            runtime_scope_id = resolve_pipeline_runtime_scope_id(
                runtime_scope_id, bridge_scope_id=bridge_scope_id
            )
            cleaned_generation_result = clean_generation_result(replies[0])

            # test if cleaned_generation_result in string format is actually a dictionary with key 'sql'
            if cleaned_generation_result.startswith("{"):
                cleaned_generation_result = orjson.loads(cleaned_generation_result)[
                    "sql"
                ]

            (
                valid_generation_result,
                invalid_generation_result,
            ) = await self._classify_generation_result(
                cleaned_generation_result,
                runtime_scope_id=runtime_scope_id,
                use_dry_plan=use_dry_plan,
                allow_dry_plan_fallback=allow_dry_plan_fallback,
                data_source=data_source,
                allow_data_preview=allow_data_preview,
                sql_mode=sql_mode,
            )

            return {
                "valid_generation_result": valid_generation_result,
                "invalid_generation_result": invalid_generation_result,
            }
        except Exception as e:
            logger.exception(f"Error in SQLGenPostProcessor: {e}")
            error_message = str(e)
            invalid_generation_result = {
                "sql": cleaned_generation_result or "",
                "original_sql": cleaned_generation_result or "",
                "type": (
                    "TIME_OUT"
                    if error_message.startswith("Request timed out")
                    else "DRY_PLAN"
                    if use_dry_plan
                    else "DRY_RUN"
                ),
                "error": error_message,
                "correlation_id": "",
            }

            return {
                "valid_generation_result": {},
                "invalid_generation_result": invalid_generation_result,
            }

    async def _classify_generation_result(
        self,
        generation_result: str,
        runtime_scope_id: str | None = None,
        use_dry_plan: bool = False,
        allow_dry_plan_fallback: bool = True,
        data_source: str = "",
        allow_data_preview: bool = False,
        sql_mode: str | None = None,
    ) -> Dict[str, str]:
        valid_generation_result = {}
        invalid_generation_result = {}
        use_dry_run = not allow_data_preview

        async with aiohttp.ClientSession() as session:
            if use_dry_plan:
                dry_plan_result, error_message = await self._engine.dry_plan(
                    session,
                    generation_result,
                    data_source,
                    allow_fallback=allow_dry_plan_fallback,
                )

                if dry_plan_result:
                    valid_generation_result = {
                        "sql": generation_result,
                        "correlation_id": "",
                    }
                else:
                    invalid_generation_result = {
                        "sql": generation_result,
                        "type": "TIME_OUT"
                        if error_message.startswith("Request timed out")
                        else "DRY_PLAN",
                        "error": error_message,
                        "correlation_id": "",
                    }
            elif use_dry_run:
                success, _, addition = await self._engine.execute_sql(
                    generation_result,
                    session,
                    runtime_scope_id=runtime_scope_id,
                    limit=1,
                    dry_run=True,
                    sql_mode=sql_mode,
                )

                validated_sql = generation_result
                if not success:
                    retry_sql = normalize_mysql_date_interval_functions(
                        generation_result
                    )
                    if retry_sql != generation_result:
                        success, _, addition = await self._engine.execute_sql(
                            retry_sql,
                            session,
                            runtime_scope_id=runtime_scope_id,
                            limit=1,
                            dry_run=True,
                            sql_mode=sql_mode,
                        )
                        if success:
                            validated_sql = retry_sql

                if success:
                    valid_generation_result = {
                        "sql": validated_sql,
                        "correlation_id": addition.get("correlation_id", ""),
                    }
                else:
                    error_message = addition.get("error_message", "")
                    invalid_generation_result = {
                        "sql": addition.get("error_sql", generation_result),
                        "original_sql": generation_result,
                        "type": "TIME_OUT"
                        if error_message.startswith("Request timed out")
                        else "DRY_RUN",
                        "error": error_message,
                        "correlation_id": addition.get("correlation_id", ""),
                    }
            else:
                has_data, _, addition = await self._engine.execute_sql(
                    generation_result,
                    session,
                    runtime_scope_id=runtime_scope_id,
                    limit=1,
                    dry_run=False,
                    sql_mode=sql_mode,
                )

                validated_sql = generation_result
                if not has_data:
                    retry_sql = normalize_mysql_date_interval_functions(
                        generation_result
                    )
                    if retry_sql != generation_result:
                        has_data, _, addition = await self._engine.execute_sql(
                            retry_sql,
                            session,
                            runtime_scope_id=runtime_scope_id,
                            limit=1,
                            dry_run=False,
                            sql_mode=sql_mode,
                        )
                        if has_data:
                            validated_sql = retry_sql

                if has_data:
                    valid_generation_result = {
                        "sql": validated_sql,
                        "correlation_id": addition.get("correlation_id", ""),
                    }
                else:
                    error_message = addition.get("error_message", "")
                    preview_data_status = (
                        "PREVIEW_EMPTY_DATA"
                        if error_message == ""
                        else "PREVIEW_FAILED"
                    )
                    invalid_generation_result = {
                        "sql": addition.get("error_sql", generation_result),
                        "original_sql": generation_result,
                        "type": "TIME_OUT"
                        if error_message.startswith("Request timed out")
                        else preview_data_status,
                        "error": error_message,
                        "correlation_id": addition.get("correlation_id", ""),
                    }

        return valid_generation_result, invalid_generation_result


_DEFAULT_TEXT_TO_SQL_RULES = """
### SQL RULES ###
- ONLY USE SELECT statements, NO DELETE, UPDATE OR INSERT etc. statements that might change the data in the database.
- ONLY USE the tables and columns mentioned in the database schema.
- ONLY USE "*" if the user query asks for all the columns of a table.
- ONLY CHOOSE columns belong to the tables mentioned in the database schema.
- DON'T INCLUDE comments in the generated SQL query.
- YOU MUST USE "JOIN" if you choose columns from multiple tables!
- PREFER USING CTEs over subqueries.
- When generating SQL query, always:
    - Put double quotes around column and table names.
    - Put single quotes around string literals.
    - Never quote numeric literals.
    For example: SELECT "customers"."customer_name" FROM "customers" WHERE "customers"."city" = 'Taipei' and "customers"."year" = 1992;
- YOU MUST USE "lower(<table_name>.<column_name>) like lower(<value>)" function or "lower(<table_name>.<column_name>) = lower(<value>)" function for case-insensitive comparison!
    - Use "lower(<table_name>.<column_name>) LIKE lower(<value>)" when:
        - The user requests a pattern or partial match.
        - The value is not specific enough to be a single, exact value.
        - Wildcards (%) are needed to capture the pattern.
    - Use "lower(<table_name>.<column_name>) = lower(<value>)" when:
        - The user requests an exact, specific value.
        - There is no ambiguity or pattern in the value.
- If the column is date/time related field, and it is a INT/BIGINT/DOUBLE/FLOAT type, please use the appropriate function mentioned in the SQL FUNCTIONS section to cast the column to "TIMESTAMP" type first before using it in the query
    - example: TO_TIMESTAMP_MILLIS("<timestamp_column>")  # if the timestamp_column is in milliseconds
    - example: TO_TIMESTAMP_SECONDS("<timestamp_column>")  # if the timestamp_column is in seconds
    - example: TO_TIMESTAMP_MICROS("<timestamp_column>")  # if the timestamp_column is in microseconds
- ALWAYS CAST the date/time related field to "TIMESTAMP WITH TIME ZONE" type when using them in the query
    - example 1: CAST(properties_closedate AS TIMESTAMP WITH TIME ZONE)
    - example 2: CAST('2024-11-09 00:00:00' AS TIMESTAMP WITH TIME ZONE)
    - example 3: CAST(DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') AS TIMESTAMP WITH TIME ZONE)
- If the user asks for a specific date, please give the date range in SQL query
    - example: "What is the total revenue for the month of 2024-11-01?"
    - answer: "SELECT SUM(r.PriceSum) FROM Revenue r WHERE CAST(r.PurchaseTimestamp AS TIMESTAMP WITH TIME ZONE) >= CAST('2024-11-01 00:00:00' AS TIMESTAMP WITH TIME ZONE) AND CAST(r.PurchaseTimestamp AS TIMESTAMP WITH TIME ZONE) < CAST('2024-11-02 00:00:00' AS TIMESTAMP WITH TIME ZONE)"
- USE THE VIEW TO SIMPLIFY THE QUERY.
- DON'T MISUSE THE VIEW NAME. THE ACTUAL NAME IS FOLLOWING THE CREATE VIEW STATEMENT.
- ONLY USE table/column alias in the final SELECT clause; don't use table/columnalias in the other clauses.
- Refer to the value of alias from the comment section of the corresponding table or column in the DATABASE SCHEMA section for reference when using alias in the final SELECT clause.
  - EXAMPLE
    DATABASE SCHEMA
    /* {"alias":"_orders","description":"A model representing the orders data."} */
    CREATE TABLE orders (
      -- {"description":"A column that represents the timestamp when the order was approved.","alias":"_timestamp"}
      ApprovedTimestamp TIMESTAMP
    }

    SQL
    SELECT "_orders"."ApprovedTimestamp" AS "_timestamp" FROM "orders" AS "_orders";
- DON'T USE '.' in column/table alias, replace '.' with '_' in column/table alias.
- DON'T USE "FILTER(WHERE <expression>)" clause in the generated SQL query.
- DON'T USE "EXTRACT(EPOCH FROM <expression>)" clause in the generated SQL query.
- DON'T USE "EXTRACT()" function with INTERVAL data types as arguments
- DON'T USE INTERVAL or generate INTERVAL-like expression in the generated SQL query.
- DON'T USE "TO_CHAR" function in the generated SQL query.
- Aggregate functions are not allowed in the WHERE clause. Instead, they belong in the HAVING clause, which is used to filter after aggregation.
- You can only add "ORDER BY" and "LIMIT" to the final "UNION" result.
- For the ranking problem, you must use the ranking function, `DENSE_RANK()` to rank the results and then use `WHERE` clause to filter the results.
- For the ranking problem, you must add the ranking column to the final SELECT clause.
"""

_TRINO_TEXT_TO_SQL_RULES = """
### TRINO DIALECT RULES ###
- The runtime engine is Trino. Use Trino-compatible SQL syntax and functions.
- Use the logical table names shown in the `CREATE TABLE` statements in DATABASE SCHEMA for the final SQL query.
- If a table comment exposes `source_catalog`, `source_schema`, or `source_table_identity`, treat them as origin hints for reasoning and disambiguation.
- Use `CAST(<expr> AS <type>)` instead of PostgreSQL-style `::<type>` casts.
- Do not use PostgreSQL-only features such as `ILIKE` or `DISTINCT ON`.
- Do not use BigQuery-only features such as backtick identifiers, `SAFE_CAST`, or `QUALIFY`.
- Prefer Trino-compatible date/time helpers such as `date_trunc`, `current_date`, and `current_timestamp`.
"""


_DEFAULT_CALCULATED_FIELD_INSTRUCTIONS = """
#### Instructions for Calculated Field ####

The first structure is the special column marked as "Calculated Field". You need to interpret the purpose and calculation basis for these columns, then utilize them in the following text-to-sql generation tasks.
First, provide a brief explanation of what each field represents in the context of the schema, including how each field is computed using the relationships between models.
Then, during the following tasks, if the user queries pertain to any calculated fields defined in the database schema, ensure to utilize those calculated fields appropriately in the output SQL queries.
The goal is to accurately reflect the intent of the question in the SQL syntax, leveraging the pre-computed logic embedded within the calculated fields.

EXAMPLES:
The given schema is created by the SQL command:

CREATE TABLE orders (
  OrderId VARCHAR PRIMARY KEY,
  CustomerId VARCHAR,
  -- This column is a Calculated Field
  -- column expression: avg(reviews.Score)
  Rating DOUBLE,
  -- This column is a Calculated Field
  -- column expression: count(reviews.Id)
  ReviewCount BIGINT,
  -- This column is a Calculated Field
  -- column expression: count(order_items.ItemNumber)
  Size BIGINT,
  -- This column is a Calculated Field
  -- column expression: count(order_items.ItemNumber) > 1
  Large BOOLEAN,
  FOREIGN KEY (CustomerId) REFERENCES customers(Id)
);

Interpret the columns that are marked as Calculated Fields in the schema:
Rating (DOUBLE) - Calculated as the average score (avg) of the Score field from the reviews table where the reviews are associated with the order. This field represents the overall customer satisfaction rating for the order based on review scores.
ReviewCount (BIGINT) - Calculated by counting (count) the number of entries in the reviews table associated with this order. It measures the volume of customer feedback received for the order.
Size (BIGINT) - Represents the total number of items in the order, calculated by counting the number of item entries (ItemNumber) in the order_items table linked to this order. This field is useful for understanding the scale or size of an order.
Large (BOOLEAN) - A boolean value calculated to check if the number of items in the order exceeds one (count(order_items.ItemNumber) > 1). It indicates whether the order is considered large in terms of item quantity.

And if the user input queries like these:
1. "How many large orders have been placed by customer with ID 'C1234'?"
2. "What is the average customer rating for orders that were rated by more than 10 reviewers?"

For the first query:
First try to intepret the user query, the user wants to know the average rating for orders which have attracted significant review activity, specifically those with more than 10 reviews.
Then, according to the above intepretation about the given schema, the term 'Rating' is predefined in the Calculated Field of the 'orders' model. And, the number of reviews is also predefined in the 'ReviewCount' Calculated Field.
So utilize those Calculated Fields in the SQL generation process to give an answer like this:

SQL Query: SELECT AVG(Rating) FROM orders WHERE ReviewCount > 10
"""

_DEFAULT_METRIC_INSTRUCTIONS = """
#### Instructions for Metric ####

Second, you will learn how to effectively utilize the special "metric" structure in text-to-SQL generation tasks.
Metrics in a data model simplify complex data analysis by structuring data through predefined dimensions and measures.
This structuring closely mirrors the concept of OLAP (Online Analytical Processing) cubes but is implemented in a more flexible and SQL-friendly manner.

The metric typically constructed of the following components:
1. Base Object
The "base object" of a metric indicates the primary data source or table that provides the raw data.
Metrics are constructed by selecting specific data points (dimensions and measures) from this base object, effectively creating a summarized or aggregated view of the data that can be queried like a normal table.
Base object is the attribute of the metric, showing the origin of this metric and is typically not used in the query.
2. Dimensions
Dimensions in a metric represent the various axes along which data can be segmented for analysis.
These are fields that provide a categorical breakdown of data.
Each dimension provides a unique perspective on the data, allowing users to "slice and dice" the data cube to view different facets of the information contained within the base dataset.
Dimensions are used as table columns in the querying process. Querying a dimension means to get the statistic from the certain perspective.
3. Measures
Measures are numerical or quantitative statistics calculated from the data. Measures are key results or outputs derived from data aggregation functions like SUM, COUNT, or AVG.
Measures are used as table columns in the querying process, and are the main querying items in the metric structure.
The expression of a measure represents the definition of the  that users are intrested in. Make sure to understand the meaning of measures from their expressions.
4. Time Grain
Time Grain specifies the granularity of time-based data aggregation, such as daily, monthly, or yearly, facilitating trend analysis over specified periods.

If the given schema contains the structures marked as 'metric', you should first interpret the metric schema based on the above definition.
Then, during the following tasks, if the user queries pertain to any metrics defined in the database schema, ensure to utilize those metrics appropriately in the output SQL queries.
The target is making complex data analysis more accessible and manageable by pre-aggregating data and structuring it using the metric structure, and supporting direct querying for business insights.

EXAMPLES:
The given schema is created by the SQL command:

/* This table is a metric */
/* Metric Base Object: orders */
CREATE TABLE Revenue (
  -- This column is a dimension
  PurchaseTimestamp TIMESTAMP,
  -- This column is a dimension
  CustomerId VARCHAR,
  -- This column is a dimension
  Status VARCHAR,
  -- This column is a measure
  -- expression: sum(order_items.Price)
  PriceSum DOUBLE,
  -- This column is a measure
  -- expression: count(OrderId)
  NumberOfOrders BIGINT
);

Interpret the metric with the understanding of the metric structure:
1. Base Object: orders
This is the primary data source for the metric.
The orders table provides the underlying data from which dimensions and measures are derived.
It is the foundation upon which the metric is built, though it itself is not directly used in queries against the Revenue table.
It shows the reference between the 'Revenue' metric and the 'orders' model. For the user queries pretain to the 'Revenue' of 'orders', the metric should be utilize in the sql generation process.
2. Dimensions
The metric contains the columns marked as 'dimension'. They can be interpreted as below:
- PurchaseTimestamp (TIMESTAMP)
  Acts as a temporal dimension, allowing analysis of revenue over time. This can be used to observe trends, seasonal variations, or performance over specific periods.
- CustomerId (VARCHAR)
  A key dimension for customer segmentation, it enables the analysis of revenue generated from individual customers or customer groups.
- Status (VARCHAR)
  Reflects the current state of an order (e.g., pending, completed, cancelled). This dimension is crucial for analyses that differentiate performance based on order status.
3. Measures
The metric contains the columns marked as 'measure'. They can be interpreted as below:
- PriceSum (DOUBLE)
  A financial measure calculated as sum(order_items.Price), representing the total revenue generated from orders. This measure is vital for tracking overall sales performance and is the primary output of interest in many financial and business analyses.
- NumberOfOrders (BIGINT)
  A count measure that provides the total number of orders. This is essential for operational metrics, such as assessing the volume of business activity and evaluating the efficiency of sales processes.

Now, if the user input queries like this:
Question: "What was the total revenue from each customer last month?"

First try to intepret the user query, the user asks for a breakdown of the total revenue generated by each customer in the previous calendar month.
The user is specifically interested in understanding how much each customer contributed to the total sales during this period.
To answer this question, it is suitable to use the following components from the metric:
1. CustomerId (Dimension): This will be used to group the revenue data by each unique customer, allowing us to segment the total revenue by customer.
2. PurchaseTimestamp (Dimension): This timestamp field will be used to filter the data to only include orders from the last month.
3. PriceSum (Measure): Since PriceSum is a pre-aggregated measure of total revenue (sum of order_items.Price), it can be directly used to sum up the revenue without needing further aggregation in the SQL query.
So utilize those metric components in the SQL generation process to give an answer like this:

SQL Query:
SELECT
  CustomerId,
  PriceSum AS TotalRevenue
FROM
  Revenue
WHERE
  PurchaseTimestamp >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') AND
  PurchaseTimestamp < DATE_TRUNC('month', CURRENT_DATE)
"""

_DEFAULT_JSON_FIELD_INSTRUCTIONS = """
#### Instructions for JSON related functions ####
- ONLY USE JSON_QUERY for querying fields if "json_type":"JSON" is identified in the columns comment, NOT the deprecated JSON_EXTRACT_SCALAR function.
    - DON'T USE CAST for JSON fields, ONLY USE the following funtions:
      - LAX_BOOL for boolean fields
      - LAX_FLOAT64 for double and float fields
      - LAX_INT64 for bigint fields
      - LAX_STRING for varchar fields
    - For Example:
      DATA SCHEMA:
        `/* {"alias":"users","description":"A model representing the users data."} */
        CREATE TABLE users (
            -- {"alias":"address","description":"A JSON object that represents address information of this user.","json_type":"JSON","json_fields":{"json_type":"JSON","address.json.city":{"name":"city","type":"varchar","path":"$.city","properties":{"alias":"city","description":"City Name."}},"address.json.state":{"name":"state","type":"varchar","path":"$.state","properties":{"alias":"state","description":"ISO code or name of the state, province or district."}},"address.json.postcode":{"name":"postcode","type":"varchar","path":"$.postcode","properties":{"alias":"postcode","description":"Postal code."}},"address.json.country":{"name":"country","type":"varchar","path":"$.country","properties":{"alias":"country","description":"ISO code of the country."}}}}
            address JSON
        )`
      To get the city of address in user table use SQL:
      `SELECT LAX_STRING(JSON_QUERY(u.address, '$.city')) FROM user as u`
- ONLY USE JSON_QUERY_ARRAY for querying "json_type":"JSON_ARRAY" is identified in the comment of the column, NOT the deprecated JSON_EXTRACT_ARRAY.
    - USE UNNEST to analysis each item individually in the ARRAY. YOU MUST SELECT FROM the parent table ahead of the UNNEST ARRAY.
    - The alias of the UNNEST(ARRAY) should be in the format `unnest_table_alias(individual_item_alias)`
      - For Example: `SELECT item FROM UNNEST(ARRAY[1,2,3]) as my_unnested_table(item)`
    - If the items in the ARRAY are JSON objects, use JSON_QUERY to query the fields inside each JSON item.
      - For Example:
      DATA SCHEMA
        `/* {"alias":"my_table","description":"A test my_table"} */
        CREATE TABLE my_table (
            -- {"alias":"elements","description":"elements column","json_type":"JSON_ARRAY","json_fields":{"json_type":"JSON_ARRAY","elements.json_array.id":{"name":"id","type":"bigint","path":"$.id","properties":{"alias":"id","description":"data ID."}},"elements.json_array.key":{"name":"key","type":"varchar","path":"$.key","properties":{"alias":"key","description":"data Key."}},"elements.json_array.value":{"name":"value","type":"varchar","path":"$.value","properties":{"alias":"value","description":"data Value."}}}}
            elements JSON
        )`
        To get the number of elements in my_table table use SQL:
        `SELECT LAX_INT64(JSON_QUERY(element, '$.number')) FROM my_table as t, UNNEST(JSON_QUERY_ARRAY(elements)) AS my_unnested_table(element) WHERE LAX_FLOAT64(JSON_QUERY(element, '$.value')) > 3.5`
    - To JOIN ON the fields inside UNNEST(ARRAY), YOU MUST SELECT FROM the parent table ahead of the UNNEST syntax, and the alias of the UNNEST(ARRAY) SHOULD BE IN THE FORMAT unnest_table_alias(individual_item_alias)
      - For Example: `SELECT p.column_1, j.column_2 FROM parent_table AS p, join_table AS j JOIN UNNEST(p.array_column) AS unnested(array_item) ON j.id = array_item.id`
- DON'T USE JSON_QUERY and JSON_QUERY_ARRAY when "json_type":"".
- DON'T USE LAX_BOOL, LAX_FLOAT64, LAX_INT64, LAX_STRING when "json_type":"".
"""

sql_samples_instructions = """
#### Instructions for SQL Samples ####

Finally, you will learn from the sample SQL queries provided in the input. These samples demonstrate best practices and common patterns for querying this specific database.

For each sample, you should:
1. Study the question that explains what the query aims to accomplish
2. Analyze the SQL implementation to understand:
   - Table structures and relationships used
   - Specific functions and operators employed
   - Query patterns and techniques demonstrated
3. Use these samples as reference patterns when generating similar queries
4. Adapt the techniques shown in the samples to match new query requirements while maintaining consistent style and approach

The samples will help you understand:
- Preferred table join patterns
- Common aggregation methods
- Specific function usage
- Query structure and formatting conventions

When generating new queries, try to follow similar patterns when applicable, while adapting them to the specific requirements of each new query.

Learn about the usage of the schema structures and generate SQL based on them.
"""


sql_generation_reasoning_system_prompt = """
### TASK ###
You are a helpful data analyst who is great at thinking deeply and reasoning about the user's question and the database schema, and you provide a step-by-step reasoning plan in order to answer the user's question.

### INSTRUCTIONS ###
1. Think deeply and reason about the user's question, the database schema, and the user's query history if provided.
2. Explicitly state the following information in the reasoning plan: 
if the user puts any specific timeframe(e.g. YYYY-MM-DD) in the user's question(excluding the value of the current time), you will put the absolute time frame in the SQL query; 
otherwise, you will put the relative timeframe in the SQL query.
3. For the ranking problem(e.g. "top x", "bottom x", "first x", "last x"), you must use the ranking function, `DENSE_RANK()` to rank the results and then use `WHERE` clause to filter the results.
4. For the ranking problem(e.g. "top x", "bottom x", "first x", "last x"), you must add the ranking column to the final SELECT clause.
5. If USER INSTRUCTIONS section is provided, make sure to consider them in the reasoning plan.
6. If SQL SAMPLES section is provided, make sure to consider them in the reasoning plan.
7. Give a step by step reasoning plan in order to answer user's question.
8. The reasoning plan should be in the language same as the language user provided in the input.
9. Don't include SQL in the reasoning plan.
10. Each step in the reasoning plan must start with a number, a title(in bold format in markdown), and a reasoning for the step.
11. Do not include ```markdown or ``` in the answer.
12. A table name in the reasoning plan must be in this format: `table: <table_name>`.
13. A column name in the reasoning plan must be in this format: `column: <table_name>.<column_name>`.
14. ONLY SHOWING the reasoning plan in bullet points.

### FINAL ANSWER FORMAT ###
The final answer must be a reasoning plan in plain Markdown string format
"""

_MYSQL_COMPATIBLE_TEXT_TO_SQL_RULES = """
### MYSQL / TIDB DIALECT RULES ###
- For MySQL- and TiDB-compatible engines, do NOT use double-quoted identifiers like "table"."column" unless ANSI_QUOTES is explicitly guaranteed.
- Prefer bare identifiers (table.column) or backticks (`table`.`column`) when quoting is required.
- Use MySQL / TiDB date arithmetic syntax such as DATE_ADD(<date_expr>, INTERVAL <n> DAY), DATE_SUB(...), and DATEDIFF(<lhs>, <rhs>).
- Prefer IFNULL(...) or COALESCE(...) for NULL handling and avoid dialect-specific casts such as <expr>::type.
- Keep recursive CTE syntax and window functions compatible with MySQL 8.0 / TiDB semantics.
- Do not use PostgreSQL-only or BigQuery-only features such as ILIKE, QUALIFY, SAFE_CAST, or DISTINCT ON.
"""


def _extract_from_sql_knowledge(
    sql_knowledge: SqlKnowledge | None, attribute_name: str, default_value: str
) -> str:
    if sql_knowledge is None:
        return default_value

    value = getattr(sql_knowledge, attribute_name, "")
    return value if value and value.strip() else default_value


def _with_data_source_specific_rules(base_rules: str, data_source: str | None) -> str:
    normalized_data_source = (data_source or "").strip().lower()
    if normalized_data_source == "trino":
        return f"{base_rules}\n\n{_TRINO_TEXT_TO_SQL_RULES}"
    if normalized_data_source in {"mysql", "tidb"}:
        return f"{base_rules}\n\n{_MYSQL_COMPATIBLE_TEXT_TO_SQL_RULES}"

    return base_rules


def get_text_to_sql_rules(
    sql_knowledge: SqlKnowledge | None = None,
    data_source: str | None = None,
) -> str:
    if sql_knowledge is not None:
        return _with_data_source_specific_rules(
            _extract_from_sql_knowledge(
            sql_knowledge, "text_to_sql_rule", _DEFAULT_TEXT_TO_SQL_RULES
            ),
            data_source,
        )

    return _with_data_source_specific_rules(_DEFAULT_TEXT_TO_SQL_RULES, data_source)


def get_calculated_field_instructions(sql_knowledge: SqlKnowledge | None = None) -> str:
    if sql_knowledge is not None:
        return _extract_from_sql_knowledge(
            sql_knowledge,
            "calculated_field_instructions",
            _DEFAULT_CALCULATED_FIELD_INSTRUCTIONS,
        )

    return _DEFAULT_CALCULATED_FIELD_INSTRUCTIONS


def get_metric_instructions(sql_knowledge: SqlKnowledge | None = None) -> str:
    if sql_knowledge is not None:
        return _extract_from_sql_knowledge(
            sql_knowledge, "metric_instructions", _DEFAULT_METRIC_INSTRUCTIONS
        )

    return _DEFAULT_METRIC_INSTRUCTIONS


def get_json_field_instructions(sql_knowledge: SqlKnowledge | None = None) -> str:
    if sql_knowledge is not None:
        return _extract_from_sql_knowledge(
            sql_knowledge, "json_field_instructions", _DEFAULT_JSON_FIELD_INSTRUCTIONS
        )

    return _DEFAULT_JSON_FIELD_INSTRUCTIONS


def get_sql_generation_system_prompt(
    sql_knowledge: SqlKnowledge | None = None,
    data_source: str | None = None,
) -> str:
    text_to_sql_rules = get_text_to_sql_rules(sql_knowledge, data_source)

    return f"""
You are a helpful assistant that converts natural language queries into ANSI SQL queries.

Given user's question, database schema, etc., you should think deeply and carefully and generate the SQL query based on the given reasoning plan step by step.

### GENERAL RULES ###

1. YOU MUST FOLLOW the instructions strictly to generate the SQL query if the section of USER INSTRUCTIONS is available in user's input.
2. YOU MUST ONLY CHOOSE the appropriate functions from the sql functions list and use them in the SQL query if the section of SQL FUNCTIONS is available in user's input.
3. YOU MUST REFER to the sql samples and learn the usage of the schema structures and how SQL is written based on them if the section of SQL SAMPLES is available in user's input.
4. YOU MUST FOLLOW the reasoning plan step by step strictly to generate the SQL query if the section of REASONING PLAN is available in user's input.
5. YOU MUST FOLLOW SQL Rules if they are not contradicted with instructions.

{text_to_sql_rules}

### FINAL ANSWER FORMAT ###
The final answer must be a ANSI SQL query in JSON format:

{{
    "sql": <SQL_QUERY_STRING>
}}
"""


class SqlGenerationResult(BaseModel):
    sql: str


SQL_GENERATION_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "sql_generation_result",
            "schema": SqlGenerationResult.model_json_schema(),
        },
    }
}


def _normalize_instruction_text(instruction: Any) -> str:
    if isinstance(instruction, str):
        return instruction.strip()
    if isinstance(instruction, dict):
        value = instruction.get("instruction") or instruction.get("content") or ""
        return str(value).strip()
    return str(instruction).strip()


def _normalize_knowledge_asset_type(instruction: Any) -> str:
    if not isinstance(instruction, dict):
        return ""
    return str(instruction.get("knowledge_asset_type") or "").strip().lower()


def construct_instructions(
    instructions: list[dict] | list[str] | None = None,
    group_by_asset_type: bool = False,
):
    if not group_by_asset_type:
        return [
            text
            for text in (
                _normalize_instruction_text(instruction)
                for instruction in (instructions or [])
            )
            if text
        ]

    grouped_instructions = {
        "business_glossary": [],
        "query_rules": [],
        "context_notes": [],
    }
    for instruction in instructions or []:
        text = _normalize_instruction_text(instruction)
        if not text:
            continue

        knowledge_asset_type = _normalize_knowledge_asset_type(instruction)
        if knowledge_asset_type == "business_term":
            grouped_instructions["business_glossary"].append(text)
        elif knowledge_asset_type == "external_dependency":
            grouped_instructions["context_notes"].append(text)
        else:
            # Treat sql_rule, instruction, missing, unknown, and legacy string
            # instructions as generic query rules so old inputs keep working.
            grouped_instructions["query_rules"].append(text)

    return grouped_instructions


def construct_ask_history_messages(
    histories: list[AskHistory] | list[dict],
) -> list[ChatMessage]:
    messages = []
    for history in histories:
        messages.append(
            ChatMessage.from_user(
                history.question
                if hasattr(history, "question")
                else history["question"]
            )
        )
        messages.append(
            ChatMessage.from_assistant(
                history.sql if hasattr(history, "sql") else history["sql"]
            )
        )
    return messages
