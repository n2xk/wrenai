#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_compose.sh"

"${SCRIPT_DIR}/test-apps-stop.sh"

TIDB_NAME="${TIDB_DEMO_CONTAINER_NAME:-local-tidb-demo}"
if docker ps -a --format '{{.Names}}' | grep -qx "${TIDB_NAME}"; then
  docker stop "${TIDB_NAME}" >/dev/null || true
fi

ENV_FILE="$(pick_env_file dev)"
compose_base "${ENV_FILE}" "${DOCKER_DIR}/compose.dev.yaml" down "$@"
