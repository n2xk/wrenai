# Wren AI

Wren AI 是一个 GenBI（Generative BI）系统，用自然语言完成问数、SQL 生成、结果查询、图表生成和数据看板/数据表沉淀。

本仓库是 Wren AI 的本地开发主仓库，当前重点是围绕语义层、问数流程、数据连接器、看板和数据表能力进行迭代。

## 这套系统解决什么问题

用户可以用自然语言提问，例如：

- 查询某个时间范围内的业务指标
- 对明细数据做筛选、聚合、排序
- 生成图表并固定到数据看板
- 将查询结果保存为数据表
- 基于业务字典、分析规则和问数策略约束 SQL 生成

系统会结合语义层和知识库内容，把问题转换成可执行 SQL，再返回查询结果、解释过程和可视化结果。

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 自然语言问数 | 将用户问题转换为 SQL，并返回结构化结果 |
| 语义层 | 使用 MDL 描述模型、字段、关系、指标和计算逻辑 |
| 知识治理 | 通过业务字典、分析规则、外部数据依赖、问数策略提高问数稳定性 |
| 图表生成 | 基于查询结果生成图表，并支持固定到数据看板 |
| 数据表沉淀 | 将有价值的查询结果保存成数据表，便于后续复用 |
| 数据连接器 | 支持接入多种数据库或查询引擎 |
| 诊断与回归 | 通过诊断信息和业务回归测试计划持续验证问数质量 |

## 仓库结构

| 目录 | 作用 |
| --- | --- |
| `wren-ui/` | Next.js 前端，以及内嵌 Apollo GraphQL 后端 |
| `wren-ai-service/` | Python FastAPI AI 服务，负责 RAG、LLM 调用、SQL / 图表生成 |
| `wren-engine/` | 本地 SQL 引擎源码目录，负责 SQL 校验、执行和数据源适配 |
| `wren-mdl/` | MDL JSON Schema 定义 |
| `docker/` | 本地 Docker Compose 配置 |
| `docs/` | 本地需求、测试方案、架构和验收文档 |

## 服务关系

```text
用户
  ↓
Wren UI / Apollo Server
  ↓
Wren AI Service
  ↓
Wren Engine / Ibis Server / Trino
  ↓
外部数据库或本地测试数据源
```

主要调用链：

1. 用户在 UI 中输入自然语言问题。
2. UI 通过 Apollo Server 创建问数任务。
3. Apollo Server 调用 AI Service。
4. AI Service 结合 MDL、知识库和问数策略生成 SQL。
5. Engine / Ibis Server 校验并执行 SQL。
6. UI 展示结果、诊断信息、图表，并支持保存到看板或数据表。

## 本机标准开发测试环境

当前本机默认只推荐一套主环境：`test-env`。它既用于日常开发验证，也用于严格 UI E2E 回归。

`test-env` 会启动：

- Docker 依赖层：PostgreSQL、engine、ibis-server、Trino
- TiDB demo：用于业务问数回归数据源
- PM2 源码应用：`test-ui`、`test-ai-service`

首次使用先准备本地私密配置：

```bash
cp docker/env/test.example docker/env/test.local
# 编辑 docker/env/test.local，填 OPENROUTER_API_KEY / OPENAI_API_KEY 等
```

启动本机开发测试环境：

```bash
./docker/scripts/test-env-up.sh
```

重启 UI / AI Service：

```bash
./docker/scripts/test-apps-restart.sh all
# 或只重启一个
./docker/scripts/test-apps-restart.sh ui
./docker/scripts/test-apps-restart.sh ai
```

默认访问：

- UI：`http://127.0.0.1:3002`
- AI Service：`http://127.0.0.1:5555`
- TiDB demo：`127.0.0.1:4000`
- PostgreSQL：`127.0.0.1:9432`
- Engine：`127.0.0.1:8080`
- Ibis Server：`127.0.0.1:8000`

`dev-up.sh` 仅保留为高级 / 诊断入口：只启动 PostgreSQL、engine、ibis-server、Trino，不启动 TiDB，也不启动 UI / AI Service。除非明确需要手动用 background terminal 启动应用，否则不要作为主开发入口。

```bash
./docker/scripts/dev-up.sh
```

修改 engine / ibis-server 后重建：

```bash
./docker/scripts/rebuild-engine.sh
```

单机生产完整栈使用 Docker 部署，会从当前仓库源码构建 UI / AI Service / engine / ibis 镜像，AI Service 通过外部 LiteLLM proxy 访问上游模型：

```bash
cp docker/env/prod.example docker/env/prod.local
cp docker/config/ai.config.example.yaml docker/config/ai.config.local.yaml
./docker/scripts/prod-up.sh
```

演示环境同样使用 Docker 完整栈，从当前仓库源码构建应用镜像，并使用独立端口和 `COMPOSE_PROJECT_NAME=demo`：

```bash
cp docker/env/demo.example docker/env/demo.local
cp docker/config/ai.config.example.yaml docker/config/ai.config.local.yaml
./docker/scripts/demo-up.sh
```

`demo.example` 默认开启启动时产品初始化：UI 容器启动后会自动创建首个 owner、默认 workspace、系统样例知识库、样例模型 / 关系 / 看板，并部署到 AI Service。对外演示前请在 `docker/env/demo.local` 修改 `WREN_BOOTSTRAP_EMAIL` / `WREN_BOOTSTRAP_PASSWORD`。

具体说明见 `docker/README.md`。

## 常用命令

### Wren UI

```bash
cd wren-ui
yarn install
yarn dev
yarn build
yarn lint
yarn check-types
yarn test
yarn test:e2e
yarn migrate
yarn rollback
yarn generate-gql
```

### Wren AI Service

```bash
cd wren-ai-service
poetry install
just init
just up
just start
just test
just test-usecases
just down
```

## 数据源支持范围

系统当前面向数据库类数据源为主，常见数据源包括：

- PostgreSQL
- MySQL
- Microsoft SQL Server
- ClickHouse
- Oracle
- Trino
- DuckDB
- BigQuery
- Snowflake
- Redshift
- Athena
- Databricks

本地真实连接验证以 `docs/` 下的数据源测试方案为准。部分云厂商数据源无法用纯 Docker 完整模拟，需要使用真实账号或替代验证方式。

## LLM 配置

AI Service 支持通过配置文件接入不同 LLM Provider。当前本地 / 测试口径与 `wren-ai-service/config.local.yaml` 对齐：

- LLM：`openrouter/deepseek/deepseek-v4-flash`
- OpenRouter provider 顺序：`deepseek` → `siliconflow/fp8` → `novita`
- Embedder：`openai/qwen/qwen3-embedding-8b`
- Embedding dimension：`4096`

相关配置入口：

- PM2 开发测试环境变量：`docker/env/test.local`（由 `docker/env/test.example` 复制，私密不提交）
- PM2 开发测试进程配置：`docker/pm2.test.config.cjs`
- Docker 完整栈 AI 配置：`docker/config/ai.config.example.yaml` / `docker/config/ai.config.local.yaml`
- Docker 完整栈环境变量：`docker/env/prod.example` / `docker/env/prod.local`
- AI Service 本地源码配置：`wren-ai-service/config.local.yaml`

当前问数质量高度依赖模型能力、限流策略、Provider 稳定性和业务知识配置。测试时应遵守回归测试文档中的节流和重试规则，避免因 429 限流误判业务能力。

## 关键本地文档

| 文档 | 说明 |
| --- | --- |
| `docs/local-source-quickstart.md` | 本地源码启动说明 |
| `docs/local-source-acceptance.md` | 本地验收说明 |
| `docs/业务需求/问数回归测试计划.md` | 问数回归测试主计划 |
| `docs/业务需求/部署后TiDB业务初始化说明.md` | 部署完成后自动创建 TiDB 业务空间、导入知识资产、生成建模辅助内容并跑核心 smoke 的说明 |
| `docs/业务需求/问数语义计划与知识治理方案-2026-04-30.md` | 问数语义计划和知识治理方案 |
| `docs/真实外部数据源连接验证测试方案-2026-04-29.md` | 真实外部数据源连接验证方案 |
| `docs/多知识库联合查询方案-2026-04-30.md` | 多知识库联合查询方案 |

## 开发约定

- 优先保持小步提交和可回滚改动。
- 修改问数、图表、看板、数据表相关流程时，需要同步考虑回归测试计划。
- 修改数据源、MDL、语义策略时，需要确认 UI、AI Service、Engine 三侧契约是否一致。
- 涉及 LLM 调用的测试需要控制请求频率，避免 Provider 限流影响判断。
- UI 和 AI Service 的本地启动方式以本 README 和项目记忆中的当前方式为准。

<p align="right">
  <a href="#top">回到顶部</a>
</p>
