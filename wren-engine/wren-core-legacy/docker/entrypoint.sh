#!/bin/bash
set -e

export ENV_MAX_HEAP_SIZE=$2
export ENV_MIN_HEAP_SIZE=$3

ETC_DIR="${WREN_ENGINE_ETC_DIR:-etc}"
CONFIG_FILE="${ETC_DIR}/config.properties"
MDL_DIR="${ETC_DIR}/mdl"
SAMPLE_MDL_FILE="${MDL_DIR}/sample.json"

mkdir -p "${MDL_DIR}"

if [ ! -f "${CONFIG_FILE}" ]; then
  echo "init ${CONFIG_FILE}"
  echo "node.environment=production" >"${CONFIG_FILE}"
elif ! grep -q "^node.environment=" "${CONFIG_FILE}"; then
  echo "node.environment is not set, set it to production"
  echo "node.environment=production" >>"${CONFIG_FILE}"
fi

if ! grep -q "^wren.experimental-enable-dynamic-fields=" "${CONFIG_FILE}"; then
  echo "wren.experimental-enable-dynamic-fields is not set, set it to true"
  echo "wren.experimental-enable-dynamic-fields=true" >>"${CONFIG_FILE}"
fi

if [ ! -f "${SAMPLE_MDL_FILE}" ]; then
  echo "init ${SAMPLE_MDL_FILE}"
  echo "{\"catalog\": \"test_catalog\", \"schema\": \"test_schema\", \"models\": []}" >"${SAMPLE_MDL_FILE}"
fi

# Required add-opens=java.nio=ALL-UNNAMED for Apache arrow in the Snowflake
exec java -Xmx${ENV_MAX_HEAP_SIZE:-"512m"} -Xms${ENV_MIN_HEAP_SIZE:-"64m"}  -Dconfig="${CONFIG_FILE}" \
     --add-opens=java.base/java.nio=ALL-UNNAMED \
     -jar "$1"
