# WrenAI Docker Runtime

本目录负责本地开发测试、生产 / 演示完整栈和外部数据源验证的运行层，按用途拆成四类：

1. 本机标准开发测试环境：`test-env-up.sh` 启动 Docker 依赖层、TiDB demo，并用 PM2 管理源码 UI / AI Service。日常开发验证和问数全量回归默认使用这一套。
2. 依赖层高级入口：`dev-up.sh` 只启动 PostgreSQL / Wren Engine / Ibis Server / Trino，不启动 TiDB、UI、AI Service；仅用于手动调试或诊断。
3. 单机生产 / 演示完整栈：从本仓库本地源码构建 UI、AI Service、Engine、Ibis 镜像，并容器化运行 Trino、PostgreSQL；模型接入通过外部 LiteLLM proxy。
4. 外部数据源连接验证：按 profile 临时启动 Docker 测试数据源，同一时间最多保留 3 个。

## 目录结构

```text
docker/
  compose.yaml              # 公共依赖层：postgres / engine / ibis-server / trino
  compose.dev.yaml          # dependency-only override：不启动 TiDB / UI / AI Service
  compose.prod.yaml         # 单机完整栈 override：本地构建并启动 UI / AI Service；模型走外部 LiteLLM
  compose.test-sources.yaml # 外部数据源测试 profile
  env/                      # 环境变量模板；*.local 为本地私有文件，不提交
  config/                   # AI Service 配置模板；*.local.yaml 不提交
  trino/catalog/            # 运行时 catalog 目录；*.properties 不提交
  trino/catalog-templates/  # catalog 示例模板
  scripts/                  # 标准启动、停止、重建、日志脚本
  data/                     # 本地运行数据目录；内容不提交
```

## 本机标准开发测试环境（默认）

当前本机主路径是 `test-env`：它会启动 Docker 依赖层、TiDB demo，并用 PM2 管理源码 UI / AI Service。日常开发验证、问数调试、严格 UI E2E 回归都优先使用这一套。

首次准备本地私密环境变量：

```bash
cp docker/env/test.example docker/env/test.local
# 然后在 docker/env/test.local 填 OPENROUTER_API_KEY / OPENAI_API_KEY 等私密 key
```

启动：

```bash
./docker/scripts/test-env-up.sh
```

`test-env-up.sh` 会启动：

- Docker：`postgres`、`engine`、`ibis-server`、`trino`、`local-tidb-demo`
- PM2：`test-ai-service`、`test-ui`

默认端口：

- `test-ui`：`127.0.0.1:3002`
- `test-ai-service`：`127.0.0.1:5555`
- `local-tidb-demo`：`127.0.0.1:4000`，status `127.0.0.1:10080`
- PostgreSQL：`127.0.0.1:9432`
- Engine：`127.0.0.1:8080`，SQL port `127.0.0.1:7432`
- Ibis Server：`127.0.0.1:8000`
- Trino：`127.0.0.1:8081`

重启 PM2 管理的源码应用：

```bash
# 重启 UI + AI Service
./docker/scripts/test-apps-restart.sh all

# 只重启 UI
./docker/scripts/test-apps-restart.sh ui

# 只重启 AI Service
./docker/scripts/test-apps-restart.sh ai
```

如果目标 PM2 进程不存在，脚本会从 `docker/pm2.test.config.cjs` 自动启动对应进程。

停止完整开发测试环境：

```bash
./docker/scripts/test-env-down.sh
```

查看状态 / 日志：

```bash
./docker/scripts/ps.sh
./docker/scripts/logs.sh
pm2 status test-ai-service test-ui
```

## 高级入口：只启动依赖层

`dev-up.sh` 只启动 PostgreSQL、engine、ibis-server、Trino，不启动 TiDB，也不启动 UI / AI Service。它不是当前主开发入口，仅用于手动用 background terminal 启动源码应用、排查依赖层问题或做最小依赖验证。

```bash
./docker/scripts/dev-up.sh
```

停止依赖层：

```bash
./docker/scripts/dev-down.sh
```

如确实需要手动启动源码应用，等价命令是：

```bash
# UI：3002
cd wren-ui
PORT=3002 PG_URL=postgres://postgres:postgres@127.0.0.1:9432/wrenai TZ=UTC yarn dev

# AI Service：5555
cd wren-ai-service
PG_CONN_STR=postgresql://postgres:postgres@127.0.0.1:9432/wrenai poetry run python -m src.__main__
```

## 修改 engine / ibis-server 后重建

`wren-engine/` 是本仓库内的普通源码目录。修改 engine 或 ibis-server 后，需要重建对应镜像并重启容器：

```bash
./docker/scripts/rebuild-engine.sh
```

如果只想预构建本地镜像，不重启 Compose 服务：

```bash
./docker/scripts/build-local-engine-images.sh
```

## 单机完整栈 / 生产部署

生产完整栈复用 `compose.yaml + compose.prod.yaml`，会从当前仓库源码构建 UI / AI Service / engine / ibis 镜像，并使用独立镜像 tag 与 Trino catalog 目录，避免和本地 dev/test 互相覆盖。会启动：

- `ui`
- `ai-service`
- `engine`
- `ibis-server`
- `trino`
- `postgres`

先复制并修改本地私有配置：

```bash
cp docker/env/prod.example docker/env/prod.local
cp docker/config/ai.config.example.yaml docker/config/ai.config.local.yaml
```

然后在 `docker/env/prod.local` 中设置：

```text
AI_SERVICE_ENV_FILE=./env/prod.local
AI_CONFIG_FILE=./config/ai.config.local.yaml
LITELLM_API_BASE=https://your-litellm.example.com/v1
LITELLM_API_KEY=sk-...
LITELLM_GENERATION_MODEL=wren-generation
LITELLM_EMBEDDING_MODEL=wren-embedding
```

生产默认隔离点：

- UI 镜像 tag：`wren-ui:prod`
- AI Service 镜像 tag：`wren-ai-service:prod`
- Engine 镜像 tag：`wren-engine:prod`
- Ibis Server 镜像 tag：`wren-engine-ibis:prod`
- Trino catalog 目录：`docker/trino/prod-catalog`

生产 / 演示环境的 LLM 统一通过外部 LiteLLM proxy：

```text
AI Service -> https://your-litellm.example.com/v1 -> OpenRouter / 其他上游 provider
```

默认占位模型：

- LiteLLM generation alias：`wren-generation`
- LiteLLM embedding alias：`wren-embedding`
- Embedding dimension：`4096`

真实上游模型、provider 顺序、限流和 fallback 由外部 LiteLLM 服务管理，不由本 Compose 栈启动。

启动生产完整栈：

```bash
./docker/scripts/prod-up.sh
```

停止生产完整栈：

```bash
./docker/scripts/prod-down.sh
```

生产建议：正式环境优先使用外部 / 托管 PostgreSQL，并通过 `PG_URL`、`PG_CONN_STR` 指向外部数据库；Compose 内置 `postgres` 更适合本地演示、小规模验证。

## 演示环境完整栈

演示环境和生产环境使用同一套 Compose 服务形态，且 UI / AI Service 均从当前仓库本地源码构建；demo 使用独立 env、project name、端口、Docker volume namespace、本地文件存储和 Trino catalog 目录，默认可以和本地 dev/test 共存。

默认隔离点：

- UI 镜像 tag：`wren-ui:demo`
- AI Service 镜像 tag：`wren-ai-service:demo`
- Engine 镜像 tag：`wren-engine:demo`
- Ibis Server 镜像 tag：`wren-engine-ibis:demo`
- Engine/Ibis/AI Service 本地文件存储：`docker/data/demo`
- Trino catalog 目录：`docker/trino/demo-catalog`

先复制并修改本地私有配置：

```bash
cp docker/env/demo.example docker/env/demo.local
cp docker/config/ai.config.example.yaml docker/config/ai.config.local.yaml
```

然后在 `docker/env/demo.local` 中设置：

```text
AI_SERVICE_ENV_FILE=./env/demo.local
AI_CONFIG_FILE=./config/ai.config.local.yaml
LITELLM_API_BASE=https://your-litellm.example.com/v1
LITELLM_API_KEY=sk-...
LITELLM_GENERATION_MODEL=wren-generation
LITELLM_EMBEDDING_MODEL=wren-embedding
```

### 启动时产品初始化

demo 环境默认开启启动初始化：

```text
WREN_AUTO_BOOTSTRAP=true
WREN_BOOTSTRAP_EMAIL=demo@example.com
WREN_BOOTSTRAP_PASSWORD=demo-password-change-me
WREN_BOOTSTRAP_DISPLAY_NAME=Demo Owner
```

UI 容器启动流程会先执行 migration，再启动 Next.js standalone server；随后等待 UI、engine、ibis-server、AI Service 可达，并调用现有 `/api/auth/bootstrap` 创建首个 owner，同时创建默认 workspace、系统样例知识库、样例模型 / 关系 / 看板并部署到 AI Service。

对外演示前必须在 `docker/env/demo.local` 修改 `WREN_BOOTSTRAP_EMAIL` / `WREN_BOOTSTRAP_PASSWORD`。生产环境默认关闭该能力；只有明确设置 `WREN_AUTO_BOOTSTRAP=true` 并提供邮箱 / 密码时才会执行。

### 临时 OpenRouter smoke 测试

如果外部 LiteLLM 暂时还没准备好，但需要验证 `demo-up.sh`、镜像构建、端口和服务编排是否正常，可以临时让 demo AI Service 直连 OpenRouter。只在 `docker/env/demo.local` 中覆盖：

```text
AI_CONFIG_FILE=./config/ai.config.openrouter-smoke.example.yaml
OPENROUTER_API_KEY=sk-or-...
GENERATION_MODEL=openrouter/deepseek/deepseek-v4-flash
```

此 smoke 配置不代表最终演示 / 生产模型接入方式；最终仍应切回 `AI_CONFIG_FILE=./config/ai.config.local.yaml` 并接外部 LiteLLM。

启动演示完整栈：

```bash
./docker/scripts/demo-up.sh
```

停止演示完整栈：

```bash
./docker/scripts/demo-down.sh
```

默认演示端口：

- UI：`127.0.0.1:3001`
- AI Service：`127.0.0.1:5556`
- PostgreSQL：`127.0.0.1:9433`
- Engine：`127.0.0.1:18080`
- Ibis Server：`127.0.0.1:18000`
- Trino：`127.0.0.1:18081`
- TiDB：默认不启动；本机 smoke 可在 `docker/env/demo.local` 设置 `TIDB_DEMO_ENABLED=true`，端口为 `127.0.0.1:4001`


## 部署后 TiDB 业务初始化

生产 / 演示 / 本机回归环境部署完成后，可以用同一套 post-deploy runner 自动创建 TiDB 业务 workspace / knowledge base、配置 TiDB 连接、导入业务知识资产、生成 suggested questions / 语义提示 / 关联关系，并执行核心问数 smoke 与 11 张降级数据表保存：

```bash
./docker/scripts/postdeploy-tidb-business-bootstrap.sh --profile demo --dry-run
./docker/scripts/postdeploy-tidb-business-bootstrap.sh --profile demo
```

配置模板：`docker/config/tidb-business-bootstrap.example.json`。TiDB 连接分为脚本 seed 侧 `TIDB_SEED_*` 和 Wren 产品连接侧 `TIDB_CONNECTOR_*`：开发测试默认启动本地 Docker TiDB 并 seed；演示 / 生产默认不启动内置 TiDB、不 seed，必须通过 `TIDB_CONNECTOR_*` 指向真实或显式配置的 TiDB。详见 `docs/业务需求/部署后TiDB业务初始化说明.md`。

## 外部数据源连接验证

测试数据源通过 profile 启动，例如：

```bash
./docker/scripts/test-sources-up.sh postgres mysql clickhouse
```

约束：

- 同一时间最多启动 3 个测试数据源 profile。
- 每批测试完成后先清理，再启动下一批。
- BigQuery / Snowflake / Redshift / Athena / Databricks 这类云服务不标记为“Docker 可完整验证”，需要真实云凭证或专门的 smoke / emulator 方案。

停止测试数据源，不会停止本地依赖层：

```bash
# 清理全部测试数据源容器和对应匿名/命名 volume
./docker/scripts/test-sources-down.sh

# 或只清理某几个 profile
./docker/scripts/test-sources-down.sh postgres mysql
```

## Trino catalog

运行时 catalog 默认写入：

```text
docker/trino/catalog/*.properties
```

可通过 `TRINO_CATALOG_HOST_DIR` 按环境隔离；prod/demo 默认分别写入：

```text
docker/trino/prod-catalog/*.properties
docker/trino/demo-catalog/*.properties
```

这些文件是本地运行产物，不提交。示例模板放在：

```text
docker/trino/catalog-templates/
```

## 环境文件约定

提交到仓库：

- `docker/env/*.example`
- `docker/config/ai.config.example.yaml`
- `docker/config/ai.config.openrouter-smoke.example.yaml`
- `docker/config/tidb-business-bootstrap.example.json`
- `docker/trino/catalog-templates/*.properties`

不提交：

- `docker/env/*.local`，例如 `docker/env/test.local` 里的 LLM API key
- `docker/config/*.local.yaml`
- `docker/config/*.local.json`
- `docker/trino/catalog/*.properties`
- `docker/trino/*-catalog/*.properties`
- `docker/data/*`
