#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_compose.sh"
MODE="${1:-dev}"
if [[ "${MODE}" == "dev" || "${MODE}" == "prod" || "${MODE}" == "demo" ]]; then
  shift || true
else
  MODE="dev"
fi
ENV_FILE="$(pick_env_file "${MODE}")"
OVERRIDE="${DOCKER_DIR}/compose.${MODE}.yaml"
compose_base "${ENV_FILE}" "${OVERRIDE}" ps "$@"
