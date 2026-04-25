import logging
import os
import sys
import uuid
from typing import Any, Dict, List, Optional, Set

import orjson
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack import Document, component
from haystack.document_stores.types import DocumentStore, DuplicatePolicy
from langfuse.decorators import observe
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider, EmbedderProvider
from src.pipelines.common import (
    build_runtime_scope_filters,
    build_runtime_scope_meta,
    resolve_pipeline_runtime_scope_id,
)
from src.pipelines.indexing import AsyncDocumentWriter

logger = logging.getLogger("wren-ai-service")


class SqlPair(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    sql: str = ""
    question: str = ""
    asset_kind: str = Field(
        default="sql_pair", validation_alias=AliasChoices("asset_kind", "assetKind")
    )
    template_level: str = Field(
        default="L0", validation_alias=AliasChoices("template_level", "templateLevel")
    )
    template_mode: str = Field(
        default="reference",
        validation_alias=AliasChoices("template_mode", "templateMode"),
    )
    source_type: str = Field(
        default="user_saved",
        validation_alias=AliasChoices("source_type", "sourceType"),
    )
    scope_type: str = Field(
        default="knowledge_base",
        validation_alias=AliasChoices("scope_type", "scopeType"),
    )
    parameter_schema: Optional[Dict[str, Any]] = Field(
        default=None,
        validation_alias=AliasChoices("parameter_schema", "parameterSchema"),
    )
    business_signature: Optional[Dict[str, Any]] = Field(
        default=None,
        validation_alias=AliasChoices("business_signature", "businessSignature"),
    )
    template_version: int = Field(
        default=1,
        validation_alias=AliasChoices("template_version", "templateVersion"),
    )
    status: str = "active"


@component
class SqlPairsConverter:
    @component.output_types(documents=List[Document])
    def run(self, sql_pairs: List[SqlPair], runtime_scope_id: str = ""):
        runtime_scope_id = resolve_pipeline_runtime_scope_id(runtime_scope_id)
        logger.info(
            f"Runtime scope: {runtime_scope_id} Converting SQL pairs to documents..."
        )

        empty_question_pair = next(
            (
                sql_pair
                for sql_pair in sql_pairs
                if not (sql_pair.question or "").strip()
            ),
            None,
        )
        if empty_question_pair is not None:
            raise ValueError(
                f"SQL pair question cannot be empty: {empty_question_pair.id}"
            )

        addition = build_runtime_scope_meta(runtime_scope_id)

        return {
            "documents": [
                Document(
                    id=str(uuid.uuid4()),
                    meta={
                        "sql_pair_id": sql_pair.id,
                        "sql": sql_pair.sql,
                        "asset_kind": sql_pair.asset_kind,
                        "template_level": sql_pair.template_level,
                        "template_mode": sql_pair.template_mode,
                        "source_type": sql_pair.source_type,
                        "scope_type": sql_pair.scope_type,
                        "parameter_schema": sql_pair.parameter_schema,
                        "business_signature": sql_pair.business_signature,
                        "template_version": sql_pair.template_version,
                        "status": sql_pair.status,
                        **addition,
                    },
                    content=sql_pair.question,
                )
                for sql_pair in sql_pairs
            ]
        }


@component
class SqlPairsCleaner:
    def __init__(self, sql_pairs_store: DocumentStore) -> None:
        self.store = sql_pairs_store

    @component.output_types()
    async def run(
        self, sql_pair_ids: List[str], runtime_scope_id: Optional[str] = None
    ) -> None:
        runtime_scope_id = resolve_pipeline_runtime_scope_id(runtime_scope_id)
        filter = build_runtime_scope_filters(
            runtime_scope_id,
            conditions=[
                {"field": "sql_pair_id", "operator": "in", "value": sql_pair_ids},
            ],
        )

        return await self.store.delete_documents(filter)


## Start of Pipeline
@observe(capture_input=False)
def boilerplates(
    mdl_str: str,
) -> Set[str]:
    mdl = orjson.loads(mdl_str)

    return {
        boilerplate.lower()
        for model in mdl.get("models", [])
        if (boilerplate := model.get("properties", {}).get("boilerplate"))
    }


@observe(capture_input=False)
def sql_pairs(
    boilerplates: Set[str],
    external_pairs: Dict[str, Any],
) -> List[SqlPair]:
    return [
        SqlPair(
            id=pair.get("id"),
            question=pair.get("question"),
            sql=pair.get("sql"),
            asset_kind=pair.get("asset_kind") or pair.get("assetKind") or "sql_pair",
            template_level=pair.get("template_level")
            or pair.get("templateLevel")
            or "L0",
            template_mode=pair.get("template_mode")
            or pair.get("templateMode")
            or "reference",
            source_type=pair.get("source_type")
            or pair.get("sourceType")
            or "user_saved",
            scope_type=pair.get("scope_type")
            or pair.get("scopeType")
            or "knowledge_base",
            parameter_schema=pair.get("parameter_schema")
            or pair.get("parameterSchema"),
            business_signature=pair.get("business_signature")
            or pair.get("businessSignature"),
            template_version=pair.get("template_version")
            or pair.get("templateVersion")
            or 1,
            status=pair.get("status") or "active",
        )
        for boilerplate in boilerplates
        if boilerplate in external_pairs
        for pair in external_pairs[boilerplate]
    ]


@observe(capture_input=False)
def to_documents(
    sql_pairs: List[SqlPair],
    document_converter: SqlPairsConverter,
    runtime_scope_id: str = "",
) -> Dict[str, Any]:
    runtime_scope_id = resolve_pipeline_runtime_scope_id(runtime_scope_id)
    return document_converter.run(
        sql_pairs=sql_pairs, runtime_scope_id=runtime_scope_id
    )


@observe(capture_input=False, capture_output=False)
async def embedding(
    to_documents: Dict[str, Any],
    embedder: Any,
) -> Dict[str, Any]:
    return await embedder.run(documents=to_documents["documents"])


@observe(capture_input=False, capture_output=False)
async def clean(
    cleaner: SqlPairsCleaner,
    sql_pairs: List[SqlPair],
    embedding: Dict[str, Any] = {},
    runtime_scope_id: str = "",
    delete_all: bool = False,
) -> Dict[str, Any]:
    runtime_scope_id = resolve_pipeline_runtime_scope_id(runtime_scope_id)
    sql_pair_ids = [sql_pair.id for sql_pair in sql_pairs]
    if sql_pair_ids or delete_all:
        await cleaner.run(
            sql_pair_ids=sql_pair_ids, runtime_scope_id=runtime_scope_id
        )

    return embedding


@observe(capture_input=False)
async def write(
    clean: Dict[str, Any],
    writer: AsyncDocumentWriter,
) -> None:
    return await writer.run(documents=clean["documents"])


## End of Pipeline


def _load_sql_pairs(sql_pairs_path: str) -> Dict[str, Any]:
    if not sql_pairs_path:
        return {}

    if not os.path.exists(sql_pairs_path):
        logger.warning(f"SQL pairs file not found: {sql_pairs_path}")
        return {}

    try:
        with open(sql_pairs_path, "r") as file:
            return orjson.loads(file.read())
    except Exception as e:
        logger.error(f"Error loading SQL pairs file: {e}")
        return {}


class SqlPairs(BasicPipeline):
    def __init__(
        self,
        embedder_provider: EmbedderProvider,
        document_store_provider: DocumentStoreProvider,
        sql_pairs_path: str = "sql_pairs.json",
        **kwargs,
    ) -> None:
        store = document_store_provider.get_store(dataset_name="sql_pairs")

        self._components = {
            "cleaner": SqlPairsCleaner(store),
            "embedder": embedder_provider.get_document_embedder(),
            "document_converter": SqlPairsConverter(),
            "writer": AsyncDocumentWriter(
                document_store=store,
                policy=DuplicatePolicy.OVERWRITE,
            ),
        }

        self._external_pairs = _load_sql_pairs(sql_pairs_path)

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="SQL Pairs Indexing")
    async def run(
        self,
        mdl_str: str,
        runtime_scope_id: str = "",
        external_pairs: Optional[Dict[str, Any]] = None,
        bridge_scope_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        runtime_scope_id = resolve_pipeline_runtime_scope_id(
            runtime_scope_id, bridge_scope_id=bridge_scope_id
        )
        logger.info(
            f"Runtime scope: {runtime_scope_id} SQL Pairs Indexing pipeline is running..."
        )

        input = {
            "mdl_str": mdl_str,
            "runtime_scope_id": runtime_scope_id,
            "external_pairs": {
                **self._external_pairs,
                **(external_pairs or {}),
            },
            **self._components,
        }

        return await self._pipe.execute(["write"], inputs=input)

    @observe(name="Clean Documents for SQL Pairs")
    async def clean(
        self,
        sql_pairs: List[SqlPair] = [],
        runtime_scope_id: Optional[str] = None,
        delete_all: bool = False,
        bridge_scope_id: Optional[str] = None,
    ) -> None:
        runtime_scope_id = resolve_pipeline_runtime_scope_id(
            runtime_scope_id, bridge_scope_id=bridge_scope_id
        )
        await clean(
            sql_pairs=sql_pairs,
            cleaner=self._components["cleaner"],
            runtime_scope_id=runtime_scope_id,
            delete_all=delete_all,
        )
