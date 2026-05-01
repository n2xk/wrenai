import logging
import sys
from typing import Any, Dict, List, Optional

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack import Document, component
from langfuse.decorators import observe

from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider, EmbedderProvider
from src.pipelines.common import (
    ScoreFilter,
    build_runtime_scope_filters,
    resolve_pipeline_runtime_scope_id,
)

logger = logging.getLogger("wren-ai-service")


def _limit_documents(documents: List[Document], max_size: int) -> List[Document]:
    return documents[: max(max_size, 0)]


@component
class OutputFormatter:
    @component.output_types(
        documents=List[Optional[Dict]],
    )
    def run(self, documents: List[Document]):
        list = []

        for doc in documents:
            formatted = {
                "instruction": doc.meta.get("instruction", ""),
                "question": doc.content,
                "instruction_id": doc.meta.get("instruction_id", ""),
                "knowledge_asset_type": doc.meta.get("knowledge_asset_type"),
                "business_term_id": doc.meta.get("business_term_id"),
                "external_dependency_id": doc.meta.get("external_dependency_id"),
                "aliases": doc.meta.get("aliases") or [],
                "related_business_terms": doc.meta.get("related_business_terms") or [],
                "related_external_dependencies": doc.meta.get(
                    "related_external_dependencies"
                )
                or [],
                "runtime_usage": doc.meta.get("runtime_usage"),
                "source_status": doc.meta.get("source_status"),
                "missing_behavior": doc.meta.get("missing_behavior"),
                "ask_user_prompt": doc.meta.get("ask_user_prompt"),
                "required_grain": doc.meta.get("required_grain") or [],
                "metadata": doc.meta.get("metadata") or {},
            }
            list.append(formatted)

        return {"documents": list}


@component
class ScopeFilter:
    @component.output_types(
        documents=List[Document],
    )
    def run(
        self,
        documents: List[Document],
        scope: str = "sql",
    ):
        return {
            "documents": list(
                filter(
                    lambda document: document.meta.get("scope", "sql") == scope,
                    documents,
                ),
            )
        }


## Start of Pipeline
@observe(capture_input=False)
async def count_documents(store: Any, runtime_scope_id: Optional[str] = None) -> int:
    runtime_scope_id = resolve_pipeline_runtime_scope_id(runtime_scope_id)
    filters = build_runtime_scope_filters(runtime_scope_id)
    document_count = await store.count_documents(filters=filters)
    return document_count


@observe(capture_input=False, capture_output=False)
async def embedding(count_documents: int, query: str, embedder: Any) -> dict:
    if count_documents:
        return await embedder.run(query)

    return {}


@observe(capture_input=False)
async def retrieval(embedding: dict, runtime_scope_id: str, retriever: Any) -> dict:
    if not embedding:
        return {}

    filters = build_runtime_scope_filters(
        runtime_scope_id,
        conditions=[
            {"field": "is_default", "operator": "==", "value": False},
        ],
    )

    res = await retriever.run(
        query_embedding=embedding.get("embedding"),
        filters=filters,
    )
    return dict(documents=res.get("documents"))


@observe(capture_input=False)
def filtered_documents(
    retrieval: dict,
    scope: str,
    scope_filter: ScopeFilter,
    score_filter: ScoreFilter,
    similarity_threshold: float,
    top_k: int,
) -> dict:
    if not retrieval:
        return {}

    res = scope_filter.run(
        documents=retrieval.get("documents"),
        scope=scope,
    )

    return score_filter.run(
        documents=res.get("documents"),
        score=similarity_threshold,
        max_size=top_k,
    )


@observe(capture_input=False)
async def default_instructions(
    count_documents: int,
    retriever: Any,
    runtime_scope_id: str,
    scope_filter: ScopeFilter,
    scope: str,
    default_instructions_max_size: int = 20,
) -> dict:
    if not count_documents:
        return {"documents": []}

    filters = build_runtime_scope_filters(
        runtime_scope_id,
        conditions=[
            {"field": "is_default", "operator": "==", "value": True},
        ],
    )

    _res = await retriever.run(
        query_embedding=None,
        filters=filters,
    )

    res = scope_filter.run(
        documents=_res.get("documents"),
        scope=scope,
    )

    return dict(
        documents=_limit_documents(
            res.get("documents") or [],
            default_instructions_max_size,
        )
    )


@observe(capture_input=False)
def formatted_output(
    default_instructions: dict,
    filtered_documents: dict,
    output_formatter: OutputFormatter,
    default_instructions_max_size: int = 20,
) -> dict:
    if not filtered_documents and not default_instructions:
        return {"documents": []}

    limited_default_documents = _limit_documents(
        default_instructions.get("documents") or [],
        default_instructions_max_size,
    )
    merged = limited_default_documents + (filtered_documents.get("documents") or [])
    documents = output_formatter.run(documents=merged)
    return documents


## End of Pipeline


class Instructions(BasicPipeline):
    def __init__(
        self,
        embedder_provider: EmbedderProvider,
        document_store_provider: DocumentStoreProvider,
        similarity_threshold: float = 0.7,
        top_k: int = 10,
        default_instructions_max_size: int = 20,
        **kwargs,
    ) -> None:
        store = document_store_provider.get_store(dataset_name="instructions")
        self._components = {
            "store": store,
            "embedder": embedder_provider.get_text_embedder(),
            "retriever": document_store_provider.get_retriever(
                document_store=store,
            ),
            "scope_filter": ScopeFilter(),
            "score_filter": ScoreFilter(),
            "output_formatter": OutputFormatter(),
        }
        self._configs = {
            "similarity_threshold": similarity_threshold,
            "top_k": top_k,
            "default_instructions_max_size": default_instructions_max_size,
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Instructions Retrieval")
    async def run(
        self,
        query: str,
        runtime_scope_id: Optional[str] = None,
        scope: str = "sql",
        bridge_scope_id: Optional[str] = None,
    ):
        logger.info("Instructions Retrieval pipeline is running...")
        runtime_scope_id = resolve_pipeline_runtime_scope_id(
            runtime_scope_id, bridge_scope_id=bridge_scope_id
        )
        return await self._pipe.execute(
            ["formatted_output"],
            inputs={
                "query": query,
                "runtime_scope_id": runtime_scope_id or "",
                "scope": scope,
                **self._components,
                **self._configs,
            },
        )
