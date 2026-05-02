import asyncio
import logging
import time
from typing import Dict, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import AliasChoices, BaseModel, Field

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import BaseRequest

logger = logging.getLogger("wren-ai-service")


# POST /v1/semantics-preparations
class SemanticsPreparationRequest(BaseRequest):
    mdl: str
    # don't recommend to use id as a field name, but it's used in the API spec
    # so we need to support as a choice, and will remove it in the future
    mdl_hash: str = Field(validation_alias=AliasChoices("mdl_hash", "id"))


class SemanticsPreparationResponse(BaseModel):
    # don't recommend to use id as a field name, but it's used in the API spec
    # so we need to support as a choice, and will remove it in the future
    mdl_hash: str = Field(serialization_alias="id")


# GET /v1/semantics-preparations/{mdl_hash}/status
class SemanticsPreparationStatusRequest(BaseModel):
    # don't recommend to use id as a field name, but it's used in the API spec
    # so we need to support as a choice, and will remove it in the future
    mdl_hash: str = Field(validation_alias=AliasChoices("mdl_hash", "id"))


class SemanticsPreparationStatusResponse(BaseModel):
    class SemanticsPreparationError(BaseModel):
        code: Literal["OTHERS"]
        message: str

    status: Literal["indexing", "finished", "failed"]
    error: Optional[SemanticsPreparationError] = None


class DeleteSemanticsRequest(BaseRequest):
    pass


class SemanticsPreparationService:
    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
        pipeline_timeout_seconds: int = 180,
    ):
        self._pipelines = pipelines
        self._pipeline_timeout_seconds = pipeline_timeout_seconds
        self._prepare_semantics_statuses: Dict[
            str, SemanticsPreparationStatusResponse
        ] = TTLCache(maxsize=maxsize, ttl=ttl)

    def _iter_available_pipelines(self, names: list[str], *, operation: str):
        for name in names:
            pipeline = self._pipelines.get(name)
            if pipeline is None:
                logger.warning(
                    "Skipping %s pipeline during semantics %s because it is not configured",
                    name,
                    operation,
                )
                continue
            yield name, pipeline

    async def _run_pipeline_with_timeout(
        self,
        name: str,
        pipeline: BasicPipeline,
        pipeline_input: dict,
    ):
        runtime_scope_id = pipeline_input.get("runtime_scope_id")
        started_at = time.monotonic()
        logger.info(
            "Runtime scope: %s, Semantics preparation pipeline %s started",
            runtime_scope_id,
            name,
        )
        try:
            pipeline_task = pipeline.run(**pipeline_input)
            if self._pipeline_timeout_seconds > 0:
                result = await asyncio.wait_for(
                    pipeline_task,
                    timeout=self._pipeline_timeout_seconds,
                )
            else:
                result = await pipeline_task
            logger.info(
                "Runtime scope: %s, Semantics preparation pipeline %s finished in %.2fs",
                runtime_scope_id,
                name,
                time.monotonic() - started_at,
            )
            return result
        except asyncio.TimeoutError as exc:
            logger.error(
                "Runtime scope: %s, Semantics preparation pipeline %s timed out after %ss",
                runtime_scope_id,
                name,
                self._pipeline_timeout_seconds,
            )
            raise TimeoutError(
                f"Semantics preparation pipeline '{name}' timed out after "
                f"{self._pipeline_timeout_seconds}s"
            ) from exc
        except Exception:
            logger.exception(
                "Runtime scope: %s, Semantics preparation pipeline %s failed after %.2fs",
                runtime_scope_id,
                name,
                time.monotonic() - started_at,
            )
            raise

    @observe(name="Prepare Semantics")
    @trace_metadata
    async def prepare_semantics(
        self,
        prepare_semantics_request: SemanticsPreparationRequest,
        **kwargs,
    ):
        results = {
            "metadata": {
                "error_type": "",
                "error_message": "",
                "request_from": prepare_semantics_request.request_from,
            },
        }

        try:
            logger.info(f"MDL: {prepare_semantics_request.mdl}")
            runtime_scope_id = prepare_semantics_request.resolve_runtime_scope_id(
                fallback_id=prepare_semantics_request.mdl_hash,
            )

            pipeline_input = {
                "mdl_str": prepare_semantics_request.mdl,
                "runtime_scope_id": runtime_scope_id,
            }

            tasks = [
                self._run_pipeline_with_timeout(name, pipeline, pipeline_input)
                for name, pipeline in self._iter_available_pipelines(
                    [
                        "db_schema",
                        "historical_question",
                        "table_description",
                        "sql_pairs",
                        "project_meta",
                    ],
                    operation="prepare",
                )
            ]

            await asyncio.gather(*tasks)

            self._prepare_semantics_statuses[
                prepare_semantics_request.mdl_hash
            ] = SemanticsPreparationStatusResponse(
                status="finished",
            )
        except Exception as e:
            logger.exception(f"Failed to prepare semantics: {e}")

            self._prepare_semantics_statuses[
                prepare_semantics_request.mdl_hash
            ] = SemanticsPreparationStatusResponse(
                status="failed",
                error=SemanticsPreparationStatusResponse.SemanticsPreparationError(
                    code="OTHERS",
                    message=f"Failed to prepare semantics: {e}",
                ),
            )

            results["metadata"]["error_type"] = "INDEXING_FAILED"
            results["metadata"]["error_message"] = str(e)

        return results

    def get_prepare_semantics_status(
        self, prepare_semantics_status_request: SemanticsPreparationStatusRequest
    ) -> SemanticsPreparationStatusResponse:
        if (
            result := self._prepare_semantics_statuses.get(
                prepare_semantics_status_request.mdl_hash
            )
        ) is None:
            logger.exception(
                f"id is not found for SemanticsPreparation: {prepare_semantics_status_request.mdl_hash}"
            )
            return SemanticsPreparationStatusResponse(
                status="failed",
                error=SemanticsPreparationStatusResponse.SemanticsPreparationError(
                    code="OTHERS",
                    message="{prepare_semantics_status_request.id} is not found",
                ),
            )

        return result

    @observe(name="Delete Semantics Documents")
    @trace_metadata
    async def delete_semantics(
        self,
        request: DeleteSemanticsRequest,
        **kwargs,
    ):
        runtime_scope_id = request.resolve_runtime_scope_id()

        if not runtime_scope_id:
            raise ValueError("Runtime scope is required to delete semantics documents")

        logger.info(
            f"Runtime scope: {runtime_scope_id}, Deleting semantics documents..."
        )

        tasks = [
            pipeline.clean(runtime_scope_id=runtime_scope_id)
            for _, pipeline in self._iter_available_pipelines(
                [
                    "db_schema",
                    "historical_question",
                    "table_description",
                    "project_meta",
                ],
                operation="delete",
            )
            if hasattr(pipeline, "clean")
        ] + [
            pipeline.clean(
                runtime_scope_id=runtime_scope_id,
                delete_all=True,
            )
            for _, pipeline in self._iter_available_pipelines(
                ["sql_pairs", "instructions"],
                operation="delete",
            )
            if hasattr(pipeline, "clean")
        ]

        await asyncio.gather(*tasks)
