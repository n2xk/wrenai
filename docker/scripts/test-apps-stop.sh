#!/usr/bin/env bash
set -euo pipefail
if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 is not installed; nothing to stop via pm2." >&2
  exit 0
fi
pm2 delete test-ai-service test-ui 2>/dev/null || true
