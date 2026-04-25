## How to run e2e test locally

1. Make sure you have start all Wren AI services. ([How to start](https://github.com/Canner/WrenAI/blob/main/docker/README.md#how-to-start))

   > Use a dedicated PostgreSQL database for e2e, for example:
   > `createdb -h 127.0.0.1 -p 9432 -U postgres wrenai_e2e`
   > and then `export E2E_PG_URL=postgres://postgres:postgres@127.0.0.1:9432/wrenai_e2e`

2. Create a `e2e.config.json` file under `wren-ui/e2e` folder and replace all data sources needed values in `./config.ts`.

   ```ts
   // Replace the default test config with your own e2e.config.json
   const defaultTestConfig = {
     bigQuery: {
       projectId: 'wrenai',
       datasetId: 'wrenai.tpch_sf1',
       // The credential file should be under "wren-ui" folder
       // For example: .tmp/credential.json
       credentialPath: 'bigquery-credential-path',
     },
     duckDb: {
       sqlCsvPath: 'https://duckdb.org/data/flights.csv',
     },
     postgreSql: {
       host: 'postgresql-host',
       port: '5432',
       username: 'postgresql-username',
       password: 'postgresql-password',
       database: 'postgresql-database',
       ssl: false,
     },
     mysql: {
       host: 'mysql-host',
       port: '3306',
       username: 'mysql-username',
       password: 'mysql-password',
       database: 'mysql-database',
     },
     sqlServer: {
       host: 'sqlServer-host',
       port: '1433',
       username: 'sqlServer-username',
       password: 'sqlServer-password',
       database: 'sqlServer-database',
     },
     trino: {
       host: 'trino-host',
       port: '8081',
       catalog: 'trino-catalog',
       schema: 'trino-schema',
       username: 'trino-username',
       password: 'trino-password',
     },
   };
   ```

3. Build UI before starting e2e server

   ```bash
   yarn build
   ```

   > Ensure port 3000 is available for E2E testing. The AI service needs WREN_UI_ENDPOINT to connect to this port for accurate and reliable test results.

4. Run test

   ```bash
   yarn test:e2e
   ```

   Run test with browser open

   ```bash
   yarn test:e2e --headed
   ```

### Browser launch overrides

The Playwright config accepts a few environment variables so local macOS runs
can switch away from the default headless-shell path when Chrome launch gets
flaky:

- `PW_BROWSER_CHANNEL=chromium` — use the full bundled Chromium app instead of
  `chromium-headless-shell`
- `PW_BROWSER_EXECUTABLE_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
  — point Playwright at a specific browser binary
- `PW_HEADLESS=0` — run headed
- `PW_CONNECT_ENDPOINT_URL=http://127.0.0.1:9222` — attach to an existing
  Chrome/Chromium remote-debugging endpoint instead of launching a browser child
- `PW_CONNECT_WS_ENDPOINT=ws://127.0.0.1:9222/devtools/browser/...` — same as
  above, but with an explicit websocket endpoint

Example when UI/AI services are already running on custom ports:

```bash
PW_SKIP_WEBSERVER=1 \
E2E_BASE_URL=http://127.0.0.1:3002 \
E2E_AI_ENDPOINT=http://127.0.0.1:5555 \
PW_BROWSER_CHANNEL=chromium \
npx playwright test e2e/specs/modelingAssistantTidbReal.spec.ts --project=chromium
```

If local browser child launch is still blocked on macOS, start Chrome yourself
with remote debugging and attach Playwright to it:

```bash
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/wrenai-playwright-debug

PW_SKIP_WEBSERVER=1 \
E2E_BASE_URL=http://127.0.0.1:3002 \
E2E_AI_ENDPOINT=http://127.0.0.1:5555 \
PW_CONNECT_ENDPOINT_URL=http://127.0.0.1:9222 \
npx playwright test e2e/specs/modelingAssistantTidbReal.spec.ts --project=chromium
```

### Modeling AI Assistant real-data specs

#### TiDB real UI flow

The TiDB UI spec can optionally save the generated relationships/semantics back
to the current runtime and will emit screenshots/report artifacts.

```bash
PW_SKIP_WEBSERVER=1 \
E2E_BASE_URL=http://127.0.0.1:3002 \
E2E_AI_ENDPOINT=http://127.0.0.1:5555 \
RUN_MODELING_ASSISTANT_TIDB_REAL=1 \
MODELING_ASSISTANT_TIDB_REAL_SAVE=1 \
MODELING_ASSISTANT_TIDB_REAL_MODEL_LIMIT=3 \
MODELING_ASSISTANT_TIDB_REAL_REPORT_PATH=tmp/modeling-ai-assistant-tidb-real-ui.md \
MODELING_ASSISTANT_TIDB_REAL_ARTIFACT_DIR=tmp/modeling-ai-assistant-tidb-real-artifacts \
npx playwright test e2e/specs/modelingAssistantTidbReal.spec.ts --project=chromium --no-deps
```

#### Quality evaluation on a real runtime selector

The quality evaluation spec supports an external runtime selector, emits a full
JSON artifact per target, and can optionally exercise save verification.

```bash
PW_SKIP_WEBSERVER=1 \
E2E_BASE_URL=http://127.0.0.1:3002 \
E2E_AI_ENDPOINT=http://127.0.0.1:5555 \
RUN_MODELING_ASSISTANT_QUALITY=1 \
MODELING_ASSISTANT_QUALITY_SELECTOR_JSON='{"workspaceId":"...","knowledgeBaseId":"...","kbSnapshotId":"...","deployHash":"..."}' \
MODELING_ASSISTANT_QUALITY_LABEL='TiDB workspace KB' \
MODELING_ASSISTANT_QUALITY_MODEL_LIMIT=3 \
MODELING_ASSISTANT_QUALITY_SAVE=1 \
MODELING_ASSISTANT_QUALITY_REPORT_PATH=tmp/modeling-ai-assistant-quality-evaluation.md \
MODELING_ASSISTANT_QUALITY_ARTIFACT_ROOT=tmp/modeling-ai-assistant-quality-artifacts \
npx playwright test e2e/specs/modelingAssistantQualityEvaluation.spec.ts --project=chromium --no-deps
```

## How to develop

- Write test with interactive UI mode

  ```bash
  yarn test:e2e --ui
  ```

- Write test with debug mode

  ```bash
  yarn test:e2e --debug
  ```

- Generate test scripts

  ```
  npx playwright codegen http://localhost:3000
  ```
