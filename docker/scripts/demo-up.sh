#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_compose.sh"
ENV_FILE="$(pick_env_file demo)"

env_file_value() {
  local file="$1"
  local key="$2"
  local fallback="$3"
  if [[ -f "${file}" ]]; then
    local line
    line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "${file}" | tail -n 1 || true)"
    if [[ -n "${line}" ]]; then
      line="${line#export }"
      local value="${line#*=}"
      value="${value%%#*}"
      value="${value#"${value%%[![:space:]]*}"}"
      value="${value%"${value##*[![:space:]]}"}"
      if [[ "${value}" == \"*\" && "${value}" == *\" ]]; then
        value="${value:1:${#value}-2}"
      elif [[ "${value}" == \'*\' && "${value}" == *\' ]]; then
        value="${value:1:${#value}-2}"
      fi
      printf '%s' "${value}"
      return
    fi
  fi
  printf '%s' "${fallback}"
}

export TIDB_DEMO_PORT="${TIDB_DEMO_PORT:-$(env_file_value "${ENV_FILE}" TIDB_DEMO_PORT 4001)}"
export TIDB_DEMO_STATUS_PORT="${TIDB_DEMO_STATUS_PORT:-$(env_file_value "${ENV_FILE}" TIDB_DEMO_STATUS_PORT 10081)}"
TIDB_DEMO_ENABLED="${TIDB_DEMO_ENABLED:-$(env_file_value "${ENV_FILE}" TIDB_DEMO_ENABLED false)}"

COMPOSE_ARGS=(
  --project-directory "${DOCKER_DIR}"
  --env-file "${ENV_FILE}"
  -f "${DOCKER_DIR}/compose.yaml"
  -f "${DOCKER_DIR}/compose.prod.yaml"
  -f "${DOCKER_DIR}/compose.test-sources.yaml"
)

case "$(printf '%s' "${TIDB_DEMO_ENABLED}" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes|y|on)
    docker compose "${COMPOSE_ARGS[@]}" --profile tidb up -d tidb-demo
    docker compose "${COMPOSE_ARGS[@]}" --profile tidb up --build -d "$@"
    ;;
  *)
    docker compose "${COMPOSE_ARGS[@]}" up --build -d "$@"
    ;;
esac
