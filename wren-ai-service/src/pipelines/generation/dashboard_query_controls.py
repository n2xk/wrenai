import logging
import sys
from typing import Any, Literal, Optional

import orjson
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel, Field

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.common import clean_up_new_lines
from src.utils import trace_cost

logger = logging.getLogger("wren-ai-service")


dashboard_query_controls_system_prompt = """
### TASK ###

You help a BI dashboard decide whether a finished SQL answer has one user-facing date filter that can safely become a rolling dashboard control.

Return JSON only. Do not rewrite SQL. Only identify the existing SQL date literals that should be replaced later by deterministic dashboard code.

### SAFETY RULES ###

- Return confidence "high" or "medium" only when exactly one date range is clearly the dashboard refresh window requested by the user.
- Return null time_filter with confidence "low" when multiple ranges are equally plausible, when literals do not appear in the SQL, or when the SQL already uses relative dates like CURRENT_DATE.
- Preserve SQL literal text exactly as it appears inside quotes, including time suffixes.
- Use kind "between" for BETWEEN start AND end.
- Use kind "gte_lte" for field >= start AND field <= end.
- Use kind "gte_lt" for field >= start AND field < end.
- For SQL like field < DATE_ADD('2026-04-03', INTERVAL 1 DAY), use end_literal "2026-04-03" and end_literal_offset_days 1.

### OUTPUT FORMAT ###

{
  "confidence": "high" | "medium" | "low",
  "reason": "short reason",
  "time_filter": null | {
    "field": "SQL field or expression being filtered",
    "kind": "between" | "gte_lte" | "gte_lt",
    "start_literal": "existing quoted start literal",
    "end_literal": "existing quoted end literal",
    "end_literal_offset_days": 0 | 1
  }
}
"""


dashboard_query_controls_user_prompt_template = """
User question:
{{query}}

SQL:
{{sql}}

Timezone: {{timezone}}
"""


class DashboardQueryControlsTimeFilter(BaseModel):
    field: str
    kind: Literal["between", "gte_lte", "gte_lt"]
    start_literal: str
    end_literal: str
    end_literal_offset_days: int = Field(default=0, ge=0, le=1)


class DashboardQueryControlsProposalResult(BaseModel):
    confidence: Literal["high", "medium", "low"]
    reason: str = ""
    time_filter: Optional[DashboardQueryControlsTimeFilter] = None


DASHBOARD_QUERY_CONTROLS_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "dashboard_query_controls_proposal_result",
            "schema": DashboardQueryControlsProposalResult.model_json_schema(),
        },
    }
}


@observe(capture_input=False)
def prompt(
    query: str,
    sql: str,
    timezone: str,
    prompt_builder: PromptBuilder,
) -> dict:
    _prompt = prompt_builder.run(query=query, sql=sql, timezone=timezone)
    return {"prompt": clean_up_new_lines(_prompt.get("prompt"))}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def propose_dashboard_query_controls(
    prompt: dict, generator: Any, generator_name: str
) -> dict:
    return await generator(prompt=prompt.get("prompt")), generator_name


@observe(capture_input=False)
async def post_process(
    propose_dashboard_query_controls: dict,
) -> dict:
    raw = propose_dashboard_query_controls.get("replies", ["{}"])[0]
    try:
        parsed = orjson.loads(raw)
        result = DashboardQueryControlsProposalResult.model_validate(parsed)
        return result.model_dump(mode="json")
    except Exception as exc:
        logger.warning("Failed to parse dashboard query controls proposal: %s", exc)
        return DashboardQueryControlsProposalResult(
            confidence="low",
            reason="invalid_dashboard_query_controls_proposal_response",
            time_filter=None,
        ).model_dump(mode="json")


class DashboardQueryControlsProposal(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=dashboard_query_controls_system_prompt,
                generation_kwargs=DASHBOARD_QUERY_CONTROLS_MODEL_KWARGS,
            ),
            "generator_name": llm_provider.get_model(),
            "prompt_builder": PromptBuilder(
                template=dashboard_query_controls_user_prompt_template
            ),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Dashboard Query Controls Proposal")
    async def run(
        self,
        query: str,
        sql: str,
        timezone: str = "UTC",
    ):
        logger.info("Dashboard Query Controls Proposal pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "sql": sql,
                "timezone": timezone,
                **self._components,
            },
        )
