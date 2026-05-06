#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${DOCKER_DIR}/.." && pwd)"

PROFILE="test"
CONFIG=""
ENV_FILE=""
BASE_URL=""
OUT_ROOT=""
DRY_RUN="0"
RUN_ALL="0"
PREPARE="0"
SKIP_RESET="0"
ALLOW_PROD_RESET="0"
RESTART_TEST_APPS="1"
HEADLESS="1"
BATCHES=()

usage() {
  cat <<'USAGE'
Usage: ./docker/scripts/tidb-regression.sh [options]

Unified TiDB business regression orchestrator. It intentionally runs only UI
same-origin product APIs and Playwright browser flows; direct AI-service calls do
not count as E2E evidence.

Options:
  --profile test|demo|prod      Target environment. Default: test.
  --config PATH                 Bootstrap config JSON. Defaults to docker/config/tidb-business-bootstrap*.json.
  --env-file PATH               Env file to load before running cases. Defaults to docker/env/<profile>.local|example.
  --base-url URL                Override UI base URL for API/Playwright runners.
  --reset                       Allow profile config to reset/reseed TiDB in B0. Default for test/demo config is reset.
  --skip-reset                  Disable TiDB reset/reseed even when profile config enables it.
  --allow-prod-reset            Permit prod profile seed reset when explicitly configured.
  --prepare                     Run B0 prepare stage only.
  --batch B0|B1|B2|B3|B4|B5|B6 Run a single batch. Can be repeated.
  --all                         Run all currently automated batches: B0, B1, B2, B5, B6.
  --dry-run                     Validate inputs and print commands without network writes.
  --headed                      Run Playwright in headed mode for UI inspection.
  --no-restart-test-apps        Do not restart PM2 test-ui/test-ai-service before test profile runs.
  --out-dir DIR                 Root artifact dir. Default: wren-ui/tmp/tidb-regression/<timestamp>.
  -h, --help                    Show this help.

Batch mapping:
  B0  Environment reset, TiDB seed, workspace/KB/connector/knowledge assets, deploy, generated suggestions/semantics/relations.
  B1  First-phase degraded Excel table generation and save-to-spreadsheet cases.
  B2  Core T01~T15 business ask cases available in the postdeploy config.
  B3  Productization UI runner placeholder; chart smoke is covered by B5/PX12 until the dedicated runner lands.
  B4  Ordinary ask/routing safety runner placeholder; keep MCP Playwright/manual execution for now.
  B5  Follow-up / clarification / chart smoke Playwright cases.
  B6  FULL external-data supply Playwright cases.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      PROFILE="$2"; shift 2 ;;
    --config)
      CONFIG="$2"; shift 2 ;;
    --env-file)
      ENV_FILE="$2"; shift 2 ;;
    --base-url)
      BASE_URL="$2"; shift 2 ;;
    --out-dir)
      OUT_ROOT="$2"; shift 2 ;;
    --reset)
      # Kept for readability at call sites. Reset behavior is controlled by profile config unless --skip-reset is set.
      SKIP_RESET="0"; shift ;;
    --skip-reset|--no-reset)
      SKIP_RESET="1"; shift ;;
    --allow-prod-reset)
      ALLOW_PROD_RESET="1"; shift ;;
    --prepare)
      PREPARE="1"; shift ;;
    --batch)
      BATCHES+=("$2"); shift 2 ;;
    --all)
      RUN_ALL="1"; shift ;;
    --dry-run)
      DRY_RUN="1"; shift ;;
    --headed)
      HEADLESS="0"; shift ;;
    --no-restart-test-apps)
      RESTART_TEST_APPS="0"; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2 ;;
  esac
done

case "${PROFILE}" in
  test|demo|prod) ;;
  *) echo "Unsupported profile: ${PROFILE}" >&2; exit 2 ;;
esac

if [[ -z "${CONFIG}" ]]; then
  if [[ -f "${DOCKER_DIR}/config/tidb-business-bootstrap.local.json" ]]; then
    CONFIG="${DOCKER_DIR}/config/tidb-business-bootstrap.local.json"
  else
    CONFIG="${DOCKER_DIR}/config/tidb-business-bootstrap.example.json"
  fi
fi

if [[ -z "${ENV_FILE}" ]]; then
  if [[ -f "${DOCKER_DIR}/env/${PROFILE}.local" ]]; then
    ENV_FILE="${DOCKER_DIR}/env/${PROFILE}.local"
  else
    ENV_FILE="${DOCKER_DIR}/env/${PROFILE}.example"
  fi
fi

if [[ -z "${BASE_URL}" ]]; then
  case "${PROFILE}" in
    test) BASE_URL="http://127.0.0.1:3002" ;;
    demo) BASE_URL="http://127.0.0.1:3001" ;;
    prod) BASE_URL="http://127.0.0.1:3000" ;;
  esac
fi

if [[ -z "${OUT_ROOT}" ]]; then
  OUT_ROOT="${REPO_ROOT}/wren-ui/tmp/tidb-regression/$(date +%Y%m%d-%H%M%S)-${PROFILE}"
fi

load_env_file_for_shell() {
  local file="$1"
  local line key value
  [[ -f "${file}" ]] || return 0
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    if [[ "${line}" == export[[:space:]]* ]]; then
      line="${line#export }"
      line="${line#"${line%%[![:space:]]*}"}"
    fi
    [[ "${line}" == *=* ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ "${value}" == \"*\" && "${value}" == *\" ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "${value}" == \'*\' && "${value}" == *\' ]]; then
      value="${value:1:${#value}-2}"
    fi
    [[ -n "${key}" ]] && export "${key}=${value}"
  done < "${file}"
}

load_env_file_for_shell "${ENV_FILE}"

if [[ "${RUN_ALL}" == "1" ]]; then
  BATCHES=(B0 B1 B2 B5 B6)
elif [[ "${PREPARE}" == "1" ]]; then
  BATCHES=(B0)
elif [[ ${#BATCHES[@]} -eq 0 ]]; then
  BATCHES=(B0)
fi

mkdir -p "${OUT_ROOT}"

postdeploy_args() {
  local extra=("$@")
  local args=(--profile "${PROFILE}" --config "${CONFIG}" --env-file "${ENV_FILE}" --base-url "${BASE_URL}")
  if [[ "${SKIP_RESET}" == "1" ]]; then
    args+=(--no-reset-tidb)
  fi
  if [[ "${ALLOW_PROD_RESET}" == "1" ]]; then
    args+=(--allow-prod-reset)
  fi
  if [[ "${DRY_RUN}" == "1" ]]; then
    args+=(--dry-run)
  fi
  printf '%q ' "${SCRIPT_DIR}/postdeploy-tidb-business-bootstrap.sh" "${args[@]}" "${extra[@]}"
}

run_postdeploy() {
  local run_only="$1"
  local cmd=("${SCRIPT_DIR}/postdeploy-tidb-business-bootstrap.sh" --profile "${PROFILE}" --config "${CONFIG}" --env-file "${ENV_FILE}" --base-url "${BASE_URL}" --run-only "${run_only}")
  if [[ "${SKIP_RESET}" == "1" ]]; then
    cmd+=(--no-reset-tidb)
  fi
  if [[ "${ALLOW_PROD_RESET}" == "1" ]]; then
    cmd+=(--allow-prod-reset)
  fi
  if [[ "${DRY_RUN}" == "1" ]]; then
    cmd+=(--dry-run)
    printf '[dry-run] '
    printf '%q ' "${cmd[@]}"
    printf '\n'
    "${cmd[@]}"
    return
  fi
  "${cmd[@]}"
}

report_json_path() {
  # Keep in sync with docker/config/tidb-business-bootstrap.example.json common.report.outputDir.
  printf '%s\n' "${REPO_ROOT}/wren-ui/tmp/postdeploy-tidb-business-bootstrap/report.json"
}

selector_env_file() {
  local report_json
  report_json="$(report_json_path)"
  if [[ ! -f "${report_json}" ]]; then
    echo "Missing postdeploy report: ${report_json}. Run B0 first." >&2
    exit 3
  fi
  python3 - "$report_json" "${BASE_URL}" <<'PY'
import json, shlex, sys
from pathlib import Path
report = json.loads(Path(sys.argv[1]).read_text())
base_url = sys.argv[2]
ws = report.get('workspace') or {}
kb = report.get('knowledgeBase') or {}
values = {
    'BASE_URL': base_url,
    'WORKSPACE_ID': ws.get('id') or '',
    'KNOWLEDGE_BASE_ID': kb.get('id') or '',
    'KB_SNAPSHOT_ID': kb.get('kbSnapshotId') or kb.get('defaultKbSnapshotId') or '',
    'DEPLOY_HASH': kb.get('deployHash') or '',
}
for key, value in values.items():
    print(f'export {key}={shlex.quote(str(value))}')
PY
}

run_playwright_script() {
  local batch="$1"
  local script="$2"
  local batch_out="${OUT_ROOT}/${batch}"
  mkdir -p "${batch_out}"
  if [[ "${DRY_RUN}" == "1" ]]; then
    echo "[dry-run] BASE_URL=${BASE_URL} AUTH_EMAIL=<from env> node ${script} OUT_DIR=${batch_out}"
    return
  fi
  local env_file="${batch_out}/selector.env"
  selector_env_file > "${env_file}"
  # shellcheck disable=SC1090
  source "${env_file}"
  export AUTH_EMAIL="${AUTH_EMAIL:-${WREN_BOOTSTRAP_EMAIL:-}}"
  export AUTH_PASSWORD="${AUTH_PASSWORD:-${WREN_BOOTSTRAP_PASSWORD:-}}"
  export HEADLESS="${HEADLESS}"
  export OUT_DIR="${batch_out}"
  if [[ -z "${AUTH_EMAIL}" || -z "${AUTH_PASSWORD}" ]]; then
    echo "AUTH_EMAIL/AUTH_PASSWORD or WREN_BOOTSTRAP_EMAIL/WREN_BOOTSTRAP_PASSWORD is required for ${script}." >&2
    exit 3
  fi
  (cd "${REPO_ROOT}" && node "${script}")
}

run_gap_notice() {
  local batch="$1"
  local message="$2"
  local notice="${OUT_ROOT}/${batch}-manual-gap.md"
  cat > "${notice}" <<NOTICE
# ${batch} manual/UI runner gap

${message}

当前统一入口不会把该批次标记为通过。执行全量验收时仍需按

docs/业务需求/问数回归测试计划.md

使用 MCP Playwright/Chrome 完成 UI 端到端验证，并把 threadId / responseId / 截图 / 体验问题写入报告。
NOTICE
  echo "[${batch}] runner gap recorded: ${notice}"
}

if [[ "${PROFILE}" == "test" && "${RESTART_TEST_APPS}" == "1" ]]; then
  if [[ "${DRY_RUN}" == "1" ]]; then
    echo "[dry-run] ${SCRIPT_DIR}/test-apps-restart.sh all"
  else
    "${SCRIPT_DIR}/test-apps-restart.sh" all
  fi
fi

printf 'TiDB regression profile=%s baseUrl=%s out=%s batches=%s\n' \
  "${PROFILE}" "${BASE_URL}" "${OUT_ROOT}" "${BATCHES[*]}"

for batch in "${BATCHES[@]}"; do
  case "${batch}" in
    B0)
      run_postdeploy prepare ;;
    B1)
      run_postdeploy save-degraded-tables ;;
    B2)
      run_postdeploy core-cases ;;
    B3)
      run_gap_notice B3 "产品化专项仍需要专门 Playwright runner：重新生成图表、固定到看板、数据表详情/查看 SQL/导出、反馈、诊断、推荐问题卡片。B5/PX12 当前只覆盖图表生成 smoke，不能替代完整 B3。" ;;
    B4)
      run_gap_notice B4 "普通问数 / 路由安全批次仍需要 CSV runner 或 MCP Playwright 执行 OQ/ROUTE/RANK/EDGE 等用例，并验证历史对话可见。" ;;
    B5)
      run_playwright_script B5 "wren-ui/scripts/tidb-followup-special-cases-e2e.mjs" ;;
    B6)
      run_playwright_script B6 "wren-ui/scripts/tidb-full-external-supply-e2e.mjs" ;;
    *)
      echo "Unknown batch: ${batch}" >&2
      exit 2 ;;
  esac
done

cat > "${OUT_ROOT}/summary.md" <<SUMMARY
# TiDB regression run

- Profile: \`${PROFILE}\`
- Base URL: \`${BASE_URL}\`
- Batches: \`${BATCHES[*]}\`
- Output: \`${OUT_ROOT}\`
- Postdeploy report: \`$(report_json_path)\`

Notes:
- This runner uses UI same-origin APIs and Playwright only.
- B3/B4 are explicitly recorded as runner gaps until dedicated UI runners land.
SUMMARY

echo "Regression orchestration finished. Summary: ${OUT_ROOT}/summary.md"
