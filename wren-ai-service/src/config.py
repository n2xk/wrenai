import logging
from pathlib import Path
from typing import Literal

import yaml
from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings

logger = logging.getLogger("wren-ai-service")


class Settings(BaseSettings):
    """
    Configuration settings for the Wren AI service.

    The settings are loaded in the following order of precedence:
    1. Default values: Defined in the class attributes.
    2. Environment variables: Overrides default values if set.
    3. .env.dev file: Loads additional settings or overrides previous ones.
    4. config.yaml file: Provides the highest priority configuration.

    This hierarchical loading allows for flexible configuration management
    across different environments and deployment scenarios.
    """

    host: str = Field(default="127.0.0.1", alias="WREN_AI_SERVICE_HOST")
    port: int = Field(default=5555, alias="WREN_AI_SERVICE_PORT")

    # indexing and retrieval config
    column_indexing_batch_size: int = Field(default=50)
    table_retrieval_size: int = Field(default=10)
    table_column_retrieval_size: int = Field(default=100)
    enable_column_pruning: bool = Field(default=False)
    historical_question_retrieval_similarity_threshold: float = Field(default=0.9)
    sql_pairs_similarity_threshold: float = Field(default=0.7)
    sql_pairs_retrieval_max_size: int = Field(default=10)
    instructions_similarity_threshold: float = Field(default=0.7)
    instructions_top_k: int = Field(default=10)

    # generation config
    allow_intent_classification: bool = Field(default=True)
    allow_sql_generation_reasoning: bool = Field(default=True)
    allow_sql_functions_retrieval: bool = Field(default=True)
    allow_sql_diagnosis: bool = Field(default=True)
    allow_sql_knowledge_retrieval: bool = Field(default=False)
    semantic_plan_mode: Literal["deterministic", "shadow", "enhanced"] = Field(
        default="deterministic",
        alias="WREN_SEMANTIC_PLAN_MODE",
    )
    allow_semantic_plan_llm: bool = Field(
        default=False,
        alias="WREN_SEMANTIC_PLAN_LLM_ENABLED",
    )
    ask_policy_file: str | None = Field(
        default=None,
        alias="WREN_ASK_POLICY_FILE",
    )
    max_histories: int = Field(default=5)
    max_sql_correction_retries: int = Field(default=3)

    # engine config
    engine_timeout: float = Field(default=30.0)
    ask_runtime_mode: Literal["legacy", "deepagents"] = Field(
        default="deepagents",
        alias="ASK_RUNTIME_MODE",
    )
    ask_shadow_compare_enabled: bool = Field(
        default=False,
        alias="ASK_SHADOW_COMPARE_ENABLED",
    )
    ask_shadow_compare_sample_rate: float = Field(
        default=0.1,
        alias="ASK_SHADOW_COMPARE_SAMPLE_RATE",
    )

    # service config
    query_cache_ttl: int = Field(default=3600)  # unit: seconds
    query_cache_maxsize: int = Field(
        default=1_000_000,
        json_schema_extra={
            "comment": """
            the maxsize is a necessary parameter to init cache, but we don't want to expose it to the user
            so we set it to 1_000_000, which is a large number
            """
        },
    )

    # user guide config
    is_oss: bool = Field(default=True)
    doc_endpoint: str | None = Field(default=None)

    # langfuse config
    # in order to use langfuse, we also need to set the LANGFUSE_SECRET_KEY and LANGFUSE_PUBLIC_KEY in the .env or .env.dev file
    langfuse_host: str = Field(default="https://cloud.langfuse.com")
    langfuse_enable: bool = Field(default=True)

    # debug config
    logging_level: str = Field(default="INFO")
    development: bool = Field(default=False)
    reload: bool | None = Field(default=None, alias="WREN_AI_SERVICE_RELOAD")
    semantics_preparation_pipeline_timeout_seconds: int = Field(
        default=180,
        alias="WREN_SEMANTICS_PREPARATION_PIPELINE_TIMEOUT_SECONDS",
    )

    # this is used to store the config like type: llm, embedder, etc. and we will process them later
    config_path: str = Field(default="config.yaml", alias="CONFIG_PATH")
    _components: list[dict]

    sql_pairs_path: str = Field(default="sql_pairs.json")

    def __init__(self):
        load_dotenv(".env.dev", override=True)
        super().__init__()
        raw = self.config_loader()
        self.override(raw)
        self.normalize_semantic_plan_settings()
        self._components = [
            component for component in raw if "settings" not in component
        ]

    def config_loader(self):
        candidates = self._resolve_config_candidates()

        for path in candidates:
            try:
                with open(path, "r") as file:
                    return list(yaml.load_all(file, Loader=yaml.SafeLoader))
            except FileNotFoundError:
                continue
            except yaml.YAMLError as e:
                logger.exception(f"Error parsing YAML file {path}: {e}")
                return []

        message = (
            f"Warning: Configuration file {self.config_path} not found. "
            f"Checked: {', '.join(str(path) for path in candidates)}. "
            "Using default settings."
        )
        logger.warning(message)
        return []

    def _resolve_config_candidates(self) -> list[Path]:
        configured = Path(self.config_path)
        candidates: list[Path] = []

        if configured.is_absolute():
            candidates.append(configured)
            return candidates

        repo_root = Path(__file__).resolve().parents[2]
        service_root = Path(__file__).resolve().parents[1]
        local_override = configured.with_name(
            f"{configured.stem}.local{configured.suffix}"
        )

        for candidate in (
            Path.cwd() / local_override,
            service_root / local_override,
            repo_root / local_override,
            Path.cwd() / configured,
            service_root / configured,
            repo_root / configured,
            repo_root / "docker" / configured.name,
        ):
            if candidate not in candidates:
                candidates.append(candidate)

        return candidates

    def override(self, raw: list[dict]) -> None:
        override_settings = {}

        for doc in raw:
            if "settings" in doc:
                override_settings = doc["settings"]
                break

        for key, value in override_settings.items():
            if hasattr(self, key):
                setattr(self, key, value)
            else:
                message = f"Warning: Unknown configuration key '{key}' in YAML file."
                logger.warning(message)

    def normalize_semantic_plan_settings(self) -> None:
        if self.semantic_plan_mode not in {"deterministic", "shadow", "enhanced"}:
            logger.warning(
                "Warning: Unknown semantic_plan_mode '%s'. Falling back to deterministic.",
                self.semantic_plan_mode,
            )
            self.semantic_plan_mode = "deterministic"

        # Backward compatibility: the old boolean enabled the LLM plan as an
        # applied enhancement. The new mode can still be set explicitly to
        # shadow for safe observation without changing runtime decisions.
        if self.allow_semantic_plan_llm and self.semantic_plan_mode == "deterministic":
            self.semantic_plan_mode = "enhanced"

    @property
    def components(self) -> list[dict]:
        return self._components


settings = Settings()
