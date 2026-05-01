# WrenAI Docker Runtime

本目录只负责 **Docker 化运行层**，按用途拆成三类：

1. 本地开发依赖层：Docker 跑 PostgreSQL / Wren Engine / Ibis Server / Trino，UI 和 AI Service 在宿主机用源码启动。
2. 单机生产 / 演示完整栈：UI、AI Service、Engine、Ibis、Trino、PostgreSQL 全部容器化。
3. 外部数据源连接验证：按 profile 临时启动 Docker 测试数据源，同一时间最多保留 3 个。

## 目录结构

```text
docker/
  compose.yaml              # 公共依赖层：postgres / engine / ibis-server / trino
  compose.dev.yaml          # 本地开发 override：不启动 UI / AI Service
  compose.prod.yaml         # 单机完整栈 override：启动 UI / AI Service
  compose.test-sources.yaml # 外部数据源测试 profile
  env/                      # 环境变量模板；*.local 为本地私有文件，不提交
  config/                   # AI Service 配置模板；*.local.yaml 不提交
  trino/catalog/            # 运行时 catalog 目录；*.properties 不提交
  trino/catalog-templates/  # catalog 示例模板
  scripts/                  # 标准启动、停止、重建、日志脚本
  data/                     # 本地运行数据目录；内容不提交
```

## 本地开发：只启动依赖层

默认开发依赖层：

```bash
./docker/scripts/dev-up.sh
```

这会启动：

- `postgres`
- `engine`
- `ibis-server`
- `trino`

不会启动：

- `ui`
- `ai-service`
- `local-tidb-demo`

如果要达到当前问数回归测试环境效果，先准备本地测试环境变量：

```bash
cp docker/env/test.example docker/env/test.local
# 然后在 docker/env/test.local 填 OPENROUTER_API_KEY / OPENAI_API_KEY 等私密 key
```

再启动：

```bash
./docker/scripts/test-env-up.sh
```

`test-env-up.sh` 会启动开发依赖层，确保 `local-tidb-demo` 存在并运行在 `127.0.0.1:4000`，同时用 PM2 管理 UI / AI Service 两个源码进程。PM2 会优先读取 `docker/env/test.local`，没有则退回 `docker/env/test.example`。

PM2 会启动：

- `test-ai-service`：`127.0.0.1:5555`
- `test-ui`：`127.0.0.1:3002`

等价源码命令：

```bash
# UI：3002
cd wren-ui
PORT=3002 PG_URL=postgres://postgres:postgres@127.0.0.1:9432/wrenai TZ=UTC yarn dev

# AI Service：5555
cd wren-ai-service
PG_CONN_STR=postgresql://postgres:postgres@127.0.0.1:9432/wrenai poetry run python -m src.__main__
```

停止本地依赖层：

```bash
./docker/scripts/dev-down.sh
```

停止 PM2 管理的测试应用进程：

```bash
./docker/scripts/test-apps-stop.sh
```

重启 PM2 管理的测试应用进程：

```bash
# 重启 UI + AI Service
./docker/scripts/test-apps-restart.sh

# 只重启 UI
./docker/scripts/test-apps-restart.sh ui

# 只重启 AI Service
./docker/scripts/test-apps-restart.sh ai
```

如果目标 PM2 进程不存在，脚本会从 `docker/pm2.test.config.cjs` 自动启动对应进程。

停止完整测试环境：

```bash
./docker/scripts/test-env-down.sh
```

查看状态 / 日志：

```bash
./docker/scripts/ps.sh
./docker/scripts/logs.sh
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

## 单机完整栈 / 演示部署

先复制并修改本地私有配置：

```bash
cp docker/env/prod.example docker/env/prod.local
cp docker/config/ai.config.example.yaml docker/config/ai.config.local.yaml
```

然后在 `docker/env/prod.local` 中设置：

```text
AI_SERVICE_ENV_FILE=./env/prod.local
AI_CONFIG_FILE=./config/ai.config.local.yaml
OPENROUTER_API_KEY=...
# 当前默认模型和 embedder 均通过 OpenRouter / LiteLLM 路由
```


当前 `docker/config/ai.config.example.yaml` 与 `wren-ai-service/config.local.yaml` 对齐：

- LLM：`openrouter/deepseek/deepseek-v4-flash`
- Provider 顺序：`deepseek` → `siliconflow/fp8` → `novita`
- Embedder：`openai/qwen/qwen3-embedding-8b`
- Embedding dimension：`4096`

启动完整栈：

```bash
./docker/scripts/prod-up.sh
```

停止完整栈：

```bash
./docker/scripts/prod-down.sh
```

生产建议：正式环境优先使用外部 / 托管 PostgreSQL，并通过 `PG_URL`、`PG_CONN_STR` 指向外部数据库；Compose 内置 `postgres` 更适合本地演示、小规模验证。

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

运行时 catalog 写入：

```text
docker/trino/catalog/*.properties
```

这些文件是本地运行产物，不提交。示例模板放在：

```text
docker/trino/catalog-templates/
```

## 环境文件约定

提交到仓库：

- `docker/env/*.example`
- `docker/config/ai.config.example.yaml`
- `docker/trino/catalog-templates/*.properties`

不提交：

- `docker/env/*.local`，例如 `docker/env/test.local` 里的 LLM API key
- `docker/config/*.local.yaml`
- `docker/trino/catalog/*.properties`
- `docker/data/*`
