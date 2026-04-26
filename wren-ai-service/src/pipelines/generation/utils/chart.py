import logging
import re
from typing import Any, Dict, Literal, Optional

import orjson
import pandas as pd
from haystack import component
from jsonschema import validate
from jsonschema.exceptions import ValidationError
from pydantic import BaseModel, Field

logger = logging.getLogger("wren-ai-service")

NUMERIC_TYPE_PATTERN = re.compile(
    r"(int|integer|bigint|smallint|decimal|numeric|double|float|real|number)",
    re.IGNORECASE,
)
TEMPORAL_TYPE_PATTERN = re.compile(
    r"(date|time|timestamp|datetime)",
    re.IGNORECASE,
)
NUMERIC_VALUE_PATTERN = re.compile(
    r"^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$"
)
MEASURE_PRIORITY_PATTERN = re.compile(
    r"(amount|revenue|sales|gmv|bet|deposit|withdraw|loss|win|profit|ratio|rate|value|total|sum|avg|mean|score)",
    re.IGNORECASE,
)
COUNT_PRIORITY_PATTERN = re.compile(r"(count|num|qty|quantity)", re.IGNORECASE)
IDENTIFIER_PATTERN = re.compile(r"(^|_)(id|ids|code|key)$", re.IGNORECASE)
TEMPORAL_NAME_PATTERN = re.compile(r"(date|time|day|week|month|year)", re.IGNORECASE)


def _is_cjk_language(language: str | None, query: str | None = None) -> bool:
    normalized_language = (language or "").lower()
    if any(
        token in normalized_language
        for token in ["zh", "chinese", "中文", "简体", "繁體", "繁体"]
    ):
        return True
    return bool(query and re.search(r"[\u4e00-\u9fff]", query))


def _to_number(value: Any) -> float | int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        if pd.isna(value):
            return None
        return value
    if not isinstance(value, str):
        return None

    normalized = value.strip().replace(",", "")
    if not normalized or not NUMERIC_VALUE_PATTERN.match(normalized):
        return None

    numeric = float(normalized)
    if not pd.notna(numeric):
        return None
    if numeric.is_integer():
        return int(numeric)
    return numeric


def _normalize_chart_dataset(
    data: Dict[str, Any] | list[dict] | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if isinstance(data, list):
        rows = [row for row in data if isinstance(row, dict)]
        if not rows:
            return [], []
        columns = [{"name": name, "type": None} for name in rows[0].keys()]
        return columns, rows

    if not isinstance(data, dict):
        return [], []

    raw_columns = data.get("columns", [])
    raw_rows = data.get("data", [])
    columns: list[dict[str, Any]] = []
    for index, column in enumerate(raw_columns):
        if isinstance(column, dict):
            columns.append(
                {
                    "name": column.get("name", f"column_{index}"),
                    "type": column.get("type"),
                }
            )
        else:
            columns.append({"name": str(column), "type": None})

    rows: list[dict[str, Any]] = []
    for raw_row in raw_rows:
        if isinstance(raw_row, dict):
            rows.append(raw_row)
            continue

        if not isinstance(raw_row, (list, tuple)):
            continue

        row = {
            column["name"]: raw_row[index] if index < len(raw_row) else None
            for index, column in enumerate(columns)
        }
        rows.append(row)

    return columns, rows


def _looks_temporal_column(column: dict[str, Any], rows: list[dict[str, Any]]) -> bool:
    column_type = str(column.get("type") or "")
    column_name = str(column.get("name") or "")
    if TEMPORAL_TYPE_PATTERN.search(column_type):
        return True
    if TEMPORAL_NAME_PATTERN.search(column_name):
        sample_values = [
            row.get(column_name)
            for row in rows
            if row.get(column_name) not in [None, ""]
        ][:5]
        if not sample_values:
            return False
        return all(pd.notna(pd.to_datetime(value, errors="coerce")) for value in sample_values)
    return False


def _looks_numeric_column(column: dict[str, Any], rows: list[dict[str, Any]]) -> bool:
    column_type = str(column.get("type") or "")
    if NUMERIC_TYPE_PATTERN.search(column_type):
        return True

    column_name = str(column.get("name") or "")
    sample_values = [
        row.get(column_name)
        for row in rows
        if row.get(column_name) not in [None, ""]
    ][:20]
    if not sample_values:
        return False

    numeric_values = [value for value in sample_values if _to_number(value) is not None]
    return len(numeric_values) >= max(1, int(len(sample_values) * 0.6))


def _unique_non_null_values(column_name: str, rows: list[dict[str, Any]]) -> list[Any]:
    seen = []
    for row in rows:
        value = row.get(column_name)
        if value in [None, ""] or value in seen:
            continue
        seen.append(value)
    return seen


def _score_measure_column(column_name: str) -> int:
    score = 0
    if MEASURE_PRIORITY_PATTERN.search(column_name):
        score += 20
    if COUNT_PRIORITY_PATTERN.search(column_name):
        score -= 5
    if IDENTIFIER_PATTERN.search(column_name):
        score -= 20
    return score


def build_deterministic_chart_result(
    *,
    data: Dict[str, Any] | list[dict] | None,
    query: str,
    language: str,
) -> Optional[dict[str, Any]]:
    columns, rows = _normalize_chart_dataset(data)
    if len(rows) < 2 or not columns:
        return None

    row_count = len(rows)
    column_names = [str(column.get("name") or "") for column in columns]
    varying_columns = {
        name: len(_unique_non_null_values(name, rows))
        for name in column_names
    }

    temporal_dimension = next(
        (
            column
            for column in columns
            if varying_columns.get(str(column.get("name") or ""), 0) >= 2
            and _looks_temporal_column(column, rows)
        ),
        None,
    )

    category_dimension = temporal_dimension or next(
        (
            column
            for column in columns
            if varying_columns.get(str(column.get("name") or ""), 0) >= 2
            and not _looks_numeric_column(column, rows)
        ),
        None,
    )

    if category_dimension is None:
        category_dimension = next(
            (
                column
                for column in columns
                if varying_columns.get(str(column.get("name") or ""), 0) >= 2
                and not IDENTIFIER_PATTERN.search(str(column.get("name") or ""))
            ),
            None,
        )

    if category_dimension is None:
        return None

    category_name = str(category_dimension.get("name") or "")
    is_temporal_chart = category_dimension is temporal_dimension
    category_type = "temporal" if is_temporal_chart else "nominal"

    measure_candidates = []
    for index, column in enumerate(columns):
        column_name = str(column.get("name") or "")
        if column_name == category_name:
            continue
        if varying_columns.get(column_name, 0) < 1:
            continue
        if not _looks_numeric_column(column, rows):
            continue

        numeric_values = [
            _to_number(row.get(column_name))
            for row in rows
            if row.get(column_name) not in [None, ""]
        ]
        numeric_values = [value for value in numeric_values if value is not None]
        if not numeric_values:
            continue

        measure_candidates.append(
            (
                -_score_measure_column(column_name),
                index,
                column_name,
            )
        )

    ordered_measure_candidates = [
        column_name for _, _, column_name in sorted(measure_candidates)
    ]

    measure_columns = ordered_measure_candidates[: (3 if row_count <= 24 else 2)]
    if not measure_columns:
        return None

    use_cjk = _is_cjk_language(language, query)
    title = query.strip() or (
        "自动生成图表" if use_cjk else "Auto-generated chart"
    )

    if is_temporal_chart:
        if len(measure_columns) >= 2:
            chart_type = "multi_line"
            chart_schema = {
                "title": title,
                "mark": {"type": "line"},
                "transform": [
                    {
                        "fold": measure_columns,
                        "as": ["Metric", "Value"],
                    }
                ],
                "encoding": {
                    "x": {
                        "field": category_name,
                        "type": category_type,
                        "title": category_name,
                    },
                    "y": {
                        "field": "Value",
                        "type": "quantitative",
                        "title": "指标值" if use_cjk else "Value",
                    },
                    "color": {
                        "field": "Metric",
                        "type": "nominal",
                        "title": "指标" if use_cjk else "Metric",
                    },
                },
            }
            reasoning = (
                f"已根据 {category_name} 的时间变化趋势，使用多折线图展示关键指标。"
                if use_cjk
                else f"Used a multi-line chart to show key metrics over {category_name}."
            )
        else:
            chart_type = "line"
            chart_schema = {
                "title": title,
                "mark": {"type": "line"},
                "encoding": {
                    "x": {
                        "field": category_name,
                        "type": category_type,
                        "title": category_name,
                    },
                    "y": {
                        "field": measure_columns[0],
                        "type": "quantitative",
                        "title": measure_columns[0],
                    },
                },
            }
            reasoning = (
                f"已根据 {category_name} 的时间变化趋势，使用折线图展示 {measure_columns[0]}。"
                if use_cjk
                else f"Used a line chart to show how {measure_columns[0]} changes over {category_name}."
            )
    else:
        if len(measure_columns) >= 2:
            chart_type = "grouped_bar"
            chart_schema = {
                "title": title,
                "mark": {"type": "bar"},
                "transform": [
                    {
                        "fold": measure_columns,
                        "as": ["Metric", "Value"],
                    }
                ],
                "encoding": {
                    "x": {
                        "field": category_name,
                        "type": "nominal",
                        "title": category_name,
                    },
                    "y": {
                        "field": "Value",
                        "type": "quantitative",
                        "title": "指标值" if use_cjk else "Value",
                        "stack": None,
                    },
                    "xOffset": {
                        "field": "Metric",
                        "type": "nominal",
                        "title": "指标" if use_cjk else "Metric",
                    },
                    "color": {
                        "field": "Metric",
                        "type": "nominal",
                        "title": "指标" if use_cjk else "Metric",
                    },
                },
            }
            reasoning = (
                f"已使用分组柱状图，对比不同 {category_name} 下的关键指标。"
                if use_cjk
                else f"Used a grouped bar chart to compare key metrics across {category_name}."
            )
        else:
            chart_type = "bar"
            chart_schema = {
                "title": title,
                "mark": {"type": "bar"},
                "encoding": {
                    "x": {
                        "field": category_name,
                        "type": "nominal",
                        "title": category_name,
                    },
                    "y": {
                        "field": measure_columns[0],
                        "type": "quantitative",
                        "title": measure_columns[0],
                    },
                    "color": {
                        "field": category_name,
                        "type": "nominal",
                        "title": category_name,
                    },
                },
            }
            reasoning = (
                f"已使用柱状图，对比不同 {category_name} 的 {measure_columns[0]}。"
                if use_cjk
                else f"Used a bar chart to compare {measure_columns[0]} across {category_name}."
            )

    return {
        "reasoning": reasoning,
        "chart_type": chart_type,
        "chart_schema": chart_schema,
    }


chart_generation_instructions = """
### INSTRUCTIONS ###

- Chart types: Bar chart, Line chart, Multi line chart, Area chart, Pie chart, Stacked bar chart, Grouped bar chart
- You can only use the chart types provided in the instructions
- Generated chart should answer the user's question and based on the semantics of the SQL query, and the sample data, sample column values are used to help you generate the suitable chart type
- If the sample data is not suitable for visualization, you must return an empty string for the schema and chart type
- If the sample data is empty, you must return an empty string for the schema and chart type
- The language for the chart and reasoning must be the same language provided by the user
- Please use the current time provided by the user to generate the chart
- In order to generate the grouped bar chart, you need to follow the given instructions:
    - Disable Stacking: Add "stack": null to the y-encoding.
    - Use xOffset for subcategories to group bars.
    - Don't use "transform" section.
- In order to generate the pie chart, you need to follow the given instructions:
    - Add {"type": "arc"} to the mark section.
    - Add "theta" encoding to the encoding section.
    - Add "color" encoding to the encoding section.
    - Don't add "innerRadius" to the mark section.
- If the x-axis of the chart is a temporal field, the time unit should be the same as the question user asked.
    - For yearly question, the time unit should be "year".
    - For monthly question, the time unit should be "yearmonth".
    - For weekly question, the time unit should be "yearmonthdate".
    - For daily question, the time unit should be "yearmonthdate".
    - Default time unit is "yearmonth".
- For each axis, generate the corresponding human-readable title based on the language provided by the user.
- Make sure all of the fields(x, y, xOffset, color, etc.) in the encoding section of the chart schema are present in the column names of the data.

### GUIDELINES TO PLOT CHART ###

1. Understanding Your Data Types
- Nominal (Categorical): Names or labels without a specific order (e.g., types of fruits, countries).
- Ordinal: Categorical data with a meaningful order but no fixed intervals (e.g., rankings, satisfaction levels).
- Quantitative: Numerical values representing counts or measurements (e.g., sales figures, temperatures).
- Temporal: Date or time data (e.g., timestamps, dates).
2. Chart Types and When to Use Them
- Bar Chart
    - Use When: Comparing quantities across different categories.
    - Data Requirements:
        - One categorical variable (x-axis).
        - One quantitative variable (y-axis).
    - Example: Comparing sales numbers for different product categories.
- Grouped Bar Chart
    - Use When: Comparing sub-categories within main categories.
    - Data Requirements:
        - Two categorical variables (x-axis grouped by one, color-coded by another).
        - One quantitative variable (y-axis).
        - Example: Sales numbers for different products across various regions.
- Line Chart
    - Use When: Displaying trends over continuous data, especially time.
    - Data Requirements:
        - One temporal or ordinal variable (x-axis).
        - One quantitative variable (y-axis).
    - Example: Tracking monthly revenue over a year.
- Multi Line Chart
    - Use When: Displaying trends over continuous data, especially time.
    - Data Requirements:
        - One temporal or ordinal variable (x-axis).
        - Two or more quantitative variables (y-axis and color).
    - Implementation Notes:
        - Uses `transform` with `fold` to combine multiple metrics into a single series
        - The folded metrics are distinguished using the color encoding
    - Example: Tracking monthly click rate and read rate over a year.
- Area Chart
    - Use When: Similar to line charts but emphasizing the volume of change over time.
    - Data Requirements:
        - Same as Line Chart.
    - Example: Visualizing cumulative rainfall over months.
- Pie Chart
    - Use When: Showing parts of a whole as percentages.
    - Data Requirements:
        - One categorical variable.
        - One quantitative variable representing proportions.
    - Example: Market share distribution among companies.
- Stacked Bar Chart
    - Use When: Showing composition and comparison across categories.
    - Data Requirements: Same as grouped bar chart.
    - Example: Sales by region and product type.
- Guidelines for Selecting Chart Types
    - Comparing Categories:
        - Bar Chart: Best for simple comparisons across categories.
        - Grouped Bar Chart: Use when you have sub-categories.
        - Stacked Bar Chart: Use to show composition within categories.
    - Showing Trends Over Time:
        - Line Chart: Ideal for continuous data over time.
        - Area Chart: Use when you want to emphasize volume or total value over time.
    - Displaying Proportions:
        - Pie Chart: Use for simple compositions at a single point in time.
        - Stacked Bar Chart (100%): Use for comparing compositions across multiple categories.
    
### EXAMPLES ###

1. Bar Chart
- Sample Data:
 [
    {"Region": "North", "Sales": 100},
    {"Region": "South", "Sales": 200},
    {"Region": "East", "Sales": 300},
    {"Region": "West", "Sales": 400}
]
- Chart Schema:
{
    "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>,
    "mark": {"type": "bar"},
    "encoding": {
        "x": {"field": "Region", "type": "nominal", "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>},
        "y": {"field": "Sales", "type": "quantitative", "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>},
        "color": {"field": "Region", "type": "nominal", "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>"}
    }
}
2. Line Chart
- Sample Data:
[
    {"Date": "2022-01-01", "Sales": 100},
    {"Date": "2022-01-02", "Sales": 200},
    {"Date": "2022-01-03", "Sales": 300},
    {"Date": "2022-01-04", "Sales": 400}
]
- Chart Schema:
{
    "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>,
    "mark": {"type": "line"},
    "encoding": {
        "x": {"field": "Date", "type": "temporal", "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>},
        "y": {"field": "Sales", "type": "quantitative", "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>}
    }
}
3. Pie Chart
- Sample Data:
[
    {"Company": "Company A", "Market Share": 0.4},
    {"Company": "Company B", "Market Share": 0.3},
    {"Company": "Company C", "Market Share": 0.2},
    {"Company": "Company D", "Market Share": 0.1}
]
- Chart Schema:
{
    "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>,
    "mark": {"type": "arc"},
    "encoding": {
        "theta": {"field": "Market Share", "type": "quantitative"},
        "color": {"field": "Company", "type": "nominal", "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>}
    }
}
4. Area Chart
- Sample Data:
[
    {"Date": "2022-01-01", "Sales": 100},
    {"Date": "2022-01-02", "Sales": 200},
    {"Date": "2022-01-03", "Sales": 300},
    {"Date": "2022-01-04", "Sales": 400}
]
- Chart Schema:
{
    "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>",
    "mark": {"type": "area"},
    "encoding": {
        "x": {"field": "Date", "type": "temporal", "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>"},
        "y": {"field": "Sales", "type": "quantitative", "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>"}
    }
}
5. Stacked Bar Chart
- Sample Data:
[
    {"Region": "North", "Product": "A", "Sales": 100},
    {"Region": "North", "Product": "B", "Sales": 150},
    {"Region": "South", "Product": "A", "Sales": 200},
    {"Region": "South", "Product": "B", "Sales": 250},
    {"Region": "East", "Product": "A", "Sales": 300},
    {"Region": "East", "Product": "B", "Sales": 350},
    {"Region": "West", "Product": "A", "Sales": 400},
    {"Region": "West", "Product": "B", "Sales": 450}
]
- Chart Schema:
{
    "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>",
    "mark": {"type": "bar"},
    "encoding": {
        "x": {"field": "Region", "type": "nominal", "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>"},
        "y": {"field": "Sales", "type": "quantitative", "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>", "stack": "zero"},
        "color": {"field": "Product", "type": "nominal", "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>"}
    }
}
6. Grouped Bar Chart
- Sample Data:
[
    {"Region": "North", "Product": "A", "Sales": 100},
    {"Region": "North", "Product": "B", "Sales": 150},
    {"Region": "South", "Product": "A", "Sales": 200},
    {"Region": "South", "Product": "B", "Sales": 250},
    {"Region": "East", "Product": "A", "Sales": 300},
    {"Region": "East", "Product": "B", "Sales": 350},
    {"Region": "West", "Product": "A", "Sales": 400},
    {"Region": "West", "Product": "B", "Sales": 450}
]
- Chart Schema:
{
    "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>",
    "mark": {"type": "bar"},
    "encoding": {
        "x": {"field": "Region", "type": "nominal", "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>"},
        "y": {"field": "Sales", "type": "quantitative", "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>"},
        "xOffset": {"field": "Product", "type": "nominal", "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>"},
        "color": {"field": "Product", "type": "nominal", "title": "<TITLE_IN_LANGUAGE_PROVIDED_BY_USER>"}
    }
}
7. Multi Line Chart
- Sample Data:
[
    {"Date": "2022-01-01", "readCount": 100, "clickCount": 10},
    {"Date": "2022-01-02", "readCount": 200, "clickCount": 30},
    {"Date": "2022-01-03", "readCount": 300, "clickCount": 20},
    {"Date": "2022-01-04", "readCount": 400, "clickCount": 40}
]
- Chart Schema:
{
    "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>,
    "mark": {"type": "line"},
    "transform": [
        {
        "fold": ["readCount", "clickCount"],
        "as": ["Metric", "Value"]
        }
    ],
    "encoding": {
        "x": {"field": "Date", "type": "temporal", "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>},
        "y": {"field": "Value", "type": "quantitative", "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>},
        "color": {"field": "Metric", "type": "nominal", "title": <TITLE_IN_LANGUAGE_PROVIDED_BY_USER>}
    }
}
"""


@component
class ChartDataPreprocessor:
    @component.output_types(
        sample_data=list[dict],
        sample_column_values=dict[str, Any],
    )
    def run(
        self,
        data: Dict[str, Any],
        sample_data_count: int = 15,
        sample_column_size: int = 5,
    ):
        columns = [
            column.get("name", "") if isinstance(column, dict) else column
            for column in data.get("columns", [])
        ]
        data = data.get("data", [])

        df = pd.DataFrame(data, columns=columns)
        sample_column_values = {
            col: list(df[col].unique())[:sample_column_size] for col in df.columns
        }

        if len(df) > sample_data_count:
            sample_data = df.sample(n=sample_data_count).to_dict(orient="records")
        else:
            sample_data = df.to_dict(orient="records")

        return {
            "sample_data": sample_data,
            "sample_column_values": sample_column_values,
        }


@component
class ChartGenerationPostProcessor:
    @component.output_types(
        results=Dict[str, Any],
    )
    def run(
        self,
        replies: str,
        vega_schema: Dict[str, Any],
        sample_data: list[dict],
        remove_data_from_chart_schema: Optional[bool] = True,
    ):
        try:
            generation_result = orjson.loads(replies[0])
            reasoning = generation_result.get("reasoning", "")
            chart_type = generation_result.get("chart_type", "")
            if chart_schema := generation_result.get("chart_schema", {}):
                # sometimes the chart_schema is still in string format
                if isinstance(chart_schema, str):
                    chart_schema = orjson.loads(chart_schema)

                chart_schema[
                    "$schema"
                ] = "https://vega.github.io/schema/vega-lite/v5.json"
                chart_schema["data"] = {"values": sample_data}

                validate(chart_schema, schema=vega_schema)

                if remove_data_from_chart_schema:
                    chart_schema["data"]["values"] = []

                return {
                    "results": {
                        "chart_schema": chart_schema,
                        "reasoning": reasoning,
                        "chart_type": chart_type,
                    }
                }

            return {
                "results": {
                    "chart_schema": {},
                    "reasoning": reasoning,
                    "chart_type": chart_type,
                }
            }
        except ValidationError as e:
            logger.exception(f"Vega-lite schema is not valid: {e}")

            return {
                "results": {
                    "chart_schema": {},
                    "reasoning": "",
                    "chart_type": "",
                }
            }
        except Exception as e:
            logger.exception(f"JSON deserialization failed: {e}")

            return {
                "results": {
                    "chart_schema": {},
                    "reasoning": "",
                    "chart_type": "",
                }
            }


class ChartSchema(BaseModel):
    class ChartType(BaseModel):
        type: Literal["bar", "line", "area", "arc"]

    class ChartEncoding(BaseModel):
        field: str
        type: Literal["ordinal", "quantitative", "nominal"]
        title: str

    title: str
    mark: ChartType
    encoding: ChartEncoding


class TemporalChartEncoding(ChartSchema.ChartEncoding):
    type: Literal["temporal"] = Field(default="temporal")
    timeUnit: str = Field(default="yearmonth")


class LineChartSchema(ChartSchema):
    class LineChartMark(BaseModel):
        type: Literal["line"] = Field(default="line")

    class LineChartEncoding(BaseModel):
        x: TemporalChartEncoding | ChartSchema.ChartEncoding
        y: ChartSchema.ChartEncoding
        color: ChartSchema.ChartEncoding

    mark: LineChartMark
    encoding: LineChartEncoding


class MultiLineChartSchema(ChartSchema):
    class MultiLineChartMark(BaseModel):
        type: Literal["line"] = Field(default="line")

    class MultiLineChartTransform(BaseModel):
        fold: list[str]
        as_: list[str] = Field(alias="as")

    class MultiLineChartEncoding(BaseModel):
        x: TemporalChartEncoding | ChartSchema.ChartEncoding
        y: ChartSchema.ChartEncoding
        color: ChartSchema.ChartEncoding

    mark: MultiLineChartMark
    transform: list[MultiLineChartTransform]
    encoding: MultiLineChartEncoding


class BarChartSchema(ChartSchema):
    class BarChartMark(BaseModel):
        type: Literal["bar"] = Field(default="bar")

    class BarChartEncoding(BaseModel):
        x: TemporalChartEncoding | ChartSchema.ChartEncoding
        y: ChartSchema.ChartEncoding
        color: ChartSchema.ChartEncoding

    mark: BarChartMark
    encoding: BarChartEncoding


class GroupedBarChartSchema(ChartSchema):
    class GroupedBarChartMark(BaseModel):
        type: Literal["bar"] = Field(default="bar")

    class GroupedBarChartEncoding(BaseModel):
        x: TemporalChartEncoding | ChartSchema.ChartEncoding
        y: ChartSchema.ChartEncoding
        xOffset: ChartSchema.ChartEncoding
        color: ChartSchema.ChartEncoding

    mark: GroupedBarChartMark
    encoding: GroupedBarChartEncoding


class StackedBarChartYEncoding(ChartSchema.ChartEncoding):
    stack: Literal["zero"] = Field(default="zero")


class StackedBarChartSchema(ChartSchema):
    class StackedBarChartMark(BaseModel):
        type: Literal["bar"] = Field(default="bar")

    class StackedBarChartEncoding(BaseModel):
        x: TemporalChartEncoding | ChartSchema.ChartEncoding
        y: StackedBarChartYEncoding
        color: ChartSchema.ChartEncoding

    mark: StackedBarChartMark
    encoding: StackedBarChartEncoding


class PieChartSchema(ChartSchema):
    class PieChartMark(BaseModel):
        type: Literal["arc"] = Field(default="arc")

    class PieChartEncoding(BaseModel):
        theta: ChartSchema.ChartEncoding
        color: ChartSchema.ChartEncoding

    mark: PieChartMark
    encoding: PieChartEncoding


class AreaChartSchema(ChartSchema):
    class AreaChartMark(BaseModel):
        type: Literal["area"] = Field(default="area")

    class AreaChartEncoding(BaseModel):
        x: TemporalChartEncoding | ChartSchema.ChartEncoding
        y: ChartSchema.ChartEncoding

    mark: AreaChartMark
    encoding: AreaChartEncoding


class ChartGenerationResults(BaseModel):
    reasoning: str
    chart_type: Literal[
        "line", "multi_line", "bar", "pie", "grouped_bar", "stacked_bar", "area", ""
    ]  # empty string for no chart
    chart_schema: (
        LineChartSchema
        | MultiLineChartSchema
        | BarChartSchema
        | PieChartSchema
        | GroupedBarChartSchema
        | StackedBarChartSchema
        | AreaChartSchema
    )
