#!/usr/bin/env python3
"""Validate knowledge-base markdown import files and preview API payloads.

The script is intentionally dry-run only. It does not write to a Wren workspace;
it checks v1/v2 front matter compatibility and prints the payload shape expected
by the current knowledge APIs.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover - environment guard
    raise SystemExit(
        "PyYAML is required to validate knowledge-base YAML front matter. "
        "Run this through the wren-ai-service poetry env or install PyYAML."
    ) from exc


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
DEFAULT_MANIFEST = SCRIPT_DIR / "import-manifest.sample.yaml"
SUPPORTED_VERSIONS = {"v1", "v2"}
SUPPORTED_TEMPLATE_MODES = {
    "reference",
    "trusted_reference",
    "anchored_template",
    "executable_template",
    # document-friendly aliases
    "reference_example",
}
SQL_STATUS_MAP = {
    # `draft_sql` is the document-side authoring/review state. SQL templates
    # that pass the governed import path are owner/admin approved by the API and
    # must be active in the runtime index; otherwise they are filtered out
    # during ask-template routing and unrelated reference examples may win.
    "draft_sql": "active",
    "spec_only": "draft",
    "blocked_missing_source": "draft",
    "blocked_missing_sql_model": "draft",
    "active": "active",
    "deprecated": "deprecated",
}
FRONT_MATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.DOTALL)
SQL_BLOCK_RE = re.compile(r"```sql\s*(.*?)```", re.DOTALL | re.IGNORECASE)


@dataclass
class ImportIssue:
    level: str
    path: str
    message: str


@dataclass
class ImportPreview:
    path: str
    asset_type: str
    import_target: str
    payloads: list[dict[str, Any]] = field(default_factory=list)


def load_yaml_file(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as f:
        loaded = yaml.safe_load(f) or {}
    if not isinstance(loaded, dict):
        raise ValueError(f"{path} must contain a YAML object")
    return loaded


def resolve_manifest_root(manifest: dict[str, Any], manifest_path: Path) -> Path:
    configured_root = Path(str(manifest.get("root") or SCRIPT_DIR))
    candidates = []
    if configured_root.is_absolute():
        candidates.append(configured_root)
    else:
        candidates.extend(
            [
                (REPO_ROOT / configured_root).resolve(),
                (manifest_path.parent / configured_root).resolve(),
                (SCRIPT_DIR / configured_root).resolve(),
            ]
        )

    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def parse_markdown(path: Path) -> tuple[dict[str, Any], str]:
    text = path.read_text(encoding="utf-8")
    match = FRONT_MATTER_RE.match(text)
    if not match:
        return {}, text
    front_matter = yaml.safe_load(match.group(1)) or {}
    if not isinstance(front_matter, dict):
        raise ValueError(f"{path} front matter must be a YAML object")
    return front_matter, text[match.end() :]


def normalize_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return [value]


def normalize_string_list(value: Any) -> list[str]:
    values: list[str] = []
    for item in normalize_list(value):
        normalized = str(item or "").strip()
        if normalized and normalized not in values:
            values.append(normalized)
    return values


def pick(front_matter: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in front_matter and front_matter[key] not in (None, ""):
            return front_matter[key]
    return default


def camel_signature_key(key: str) -> str:
    aliases = {
        "template_id": "templateId",
        "parameter_slots": "parameterSlots",
        "external_dependencies": "externalDependencies",
        "positive_cues": "positiveCues",
        "negative_cues": "negativeCues",
        "expected_grain": "expectedGrain",
        "result_grain": "resultGrain",
    }
    return aliases.get(key, key)


def normalize_template_mode(value: Any) -> str:
    mode = str(value or "reference").strip()
    if mode == "reference_example":
        return "reference"
    if mode not in SUPPORTED_TEMPLATE_MODES:
        return "reference"
    return mode


def extract_sql(markdown_body: str) -> str:
    match = SQL_BLOCK_RE.search(markdown_body)
    return match.group(1).strip() if match else ""


def build_parameter_schema(front_matter: dict[str, Any]) -> dict[str, Any] | None:
    required_slots = normalize_string_list(
        pick(front_matter, "required_slots", "requiredSlots")
    )
    parameters = normalize_string_list(front_matter.get("parameters"))
    if not required_slots:
        required_slots = parameters
    if not parameters:
        parameters = required_slots
    if not required_slots:
        return None

    schema: dict[str, Any] = {
        "type": "object",
        "required": required_slots,
        "requiredSlots": required_slots,
    }
    if parameters:
        schema["parameters"] = parameters
    dialect = front_matter.get("dialect")
    if isinstance(dialect, str) and dialect.strip():
        schema["dialect"] = dialect.strip()
    parameter_style = pick(front_matter, "parameter_style", "parameterStyle")
    if isinstance(parameter_style, str) and parameter_style.strip():
        schema["parameterStyle"] = parameter_style.strip()
    return schema


def build_business_signature(front_matter: dict[str, Any]) -> dict[str, Any] | None:
    raw_signature = front_matter.get("business_signature") or front_matter.get(
        "businessSignature"
    )
    signature: dict[str, Any] = {}
    if isinstance(raw_signature, dict):
        signature.update(
            {
                camel_signature_key(str(key)): value
                for key, value in raw_signature.items()
                if value not in (None, "")
            }
        )

    overlays = {
        "templateId": front_matter.get("id"),
        "expectedGrain": pick(front_matter, "expected_grain", "result_grain"),
        "positiveCues": pick(front_matter, "positive_scenarios", "positive_cues"),
        "negativeCues": pick(front_matter, "negative_scenarios", "negative_cues"),
        "externalDependencies": pick(
            front_matter, "external_dependencies", "externalDependencies"
        ),
        "parameterSlots": pick(front_matter, "required_slots", "parameters"),
    }
    for key, value in overlays.items():
        if value in (None, ""):
            continue
        if isinstance(value, list) and not value:
            continue
        signature[key] = value

    return signature or None


def build_sql_pair_payloads(
    relative_path: str,
    front_matter: dict[str, Any],
    markdown_body: str,
    issues: list[ImportIssue],
) -> list[dict[str, Any]]:
    sql = extract_sql(markdown_body)
    if not sql:
        issues.append(ImportIssue("error", relative_path, "SQL 模板缺少 ```sql 代码块"))

    questions = normalize_string_list(front_matter.get("question_variants")) or [
        str(front_matter.get("title") or front_matter.get("id") or path.stem)
    ]
    template_mode = normalize_template_mode(front_matter.get("template_type"))
    parameter_schema = build_parameter_schema(front_matter)
    business_signature = build_business_signature(front_matter)
    status = SQL_STATUS_MAP.get(str(front_matter.get("status") or "draft"), "draft")

    if front_matter.get("import_format_version") == "v2":
        if not front_matter.get("template_type"):
            issues.append(
                ImportIssue(
                    "warning",
                    relative_path,
                    "v2 SQL 模板缺少 template_type，已按 reference 预览",
                )
            )
        if template_mode in {
            "anchored_template",
            "executable_template",
        } and not normalize_string_list(front_matter.get("required_slots")):
            issues.append(
                ImportIssue(
                    "warning",
                    relative_path,
                    "硬模板缺少 required_slots，运行时应降级或补齐",
                )
            )
    elif template_mode != "reference":
        issues.append(
            ImportIssue(
                "warning",
                relative_path,
                "v1 模板未显式 template_type，预览已安全降级为 reference",
            )
        )
        template_mode = "reference"

    payloads: list[dict[str, Any]] = []
    for question in questions:
        payload = {
            "question": question,
            "sql": sql,
            "assetKind": "sql_template",
            "templateLevel": "L2",
            "templateMode": template_mode,
            "sourceType": "business_import",
            "scopeType": "knowledge_base",
            "status": status,
        }
        if parameter_schema:
            payload["parameterSchema"] = parameter_schema
        if business_signature:
            payload["businessSignature"] = business_signature
        payloads.append({"apiPath": "/api/v1/knowledge/sql_pairs", "payload": payload})
    return payloads


def build_business_term_payload(front_matter: dict[str, Any]) -> dict[str, Any]:
    return {
        "termId": front_matter.get("id"),
        "name": front_matter.get("name"),
        "category": front_matter.get("category"),
        "aliases": normalize_string_list(front_matter.get("aliases")),
        "definition": front_matter.get("definition"),
        "canonicalExpression": front_matter.get("canonical_expression"),
        "sourceTables": normalize_string_list(front_matter.get("source_tables")),
        "sourceFields": normalize_string_list(front_matter.get("source_fields")),
        "relatedRules": normalize_string_list(front_matter.get("related_rules")),
        "relatedTemplates": normalize_string_list(front_matter.get("related_templates")),
        "features": normalize_string_list(front_matter.get("features")),
        "conflictTerms": normalize_string_list(front_matter.get("conflict_terms")),
        "applicableScenarios": normalize_string_list(
            front_matter.get("applicable_scenarios")
        ),
        "notApplicableScenarios": normalize_string_list(
            front_matter.get("not_applicable_scenarios")
        ),
        "requiredSlots": normalize_string_list(front_matter.get("required_slots")),
        "status": front_matter.get("status") or "draft",
    }


def build_external_dependency_payload(front_matter: dict[str, Any]) -> dict[str, Any]:
    return {
        "dependencyId": front_matter.get("id"),
        "name": front_matter.get("name"),
        "aliases": normalize_string_list(front_matter.get("aliases")),
        "sourceStatus": front_matter.get("source_status") or "missing",
        "missingBehavior": front_matter.get("missing_behavior") or "ask_user",
        "requiredGrain": normalize_string_list(front_matter.get("required_grain")),
        "requiredByTerms": normalize_string_list(front_matter.get("required_by_terms")),
        "requiredByTemplates": normalize_string_list(
            front_matter.get("required_by_templates")
        ),
        "relatedRules": normalize_string_list(front_matter.get("related_rules")),
        "triggerWhen": normalize_string_list(front_matter.get("trigger_when")),
        "notTriggerWhen": normalize_string_list(front_matter.get("not_trigger_when")),
        "lifecycle": front_matter.get("lifecycle") or "per_question",
        "inputModes": normalize_string_list(front_matter.get("input_modes"))
        or ["single_value"],
        "askUserPrompt": front_matter.get("ask_user_prompt"),
        "validation": front_matter.get("validation"),
        "status": front_matter.get("status") or "draft",
    }


def build_instruction_payload(front_matter: dict[str, Any], markdown_body: str) -> dict[str, Any]:
    scope = str(front_matter.get("scope") or "question_match")
    return {
        "instruction": markdown_body.strip(),
        "questions": normalize_string_list(front_matter.get("questions")),
        "isGlobal": scope == "global",
        "isDefault": scope == "global",
        "relatedBusinessTerms": normalize_string_list(
            front_matter.get("related_business_terms")
        ),
        "relatedExternalDependencies": normalize_string_list(
            front_matter.get("related_external_dependencies")
        ),
        "runtimeUsage": front_matter.get("runtime_usage") or {},
    }


def iter_manifest_files(root: Path, section: dict[str, Any]) -> list[Path]:
    paths: list[Path] = []
    for pattern in normalize_string_list(section.get("include_globs")):
        paths.extend(root.glob(pattern))
    return sorted({path for path in paths if path.is_file()})


def should_include(front_matter: dict[str, Any], section: dict[str, Any]) -> bool:
    only_status = set(normalize_string_list(section.get("only_status")))
    if not only_status:
        return True
    return str(front_matter.get("status") or "") in only_status


def is_skipped(front_matter: dict[str, Any], section: dict[str, Any]) -> bool:
    skip_ids = set(normalize_string_list(section.get("skip_ids")))
    if not skip_ids:
        return False
    return str(front_matter.get("id") or "") in skip_ids


def validate_file(
    path: Path, root: Path, section_name: str, issues: list[ImportIssue]
) -> ImportPreview | None:
    front_matter, markdown_body = parse_markdown(path)
    relative_path = str(path.relative_to(root))
    version = str(front_matter.get("import_format_version") or "v1")
    if version not in SUPPORTED_VERSIONS:
        issues.append(ImportIssue("error", relative_path, f"不支持的 import_format_version={version}"))

    asset_type = str(front_matter.get("kb_asset_type") or "")
    import_target = str(front_matter.get("import_target") or "")
    preview = ImportPreview(
        path=relative_path,
        asset_type=asset_type,
        import_target=import_target,
    )

    if section_name == "sql_pairs":
        preview.payloads = build_sql_pair_payloads(
            relative_path,
            front_matter,
            markdown_body,
            issues,
        )
    elif section_name == "business_terms":
        preview.payloads = [
            {
                "apiPath": "/api/v1/knowledge/business_terms",
                "payload": build_business_term_payload(front_matter),
            }
        ]
    elif section_name == "external_dependencies":
        preview.payloads = [
            {
                "apiPath": "/api/v1/knowledge/external_dependencies",
                "payload": build_external_dependency_payload(front_matter),
            }
        ]
    elif section_name == "instructions":
        preview.payloads = [
            {
                "apiPath": "/api/v1/knowledge/instructions",
                "payload": build_instruction_payload(front_matter, markdown_body),
            }
        ]
    else:
        return None

    return preview


def run_validation(args: argparse.Namespace) -> tuple[list[ImportPreview], list[ImportIssue]]:
    manifest_path = Path(args.manifest).resolve()
    manifest = load_yaml_file(manifest_path)
    root = Path(args.root).resolve() if args.root else resolve_manifest_root(manifest, manifest_path)
    issues: list[ImportIssue] = []
    previews: list[ImportPreview] = []

    for section_name in (
        "sql_pairs",
        "instructions",
        "business_terms",
        "external_dependencies",
    ):
        if args.target != "all" and args.target != section_name:
            continue
        section = manifest.get(section_name) or {}
        if not isinstance(section, dict):
            continue
        for path in iter_manifest_files(root, section):
            front_matter, _ = parse_markdown(path)
            if not should_include(front_matter, section):
                continue
            if is_skipped(front_matter, section):
                continue
            preview = validate_file(path, root, section_name, issues)
            if preview:
                previews.append(preview)

    return previews, issues


def render_summary(previews: list[ImportPreview], issues: list[ImportIssue]) -> str:
    counts: dict[str, int] = {}
    payload_count = 0
    for preview in previews:
        counts[preview.import_target] = counts.get(preview.import_target, 0) + 1
        payload_count += len(preview.payloads)

    lines = [
        "# Knowledge Base 导入格式 dry-run",
        "",
        f"- 文件数：{len(previews)}",
        f"- 预览 payload 数：{payload_count}",
        f"- error：{sum(1 for issue in issues if issue.level == 'error')}",
        f"- warning：{sum(1 for issue in issues if issue.level == 'warning')}",
        "",
        "## 资产计数",
        "",
    ]
    for target, count in sorted(counts.items()):
        lines.append(f"- `{target}`：{count}")
    if issues:
        lines.extend(["", "## 问题", ""])
        for issue in issues:
            lines.append(f"- **{issue.level}** `{issue.path}`：{issue.message}")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
    parser.add_argument("--root", default="")
    parser.add_argument(
        "--target",
        choices=["all", "sql_pairs", "instructions", "business_terms", "external_dependencies"],
        default="all",
    )
    parser.add_argument("--format", choices=["summary", "json"], default="summary")
    parser.add_argument("--output", default="")
    parser.add_argument("--strict", action="store_true", help="Treat warnings as failures")
    args = parser.parse_args()

    previews, issues = run_validation(args)
    error_count = sum(1 for issue in issues if issue.level == "error")
    warning_count = sum(1 for issue in issues if issue.level == "warning")

    if args.format == "json":
        rendered = json.dumps(
            {
                "previews": [preview.__dict__ for preview in previews],
                "issues": [issue.__dict__ for issue in issues],
            },
            ensure_ascii=False,
            indent=2,
        )
    else:
        rendered = render_summary(previews, issues)

    if args.output:
        Path(args.output).write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)

    if error_count or (args.strict and warning_count):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
