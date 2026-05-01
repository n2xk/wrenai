#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_compose.sh"
ENV_FILE="$(pick_env_file prod)"
compose_base "${ENV_FILE}" "${DOCKER_DIR}/compose.prod.yaml" down "$@"
