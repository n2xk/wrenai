# AGENTS.md

本文件记录 WrenAI 当前本地工作树的代码结构、启动方式、测试口径和开发约定，供后续 agent / 开发者快速对齐上下文。

## 项目定位

WrenAI 是一个 GenBI（Generative BI）系统：用户用自然语言提问，系统结合语义层、知识库、问数策略和 LLM 生成 SQL、执行查询、展示结果，并支持生成图表、固定到数据看板、保存到数据表。

当前本地仓库重点围绕以下方向迭代：

- 问数链路稳定性和语义治理
- 知识库 / 数据看板 / 数据表产品化体验
- 新 connector 数据连接器体系
- 图表、SQL、看板、数据表的端到端产物化
- 业务需求回归测试和真实数据源连接验证

## 当前仓库结构

| 目录 | 说明 |
| --- | --- |
| `wren-ui/` | Next.js 14 前端，以及 `src/pages/api` + `src/server` 下的本地后端 API / service / repository / adaptor 层 |
| `wren-ai-service/` | Python 3.12 + FastAPI AI 服务，负责 RAG、LLM 调用、SQL 生成、图表生成、问数策略和诊断数据 |
| `wren-engine/` | 本地 SQL engine 源码目录，包含 engine / ibis-server 相关代码；修改后需要随顶层仓库提交并重建本地 Docker 镜像 |
| `wren-mdl/` | MDL JSON Schema 和相关 schema 测试 |
| `docker/` | 本地 Docker Compose 依赖服务配置 |
| `docs/` | 当前需求、设计方案、测试计划、测试结果和本地验收文档 |

已移除 / 不再作为当前主路径维护：

- `wren-launcher/`：旧 Go launcher 已删除。
- 顶层 `CONTRIBUTING.md` / `CODE_OF_CONDUCT.md`：已删除。
- `wren-ai-service/CONTRIBUTING.md`：已删除。
- 独立 `docker/bootstrap/`：已删除；不要再恢复旧 bootstrap 容器流程。

## 当前服务关系

```text
用户 / MCP Playwright
  ↓
wren-ui 3002（Next.js 页面 + API routes）
  ↓
wren-ai-service 5555（FastAPI）
  ↓
engine 8080 / ibis-server / Trino
  ↓
PostgreSQL / TiDB / 其他真实或测试数据源
```

主要问数链路：

1. 用户在 UI 输入自然语言问题。
2. UI 创建 thread / asking task / thread response 等持久化对象。
3. UI API 调用 AI Service。
4. AI Service 结合 MDL、SQL 模板、业务字典、分析规则、外部数据依赖、问数策略生成 SQL 或追问信息。
5. Engine / Ibis Server 校验并执行 SQL。
6. UI 展示回答、SQL、思考过程、诊断、图表，并支持保存到看板或数据表。

## 本地启动约定

当前本机主路径：使用 `test-env` 作为统一的开发测试环境。它包含 Docker 依赖层、TiDB demo，以及 PM2 管理的源码 UI / AI Service。执行问数回归、日常问数验证、UI E2E 时都应优先使用这套环境。

### 启动本机开发测试环境（默认）

```bash
cp docker/env/test.example docker/env/test.local
# 编辑 docker/env/test.local，填 OPENROUTER_API_KEY / OPENAI_API_KEY 等
./docker/scripts/test-env-up.sh
```

这会启动：

- Docker：PostgreSQL、engine、ibis-server、Trino、TiDB demo
- PM2：`test-ui`、`test-ai-service`

默认端口：

- UI：`127.0.0.1:3002`
- AI Service：`127.0.0.1:5555`
- TiDB demo：`127.0.0.1:4000`
- PostgreSQL：`127.0.0.1:9432`
- engine：`127.0.0.1:8080`
- ibis-server：`127.0.0.1:8000`

重启测试应用进程：`./docker/scripts/test-apps-restart.sh [ui|ai|all]`。

PM2 开发测试 LLM 配置：`docker/env/test.local`（由 `docker/env/test.example` 复制，私密不提交）。当前默认与 `wren-ai-service/config.local.yaml` 对齐：DeepSeek V4 Flash via OpenRouter，provider 顺序 deepseek -> siliconflow/fp8 -> novita，embedding dimension 4096。

### 高级入口：只启动依赖层

`dev-up.sh` 仅保留为 dependency-only / 诊断入口：只启动 PostgreSQL、engine、ibis-server、Trino，不启动 TiDB，也不启动 UI / AI Service。除非明确需要手动用 background terminal 启动应用，否则不要作为主开发入口。

```bash
./docker/scripts/dev-up.sh
```

如手动启动源码应用，默认命令仍是：

```bash
cd wren-ui
PORT=3002 PG_URL=postgres://postgres:postgres@127.0.0.1:9432/wrenai TZ=UTC yarn dev

cd wren-ai-service
PG_CONN_STR=postgresql://postgres:postgres@127.0.0.1:9432/wrenai poetry run python -m src.__main__
```

修改 `wren-engine/` 或 ibis-server 后重建：

```bash
./docker/scripts/rebuild-engine.sh
```

单机生产完整栈（Docker + 外部 LiteLLM proxy）：

```bash
cp docker/env/prod.example docker/env/prod.local
cp docker/config/ai.config.example.yaml docker/config/ai.config.local.yaml
./docker/scripts/prod-up.sh
```

演示完整栈（与生产同形，本地源码构建，独立 demo env / project / 端口，默认接外部 LiteLLM）：

```bash
cp docker/env/demo.example docker/env/demo.local
cp docker/config/ai.config.example.yaml docker/config/ai.config.local.yaml
./docker/scripts/demo-up.sh
```

常用依赖端口：

- PostgreSQL：`127.0.0.1:9432`
- engine：`127.0.0.1:8080`
- ibis-server：`127.0.0.1:8000`
- Trino：`127.0.0.1:8081`

## 常用命令

### wren-ui

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

### wren-ai-service

```bash
cd wren-ai-service
poetry install
just init
just up
just start
just test
just test-usecases
just down
just load-test
```

### wren-mdl

```bash
python -m pytest wren-mdl/tests/test_mdl_schema.py -q
```

### Docker compose 配置校验

```bash
docker compose --project-directory docker --env-file docker/env/dev.example -f docker/compose.yaml -f docker/compose.dev.yaml config --quiet
docker compose --project-directory docker --env-file docker/env/prod.example -f docker/compose.yaml -f docker/compose.prod.yaml config --quiet
docker compose --project-directory docker --env-file docker/env/test-sources.example -f docker/compose.yaml -f docker/compose.test-sources.yaml config --quiet
```

## wren-ui 当前结构重点

- 页面路由：`wren-ui/src/pages/`
- 新功能页面：`wren-ui/src/features/`
  - `features/home/`：问数、thread、dashboard、spreadsheet
  - `features/knowledgePage/`：知识库、业务字典、分析规则、SQL 模板、外部数据依赖、问数策略入口
  - `features/settings/`：系统设置、connector、诊断、权限、反馈等
  - `features/askPolicies/`：问数策略产品化 UI
- API routes：`wren-ui/src/pages/api/`
- 后端业务层：`wren-ui/src/server/`
  - `controllers/`
  - `services/`
  - `repositories/`
  - `adaptors/`
  - `authz/`
  - `context/`
  - `utils/`

注意：旧 `src/apollo` 架构说明已经过时，当前以后端 API routes + `src/server` 分层为准。

## wren-ai-service 当前结构重点

- FastAPI 路由：`wren-ai-service/src/web/v1/routers/`
- Web service 层：`wren-ai-service/src/web/v1/services/`
- 核心运行时和策略：`wren-ai-service/src/core/`
  - `fixed_order_ask_runtime.py`
  - `ask_policy.py`
  - skill runner 相关逻辑
- Pipeline：`wren-ai-service/src/pipelines/`
  - `indexing/`
  - `retrieval/`
  - `generation/`
- Provider：`wren-ai-service/src/providers/`
  - `llm/`
  - `embedder/`
  - `document_store/`
  - `engine/`
- 配置：`wren-ai-service/src/config.py`、`config.yaml`、`config.local.yaml`、`.env.dev`

## 当前产品约定

- `/setup` 不是主路径；数据连接应优先走系统设置的数据连接器，以及知识库 / 添加资产向导里的 connector 流程。
- 新 connector 体系优先覆盖旧 connection 类型；新增或修改 connector 时要同时检查 UI 表单、后端存储、Engine/Ibis connection info 契约。
- REST JSON / Python Tool 等非数据库连接器默认不作为普通新建入口展示，除非 feature flag 或明确需求打开。
- 问数策略属于知识库治理内容，产品入口应优先放在知识库相关 tab / 页面，而不是系统设置主入口。
- 业务字典、分析规则、SQL 模板、外部数据依赖、问数策略都属于问数质量治理资产，改动时必须考虑对回归用例的影响。

## 测试和验证口径

### 问数回归测试

执行 `docs/业务需求/问数回归测试计划.md` 时，必须按严格 UI E2E 口径：

- 优先使用 MCP Playwright / Chrome 操作 UI。
- 若使用 API 自动化，只能使用 UI 同源产品链路 API。
- 必须完成 asking task → thread / thread response 持久化绑定。
- 每条问数、追问、图表、反馈、诊断用例最终都应能在 UI 历史对话或对应管理页面看到。
- 直接调用 AI Service `/v1/asks` 或只创建 asking task 只能作为诊断旁证，不能算 UI E2E 通过。

### LLM 限流

- 回归测试要遵守测试计划中的节流和重试规则。
- 当前关注 OpenRouter / provider 429，测试请求不应过密。
- 遇到 provider 429 先按测试计划重试 / 记录，不要误判为业务 SQL 失败。

### MCP Playwright

- 本仓库使用 MCP Playwright 时默认使用 isolated 模式（`--isolated`）。
- 除非用户明确要求，否则不要复用非 isolated 浏览器上下文。

### 变更验证

按改动范围选择验证：

- 文档改动：扫描断链 / 过期引用。
- UI 改动：至少跑相关单测、类型检查或 MCP Playwright 冒烟。
- AI Service 改动：至少跑相关 pytest；涉及问数策略时补回归断言。
- Docker / deployment 改动：跑 `docker compose ... config --quiet` 或对应 manifest 校验。
- MDL schema 改动：跑 `python -m pytest wren-mdl/tests/test_mdl_schema.py -q`。

## 关键本地文档

- `README.md`：当前本地项目说明。
- `docs/local-source-quickstart.md`：本地源码快速启动参考；若与本文件冲突，以用户最近明确的启动口径和项目记忆为准。
- `docs/local-source-acceptance.md`：本地源码验收参考。
- `docs/业务需求/问数回归测试计划.md`：问数 UI E2E 主回归计划。
- `docs/业务需求/问数语义计划与知识治理方案-2026-04-30.md`：问数语义计划和知识治理方案。
- `docs/业务需求/问数策略配置建议-2026-05-01.md`：问数策略配置建议。
- `docs/业务需求/第一期Excel示例表格全覆盖清单-2026-05-01.md`：第一期需求表格覆盖清单。
- `docs/真实外部数据源连接验证测试方案-2026-04-29.md`：真实数据源连接验证方案。
- `docs/多知识库联合查询方案-2026-04-30.md`：多知识库联合查询方案。

## Git / 提交约定

- 常用 scope：`wren-ui`、`wren-ai-service`、`wren-mdl`、`docker`、`deployment`、`docs`。
- `wren-engine` 是普通本地源码目录，查看或提交其改动时直接使用顶层 git 状态；修改后重建 `engine:local` / `engine-ibis:local` 镜像。
- 当前仓库经常存在多个并行未提交改动；修改前先看 `git status --short`，不要覆盖无关工作。
- 文档 / 清理类改动要先说明清理计划，再做最小可回滚修改。
- 提交信息遵循当前 Lore Commit Protocol / conventional scope 约定。
