import logging
import sys
from typing import Any, Optional

import orjson
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe
from pydantic import BaseModel, Field

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.common import clean_up_new_lines
from src.pipelines.generation.utils.sql import construct_instructions
from src.utils import trace_cost
from src.web.v1.services import Configuration
from src.web.v1.services.ask import AskHistory

logger = logging.getLogger("wren-ai-service")


semantic_plan_system_prompt = """
### Task ###
You are a semantic planner for a text-to-SQL system. Extract a structured
SemanticPlan from the user's business question. Do not generate SQL.

### Instructions ###
- Preserve the user's language for free-text labels.
- Prefer explicit user values over inferred values.
- Use retrieved SQL templates only as candidates; do not force a template match.
- Mark missing slots when the question cannot safely produce SQL without them.
- Keep arrays short and stable. Use machine-readable snake_case identifiers.
- If uncertain, leave fields empty instead of inventing details.

### Output ###
Return a JSON object matching the schema. Do not include markdown.
"""

semantic_plan_user_prompt_template = """
### CURRENT QUESTION ###
{{ query }}

{% if histories %}
### CONVERSATION HISTORY ###
{% for history in histories %}
Question: {{ history.question }}
SQL: {{ history.sql }}
{% endfor %}
{% endif %}

{% if sql_samples %}
### RETRIEVED SQL TEMPLATE CANDIDATES ###
{% for sql_sample in sql_samples %}
- id={{ sql_sample.id | default("", true) }}
  title={{ sql_sample.title | default(sql_sample.question, true) }}
  mode={{ sql_sample.template_mode | default(sql_sample.templateMode, true) }}
  score={{ sql_sample.score | default("", true) }}
  question={{ sql_sample.question | default("", true) }}
{% endfor %}
{% endif %}

{% if instructions %}
### BUSINESS INSTRUCTIONS ###
{% for instruction in instructions %}
{{ loop.index }}. {{ instruction }}
{% endfor %}
{% endif %}

{% if deterministic_plan %}
### CURRENT DETERMINISTIC PLAN ###
{{ deterministic_plan }}
{% endif %}

Output Language: {{ language }}
"""


class SemanticPlanResult(BaseModel):
    intent: Optional[str] = None
    subject: Optional[str] = None
    features: list[str] = Field(default_factory=list)
    metrics: list[str] = Field(default_factory=list)
    dimensions: list[str] = Field(default_factory=list)
    filters: dict[str, Any] = Field(default_factory=dict)
    grain: Optional[str] = None
    required_slots: list[str] = Field(default_factory=list)
    missing_slots: list[str] = Field(default_factory=list)
    resolved_slots: dict[str, Any] = Field(default_factory=dict)
    external_dependencies: list[str] = Field(default_factory=list)
    decision: dict[str, Any] = Field(default_factory=dict)
    confidence: float = 0.0


SEMANTIC_PLAN_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "semantic_plan_result",
            "schema": SemanticPlanResult.model_json_schema(),
        },
    }
}


def _coerce_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple | set):
        return list(value)
    return [value]


def _coerce_str_list(value: Any) -> list[str]:
    return [str(item) for item in _coerce_list(value) if str(item).strip()]


def _coerce_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def normalize_semantic_plan_response(
    payload: Any,
    *,
    deterministic_plan: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Normalize LLM SemanticPlan output without trusting it blindly."""

    deterministic_plan = deterministic_plan or {}
    payload = _coerce_dict(payload)

    normalized: dict[str, Any] = {
        "version": "p1_llm_semantic_plan_v1",
        "source": "llm",
        "intent": payload.get("intent") or deterministic_plan.get("intent"),
        "subject": payload.get("subject") or deterministic_plan.get("subject"),
        "features": _coerce_str_list(
            payload.get("features") or deterministic_plan.get("features")
        ),
        "metrics": _coerce_str_list(
            payload.get("metrics") or deterministic_plan.get("metrics")
        ),
        "dimensions": _coerce_str_list(
            payload.get("dimensions") or deterministic_plan.get("dimensions")
        ),
        "filters": {
            **_coerce_dict(deterministic_plan.get("filters")),
            **_coerce_dict(payload.get("filters")),
        },
        "grain": payload.get("grain") or deterministic_plan.get("grain"),
        "required_slots": _coerce_str_list(payload.get("required_slots")),
        "missing_slots": _coerce_str_list(
            payload.get("missing_slots") or deterministic_plan.get("missing_slots")
        ),
        "resolved_slots": {
            **_coerce_dict(deterministic_plan.get("resolved_slots")),
            **_coerce_dict(payload.get("resolved_slots")),
        },
        "external_dependencies": _coerce_str_list(
            payload.get("external_dependencies")
            or deterministic_plan.get("external_dependencies")
        ),
        "decision": {
            **_coerce_dict(deterministic_plan.get("decision")),
            **_coerce_dict(payload.get("decision")),
        },
        "confidence": payload.get("confidence", 0.0),
    }
    return normalized


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    query: str,
    histories: list[AskHistory],
    prompt_builder: PromptBuilder,
    sql_samples: Optional[list[dict]] = None,
    instructions: Optional[list[dict]] = None,
    deterministic_plan: Optional[dict[str, Any]] = None,
    configuration: Configuration | None = None,
) -> dict:
    _prompt = prompt_builder.run(
        query=query,
        histories=histories or [],
        sql_samples=sql_samples or [],
        instructions=construct_instructions(instructions=instructions),
        deterministic_plan=deterministic_plan or {},
        language=(configuration.language if configuration else None) or "English",
    )
    return {"prompt": clean_up_new_lines(_prompt.get("prompt"))}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def generate_semantic_plan(
    prompt: dict, generator: Any, generator_name: str
) -> dict:
    return await generator(prompt=prompt.get("prompt")), generator_name


@observe(capture_input=False)
def post_process(
    generate_semantic_plan: dict,
    deterministic_plan: Optional[dict[str, Any]] = None,
) -> dict:
    try:
        reply = generate_semantic_plan.get("replies", ["{}"])[0]
        payload = orjson.loads(reply)
    except Exception:
        return {
            **(deterministic_plan or {}),
            "version": "p1_llm_semantic_plan_v1",
            "source": "deterministic",
            "llm_error": "invalid_semantic_plan_response",
        }

    return normalize_semantic_plan_response(
        payload,
        deterministic_plan=deterministic_plan,
    )


## End of Pipeline


class SemanticPlan(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        self._components = {
            "generator": llm_provider.get_generator(
                system_prompt=semantic_plan_system_prompt,
                generation_kwargs=SEMANTIC_PLAN_MODEL_KWARGS,
            ),
            "generator_name": llm_provider.get_model(),
            "prompt_builder": PromptBuilder(template=semantic_plan_user_prompt_template),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Semantic Plan Generation")
    async def run(
        self,
        query: str,
        histories: Optional[list[AskHistory]] = None,
        sql_samples: Optional[list[dict]] = None,
        instructions: Optional[list[dict]] = None,
        deterministic_plan: Optional[dict[str, Any]] = None,
        configuration: Configuration = Configuration(),
    ):
        logger.info("Semantic Plan Generation pipeline is running...")
        return await self._pipe.execute(
            ["post_process"],
            inputs={
                "query": query,
                "histories": histories or [],
                "sql_samples": sql_samples or [],
                "instructions": instructions or [],
                "deterministic_plan": deterministic_plan or {},
                "configuration": configuration,
                **self._components,
            },
        )
