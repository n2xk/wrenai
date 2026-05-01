#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PM2_CONFIG="${DOCKER_DIR}/pm2.test.config.cjs"

usage() {
  cat <<'USAGE'
Usage: ./docker/scripts/test-apps-restart.sh [all|ui|ai]

Targets:
  all  Restart both PM2-managed test apps. Default.
  ui   Restart only test-ui.
  ai   Restart only test-ai-service.

If a target process does not exist yet, the script starts it from pm2.test.config.cjs.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 is required to manage test UI / AI Service processes." >&2
  echo "Install it once with: npm install -g pm2" >&2
  exit 127
fi

TARGET="${1:-all}"
case "${TARGET}" in
  all)
    APPS=(test-ai-service test-ui)
    ;;
  ai|ai-service|service)
    APPS=(test-ai-service)
    ;;
  ui)
    APPS=(test-ui)
    ;;
  *)
    echo "Unknown restart target: ${TARGET}" >&2
    usage >&2
    exit 2
    ;;
esac

ensure_started_or_restart() {
  local app="$1"
  if pm2 describe "${app}" >/dev/null 2>&1; then
    pm2 restart "${app}" --update-env
  else
    pm2 start "${PM2_CONFIG}" --only "${app}" --update-env
  fi
}

for app in "${APPS[@]}"; do
  ensure_started_or_restart "${app}"
done

pm2 status "${APPS[@]}"
