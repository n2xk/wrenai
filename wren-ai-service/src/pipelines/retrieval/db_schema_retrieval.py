import ast
import logging
import os
import re
import sys
from typing import Any, Optional

import orjson
import tiktoken
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack import Document
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider, EmbedderProvider, LLMProvider
from src.pipelines.common import (
    build_runtime_scope_filters,
    build_table_ddl,
    clean_up_new_lines,
    get_engine_supported_data_type,
    resolve_pipeline_runtime_scope_id,
)
from src.utils import trace_cost
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")

TABLE_IDENTIFIER_PATTERN = re.compile(
    r"(?<![A-Za-z0-9_])([A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z][A-Za-z0-9_]*)?)(?![A-Za-z0-9_])"
)
TABLE_IDENTIFIER_PREFIXES = (
    "ads_",
    "dim_",
    "dwd_",
    "dws_",
    "fact_",
    "ods_",
    "tidb_",
)


def _env_flag_enabled(name: str, default: bool = True) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() not in {"0", "false", "no", "off"}


schema_linking_entity_system_prompt = """
### TASK ###
Extract schema-linking entities from the user's text-to-SQL question.

Return only JSON. Do not generate SQL.

Entities should help schema retrieval:
- table_names: explicit or strongly implied physical/logical table names.
- column_names: explicit or strongly implied column names.
- business_terms: business concepts or metric names that should influence table retrieval.

Use conservative extraction. If uncertain, put the phrase in business_terms instead
of inventing a table or column.

### FINAL ANSWER FORMAT ###
{
  "table_names": ["..."],
  "column_names": ["..."],
  "business_terms": ["..."]
}
"""

schema_linking_entity_user_prompt_template = """
### QUESTION ###
{{ question }}
"""


table_columns_selection_system_prompt = """
### TASK ###
You are a highly skilled data analyst. Your goal is to examine the provided database schema, interpret the posed question, and identify the specific columns from the relevant tables required to construct an accurate SQL query.

The database schema includes tables, columns, primary keys, foreign keys, relationships, and any relevant constraints.

### INSTRUCTIONS ###
1. Carefully analyze the schema and identify the essential tables and columns needed to answer the question.
2. For each table, provide a clear and concise reasoning for why specific columns are selected.
3. List each reason as part of a step-by-step chain of thought, justifying the inclusion of each column.
4. If a "." is included in columns, put the name before the first dot into chosen columns.
5. The number of columns chosen must match the number of reasoning.
6. Final chosen columns must be only column names, don't prefix it with table names.
7. If the chosen column is a child column of a STRUCT type column, choose the parent column instead of the child column.

### FINAL ANSWER FORMAT ###
Please provide your response as a JSON object, structured as follows:

{
    "results": [
        {
            "table_selection_reason": "Reason for selecting tablename1",
            "table_contents": {
              "chain_of_thought_reasoning": [
                  "Reason 1 for selecting column1",
                  "Reason 2 for selecting column2",
                  ...
              ],
              "columns": ["column1", "column2", ...]
            },
            "table_name":"tablename1",
        },
        {
            "table_selection_reason": "Reason for selecting tablename2",
            "table_contents":
            {
              "chain_of_thought_reasoning": [
                  "Reason 1 for selecting column1",
                  "Reason 2 for selecting column2",
                  ...
              ],
              "columns": ["column1", "column2", ...]
            },
            "table_name":"tablename2"
        },
        ...
    ]
}

### ADDITIONAL NOTES ###
- Each table key must list only the columns relevant to answering the question.
- Provide a reasoning list (`chain_of_thought_reasoning`) for each table, explaining why each column is necessary.
- Provide the reason of selecting the table in (`table_selection_reason`) for each table.
- Be logical, concise, and ensure the output strictly follows the required JSON format.
- Use table name used in the "Create Table" statement, don't use "alias".
- Match Column names with the definition in the "Create Table" statement.
- Match Table names with the definition in the "Create Table" statement.

Good luck!

"""

table_columns_selection_user_prompt_template = """
### Database Schema ###

{% for db_schema in db_schemas %}
    {{ db_schema }}
{% endfor %}

### INPUT ###
{{ question }}
"""


def _build_metric_ddl(content: dict) -> str:
    columns_ddl = [
        f"{column['comment']}{column['name']} {get_engine_supported_data_type(column['data_type'])}"
        for column in content["columns"]
        if column["data_type"].lower()
        != "unknown"  # quick fix: filtering out UNKNOWN column type
    ]

    return (
        f"{content['comment']}CREATE TABLE {content['name']} (\n  "
        + ",\n  ".join(columns_ddl)
        + "\n);"
    )


def _build_view_ddl(content: dict) -> str:
    return (
        f"{content['comment']}CREATE VIEW {content['name']}\nAS {content['statement']}"
    )


## Start of Pipeline
@observe(capture_input=False, capture_output=False)
async def schema_linking_entities(
    query: str,
    histories: list[AskHistory],
    schema_linking_entity_generator: Any,
    schema_linking_entity_prompt_builder: PromptBuilder,
) -> dict[str, Any]:
    if not query or not _env_flag_enabled(
        "WREN_SCHEMA_LINKING_ENTITY_EXTRACTION_ENABLED",
        True,
    ):
        return {}

    previous_query_summaries = (
        [history.question for history in histories] if histories else []
    )
    combined_query = "\n".join([*previous_query_summaries, query])
    try:
        prompt = schema_linking_entity_prompt_builder.run(question=combined_query).get(
            "prompt"
        )
        response = await schema_linking_entity_generator(
            prompt=clean_up_new_lines(prompt or "")
        )
        raw_reply = (response.get("replies") or ["{}"])[0]
        entities = orjson.loads(raw_reply)
        return {
            "table_names": [
                str(value).strip()
                for value in entities.get("table_names", [])
                if str(value).strip()
            ],
            "column_names": [
                str(value).strip()
                for value in entities.get("column_names", [])
                if str(value).strip()
            ],
            "business_terms": [
                str(value).strip()
                for value in entities.get("business_terms", [])
                if str(value).strip()
            ],
        }
    except Exception as exc:
        logger.warning(
            "Schema-linking entity extraction failed; falling back to keyword/vector retrieval: %s",
            exc,
            exc_info=True,
        )
        return {}


@observe(capture_input=False, capture_output=False)
async def embedding(
    query: str,
    embedder: Any,
    histories: list[AskHistory],
    schema_linking_entities: dict[str, Any],
) -> dict:
    if query:
        if histories:
            previous_query_summaries = [history.question for history in histories]
        else:
            previous_query_summaries = []

        entity_terms = []
        for key in ("table_names", "column_names", "business_terms"):
            entity_terms.extend(schema_linking_entities.get(key) or [])
        entity_suffix = (
            "\nSchema linking entities: " + ", ".join(dict.fromkeys(entity_terms))
            if entity_terms
            else ""
        )

        query = "\n".join(previous_query_summaries) + "\n" + query + entity_suffix

        return await embedder.run(query)
    else:
        return {}


def _extract_keyword_table_candidates(
    query: str | None,
    *,
    histories: list[AskHistory] | None = None,
    tables: list[str] | None = None,
    schema_linking_entities: dict[str, Any] | None = None,
) -> list[str]:
    candidates: list[str] = []

    def add_candidate(value: Any) -> None:
        raw_value = str(value or "").strip().strip('`"[]')
        if not raw_value:
            return
        for candidate in (raw_value, raw_value.split(".")[-1]):
            normalized_candidate = candidate.strip().strip('`"[]')
            if normalized_candidate and normalized_candidate not in candidates:
                candidates.append(normalized_candidate)

    for table in tables or []:
        add_candidate(table)
    for table in (schema_linking_entities or {}).get("table_names") or []:
        add_candidate(table)

    texts = [query or ""]
    for history in histories or []:
        if isinstance(history, dict):
            history_question = history.get("question")
        else:
            history_question = getattr(history, "question", None)
        if history_question:
            texts.append(str(history_question))
    for text in texts:
        for match in TABLE_IDENTIFIER_PATTERN.finditer(text):
            identifier = match.group(1)
            bare_identifier = identifier.split(".")[-1]
            if "_" not in bare_identifier:
                continue
            if not bare_identifier.lower().startswith(TABLE_IDENTIFIER_PREFIXES):
                continue
            add_candidate(identifier)

    return candidates


def _merge_table_documents(*document_groups: list[Document] | None) -> list[Document]:
    merged_documents: list[Document] = []
    seen_names: set[str] = set()
    for documents in document_groups:
        for document in documents or []:
            table_name = str(document.meta.get("name") or "")
            if not table_name:
                try:
                    table_name = str(
                        ast.literal_eval(document.content).get("name") or ""
                    )
                except Exception:
                    table_name = document.content
            normalized_name = table_name.lower()
            if normalized_name in seen_names:
                continue
            seen_names.add(normalized_name)
            merged_documents.append(document)
    return merged_documents


@observe(capture_input=False)
async def table_retrieval(
    embedding: dict,
    runtime_scope_id: str,
    tables: list[str] | None,
    table_retriever: Any,
    query: str = "",
    histories: Optional[list[AskHistory]] = None,
    schema_linking_entities: Optional[dict[str, Any]] = None,
) -> dict:
    tables = tables or []
    conditions = [
        {"field": "type", "operator": "==", "value": "TABLE_DESCRIPTION"},
    ]
    keyword_table_candidates = _extract_keyword_table_candidates(
        query,
        histories=histories,
        tables=tables,
        schema_linking_entities=schema_linking_entities,
    )

    if embedding:
        vector_result = await table_retriever.run(
            query_embedding=embedding.get("embedding"),
            filters=build_runtime_scope_filters(
                runtime_scope_id, conditions=conditions
            ),
        )
        if not keyword_table_candidates:
            return vector_result

        keyword_result = await table_retriever.run(
            query_embedding=[],
            filters=build_runtime_scope_filters(
                runtime_scope_id,
                conditions=[
                    *conditions,
                    {
                        "field": "name",
                        "operator": "in",
                        "value": keyword_table_candidates,
                    },
                ],
            ),
        )
        return {
            "documents": _merge_table_documents(
                keyword_result.get("documents"),
                vector_result.get("documents"),
            )
        }
    else:
        conditions.append(
            {
                "field": "name",
                "operator": "in",
                "value": keyword_table_candidates or tables,
            }
        )

        return await table_retriever.run(
            query_embedding=[],
            filters=build_runtime_scope_filters(
                runtime_scope_id, conditions=conditions
            ),
        )


@observe(capture_input=False)
async def dbschema_retrieval(
    table_retrieval: dict, runtime_scope_id: str, dbschema_retriever: Any
) -> list[Document]:
    tables = table_retrieval.get("documents", [])
    table_names = []
    for table in tables:
        content = ast.literal_eval(table.content)
        table_names.append(content["name"])

    table_name_conditions = [
        {"field": "name", "operator": "==", "value": table_name}
        for table_name in table_names
    ]

    if table_name_conditions:
        filters = build_runtime_scope_filters(
            runtime_scope_id,
            conditions=[
                {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
                {"operator": "OR", "conditions": table_name_conditions},
            ],
        )

        results = await dbschema_retriever.run(query_embedding=[], filters=filters)
        return results["documents"]

    return []


@observe()
def construct_db_schemas(dbschema_retrieval: list[Document]) -> list[dict]:
    db_schemas = {}
    for document in dbschema_retrieval:
        content = ast.literal_eval(document.content)
        if content["type"] == "TABLE":
            if document.meta["name"] not in db_schemas:
                db_schemas[document.meta["name"]] = content
            else:
                db_schemas[document.meta["name"]] = {
                    **content,
                    "columns": db_schemas[document.meta["name"]].get("columns", []),
                }
        elif content["type"] == "TABLE_COLUMNS":
            if document.meta["name"] not in db_schemas:
                db_schemas[document.meta["name"]] = {"columns": content["columns"]}
            else:
                if "columns" not in db_schemas[document.meta["name"]]:
                    db_schemas[document.meta["name"]]["columns"] = content["columns"]
                else:
                    db_schemas[document.meta["name"]]["columns"] += content["columns"]

    # remove incomplete schemas
    db_schemas = {k: v for k, v in db_schemas.items() if "type" in v and "columns" in v}

    return list(db_schemas.values())


@observe(capture_input=False)
def check_using_db_schemas_without_pruning(
    construct_db_schemas: list[dict],
    dbschema_retrieval: list[Document],
    encoding: tiktoken.Encoding,
    enable_column_pruning: bool,
    context_window_size: int,
) -> dict:
    retrieval_results = []
    has_calculated_field = False
    has_metric = False
    has_json_field = False

    for table_schema in construct_db_schemas:
        if table_schema["type"] == "TABLE":
            ddl, _has_calculated_field, _has_json_field = build_table_ddl(table_schema)
            retrieval_results.append(
                {
                    "table_name": table_schema["name"],
                    "table_ddl": ddl,
                }
            )
            if _has_calculated_field:
                has_calculated_field = True
            if _has_json_field:
                has_json_field = True

    for document in dbschema_retrieval:
        content = ast.literal_eval(document.content)

        if content["type"] == "METRIC":
            retrieval_results.append(
                {
                    "table_name": content["name"],
                    "table_ddl": _build_metric_ddl(content),
                }
            )
            has_metric = True
        elif content["type"] == "VIEW":
            retrieval_results.append(
                {
                    "table_name": content["name"],
                    "table_ddl": _build_view_ddl(content),
                }
            )

    table_ddls = [
        retrieval_result["table_ddl"] for retrieval_result in retrieval_results
    ]
    _token_count = len(encoding.encode(" ".join(table_ddls)))
    if _token_count > context_window_size or enable_column_pruning:
        return {
            "db_schemas": [],
            "tokens": _token_count,
            "has_calculated_field": has_calculated_field,
            "has_metric": has_metric,
            "has_json_field": has_json_field,
        }

    return {
        "db_schemas": retrieval_results,
        "tokens": _token_count,
        "has_calculated_field": has_calculated_field,
        "has_metric": has_metric,
        "has_json_field": has_json_field,
    }


@observe(capture_input=False)
def prompt(
    query: str,
    construct_db_schemas: list[dict],
    prompt_builder: PromptBuilder,
    check_using_db_schemas_without_pruning: dict,
    histories: list[AskHistory],
) -> dict:
    if not check_using_db_schemas_without_pruning["db_schemas"]:
        db_schemas = [
            build_table_ddl(construct_db_schema)[0]
            for construct_db_schema in construct_db_schemas
        ]

        previous_query_summaries = (
            [history.question for history in histories] if histories else []
        )

        query = "\n".join(previous_query_summaries) + "\n" + query

        _prompt = prompt_builder.run(question=query, db_schemas=db_schemas)
        return {"prompt": clean_up_new_lines(_prompt.get("prompt"))}
    else:
        return {}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def filter_columns_in_tables(
    prompt: dict, table_columns_selection_generator: Any, generator_name: str
) -> dict:
    if prompt:
        return (
            await table_columns_selection_generator(prompt=prompt.get("prompt")),
            generator_name,
        )
    else:
        return {}, generator_name


@observe()
def construct_retrieval_results(
    check_using_db_schemas_without_pruning: dict,
    filter_columns_in_tables: dict,
    construct_db_schemas: list[dict],
    dbschema_retrieval: list[Document],
) -> dict[str, Any]:
    if filter_columns_in_tables:
        columns_and_tables_needed = orjson.loads(
            filter_columns_in_tables["replies"][0]
        )["results"]

        # we need to change the below code to match the new schema of structured output
        # the objective of this loop is to change the structure of JSON to match the needed format
        reformated_json = {}
        for table in columns_and_tables_needed:
            reformated_json[table["table_name"]] = table["table_contents"]
        columns_and_tables_needed = reformated_json
        tables = set(columns_and_tables_needed.keys())
        retrieval_results = []
        has_calculated_field = False
        has_metric = False
        has_json_field = False

        for table_schema in construct_db_schemas:
            if table_schema["type"] == "TABLE" and table_schema["name"] in tables:
                ddl, _has_calculated_field, _has_json_field = build_table_ddl(
                    table_schema,
                    columns=set(
                        columns_and_tables_needed[table_schema["name"]]["columns"]
                    ),
                    tables=tables,
                )
                if _has_calculated_field:
                    has_calculated_field = True
                if _has_json_field:
                    has_json_field = True

                retrieval_results.append(
                    {
                        "table_name": table_schema["name"],
                        "table_ddl": ddl,
                    }
                )

        for document in dbschema_retrieval:
            if document.meta["name"] in columns_and_tables_needed:
                content = ast.literal_eval(document.content)

                if content["type"] == "METRIC":
                    retrieval_results.append(
                        {
                            "table_name": content["name"],
                            "table_ddl": _build_metric_ddl(content),
                        }
                    )
                    has_metric = True
                elif content["type"] == "VIEW":
                    retrieval_results.append(
                        {
                            "table_name": content["name"],
                            "table_ddl": _build_view_ddl(content),
                        }
                    )

        return {
            "retrieval_results": retrieval_results,
            "has_calculated_field": has_calculated_field,
            "has_metric": has_metric,
            "has_json_field": has_json_field,
        }
    else:
        retrieval_results = check_using_db_schemas_without_pruning["db_schemas"]

        return {
            "retrieval_results": retrieval_results,
            "has_calculated_field": check_using_db_schemas_without_pruning[
                "has_calculated_field"
            ],
            "has_metric": check_using_db_schemas_without_pruning["has_metric"],
            "has_json_field": check_using_db_schemas_without_pruning["has_json_field"],
        }


## End of Pipeline
class MatchingTableContents(BaseModel):
    chain_of_thought_reasoning: list[str]
    columns: list[str]


class MatchingTable(BaseModel):
    table_name: str
    table_contents: MatchingTableContents
    table_selection_reason: str


class RetrievalResults(BaseModel):
    results: list[MatchingTable]


class SchemaLinkingEntities(BaseModel):
    table_names: list[str] = []
    column_names: list[str] = []
    business_terms: list[str] = []


RETRIEVAL_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "retrieval_schema",
            "schema": RetrievalResults.model_json_schema(),
        },
    }
}

SCHEMA_LINKING_ENTITY_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "schema_linking_entities",
            "schema": SchemaLinkingEntities.model_json_schema(),
        },
    }
}


class DbSchemaRetrieval(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        embedder_provider: EmbedderProvider,
        document_store_provider: DocumentStoreProvider,
        table_retrieval_size: int = 10,
        table_column_retrieval_size: int = 100,
        **kwargs,
    ):
        self._components = {
            "embedder": embedder_provider.get_text_embedder(),
            "table_retriever": document_store_provider.get_retriever(
                document_store_provider.get_store(dataset_name="table_descriptions"),
                top_k=table_retrieval_size,
            ),
            "dbschema_retriever": document_store_provider.get_retriever(
                document_store_provider.get_store(),
                top_k=table_column_retrieval_size,
            ),
            "table_columns_selection_generator": llm_provider.get_generator(
                system_prompt=table_columns_selection_system_prompt,
                generation_kwargs=RETRIEVAL_MODEL_KWARGS,
            ),
            "schema_linking_entity_generator": llm_provider.get_generator(
                system_prompt=schema_linking_entity_system_prompt,
                generation_kwargs=SCHEMA_LINKING_ENTITY_MODEL_KWARGS,
            ),
            "generator_name": llm_provider.get_model(),
            "prompt_builder": PromptBuilder(
                template=table_columns_selection_user_prompt_template
            ),
            "schema_linking_entity_prompt_builder": PromptBuilder(
                template=schema_linking_entity_user_prompt_template
            ),
        }

        # for the first time, we need to load the encodings
        _model = llm_provider.get_model()
        if "gpt-4o" in _model or "gpt-4o-mini" in _model:
            _encoding = tiktoken.get_encoding("o200k_base")
        else:
            _encoding = tiktoken.get_encoding("cl100k_base")

        self._configs = {
            "encoding": _encoding,
            "context_window_size": llm_provider.get_context_window_size(),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Ask Retrieval")
    async def run(
        self,
        query: str = "",
        tables: Optional[list[str]] = None,
        runtime_scope_id: Optional[str] = None,
        histories: Optional[list[AskHistory]] = None,
        enable_column_pruning: bool = False,
        bridge_scope_id: Optional[str] = None,
    ):
        logger.info("Ask Retrieval pipeline is running...")
        runtime_scope_id = resolve_pipeline_runtime_scope_id(
            runtime_scope_id, bridge_scope_id=bridge_scope_id
        )
        return await self._pipe.execute(
            ["construct_retrieval_results"],
            inputs={
                "query": query,
                "tables": tables,
                "runtime_scope_id": runtime_scope_id or "",
                "histories": histories or [],
                "enable_column_pruning": enable_column_pruning,
                **self._components,
                **self._configs,
            },
        )
