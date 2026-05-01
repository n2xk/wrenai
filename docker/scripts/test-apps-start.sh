#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 is required to manage test UI / AI Service processes." >&2
  echo "Install it once with: npm install -g pm2" >&2
  exit 127
fi

pm2 start "${DOCKER_DIR}/pm2.test.config.cjs" --update-env
pm2 status test-ai-service test-ui
