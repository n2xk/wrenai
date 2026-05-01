#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_compose.sh"
ENV_FILE="${WREN_DOCKER_TEST_SOURCES_ENV_FILE:-${DOCKER_DIR}/env/test-sources.example}"
if [[ $# -eq 0 ]]; then
  echo "Usage: $0 <profile> [<profile> ...]" >&2
  echo "Example: $0 postgres mysql clickhouse" >&2
  exit 2
fi
if [[ $# -gt 3 ]]; then
  echo "At most 3 test-source profiles may be started at once." >&2
  exit 2
fi

args=(docker compose --project-directory "${DOCKER_DIR}" --env-file "${ENV_FILE}" -f "${DOCKER_DIR}/compose.yaml" -f "${DOCKER_DIR}/compose.test-sources.yaml")
services=()
for profile in "$@"; do
  case "${profile}" in
    postgres) services+=(test-postgres) ;;
    mysql) services+=(test-mysql) ;;
    tidb) services+=(tidb-demo) ;;
    clickhouse) services+=(test-clickhouse) ;;
    mssql) services+=(test-mssql) ;;
    oracle) services+=(test-oracle) ;;
    *) echo "Unknown test-source profile: ${profile}" >&2; exit 2 ;;
  esac
  args+=(--profile "${profile}")
done
"${args[@]}" up -d "${services[@]}"
