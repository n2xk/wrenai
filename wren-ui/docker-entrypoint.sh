#!/bin/sh
set -eu

log() {
  printf '[wren-ui-entrypoint] %s\n' "$*"
}

is_true() {
  case "${1:-}" in
    true|TRUE|1|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

wait_for_http() {
  name="$1"
  url="$2"
  timeout_seconds="${3:-120}"
  start_ts=$(date +%s)
  while true; do
    status=$(curl -sS -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)
    if [ "$status" != "000" ]; then
      log "$name is reachable at $url (http $status)"
      return 0
    fi
    now_ts=$(date +%s)
    elapsed=$((now_ts - start_ts))
    if [ "$elapsed" -ge "$timeout_seconds" ]; then
      log "timed out waiting for $name at $url"
      return 1
    fi
    sleep 2
  done
}

wait_for_runtime_dependencies() {
  timeout="${WREN_BOOTSTRAP_WAIT_TIMEOUT_SECONDS:-180}"

  if [ -n "${WREN_ENGINE_ENDPOINT:-}" ]; then
    wait_for_http 'wren-engine' "$WREN_ENGINE_ENDPOINT" "$timeout"
  fi
  if [ -n "${IBIS_SERVER_ENDPOINT:-}" ]; then
    wait_for_http 'ibis-server' "$IBIS_SERVER_ENDPOINT/docs" "$timeout"
  fi
  if [ -n "${WREN_AI_ENDPOINT:-}" ]; then
    wait_for_http 'wren-ai-service' "$WREN_AI_ENDPOINT/health" "$timeout"
  fi
}

run_startup_bootstrap() {
  if ! is_true "${WREN_AUTO_BOOTSTRAP:-false}"; then
    log 'startup owner bootstrap disabled'
    return 0
  fi

  email="${WREN_BOOTSTRAP_EMAIL:-}"
  password="${WREN_BOOTSTRAP_PASSWORD:-}"
  display_name="${WREN_BOOTSTRAP_DISPLAY_NAME:-Demo Owner}"
  locale="${WREN_BOOTSTRAP_LOCALE:-zh-CN}"
  required="${WREN_AUTO_BOOTSTRAP_REQUIRED:-false}"

  if [ -z "$email" ] || [ -z "$password" ]; then
    log 'startup owner bootstrap skipped: WREN_BOOTSTRAP_EMAIL and WREN_BOOTSTRAP_PASSWORD are required'
    if is_true "$required"; then
      return 1
    fi
    return 0
  fi

  timeout="${WREN_BOOTSTRAP_WAIT_TIMEOUT_SECONDS:-180}"
  wait_for_http 'wren-ui' "http://127.0.0.1:${PORT:-3000}" "$timeout" || {
    is_true "$required" && return 1 || return 0
  }

  payload=$(node -e '
    const payload = {
      email: process.env.WREN_BOOTSTRAP_EMAIL,
      password: process.env.WREN_BOOTSTRAP_PASSWORD,
      displayName: process.env.WREN_BOOTSTRAP_DISPLAY_NAME || "Demo Owner",
      locale: process.env.WREN_BOOTSTRAP_LOCALE || "zh-CN",
    };
    process.stdout.write(JSON.stringify(payload));
  ')
  response_file=$(mktemp)
  status=$(curl -sS -o "$response_file" -w '%{http_code}' \
    -X POST "http://127.0.0.1:${PORT:-3000}/api/auth/bootstrap" \
    -H 'Content-Type: application/json' \
    --data "$payload" || true)
  response_body=$(cat "$response_file")
  rm -f "$response_file"

  case "$status" in
    200|201)
      log "startup owner bootstrap completed for $email"
      ;;
    400)
      case "$response_body" in
        *'Bootstrap is only allowed on a fresh instance'*)
          log 'startup owner bootstrap skipped: instance already has an owner'
          ;;
        *)
          log "startup owner bootstrap failed with HTTP $status: $response_body"
          is_true "$required" && return 1 || return 0
          ;;
      esac
      ;;
    *)
      log "startup owner bootstrap failed with HTTP $status: $response_body"
      is_true "$required" && return 1 || return 0
      ;;
  esac
}

log 'running database migrations'
yarn knex migrate:latest

log 'waiting for runtime dependencies'
wait_for_runtime_dependencies

log 'starting Next.js standalone server'
HOSTNAME="${WREN_UI_HOSTNAME:-0.0.0.0}" node server.js &
server_pid=$!

terminate() {
  log 'stopping Next.js standalone server'
  kill -TERM "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
}
trap terminate INT TERM

(
  run_startup_bootstrap || {
    log 'startup owner bootstrap marked required and failed; stopping server'
    kill -TERM "$server_pid" 2>/dev/null || true
  }
) &

wait "$server_pid"
