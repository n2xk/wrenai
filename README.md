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

## 本地开发启动方式

当前开发环境推荐使用：

- Docker 启动基础依赖和部分后端依赖服务。
- background terminal 启动 UI 和 AI Service，便于实时调试。

### 启动 UI

```bash
cd wren-ui
PORT=3002 PG_URL=postgres://postgres:postgres@127.0.0.1:9432/wrenai TZ=UTC yarn dev
```

### 启动 AI Service

```bash
cd wren-ai-service
poetry run python -m src.__main__
```

### Docker 依赖服务

```bash
cd docker
cp .env.example .env.local
cp config.example.yaml config.yaml
docker compose --env-file .env.local up -d
```

具体启动组合以当前开发任务为准。如果只调试 UI 或 AI Service，可以只保留必要的依赖服务在 Docker 中运行。

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

AI Service 支持通过配置文件接入不同 LLM Provider。配置入口主要在：

- `wren-ai-service/config.yaml`
- `wren-ai-service/.env.dev`
- `wren-ai-service/docs/config_examples/`

当前问数质量高度依赖模型能力、限流策略、Provider 稳定性和业务知识配置。测试时应遵守回归测试文档中的节流和重试规则，避免因 429 限流误判业务能力。

## 关键本地文档

| 文档 | 说明 |
| --- | --- |
| `docs/local-source-quickstart.md` | 本地源码启动说明 |
| `docs/local-source-acceptance.md` | 本地验收说明 |
| `docs/业务需求/问数回归测试计划.md` | 问数回归测试主计划 |
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
