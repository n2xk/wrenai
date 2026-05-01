#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${DOCKER_DIR}/.." && pwd)"

pick_env_file() {
  local name="$1"
  local explicit=""

  case "${name}" in
    dev) explicit="${WREN_DOCKER_DEV_ENV_FILE:-}" ;;
    prod) explicit="${WREN_DOCKER_PROD_ENV_FILE:-}" ;;
    *) explicit="" ;;
  esac

  if [[ -n "${explicit}" ]]; then
    echo "${explicit}"
    return
  fi

  if [[ -f "${DOCKER_DIR}/env/${name}.local" ]]; then
    echo "${DOCKER_DIR}/env/${name}.local"
  else
    echo "${DOCKER_DIR}/env/${name}.example"
  fi
}

compose_base() {
  local env_file="$1"
  local override_file="$2"
  shift 2

  docker compose \
    --project-directory "${DOCKER_DIR}" \
    --env-file "${env_file}" \
    -f "${DOCKER_DIR}/compose.yaml" \
    -f "${override_file}" \
    "$@"
}
