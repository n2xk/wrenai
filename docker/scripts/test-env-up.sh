#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_compose.sh"

ENV_FILE="$(pick_env_file dev)"
compose_base "${ENV_FILE}" "${DOCKER_DIR}/compose.dev.yaml" up --build -d

PROJECT_NAME="$(awk -F= '/^COMPOSE_PROJECT_NAME=/{print $2; exit}' "${ENV_FILE}")"
PROJECT_NAME="${PROJECT_NAME:-local}"
NETWORK_NAME="${PROJECT_NAME}_app"
TIDB_NAME="${TIDB_DEMO_CONTAINER_NAME:-local-tidb-demo}"
TIDB_IMAGE="pingcap/tidb:${TIDB_DEMO_VERSION:-v8.5.4}"
TIDB_VOLUME="${PROJECT_NAME}_tidb_demo_data"
TIDB_PORT="${TIDB_DEMO_PORT:-4000}"
TIDB_STATUS_PORT="${TIDB_DEMO_STATUS_PORT:-10080}"

if docker ps -a --format '{{.Names}}' | grep -qx "${TIDB_NAME}"; then
  docker start "${TIDB_NAME}" >/dev/null
  if ! docker inspect "${TIDB_NAME}" --format '{{json .NetworkSettings.Networks}}' | grep -q "${NETWORK_NAME}"; then
    docker network connect --alias tidb-demo "${NETWORK_NAME}" "${TIDB_NAME}" 2>/dev/null || true
  fi
else
  docker volume create "${TIDB_VOLUME}" >/dev/null
  docker run -d \
    --name "${TIDB_NAME}" \
    --network "${NETWORK_NAME}" \
    --network-alias tidb-demo \
    -p "${TIDB_PORT}:4000" \
    -p "${TIDB_STATUS_PORT}:10080" \
    -v "${TIDB_VOLUME}:/tidb-data" \
    "${TIDB_IMAGE}" \
    --store=unistore \
    --path=/tidb-data >/dev/null
fi

"${SCRIPT_DIR}/test-apps-start.sh"
printf 'Local dev-test environment is up. TiDB demo: %s on 127.0.0.1:%s; PM2 apps: test-ai-service, test-ui\n' "${TIDB_NAME}" "${TIDB_PORT}"
