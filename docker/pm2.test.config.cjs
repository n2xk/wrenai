const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const dockerDir = __dirname;

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const result = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function resolvePathLike(value) {
  if (!value) {
    return value;
  }
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(repoRoot, value);
}

const envFile = fs.existsSync(path.join(dockerDir, 'env', 'test.local'))
  ? path.join(dockerDir, 'env', 'test.local')
  : path.join(dockerDir, 'env', 'test.example');
const testEnv = parseEnvFile(envFile);

const aiConfigPath = resolvePathLike(
  testEnv.CONFIG_PATH || 'wren-ai-service/config.local.yaml',
);

const aiEnv = {
  WREN_AI_SERVICE_HOST: '127.0.0.1',
  WREN_AI_SERVICE_PORT: '5555',
  PG_CONN_STR: 'postgresql://postgres:postgres@127.0.0.1:9432/wrenai',
  PYTHONUNBUFFERED: '1',
  ...testEnv,
  WREN_AI_SERVICE_RELOAD: 'false',
  WREN_SEMANTICS_PREPARATION_PIPELINE_TIMEOUT_SECONDS: '180',
  CONFIG_PATH: aiConfigPath,
};

const uiEnv = {
  PORT: '3002',
  PG_URL: 'postgres://postgres:postgres@127.0.0.1:9432/wrenai',
  WREN_ENGINE_ENDPOINT: 'http://127.0.0.1:8080',
  WREN_AI_ENDPOINT: 'http://127.0.0.1:5555',
  IBIS_SERVER_ENDPOINT: 'http://127.0.0.1:8000',
  TZ: 'UTC',
  ...testEnv,
};

module.exports = {
  apps: [
    {
      name: 'test-ai-service',
      cwd: path.join(repoRoot, 'wren-ai-service'),
      script: 'poetry',
      args: 'run python -m src.__main__',
      interpreter: 'none',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '5s',
      env: aiEnv,
    },
    {
      name: 'test-ui',
      cwd: path.join(repoRoot, 'wren-ui'),
      script: 'yarn',
      args: 'dev',
      interpreter: 'none',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '5s',
      env: uiEnv,
    },
  ],
};
