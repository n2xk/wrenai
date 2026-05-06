#!/usr/bin/env python3
"""Post-deploy TiDB business bootstrap and smoke validation runner.

This runner intentionally uses Wren UI same-origin APIs for product objects and
only talks directly to TiDB for optional business-source seed/reset.
"""

from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timezone
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover - operator environment guard
    raise SystemExit('PyYAML is required. Install PyYAML or run in the repo Python environment.') from exc

REPO_ROOT = Path(__file__).resolve().parents[2]
KB_VALIDATOR_PATH = REPO_ROOT / 'docs/业务需求/knowledge-base/validate_import_format.py'
SEED_TRANSFORM_PATH = REPO_ROOT / 'docs/业务需求/local_tidb_seed_transform.py'
DEFAULT_CONFIG_PATH = REPO_ROOT / 'docker/config/tidb-business-bootstrap.example.json'
DEFAULT_REPORT_DIR = REPO_ROOT / 'wren-ui/tmp/postdeploy-tidb-business-bootstrap'
TERMINAL_TASK_STATUSES = {'FINISHED', 'FAILED', 'STOPPED'}
ANSWER_FINISHED_STATUS = 'FINISHED'
ANSWER_RUNNING_STATUSES = {
    'NOT_STARTED',
    'FETCHING_DATA',
    'PREPROCESSING',
    'STREAMING',
}
ANSWER_TERMINAL_ERROR_STATUSES = {'FAILED', 'INTERRUPTED'}
PENDING_TASK_STATUSES = {
    'UNDERSTANDING',
    'SEARCHING',
    'PLANNING',
    'GENERATING',
    'CORRECTING',
    'INDEXING',
    'RUNNING',
    'PENDING',
    'QUEUED',
    'GENERATING_SQL',
}


class BootstrapError(RuntimeError):
    pass


def log(message: str) -> None:
    print(f'[postdeploy-bootstrap] {message}', flush=True)


def load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding='utf-8') as handle:
        return json.load(handle)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def deep_merge(base: Any, override: Any) -> Any:
    if isinstance(base, dict) and isinstance(override, dict):
        merged = deepcopy(base)
        for key, value in override.items():
            merged[key] = deep_merge(merged.get(key), value)
        return merged
    if override is None:
        return deepcopy(base)
    return deepcopy(override)


def load_env_file(path: Path | None) -> None:
    if not path or not path.exists():
        return
    for raw_line in path.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        if line.startswith('export '):
            line = line[len('export ') :].strip()
        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def env_value(name: str | None, default: Any = None, required: bool = False) -> Any:
    if not name:
        if required:
            raise BootstrapError('Missing env variable name in config')
        return default
    if name in os.environ:
        return os.environ[name]
    if required:
        raise BootstrapError(f'Missing required environment variable: {name}')
    return default


def as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {'1', 'true', 'yes', 'y', 'on'}


def as_int(value: Any, default: int | None = None) -> int | None:
    if value is None or value == '':
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def value_with_env(section: dict[str, Any], value_key: str, env_key: str, default: Any = None) -> Any:
    configured = section.get(value_key)
    if section.get(env_key):
        return env_value(section.get(env_key), configured if configured is not None else default)
    return configured if configured is not None else default


def rel_path(path_value: str | Path) -> Path:
    path = Path(path_value)
    return path if path.is_absolute() else REPO_ROOT / path


def load_seed_transform_module():
    spec = importlib.util.spec_from_file_location(
        'local_tidb_seed_transform',
        SEED_TRANSFORM_PATH,
    )
    if spec is None or spec.loader is None:
        raise BootstrapError(f'Cannot load seed transform module: {SEED_TRANSFORM_PATH}')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def current_date_slug() -> str:
    return datetime.now(timezone.utc).astimezone().strftime('%Y-%m-%d')


def find_first(items: list[dict[str, Any]], *predicates) -> dict[str, Any] | None:
    for item in items:
        if all(predicate(item) for predicate in predicates):
            return item
    return None


def normalize_text(value: Any) -> str:
    return str(value or '').strip()


def normalize_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return [value]


def normalize_str_list(value: Any) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in normalize_list(value):
        text = normalize_text(item)
        if text and text not in seen:
            seen.add(text)
            result.append(text)
    return result


def split_sql_statements(sql_text: str) -> list[str]:
    statements: list[str] = []
    current: list[str] = []
    quote: str | None = None
    escaped = False
    in_line_comment = False
    in_block_comment = False
    i = 0
    while i < len(sql_text):
        char = sql_text[i]
        nxt = sql_text[i + 1] if i + 1 < len(sql_text) else ''
        if in_line_comment:
            current.append(char)
            if char == '\n':
                in_line_comment = False
            i += 1
            continue
        if in_block_comment:
            current.append(char)
            if char == '*' and nxt == '/':
                current.append(nxt)
                in_block_comment = False
                i += 2
            else:
                i += 1
            continue
        if quote:
            current.append(char)
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == quote:
                quote = None
            i += 1
            continue
        if char == '-' and nxt == '-':
            current.append(char)
            current.append(nxt)
            in_line_comment = True
            i += 2
            continue
        if char == '/' and nxt == '*':
            current.append(char)
            current.append(nxt)
            in_block_comment = True
            i += 2
            continue
        if char in {"'", '"', '`'}:
            quote = char
            current.append(char)
            i += 1
            continue
        if char == ';':
            statement = ''.join(current).strip()
            if statement:
                statements.append(statement)
            current = []
            i += 1
            continue
        current.append(char)
        i += 1
    tail = ''.join(current).strip()
    if tail:
        statements.append(tail)
    return statements


def iter_sql_file_statements(path: Path, chunk_size: int = 1024 * 1024):
    """Stream SQL statements from a file without loading large seed dumps."""
    current: list[str] = []
    quote: str | None = None
    escaped = False
    in_line_comment = False
    in_block_comment = False

    with path.open(encoding='utf-8', errors='ignore') as handle:
        while True:
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            i = 0
            while i < len(chunk):
                char = chunk[i]
                nxt = chunk[i + 1] if i + 1 < len(chunk) else ''
                if in_line_comment:
                    current.append(char)
                    if char == '\n':
                        in_line_comment = False
                    i += 1
                    continue
                if in_block_comment:
                    current.append(char)
                    if char == '*' and nxt == '/':
                        current.append(nxt)
                        in_block_comment = False
                        i += 2
                    else:
                        i += 1
                    continue
                if quote:
                    current.append(char)
                    if escaped:
                        escaped = False
                    elif char == '\\':
                        escaped = True
                    elif char == quote:
                        quote = None
                    i += 1
                    continue
                if char == '-' and nxt == '-':
                    current.append(char)
                    current.append(nxt)
                    in_line_comment = True
                    i += 2
                    continue
                if char == '/' and nxt == '*':
                    current.append(char)
                    current.append(nxt)
                    in_block_comment = True
                    i += 2
                    continue
                if char in {"'", '"', '`'}:
                    quote = char
                    current.append(char)
                    i += 1
                    continue
                if char == ';':
                    statement = ''.join(current).strip()
                    if statement:
                        yield statement
                    current = []
                    i += 1
                    continue
                current.append(char)
                i += 1

    tail = ''.join(current).strip()
    if tail:
        yield tail


@dataclass
class RuntimeSelector:
    workspace_id: str | None = None
    knowledge_base_id: str | None = None
    kb_snapshot_id: str | None = None
    deploy_hash: str | None = None

    def headers(self, executable: bool = True) -> dict[str, str]:
        headers: dict[str, str] = {}
        if self.workspace_id:
            headers['x-wren-workspace-id'] = self.workspace_id
        if self.knowledge_base_id:
            headers['x-wren-knowledge-base-id'] = self.knowledge_base_id
        if executable and self.kb_snapshot_id:
            headers['x-wren-kb-snapshot-id'] = self.kb_snapshot_id
        if executable and self.deploy_hash:
            headers['x-wren-deploy-hash'] = self.deploy_hash
        return headers

    def query(self, executable: bool = True) -> dict[str, str]:
        query: dict[str, str] = {}
        if self.workspace_id:
            query['workspaceId'] = self.workspace_id
        if self.knowledge_base_id:
            query['knowledgeBaseId'] = self.knowledge_base_id
        if executable and self.kb_snapshot_id:
            query['kbSnapshotId'] = self.kb_snapshot_id
        if executable and self.deploy_hash:
            query['deployHash'] = self.deploy_hash
        return query


class ApiClient:
    def __init__(self, base_url: str, max_429_retries: int = 3):
        self.base_url = base_url.rstrip('/')
        self.cookie_jar = CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookie_jar))
        self.max_429_retries = max_429_retries

    def request(
        self,
        method: str,
        path: str,
        *,
        json_body: Any | None = None,
        headers: dict[str, str] | None = None,
        query: dict[str, Any] | None = None,
        expected: tuple[int, ...] = (200,),
        retry_429: bool = True,
    ) -> Any:
        if not path.startswith('/'):
            path = '/' + path
        url = self.base_url + path
        if query:
            clean_query = {key: value for key, value in query.items() if value not in (None, '')}
            if clean_query:
                url += '?' + urllib.parse.urlencode(clean_query)
        body_bytes: bytes | None = None
        request_headers = {'Accept': 'application/json'}
        if headers:
            request_headers.update(headers)
        if json_body is not None:
            body_bytes = json.dumps(json_body, ensure_ascii=False).encode('utf-8')
            request_headers['Content-Type'] = 'application/json'

        attempts = self.max_429_retries + 1 if retry_429 else 1
        last_error: Exception | None = None
        for attempt in range(1, attempts + 1):
            req = urllib.request.Request(url, data=body_bytes, headers=request_headers, method=method.upper())
            try:
                with self.opener.open(req, timeout=180) as response:
                    status = response.getcode()
                    raw = response.read().decode('utf-8')
                    payload = json.loads(raw) if raw else None
                    if status not in expected:
                        raise BootstrapError(f'{method} {path} returned HTTP {status}: {payload}')
                    return payload
            except urllib.error.HTTPError as error:
                raw = error.read().decode('utf-8', errors='replace')
                try:
                    payload = json.loads(raw) if raw else {}
                except json.JSONDecodeError:
                    payload = {'error': raw}
                if error.code == 429 and retry_429 and attempt < attempts:
                    delay = min(30.0, 2.0 * attempt + random.random())
                    log(f'429 from {path}; retrying in {delay:.1f}s ({attempt}/{attempts - 1})')
                    time.sleep(delay)
                    continue
                raise BootstrapError(f'{method} {path} returned HTTP {error.code}: {payload}') from error
            except (urllib.error.URLError, TimeoutError) as error:
                last_error = error
                if retry_429 and attempt < attempts:
                    delay = min(20.0, 1.5 * attempt + random.random())
                    log(f'Transient error from {path}: {error}; retrying in {delay:.1f}s')
                    time.sleep(delay)
                    continue
                raise BootstrapError(f'{method} {path} failed: {error}') from error
        raise BootstrapError(f'{method} {path} failed: {last_error}')


@dataclass
class BootstrapReport:
    profile: str
    started_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    environment: dict[str, Any] = field(default_factory=dict)
    workspace: dict[str, Any] = field(default_factory=dict)
    knowledge_base: dict[str, Any] = field(default_factory=dict)
    connector: dict[str, Any] = field(default_factory=dict)
    tidb_seed: dict[str, Any] = field(default_factory=dict)
    import_counts: dict[str, int] = field(default_factory=dict)
    generation: dict[str, Any] = field(default_factory=dict)
    core_cases: list[dict[str, Any]] = field(default_factory=list)
    saved_tables: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            'profile': self.profile,
            'startedAt': self.started_at,
            'finishedAt': datetime.now(timezone.utc).isoformat(),
            'environment': self.environment,
            'workspace': self.workspace,
            'knowledgeBase': self.knowledge_base,
            'connector': self.connector,
            'tidbSeed': self.tidb_seed,
            'importCounts': self.import_counts,
            'generation': self.generation,
            'coreCases': self.core_cases,
            'savedTables': self.saved_tables,
            'warnings': self.warnings,
            'errors': self.errors,
        }


def load_config(config_path: Path, profile: str) -> dict[str, Any]:
    raw = load_json(config_path)
    if 'profiles' not in raw:
        config = deepcopy(raw)
        config.setdefault('profile', profile)
        return config
    common = raw.get('common') or {}
    profiles = raw.get('profiles') or {}
    if profile not in profiles:
        raise BootstrapError(f'Profile {profile!r} is not defined in {config_path}')
    config = deep_merge(common, profiles[profile])
    config['profile'] = profile
    return config


def apply_cli_overrides(config: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    config = deepcopy(config)
    if args.base_url:
        config.setdefault('ui', {})['baseUrl'] = args.base_url
    if args.no_reset_tidb:
        config.setdefault('tidbSeed', {})['resetDatabase'] = False
        config.setdefault('tidbSeed', {})['resetDatabaseEnv'] = ''
    if args.prepare_only:
        config.setdefault('validation', {})['runCoreCases'] = False
        config.setdefault('validation', {})['saveDegradedTables'] = False
    if args.run_cases_only:
        config.setdefault('tidbSeed', {})['enabled'] = False
        config.setdefault('tidbSeed', {})['enabledEnv'] = ''
        config.setdefault('knowledgeAssets', {})['enabled'] = False
        config.setdefault('postImportGeneration', {})['suggestedQuestions'] = False
        config.setdefault('postImportGeneration', {})['semanticDescriptions'] = False
        config.setdefault('postImportGeneration', {})['relationships'] = False
    if args.run_only:
        config['runOnly'] = args.run_only
    return config


def load_kb_validator_module():
    spec = importlib.util.spec_from_file_location('wren_kb_import_validator', KB_VALIDATOR_PATH)
    if spec is None or spec.loader is None:
        raise BootstrapError(f'Cannot load {KB_VALIDATOR_PATH}')
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def build_kb_payload_previews(config: dict[str, Any]) -> tuple[list[Any], list[Any]]:
    validator = load_kb_validator_module()
    manifest = config.get('knowledgeAssets', {}).get('manifest') or 'docs/业务需求/knowledge-base/import-manifest.sample.yaml'
    root = config.get('knowledgeAssets', {}).get('root') or ''
    args = argparse.Namespace(manifest=str(rel_path(manifest)), root=str(rel_path(root)) if root else '', target='all')
    previews, issues = validator.run_validation(args)
    return previews, issues


def extract_front_matter(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding='utf-8')
    match = re.match(r'\A---\s*\n(.*?)\n---\s*\n', text, re.DOTALL)
    if not match:
        return {}
    loaded = yaml.safe_load(match.group(1)) or {}
    return loaded if isinstance(loaded, dict) else {}


def collect_source_tables(config: dict[str, Any]) -> list[str]:
    modeling = config.get('modeling') or {}
    configured = normalize_str_list(modeling.get('tables'))
    if configured:
        return configured
    if not as_bool(modeling.get('tablesFromSqlTemplates'), True):
        return []
    sql_dir = rel_path(config.get('knowledgeAssets', {}).get('sqlTemplatesDir') or 'docs/业务需求/knowledge-base/sql-templates')
    seen: set[str] = set()
    tables: list[str] = []
    for path in sorted(sql_dir.glob('*.md')):
        fm = extract_front_matter(path)
        for table in normalize_str_list(fm.get('source_tables')):
            if table not in seen:
                seen.add(table)
                tables.append(table)
    for table in normalize_str_list(modeling.get('additionalTables')):
        if table not in seen:
            seen.add(table)
            tables.append(table)
    return tables


def extract_policy_payloads(policy_file: Path) -> list[dict[str, Any]]:
    text = policy_file.read_text(encoding='utf-8')
    payloads: list[dict[str, Any]] = []
    for match in re.finditer(r'```yaml\s*(.*?)```', text, re.DOTALL | re.IGNORECASE):
        loaded = yaml.safe_load(match.group(1)) or {}
        if not isinstance(loaded, dict) or 'rules' in loaded:
            continue
        rule_id = normalize_text(loaded.get('id'))
        reason_code = normalize_text(loaded.get('reason_code') or loaded.get('reasonCode'))
        if not rule_id or not reason_code:
            continue
        payloads.append(
            {
                'name': loaded.get('name') or rule_id,
                'status': loaded.get('status') or 'active',
                'queryContainsAny': normalize_str_list(loaded.get('query_contains_any') or loaded.get('queryContainsAny')),
                'templateIds': normalize_str_list(loaded.get('template_ids') or loaded.get('templateIds')),
                'forbiddenTemplates': normalize_str_list(loaded.get('forbidden_templates') or loaded.get('forbiddenTemplates')),
                'requiredSlots': normalize_str_list(loaded.get('required_slots') or loaded.get('requiredSlots')),
                'semanticConditions': loaded.get('semantic_conditions') or loaded.get('semanticConditions') or {},
                'reasonCode': reason_code,
                'description': loaded.get('description') or f'Imported ask policy rule {rule_id}',
            }
        )
    return payloads


def validate_static_inputs(config: dict[str, Any]) -> dict[str, Any]:
    previews, issues = build_kb_payload_previews(config)
    error_count = sum(1 for issue in issues if issue.level == 'error')
    if error_count:
        raise BootstrapError(f'Knowledge asset format has {error_count} errors')
    policy_file = rel_path(config.get('knowledgeAssets', {}).get('askPolicyFile') or 'docs/业务需求/问数策略配置建议-2026-05-01.md')
    policy_payloads = extract_policy_payloads(policy_file)
    source_tables = collect_source_tables(config)
    counts: dict[str, int] = {}
    payload_count = 0
    for preview in previews:
        counts[preview.import_target] = counts.get(preview.import_target, 0) + 1
        payload_count += len(preview.payloads)
    seed_static = validate_tidb_seed_static(config)
    return {
        'knowledgeFiles': len(previews),
        'knowledgePayloads': payload_count,
        'knowledgeCounts': counts,
        'knowledgeWarnings': sum(1 for issue in issues if issue.level == 'warning'),
        'askPolicyRules': len(policy_payloads),
        'sourceTables': len(source_tables),
        **seed_static,
    }


def validate_tidb_seed_static(config: dict[str, Any]) -> dict[str, Any]:
    seed_config = resolve_tidb_seed_config(config)
    if not seed_config.get('enabled'):
        return {'tidbSeedEnabled': False}
    missing: list[str] = []
    schema_file = seed_config.get('schemaFile')
    if schema_file and not schema_file.exists():
        missing.append(str(schema_file))
    seed_files = seed_config.get('seedFiles') or []
    for path in seed_files:
        if not path.exists():
            missing.append(str(path))
    if not seed_files and seed_config.get('seedReferenceDir') and not seed_config['seedReferenceDir'].exists():
        missing.append(str(seed_config['seedReferenceDir']))
    if not seed_files and seed_config.get('seedFile') and not seed_config['seedFile'].exists():
        missing.append(str(seed_config['seedFile']))
    if missing:
        raise BootstrapError(
            'TiDB seed input missing. Run `python3 docs/业务需求/generate_seed_data_local.py` '
            f'or fix config. Missing: {missing}'
        )
    return {
        'tidbSeedEnabled': True,
        'tidbSeedFiles': len(seed_files),
        'tidbSeedMode': 'seedFiles' if seed_files else ('seedReferenceDir' if seed_config.get('seedReferenceDir') else 'seedFile'),
    }


def resolve_ui_config(config: dict[str, Any]) -> dict[str, Any]:
    ui = config.get('ui') or {}
    password = ui.get('password')
    if password is None and ui.get('passwordEnv'):
        password = env_value(ui.get('passwordEnv'), required=True)
    return {
        'baseUrl': ui.get('baseUrl') or env_value(ui.get('baseUrlEnv'), 'http://127.0.0.1:3001'),
        'email': ui.get('email') or env_value(ui.get('emailEnv'), required=True),
        'password': password,
        'autoBootstrap': as_bool(ui.get('autoBootstrap'), False),
    }


def resolve_tidb_seed_config(config: dict[str, Any]) -> dict[str, Any]:
    seed = config.get('tidbSeed') or {}
    seed_files = seed.get('seedFiles')
    seed_reference_dir = seed.get('seedReferenceDir')
    supplemental_files = seed.get('supplementalSeedFiles')
    if supplemental_files is None:
        supplemental_files = ['docs/业务需求/external-data/full_external_metrics_daily.sql']
    include_regression_overlay = as_bool(seed.get('includeRegressionOverlay'), True)
    regression_overlay_file = seed.get('regressionOverlayFile') or 'docs/业务需求/seed_data_local/regression_fixture.sql'
    return {
        'enabled': as_bool(value_with_env(seed, 'enabled', 'enabledEnv', False), False),
        'resetDatabase': as_bool(value_with_env(seed, 'resetDatabase', 'resetDatabaseEnv', False), False),
        'host': seed.get('host') or env_value(seed.get('hostEnv'), '127.0.0.1'),
        'port': as_int(seed.get('port') or env_value(seed.get('portEnv'), 4000), 4000),
        'user': seed.get('user') or env_value(seed.get('userEnv'), 'root'),
        'password': seed.get('password') if seed.get('password') is not None else env_value(seed.get('passwordEnv'), ''),
        'database': seed.get('database') or env_value(seed.get('databaseEnv'), 'tidb_business_demo'),
        'schemaFile': rel_path(seed.get('schemaFile') or 'docs/业务需求/local_tidb_schema.sql'),
        'seedFile': rel_path(seed['seedFile']) if seed.get('seedFile') else None,
        'seedFiles': [rel_path(item) for item in normalize_list(seed_files)] if seed_files else [],
        'seedReferenceDir': rel_path(seed_reference_dir) if seed_reference_dir else None,
        'includeRegressionOverlay': include_regression_overlay,
        'regressionOverlayFile': rel_path(regression_overlay_file) if include_regression_overlay else None,
        'supplementalSeedFiles': [rel_path(item) for item in supplemental_files],
        'batchSize': as_int(seed.get('batchSize'), 1000) or 1000,
    }


def resolve_tidb_connector_properties(config: dict[str, Any]) -> dict[str, Any]:
    connector = config.get('tidbConnector') or {}
    return {
        'displayName': connector.get('displayName') or 'TiDB Business Data Source',
        'host': connector.get('host') or env_value(connector.get('hostEnv'), required=True),
        'port': as_int(connector.get('port') or env_value(connector.get('portEnv'), 4000), 4000),
        'database': connector.get('database') or env_value(connector.get('databaseEnv'), required=True),
        'user': connector.get('user') or env_value(connector.get('userEnv'), required=True),
        'password': connector.get('password') if connector.get('password') is not None else env_value(connector.get('passwordEnv'), ''),
        'ssl': as_bool(connector.get('ssl') if connector.get('ssl') is not None else env_value(connector.get('sslEnv'), 'false'), False),
    }


def reset_and_seed_tidb(seed_config: dict[str, Any], allow_prod_reset: bool, profile: str) -> dict[str, Any]:
    if not seed_config['enabled']:
        return {'enabled': False, 'status': 'SKIPPED'}
    if profile == 'prod' and seed_config['resetDatabase'] and not allow_prod_reset:
        raise BootstrapError('Production TiDB reset requires --allow-prod-reset')
    try:
        import pymysql
    except ImportError as exc:  # pragma: no cover - operator environment guard
        raise BootstrapError('PyMySQL is required when tidbSeed.enabled=true') from exc

    conn = pymysql.connect(
        host=seed_config['host'],
        port=seed_config['port'],
        user=seed_config['user'],
        password=seed_config['password'],
        autocommit=True,
        charset='utf8mb4',
    )
    statement_counts: dict[str, int] = {}
    try:
        with conn.cursor() as cursor:
            if seed_config['resetDatabase']:
                cursor.execute(f"DROP DATABASE IF EXISTS `{seed_config['database']}`")
            cursor.execute(f"CREATE DATABASE IF NOT EXISTS `{seed_config['database']}` DEFAULT CHARACTER SET utf8mb4")
            cursor.execute(f"USE `{seed_config['database']}`")
            schema_path = seed_config['schemaFile']
            if not schema_path.exists():
                raise BootstrapError(f'TiDB schema file not found: {schema_path}')
            executed = 0
            for statement in split_sql_statements(schema_path.read_text(encoding='utf-8')):
                cursor.execute(statement)
                executed += 1
            statement_counts['schema'] = executed

            seed_files = seed_config.get('seedFiles') or []
            seed_reference_dir = seed_config.get('seedReferenceDir')
            seed_file = seed_config.get('seedFile')
            executed = 0
            if seed_files:
                for path in seed_files:
                    if not path.exists():
                        raise BootstrapError(f'TiDB seed file not found: {path}')
                    file_executed = 0
                    for statement in iter_sql_file_statements(path):
                        cursor.execute(statement)
                        executed += 1
                        file_executed += 1
                    statement_counts[f'seed:{path.name}'] = file_executed
                statement_counts['seedFiles'] = executed
            elif seed_reference_dir:
                if not seed_reference_dir.exists():
                    raise BootstrapError(f'TiDB seed reference dir not found: {seed_reference_dir}')
                seed_transform = load_seed_transform_module()
                for statement in seed_transform.iter_local_seed_sql(
                    seed_reference_dir,
                    seed_config.get('regressionOverlayFile'),
                    seed_config.get('supplementalSeedFiles') or [],
                    batch_size=max(seed_config.get('batchSize') or 1, 1),
                ):
                    for executable in split_sql_statements(statement):
                        cursor.execute(executable)
                        executed += 1
                statement_counts['seedReference'] = executed
            elif seed_file:
                if not seed_file.exists():
                    raise BootstrapError(f'TiDB seed file not found: {seed_file}')
                for statement in iter_sql_file_statements(seed_file):
                    cursor.execute(statement)
                    executed += 1
                statement_counts['seed'] = executed
            else:
                statement_counts['seed'] = 0
    finally:
        conn.close()
    return {
        'enabled': True,
        'status': 'SUCCESS',
        'database': seed_config['database'],
        'resetDatabase': seed_config['resetDatabase'],
        'statementCounts': statement_counts,
    }


def login(client: ApiClient, ui_config: dict[str, Any]) -> dict[str, Any]:
    payload = {
        'email': ui_config['email'],
        'password': ui_config['password'],
        'autoBootstrap': ui_config.get('autoBootstrap', False),
    }
    for attempt in range(1, 7):
        try:
            return client.request(
                'POST',
                '/api/auth/login',
                json_body=payload,
                expected=(200, 201),
            )
        except BootstrapError as error:
            message = str(error)
            startup_bootstrap_race = (
                payload.get('autoBootstrap')
                and (
                    'user_email_unique' in message
                    or 'duplicate key value violates unique constraint' in message
                )
            )
            if startup_bootstrap_race and attempt < 6:
                log(
                    'Login raced with startup owner bootstrap; retrying normal login '
                    f'({attempt}/5)'
                )
                payload['autoBootstrap'] = False
                time.sleep(min(2.0 * attempt, 10.0))
                continue
            raise
    raise BootstrapError('Login failed after startup bootstrap race retries')


def ensure_workspace(client: ApiClient, config: dict[str, Any], login_result: dict[str, Any]) -> dict[str, Any]:
    workspace_cfg = config.get('workspace') or {}
    name = workspace_cfg.get('name') or 'saas业务空间'
    slug = workspace_cfg.get('slug') or 'tidb-business'
    current = client.request('GET', '/api/v1/workspace/current')
    workspaces = current.get('workspaces') or []
    workspace = find_first(
        workspaces,
        lambda item: normalize_text(item.get('slug')) == slug or normalize_text(item.get('name')) == name,
    )
    if workspace:
        return workspace
    if workspace_cfg.get('mode') == 'existing-only':
        raise BootstrapError(f'Workspace not found: {name}')
    user_id = current.get('user', {}).get('id') or login_result.get('user', {}).get('id')
    if not user_id:
        raise BootstrapError('Cannot resolve current user id for workspace creation')
    created = client.request(
        'POST',
        '/api/v1/workspace',
        json_body={'name': name, 'slug': slug, 'initialOwnerUserId': user_id},
        expected=(201,),
    )
    return created.get('workspace') or created


def ensure_knowledge_base(client: ApiClient, config: dict[str, Any], selector: RuntimeSelector) -> dict[str, Any]:
    kb_cfg = config.get('knowledgeBase') or {}
    name = kb_cfg.get('name') or 'saas业务知识库'
    slug = kb_cfg.get('slug') or 'tidb-business-kb'
    headers = selector.headers(executable=False)
    items = client.request('GET', '/api/v1/knowledge/bases', headers=headers)
    knowledge_base = find_first(
        items,
        lambda item: normalize_text(item.get('slug')) == slug or normalize_text(item.get('name')) == name,
    )
    if knowledge_base:
        return knowledge_base
    if kb_cfg.get('mode') == 'existing-only':
        raise BootstrapError(f'Knowledge base not found: {name}')
    return client.request(
        'POST',
        '/api/v1/knowledge/bases',
        headers=headers,
        json_body={'name': name, 'slug': slug, 'description': kb_cfg.get('description') or None},
        expected=(201,),
    )


def refresh_knowledge_base(client: ApiClient, selector: RuntimeSelector, name: str | None = None, slug: str | None = None) -> dict[str, Any]:
    items = client.request('GET', '/api/v1/knowledge/bases', headers=selector.headers(executable=False))
    for item in items:
        if selector.knowledge_base_id and item.get('id') == selector.knowledge_base_id:
            return item
    if name or slug:
        found = find_first(
            items,
            lambda item: (slug and item.get('slug') == slug) or (name and item.get('name') == name),
        )
        if found:
            return found
    raise BootstrapError('Knowledge base disappeared after refresh')


def update_selector_from_kb(selector: RuntimeSelector, knowledge_base: dict[str, Any]) -> RuntimeSelector:
    snapshot = knowledge_base.get('defaultKbSnapshot') or {}
    return RuntimeSelector(
        workspace_id=selector.workspace_id or knowledge_base.get('workspaceId'),
        knowledge_base_id=knowledge_base.get('id') or selector.knowledge_base_id,
        kb_snapshot_id=snapshot.get('id') or knowledge_base.get('defaultKbSnapshotId') or selector.kb_snapshot_id,
        deploy_hash=snapshot.get('deployHash') or selector.deploy_hash,
    )


def ensure_connection_and_models(client: ApiClient, config: dict[str, Any], selector: RuntimeSelector) -> dict[str, Any]:
    connector_props = resolve_tidb_connector_properties(config)
    headers = selector.headers(executable=False)
    connection_payload = {'type': 'MYSQL', 'properties': connector_props}
    try:
        connection = client.request('POST', '/api/v1/settings/connection', headers=headers, json_body=connection_payload, expected=(201, 200))
    except BootstrapError as create_error:
        log(f'Connection POST failed, trying PATCH: {create_error}')
        connection = client.request('PATCH', '/api/v1/settings/connection', headers=headers, json_body=connection_payload, expected=(200,))

    tables = collect_source_tables(config)
    try:
        listed_tables: list[dict[str, Any]] = []
        for attempt in range(1, 7):
            try:
                listed_tables = client.request('GET', '/api/v1/connection/tables', headers=headers)
                break
            except BootstrapError as error:
                if attempt == 6:
                    raise
                delay = min(15.0, 1.5 * attempt)
                log(f'Connection table listing is not ready: {error}; retrying in {delay:.1f}s ({attempt}/6)')
                time.sleep(delay)
        if not tables:
            tables = [item.get('name') for item in listed_tables if item.get('name')]
        else:
            database_name = normalize_text(connector_props.get('database'))
            available_by_table: dict[str, str] = {}

            def remember_table(alias: str, actual_name: str) -> None:
                alias = normalize_text(alias)
                actual_name = normalize_text(actual_name)
                if not alias or not actual_name:
                    return
                existing = available_by_table.get(alias)
                if not existing or ('.' not in existing and '.' in actual_name):
                    available_by_table[alias] = actual_name

            for item in listed_tables:
                item_name = normalize_text(item.get('name'))
                if not item_name:
                    continue
                properties = item.get('properties') if isinstance(item.get('properties'), dict) else {}
                base_name = normalize_text(properties.get('table')) or item_name.split('.')[-1]
                actual_name = item_name
                if '.' not in actual_name and database_name:
                    actual_name = f'{database_name}.{actual_name}'
                remember_table(item_name, actual_name)
                remember_table(base_name, actual_name)
            missing = [table for table in tables if table not in available_by_table]
            if missing:
                log(f'Skipping missing source tables: {", ".join(missing[:12])}')
                tables = [available_by_table[table] for table in tables if table in available_by_table]
    except BootstrapError as error:
        log(f'Could not list connection tables before saving models: {error}')
    if not tables:
        raise BootstrapError('No TiDB tables selected for modeling')
    save_result = client.request('POST', '/api/v1/setup/models', headers=headers, json_body={'tables': tables})
    if not save_result.get('models') and connector_props.get('database'):
        qualified_tables = [
            table if '.' in table else f"{connector_props['database']}.{table}"
            for table in tables
        ]
        if qualified_tables != tables:
            log('Model save returned no models; retrying with database-qualified table names')
            tables = qualified_tables
            save_result = client.request('POST', '/api/v1/setup/models', headers=headers, json_body={'tables': tables})
    return {
        'connection': connection,
        'selectedTables': tables,
        'modelSaveResult': save_result,
    }


def deploy_and_refresh(client: ApiClient, selector: RuntimeSelector, config: dict[str, Any]) -> tuple[dict[str, Any], RuntimeSelector]:
    deploy_result = client.request('POST', '/api/v1/deploy', headers=selector.headers(executable=True), expected=(200,))
    if normalize_text(deploy_result.get('status')).upper() != 'SUCCESS':
        raise BootstrapError(f'Deploy failed: {deploy_result}')
    kb_cfg = config.get('knowledgeBase') or {}
    knowledge_base = refresh_knowledge_base(client, selector, kb_cfg.get('name'), kb_cfg.get('slug'))
    next_selector = update_selector_from_kb(selector, knowledge_base)
    if deploy_result.get('hash') and not next_selector.deploy_hash:
        next_selector.deploy_hash = deploy_result.get('hash')
    return deploy_result, next_selector


def upsert_by_key(
    client: ApiClient,
    selector: RuntimeSelector,
    list_path: str,
    create_path: str,
    update_path_prefix: str,
    payloads: list[dict[str, Any]],
    key_fn,
    label: str,
    method: str = 'PUT',
) -> int:
    headers = selector.headers(executable=True)
    existing_items = client.request('GET', list_path, headers=headers)
    if isinstance(existing_items, dict) and isinstance(existing_items.get('items'), list):
        existing_items = existing_items['items']
    if not isinstance(existing_items, list):
        existing_items = []
    count = 0
    for payload in payloads:
        key = key_fn(payload)
        existing = None
        if key is not None:
            for item in existing_items:
                if key_fn(item) == key:
                    existing = item
                    break
        if existing:
            client.request(method, f'{update_path_prefix}/{existing["id"]}', headers=headers, json_body=payload, expected=(200,))
        else:
            created = client.request('POST', create_path, headers=headers, json_body=payload, expected=(201, 200))
            existing_items.append(created)
        count += 1
    log(f'Imported {count} {label}')
    return count


def import_knowledge_assets(client: ApiClient, config: dict[str, Any], selector: RuntimeSelector) -> dict[str, int]:
    if not as_bool(config.get('knowledgeAssets', {}).get('enabled'), True):
        return {'status': 0}
    previews, issues = build_kb_payload_previews(config)
    error_count = sum(1 for issue in issues if issue.level == 'error')
    if error_count:
        raise BootstrapError(f'Knowledge asset format has {error_count} errors')
    by_path: dict[str, list[dict[str, Any]]] = {}
    for preview in previews:
        for entry in preview.payloads:
            payload = deepcopy(entry['payload'])
            if entry['apiPath'] == '/api/v1/knowledge/instructions':
                import_id = Path(preview.path).stem.split('_', 1)[0]
                runtime_usage = payload.get('runtimeUsage') if isinstance(payload.get('runtimeUsage'), dict) else {}
                runtime_usage.setdefault('importId', import_id)
                runtime_usage.setdefault('sourcePath', preview.path)
                payload['runtimeUsage'] = runtime_usage
            if entry['apiPath'] == '/api/v1/knowledge/sql_pairs':
                payload['skipSqlValidation'] = True
                payload.setdefault('sqlMode', 'dialect')
            by_path.setdefault(entry['apiPath'], []).append(payload)

    counts: dict[str, int] = {}
    counts['instructions'] = upsert_by_key(
        client,
        selector,
        '/api/v1/knowledge/instructions',
        '/api/v1/knowledge/instructions',
        '/api/v1/knowledge/instructions',
        by_path.get('/api/v1/knowledge/instructions', []),
        lambda item: (item.get('runtimeUsage') or {}).get('importId') or normalize_text(item.get('instruction'))[:120],
        'instructions',
        method='PUT',
    )
    counts['businessTerms'] = upsert_by_key(
        client,
        selector,
        '/api/v1/knowledge/business_terms',
        '/api/v1/knowledge/business_terms',
        '/api/v1/knowledge/business_terms',
        by_path.get('/api/v1/knowledge/business_terms', []),
        lambda item: item.get('termId'),
        'business terms',
        method='PUT',
    )
    counts['externalDependencies'] = upsert_by_key(
        client,
        selector,
        '/api/v1/knowledge/external_dependencies',
        '/api/v1/knowledge/external_dependencies',
        '/api/v1/knowledge/external_dependencies',
        by_path.get('/api/v1/knowledge/external_dependencies', []),
        lambda item: item.get('dependencyId'),
        'external dependencies',
        method='PUT',
    )
    counts['sqlPairs'] = upsert_by_key(
        client,
        selector,
        '/api/v1/knowledge/sql_pairs',
        '/api/v1/knowledge/sql_pairs',
        '/api/v1/knowledge/sql_pairs',
        by_path.get('/api/v1/knowledge/sql_pairs', []),
        lambda item: ((item.get('businessSignature') or {}).get('templateId'), normalize_text(item.get('question'))),
        'SQL templates / pairs',
        method='PUT',
    )

    policy_file = rel_path(config.get('knowledgeAssets', {}).get('askPolicyFile') or 'docs/业务需求/问数策略配置建议-2026-05-01.md')
    policy_payloads = extract_policy_payloads(policy_file)
    counts['askPolicies'] = upsert_by_key(
        client,
        selector,
        '/api/v1/ask-policy-rules',
        '/api/v1/ask-policy-rules',
        '/api/v1/ask-policy-rules',
        policy_payloads,
        lambda item: item.get('reasonCode'),
        'ask policy rules',
        method='PATCH',
    )
    return counts


def poll_task(client: ApiClient, path: str, selector: RuntimeSelector, timeout_s: int = 300, interval_s: float = 2.0) -> dict[str, Any]:
    deadline = time.time() + timeout_s
    last: dict[str, Any] | None = None
    while time.time() < deadline:
        last = client.request('GET', path, headers=selector.headers(executable=True))
        status = normalize_text(last.get('status')).upper()
        if status in {'FINISHED', 'FAILED', 'STOPPED', 'SUCCEEDED', 'SUCCESS'}:
            return last
        time.sleep(interval_s)
    raise BootstrapError(f'Task polling timed out for {path}; last={last}')


def list_models(client: ApiClient, selector: RuntimeSelector) -> list[dict[str, Any]]:
    return client.request('GET', '/api/v1/models/list', headers=selector.headers(executable=True))


def build_semantic_metadata_payloads(generated_models: list[dict[str, Any]], models: list[dict[str, Any]]) -> list[dict[str, Any]]:
    model_by_name = {model.get('referenceName'): model for model in models}
    payloads: list[dict[str, Any]] = []
    for generated in generated_models:
        model = model_by_name.get(generated.get('name'))
        if not model:
            continue
        fields = [*(model.get('fields') or []), *(model.get('calculatedFields') or [])]
        field_by_name = {field.get('referenceName'): field for field in fields}
        columns = []
        for column in generated.get('columns') or []:
            field_item = field_by_name.get(column.get('name'))
            if field_item:
                columns.append({'id': field_item['id'], 'description': column.get('description') or ''})
        payloads.append(
            {
                'modelId': model['id'],
                'data': {
                    'description': generated.get('description') or '',
                    'columns': columns,
                },
            }
        )
    return payloads


def generate_suggested_questions(client: ApiClient, selector: RuntimeSelector) -> dict[str, Any]:
    result = client.request('GET', '/api/v1/suggested-questions', headers=selector.headers(executable=True))
    questions = result.get('questions') if isinstance(result, dict) else result
    return {'count': len(questions or []), 'items': questions or []}


def generate_semantic_descriptions(client: ApiClient, config: dict[str, Any], selector: RuntimeSelector) -> dict[str, Any]:
    if not as_bool(config.get('postImportGeneration', {}).get('semanticDescriptions'), True):
        return {'status': 'SKIPPED'}
    models = list_models(client, selector)
    selected = normalize_str_list(config.get('postImportGeneration', {}).get('selectedModels'))
    if not selected:
        selected = [model.get('referenceName') for model in models if model.get('referenceName')]
    if not selected:
        return {'status': 'SKIPPED', 'reason': 'no models'}
    result = client.request(
        'POST',
        '/api/v1/semantics-descriptions',
        headers=selector.headers(executable=True),
        json_body={'selectedModels': selected, 'userPrompt': config.get('postImportGeneration', {}).get('semanticPrompt') or ''},
        expected=(200,),
    )
    task = poll_task(client, f'/api/v1/semantics-descriptions/{result["id"]}', selector)
    if normalize_text(task.get('status')).upper() != 'FINISHED':
        return {'status': task.get('status'), 'error': task.get('error'), 'taskId': result['id']}
    payloads = build_semantic_metadata_payloads(task.get('response') or [], models)
    saved = 0
    for payload in payloads:
        client.request(
            'PATCH',
            f'/api/v1/models/{payload["modelId"]}/metadata',
            headers=selector.headers(executable=True),
            json_body=payload['data'],
            expected=(200,),
        )
        saved += 1
    return {'status': 'FINISHED', 'taskId': result['id'], 'generatedModels': len(task.get('response') or []), 'savedModels': saved}


def build_relationship_payloads(task: dict[str, Any], models: list[dict[str, Any]]) -> list[dict[str, Any]]:
    model_by_name = {model.get('referenceName'): model for model in models}
    payloads: list[dict[str, Any]] = []
    for relationship in (task.get('response') or {}).get('relationships') or []:
        from_model = model_by_name.get(relationship.get('fromModel'))
        to_model = model_by_name.get(relationship.get('toModel'))
        if not from_model or not to_model:
            continue
        from_fields = [*(from_model.get('fields') or []), *(from_model.get('calculatedFields') or [])]
        to_fields = [*(to_model.get('fields') or []), *(to_model.get('calculatedFields') or [])]
        from_field = find_first(from_fields, lambda item: item.get('referenceName') == relationship.get('fromColumn'))
        to_field = find_first(to_fields, lambda item: item.get('referenceName') == relationship.get('toColumn'))
        if not from_field or not to_field:
            continue
        payloads.append(
            {
                'fromModelId': int(from_model['id']),
                'fromColumnId': int(from_field['id']),
                'toModelId': int(to_model['id']),
                'toColumnId': int(to_field['id']),
                'type': relationship.get('type') or 'MANY_TO_ONE',
                **({'description': relationship.get('reason')} if relationship.get('reason') else {}),
            }
        )
    return payloads


def generate_relationships(client: ApiClient, config: dict[str, Any], selector: RuntimeSelector) -> dict[str, Any]:
    if not as_bool(config.get('postImportGeneration', {}).get('relationships'), True):
        return {'status': 'SKIPPED'}
    models = list_models(client, selector)
    result = client.request('POST', '/api/v1/relationship-recommendations', headers=selector.headers(executable=True), expected=(200,))
    task = poll_task(client, f'/api/v1/relationship-recommendations/{result["id"]}', selector)
    if normalize_text(task.get('status')).upper() != 'FINISHED':
        return {'status': task.get('status'), 'error': task.get('error'), 'taskId': result['id']}
    payloads = build_relationship_payloads(task, models)
    saved = 0
    if payloads:
        saved_result = client.request(
            'POST',
            '/api/v1/relationships/import',
            headers=selector.headers(executable=True),
            json_body={'relations': payloads},
            expected=(200,),
        )
        if isinstance(saved_result, list):
            saved = len(saved_result)
        elif isinstance(saved_result, dict):
            saved = len(saved_result.get('relations') or saved_result.get('items') or payloads)
        else:
            saved = len(payloads) if saved_result is not False else 0
    return {'status': 'FINISHED', 'taskId': result['id'], 'generatedRelationships': len((task.get('response') or {}).get('relationships') or []), 'savedRelationships': saved}


def wait_between_requests(config: dict[str, Any], batch: bool = False) -> None:
    validation = config.get('validation') or {}
    key = 'batchIntervalMs' if batch else 'requestIntervalMs'
    interval = validation.get(key) or ([5000, 10000] if batch else [1000, 3000])
    if isinstance(interval, list) and len(interval) >= 2:
        delay = random.randint(int(interval[0]), int(interval[1])) / 1000.0
    else:
        delay = int(interval or 0) / 1000.0
    if delay > 0:
        time.sleep(delay)


def get_thread_response(client: ApiClient, selector: RuntimeSelector, response_id: Any) -> dict[str, Any]:
    response_id_text = normalize_text(response_id)
    if not response_id_text:
        raise BootstrapError('Thread response id is required')
    return client.request(
        'GET',
        f'/api/v1/thread-responses/{response_id_text}',
        headers=selector.headers(executable=True),
        expected=(200,),
    )


def trigger_text_answer(client: ApiClient, selector: RuntimeSelector, response_id: Any) -> dict[str, Any]:
    response_id_text = normalize_text(response_id)
    if not response_id_text:
        raise BootstrapError('Thread response id is required')
    return client.request(
        'POST',
        f'/api/v1/thread-responses/{response_id_text}/generate-answer',
        headers=selector.headers(executable=True),
        json_body={},
        expected=(200,),
    )


def summarize_answer_state(response: dict[str, Any] | None) -> dict[str, Any]:
    answer_detail = (response or {}).get('answerDetail')
    if not isinstance(answer_detail, dict):
        answer_detail = {}
    content = normalize_text(answer_detail.get('content'))
    error = answer_detail.get('error')
    if isinstance(error, dict):
        error_text = normalize_text(error.get('message') or error.get('code') or error)
    else:
        error_text = normalize_text(error)
    return {
        'answerStatus': normalize_text(answer_detail.get('status')).upper(),
        'hasAnswerContent': bool(content),
        'answerError': error_text,
    }


def is_answer_finished(state: dict[str, Any]) -> bool:
    return state.get('answerStatus') == ANSWER_FINISHED_STATUS and bool(state.get('hasAnswerContent'))


def ensure_text_answer_finished(
    client: ApiClient,
    selector: RuntimeSelector,
    config: dict[str, Any],
    response_id: Any,
    initial_response: dict[str, Any] | None = None,
) -> dict[str, Any]:
    validation = config.get('validation') or {}
    timeout_s = int(validation.get('answerTimeoutSeconds') or validation.get('askTimeoutSeconds') or 420)
    interval_s = float(validation.get('answerPollIntervalSeconds') or 2)
    max_trigger_attempts = int(validation.get('answerGenerationTriggerAttempts') or 2)

    response = initial_response or get_thread_response(client, selector, response_id)
    state = summarize_answer_state(response)
    if is_answer_finished(state):
        return state

    trigger_attempts = 0

    def trigger_once(reason: str) -> dict[str, Any]:
        nonlocal trigger_attempts
        trigger_attempts += 1
        log(f'Triggering text answer for response {response_id} ({reason}, attempt {trigger_attempts}/{max_trigger_attempts})')
        return trigger_text_answer(client, selector, response_id)

    if trigger_attempts < max_trigger_attempts and state.get('answerStatus') not in ANSWER_RUNNING_STATUSES:
        response = trigger_once(state.get('answerStatus') or 'missing answerDetail')
        state = summarize_answer_state(response)

    deadline = time.time() + timeout_s
    last_state = state
    while time.time() < deadline:
        if is_answer_finished(last_state):
            return last_state

        status = normalize_text(last_state.get('answerStatus')).upper()
        if (
            (status in ANSWER_TERMINAL_ERROR_STATUSES or (status == ANSWER_FINISHED_STATUS and not last_state.get('hasAnswerContent')))
            and trigger_attempts < max_trigger_attempts
        ):
            response = trigger_once(status or 'empty answer content')
            last_state = summarize_answer_state(response)
        elif status in ANSWER_TERMINAL_ERROR_STATUSES:
            raise BootstrapError(f'Text answer generation failed for response {response_id}: {last_state.get("answerError") or status}')

        time.sleep(interval_s)
        response = get_thread_response(client, selector, response_id)
        last_state = summarize_answer_state(response)

    raise BootstrapError(f'Text answer generation timed out for response {response_id}; last={last_state}')


def create_thread_from_question(client: ApiClient, selector: RuntimeSelector, config: dict[str, Any], question: str, name: str | None = None) -> dict[str, Any]:
    task = client.request('POST', '/api/v1/asking-tasks', headers=selector.headers(executable=True), json_body={'question': question}, expected=(201,))
    task_id = task.get('id')
    if not task_id:
        raise BootstrapError('Asking task response did not include id')
    task_result = poll_task(client, f'/api/v1/asking-tasks/{task_id}', selector, timeout_s=int((config.get('validation') or {}).get('askTimeoutSeconds') or 420))
    status = normalize_text(task_result.get('status')).upper()
    thread = client.request('POST', '/api/v1/threads', headers=selector.headers(executable=True), json_body={'taskId': task_id, 'question': question}, expected=(201,))
    thread_id = thread.get('id')
    detail = client.request('GET', f'/api/v1/threads/{thread_id}', headers=selector.headers(executable=True))
    responses = detail.get('responses') or []
    response = responses[-1] if responses else {}
    sql = response.get('sql') or ''
    result = {
        'name': name or question[:60],
        'question': question,
        'taskId': task_id,
        'taskStatus': status,
        'threadId': thread_id,
        'responseId': response.get('id'),
        'hasSql': bool(sql),
        'sql': sql,
        'error': task_result.get('error'),
        'diagnostics': (response.get('askingTask') or {}).get('diagnostics') or task_result.get('diagnostics'),
    }
    if result['responseId'] and sql:
        try:
            result.update(ensure_text_answer_finished(client, selector, config, result['responseId'], response))
        except Exception as error:
            result.update(
                {
                    'answerStatus': 'ERROR',
                    'hasAnswerContent': False,
                    'answerError': str(error),
                }
            )
    else:
        result.update(
            {
                'answerStatus': '',
                'hasAnswerContent': False,
                'answerError': 'SQL is missing' if not sql else '',
            }
        )
    return result


def load_core_cases(config: dict[str, Any]) -> list[dict[str, str]]:
    cases = config.get('validation', {}).get('coreCases') or []
    return [{'id': str(case.get('id') or case.get('name') or index + 1), 'question': str(case.get('question') or '').strip()} for index, case in enumerate(cases) if str(case.get('question') or '').strip()]


def run_core_cases(client: ApiClient, config: dict[str, Any], selector: RuntimeSelector) -> list[dict[str, Any]]:
    if not as_bool(config.get('validation', {}).get('runCoreCases'), True):
        return []
    results: list[dict[str, Any]] = []
    for index, case in enumerate(load_core_cases(config), 1):
        log(f'Running core case {case["id"]}')
        try:
            result = create_thread_from_question(client, selector, config, case['question'], case['id'])
            result['status'] = (
                'PASS'
                if result['taskStatus'] == 'FINISHED' and result['hasSql'] and result.get('answerStatus') == ANSWER_FINISHED_STATUS and result.get('hasAnswerContent')
                else 'FAIL'
            )
        except Exception as error:  # keep suite going and report all failed cases
            result = {'name': case['id'], 'question': case['question'], 'status': 'FAIL', 'error': str(error)}
        results.append(result)
        wait_between_requests(config, batch=index % 5 == 0)
    return results


def read_degraded_table_cases(config: dict[str, Any]) -> list[dict[str, str]]:
    csv_path = rel_path(config.get('validation', {}).get('degradedTableCasesCsv') or 'docs/业务需求/csv/16_第一期Excel示例表格降级保存清单.csv')
    with csv_path.open(encoding='utf-8-sig', newline='') as handle:
        reader = csv.DictReader(handle)
        return [dict(row) for row in reader]


def save_degraded_tables(client: ApiClient, config: dict[str, Any], selector: RuntimeSelector) -> list[dict[str, Any]]:
    if not as_bool(config.get('validation', {}).get('saveDegradedTables'), True):
        return []
    results: list[dict[str, Any]] = []
    for index, case in enumerate(read_degraded_table_cases(config), 1):
        test_id = normalize_text(case.get('test_id'))
        question = normalize_text(case.get('recommended_question'))
        table_name = normalize_text(case.get('save_as_data_table_name')) or test_id
        log(f'Running degraded save case {test_id}')
        try:
            ask_result = create_thread_from_question(client, selector, config, question, test_id)
            if not ask_result.get('responseId') or not ask_result.get('hasSql'):
                raise BootstrapError(f'Case {test_id} did not produce SQL')
            spreadsheet = client.request(
                'POST',
                '/api/v1/spreadsheets',
                headers=selector.headers(executable=True),
                json_body={'responseId': ask_result['responseId'], 'name': table_name},
                expected=(201,),
            )
            result = {
                **ask_result,
                'status': (
                    'PASS'
                    if ask_result.get('answerStatus') == ANSWER_FINISHED_STATUS and ask_result.get('hasAnswerContent')
                    else 'FAIL'
                ),
                'spreadsheetId': spreadsheet.get('id'),
                'spreadsheetName': spreadsheet.get('name') or table_name,
            }
        except Exception as error:
            result = {'name': test_id, 'question': question, 'status': 'FAIL', 'error': str(error)}
        results.append(result)
        wait_between_requests(config, batch=index % 5 == 0)
    return results


def write_markdown_report(report_path: Path, report: dict[str, Any]) -> None:
    lines = [
        '# 部署后 TiDB 业务初始化结果',
        '',
        f"- Profile：`{report.get('profile')}`",
        f"- Started：`{report.get('startedAt')}`",
        f"- Finished：`{report.get('finishedAt')}`",
        f"- Workspace：`{(report.get('workspace') or {}).get('id')}` / {(report.get('workspace') or {}).get('name')}",
        f"- Knowledge Base：`{(report.get('knowledgeBase') or {}).get('id')}` / {(report.get('knowledgeBase') or {}).get('name')}",
        f"- Deploy Hash：`{(report.get('knowledgeBase') or {}).get('deployHash')}`",
        '',
        '## 导入计数',
        '',
    ]
    for key, value in (report.get('importCounts') or {}).items():
        lines.append(f'- `{key}`：{value}')
    lines.extend(['', '## 生成结果', ''])
    for key, value in (report.get('generation') or {}).items():
        lines.append(f'- `{key}`：`{value}`')
    lines.extend(['', '## 核心用例', ''])
    for case in report.get('coreCases') or []:
        lines.append(
            f"- `{case.get('name')}`：{case.get('status')} thread={case.get('threadId', '-')} "
            f"response={case.get('responseId', '-')} answer={case.get('answerStatus') or '-'}"
        )
    lines.extend(['', '## 11 张降级数据表保存', ''])
    for item in report.get('savedTables') or []:
        lines.append(
            f"- `{item.get('name')}`：{item.get('status')} spreadsheet={item.get('spreadsheetId', '-')} "
            f"thread={item.get('threadId', '-')} response={item.get('responseId', '-')} answer={item.get('answerStatus') or '-'}"
        )
    if report.get('warnings'):
        lines.extend(['', '## Warnings', ''])
        lines.extend(f'- {item}' for item in report['warnings'])
    if report.get('errors'):
        lines.extend(['', '## Errors', ''])
        lines.extend(f'- {item}' for item in report['errors'])
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text('\n'.join(lines) + '\n', encoding='utf-8')


def should_run(config: dict[str, Any], stage: str) -> bool:
    run_only = config.get('runOnly')
    if not run_only or run_only == 'all':
        return True
    aliases = {
        'prepare': {'preflight', 'seed', 'workspace', 'connection', 'import-assets', 'deploy', 'generate'},
        'cases': {'core-cases', 'save-degraded-tables'},
    }
    allowed = aliases.get(run_only, {run_only})
    return stage in allowed


def run(args: argparse.Namespace) -> int:
    env_path = Path(args.env_file).resolve() if args.env_file else None
    load_env_file(env_path)
    config = apply_cli_overrides(load_config(Path(args.config).resolve(), args.profile), args)
    static = validate_static_inputs(config)
    log(f'Static validation OK: {static}')
    if args.dry_run:
        print(json.dumps({'profile': args.profile, 'static': static, 'configPath': str(Path(args.config).resolve())}, ensure_ascii=False, indent=2))
        return 0

    ui_config = resolve_ui_config(config)
    client = ApiClient(ui_config['baseUrl'], max_429_retries=int((config.get('validation') or {}).get('max429Retries') or 3))
    report = BootstrapReport(profile=args.profile)
    report.environment = {'baseUrl': ui_config['baseUrl'], 'configPath': str(Path(args.config).resolve()), 'envFile': str(env_path) if env_path else None}

    try:
        if should_run(config, 'seed'):
            report.tidb_seed = reset_and_seed_tidb(resolve_tidb_seed_config(config), args.allow_prod_reset, args.profile)
        login_result = login(client, ui_config)
        workspace = ensure_workspace(client, config, login_result)
        selector = RuntimeSelector(workspace_id=workspace['id'])
        report.workspace = {'id': workspace.get('id'), 'name': workspace.get('name'), 'slug': workspace.get('slug')}
        knowledge_base = ensure_knowledge_base(client, config, selector)
        selector.knowledge_base_id = knowledge_base['id']
        selector = update_selector_from_kb(selector, knowledge_base)
        report.knowledge_base = {'id': knowledge_base.get('id'), 'name': knowledge_base.get('name'), 'slug': knowledge_base.get('slug')}

        if should_run(config, 'connection'):
            report.connector = ensure_connection_and_models(client, config, selector)
            _, selector = deploy_and_refresh(client, selector, config)

        if should_run(config, 'import-assets'):
            report.import_counts = import_knowledge_assets(client, config, selector)
            _, selector = deploy_and_refresh(client, selector, config)

        refreshed_kb = refresh_knowledge_base(client, selector, report.knowledge_base.get('name'), report.knowledge_base.get('slug'))
        selector = update_selector_from_kb(selector, refreshed_kb)
        report.knowledge_base.update(
            {
                'defaultKbSnapshotId': refreshed_kb.get('defaultKbSnapshotId'),
                'kbSnapshotId': selector.kb_snapshot_id,
                'deployHash': selector.deploy_hash,
            }
        )

        if should_run(config, 'generate'):
            if as_bool(config.get('postImportGeneration', {}).get('suggestedQuestions'), True):
                report.generation['suggestedQuestions'] = generate_suggested_questions(client, selector)
            semantic_result = generate_semantic_descriptions(client, config, selector)
            report.generation['semanticDescriptions'] = semantic_result
            relationship_result = generate_relationships(client, config, selector)
            report.generation['relationships'] = relationship_result
            if semantic_result.get('savedModels') or relationship_result.get('savedRelationships'):
                _, selector = deploy_and_refresh(client, selector, config)
                refreshed_kb = refresh_knowledge_base(client, selector, report.knowledge_base.get('name'), report.knowledge_base.get('slug'))
                selector = update_selector_from_kb(selector, refreshed_kb)
                report.knowledge_base.update({'kbSnapshotId': selector.kb_snapshot_id, 'deployHash': selector.deploy_hash})

        if should_run(config, 'core-cases'):
            report.core_cases = run_core_cases(client, config, selector)
        if should_run(config, 'save-degraded-tables'):
            report.saved_tables = save_degraded_tables(client, config, selector)
    except Exception as error:
        report.errors.append(str(error))
        raise
    finally:
        report_dir = rel_path(config.get('report', {}).get('outputDir') or DEFAULT_REPORT_DIR)
        report_json = report_dir / 'report.json'
        report_md_tmp = report_dir / 'report.md'
        report_dict = report.to_dict()
        write_json(report_json, report_dict)
        write_markdown_report(report_md_tmp, report_dict)
        docs_report = REPO_ROOT / f'docs/业务需求/部署后TiDB业务初始化结果-{current_date_slug()}.md'
        write_markdown_report(docs_report, report_dict)
        log(f'Report written: {report_json}')
        log(f'Docs report written: {docs_report}')

    failed_core = [item for item in report.core_cases if item.get('status') != 'PASS']
    failed_tables = [item for item in report.saved_tables if item.get('status') != 'PASS']
    if failed_core or failed_tables:
        log(f'Completed with failures: core={len(failed_core)} savedTables={len(failed_tables)}')
        return 2
    log('Completed successfully')
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Post-deploy TiDB business bootstrap runner')
    parser.add_argument('--profile', default='demo', help='Profile in config: demo, prod, test')
    parser.add_argument('--config', default=str(DEFAULT_CONFIG_PATH), help='Bootstrap config JSON')
    parser.add_argument('--env-file', default='', help='Optional env file loaded before config env resolution')
    parser.add_argument('--base-url', default='', help='Override UI base URL')
    parser.add_argument('--dry-run', action='store_true', help='Parse config and source files without network writes')
    parser.add_argument('--prepare-only', action='store_true', help='Prepare workspace/KB/assets but skip ask validation')
    parser.add_argument('--run-cases-only', action='store_true', help='Skip seed/import/generation and run validation cases only')
    parser.add_argument('--run-only', choices=['all', 'preflight', 'seed', 'connection', 'import-assets', 'generate', 'core-cases', 'save-degraded-tables', 'prepare', 'cases'], default='all')
    parser.add_argument('--no-reset-tidb', action='store_true', help='Disable TiDB database reset even if profile enables it')
    parser.add_argument('--allow-prod-reset', action='store_true', help='Allow profile=prod to reset TiDB seed database')
    return parser.parse_args()


if __name__ == '__main__':
    try:
        raise SystemExit(run(parse_args()))
    except BootstrapError as error:
        log(f'FAILED: {error}')
        raise SystemExit(1)
