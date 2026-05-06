#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PROFILE="demo"
CONFIG=""
ENV_FILE=""
ENV_FILE_EXPLICIT="0"

ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    --config)
      CONFIG="$2"
      ARGS+=("$1" "$2")
      shift 2
      ;;
    --env-file)
      ENV_FILE="$2"
      ENV_FILE_EXPLICIT="1"
      ARGS+=("$1" "$2")
      shift 2
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ -z "${CONFIG}" ]]; then
  if [[ -f "${REPO_ROOT}/docker/config/tidb-business-bootstrap.local.json" ]]; then
    CONFIG="${REPO_ROOT}/docker/config/tidb-business-bootstrap.local.json"
  else
    CONFIG="${REPO_ROOT}/docker/config/tidb-business-bootstrap.example.json"
  fi
  ARGS=("--config" "${CONFIG}" "${ARGS[@]+"${ARGS[@]}"}")
fi

load_env_file_for_shell() {
  local file="$1"
  local line key value
  [[ -f "${file}" ]] || return 0
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    if [[ "${line}" == export[[:space:]]* ]]; then
      line="${line#export }"
      line="${line#"${line%%[![:space:]]*}"}"
    fi
    [[ "${line}" == *=* ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ "${value}" == \"*\" && "${value}" == *\" ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "${value}" == \'*\' && "${value}" == *\' ]]; then
      value="${value:1:${#value}-2}"
    fi
    [[ -n "${key}" ]] && export "${key}=${value}"
  done < "${file}"
}

if [[ "${ENV_FILE_EXPLICIT}" == "0" ]]; then
  ENV_EXAMPLE="${REPO_ROOT}/docker/env/${PROFILE}.example"
  ENV_LOCAL="${REPO_ROOT}/docker/env/${PROFILE}.local"
  if [[ -f "${ENV_EXAMPLE}" ]]; then
    load_env_file_for_shell "${ENV_EXAMPLE}"
    ENV_FILE="${ENV_EXAMPLE}"
  fi
  if [[ -f "${ENV_LOCAL}" ]]; then
    load_env_file_for_shell "${ENV_LOCAL}"
    ENV_FILE="${ENV_LOCAL}"
  fi
  if [[ -n "${ENV_FILE}" ]]; then
    ARGS=("--env-file" "${ENV_FILE}" "${ARGS[@]+"${ARGS[@]}"}")
  fi
elif [[ -n "${ENV_FILE}" ]]; then
  load_env_file_for_shell "${ENV_FILE}"
fi

cd "${REPO_ROOT}"
python3 wren-ui/scripts/postdeploy_tidb_business_bootstrap.py --profile "${PROFILE}" "${ARGS[@]}"
