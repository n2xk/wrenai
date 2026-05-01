#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_compose.sh"
ENV_FILE="${WREN_DOCKER_TEST_SOURCES_ENV_FILE:-${DOCKER_DIR}/env/test-sources.example}"

if [[ $# -eq 0 ]]; then
  services=(test-postgres test-mysql tidb-demo test-clickhouse test-mssql test-oracle)
else
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
  done
fi

docker compose --project-directory "${DOCKER_DIR}" --env-file "${ENV_FILE}" -f "${DOCKER_DIR}/compose.yaml" -f "${DOCKER_DIR}/compose.test-sources.yaml" rm -sfv "${services[@]}"
