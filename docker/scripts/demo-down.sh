#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_compose.sh"
ENV_FILE="$(pick_env_file demo)"
docker compose \
  --project-directory "${DOCKER_DIR}" \
  --env-file "${ENV_FILE}" \
  -f "${DOCKER_DIR}/compose.yaml" \
  -f "${DOCKER_DIR}/compose.prod.yaml" \
  -f "${DOCKER_DIR}/compose.test-sources.yaml" \
  --profile tidb \
  down "$@"
