#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_compose.sh"
ENV_FILE="$(pick_env_file dev)"
compose_base "${ENV_FILE}" "${DOCKER_DIR}/compose.dev.yaml" up --build -d --force-recreate engine ibis-server
