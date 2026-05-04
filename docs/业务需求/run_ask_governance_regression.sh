#!/usr/bin/env bash
# Run the ask-governance regression bundle used by the 2026-04-30 semantic
# governance rollout. Requires local AI service, TiDB seed DB, and (for HTTP
# smoke without --dry-run) UI service to be running.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

MDL_HASH="${WREN_ROUTE_MDL_HASH:-${WREN_MDL_HASH:-${1:-}}}"
if [[ -z "$MDL_HASH" ]]; then
  cat >&2 <<'USAGE'
Usage: WREN_ROUTE_MDL_HASH=<deployHash> docs/业务需求/run_ask_governance_regression.sh
   or: docs/业务需求/run_ask_governance_regression.sh <deployHash>

Required local services:
  - AI service at ${WREN_AI_ENDPOINT:-http://127.0.0.1:5555}
  - TiDB seed database at ${TIDB_HOST:-127.0.0.1}:${TIDB_PORT:-4000}
Optional for non-dry-run artifact smoke:
  - UI service at ${WREN_UI_ENDPOINT:-http://127.0.0.1:3002}
USAGE
  exit 2
fi

AI_ENDPOINT="${WREN_AI_ENDPOINT:-http://127.0.0.1:5555}"

echo "[ask-governance] 1/6 Offline ask-runtime policy smoke"
if command -v poetry >/dev/null 2>&1; then
  (cd wren-ai-service && poetry run python ../docs/业务需求/verify_ask_runtime_eval_cases.py)
else
  PYTHONPATH="$ROOT_DIR/wren-ai-service:${PYTHONPATH:-}" \
    python docs/业务需求/verify_ask_runtime_eval_cases.py
fi

echo "[ask-governance] 2/6 TiDB seed SQL regression"
python docs/业务需求/verify_tidb_regression.py --extended-seed

echo "[ask-governance] 3/6 Ask route regression"
python docs/业务需求/verify_ask_route_regression.py \
  --ai-endpoint "$AI_ENDPOINT" \
  --mdl-hash "$MDL_HASH" \
  --output docs/业务需求/问数路由回归结果-2026-04-30.md

echo "[ask-governance] 4/6 Business generalization route regression"
python docs/业务需求/verify_business_generalization_regression.py \
  --ai-endpoint "$AI_ENDPOINT" \
  --mdl-hash "$MDL_HASH" \
  --assertions-yaml docs/业务需求/business_generalization_route_assertions.yaml \
  --output docs/业务需求/业务泛化全量路由回归结果-2026-04-30.md \
  --strict

echo "[ask-governance] 5/6 Numeric/UI manual-case verifier"
python docs/业务需求/verify_business_manual_cases.py \
  --ai-endpoint "$AI_ENDPOINT" \
  --mdl-hash "$MDL_HASH" \
  --output docs/业务需求/业务泛化人工核验结果-2026-04-30.md \
  --strict

echo "[ask-governance] 6/6 Artifactization smoke"
ARTIFACT_ARGS=(
  --ui-endpoint "${WREN_UI_ENDPOINT:-http://127.0.0.1:3002}"
  --report docs/业务需求/问数产物化冒烟验证结果-2026-04-30.md
)
case "${WREN_ARTIFACT_SMOKE_DRY_RUN:-1}" in
  0|false|FALSE|no|NO) ;;
  *) ARTIFACT_ARGS+=(--dry-run) ;;
esac
[[ -n "${WREN_WORKSPACE_ID:-}" ]] && ARTIFACT_ARGS+=(--workspace-id "$WREN_WORKSPACE_ID")
[[ -n "${WREN_KNOWLEDGE_BASE_ID:-}" ]] && ARTIFACT_ARGS+=(--knowledge-base-id "$WREN_KNOWLEDGE_BASE_ID")
[[ -n "${WREN_KB_SNAPSHOT_ID:-}" ]] && ARTIFACT_ARGS+=(--kb-snapshot-id "$WREN_KB_SNAPSHOT_ID")
[[ -n "${WREN_DEPLOY_HASH:-}" ]] && ARTIFACT_ARGS+=(--deploy-hash "$WREN_DEPLOY_HASH")
[[ -n "${WREN_THREAD_RESPONSE_ID:-}" ]] && ARTIFACT_ARGS+=(--thread-response-id "$WREN_THREAD_RESPONSE_ID")
[[ -n "${WREN_DASHBOARD_ITEM_ID:-}" ]] && ARTIFACT_ARGS+=(--dashboard-item-id "$WREN_DASHBOARD_ITEM_ID")
[[ -n "${WREN_SPREADSHEET_ID:-}" ]] && ARTIFACT_ARGS+=(--spreadsheet-id "$WREN_SPREADSHEET_ID")
[[ -n "${WREN_AUTHORIZATION:-}" ]] && ARTIFACT_ARGS+=(--authorization "$WREN_AUTHORIZATION")
[[ -n "${WREN_SESSION_COOKIE:-}" ]] && ARTIFACT_ARGS+=(--cookie "$WREN_SESSION_COOKIE")
python docs/业务需求/verify_artifactization_smoke.py "${ARTIFACT_ARGS[@]}"

echo "[ask-governance] done"
