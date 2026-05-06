# 部署后 TiDB 业务初始化说明

本文说明如何在一套已经部署好的 WrenAI 环境中，用脚本自动完成 TiDB 业务空间初始化、知识资产导入、建模辅助生成、核心问数验证和 11 张降级数据表保存。

## 目标

脚本入口：

```bash
./docker/scripts/postdeploy-tidb-business-bootstrap.sh --profile demo
```

它会按同源 UI 产品 API 执行以下动作：

1. 登录 UI。
2. 创建或复用 workspace。
3. 创建或复用 knowledge base。
4. 可选重置并导入 TiDB 业务 seed 数据。
5. 创建或更新 TiDB/MySQL 连接。
6. 选择 TiDB 表并保存模型。
7. 部署当前知识库。
8. 导入业务知识资产：
   - 分析规则（instruction）
   - SQL 模板（sql pair / sql template）
   - 业务词典（business dictionary / business term）
   - 外部数据依赖（external dependency）
   - 问数策略（ask policy rule）
   - SQL 模板结构化字段（`businessSignature`）
   - 分析规则结构化字段（`relatedBusinessTerms` / `relatedExternalDependencies` / `runtimeUsage`）
9. 统一生成：
   - suggested questions
   - modeling AI assistant 语义提示
   - modeling AI assistant 关联关系
10. 跑核心模板问数用例（T01/T02/T03/T04/T06/T08/T09/T10/T11/T12/T13）。
11. 跑 11 个降级保存用例（FT01-D~FT11-D），并保存为数据表。

## 适用环境

脚本是通用 post-deploy runner，不绑定 demo：

| profile | 默认 UI | 默认行为 | 典型用途 |
| --- | --- | --- | --- |
| `demo` | `http://127.0.0.1:3001` | 默认不启动内置 TiDB、不 seed；通过 `TIDB_CONNECTOR_*` 连接外部 TiDB；本机 smoke 可显式启用 `TIDB_DEMO_ENABLED=true` 和 `TIDB_SEED_ENABLED=true` | 演示环境初始化 / smoke |
| `test` | `http://127.0.0.1:3002` | 重置 TiDB seed、导入知识资产、跑核心用例、保存 11 张降级表 | 本机回归测试环境 |
| `prod` | `http://127.0.0.1:3000` | 默认不启动内置 TiDB、不 seed；通过 `TIDB_CONNECTOR_*` 连接外部 TiDB，不保存降级表 | 生产初始化 / 谨慎 smoke |

配置文件：

```text
docker/config/tidb-business-bootstrap.example.json
```

本地私有覆盖文件（不提交）：

```text
docker/config/tidb-business-bootstrap.local.json
```

## TiDB 连接配置

TiDB 被拆成两套配置，避免把“脚本能连到的地址”和“Wren 容器能连到的地址”混在一起：

| 配置组 | 用途 | 示例 |
| --- | --- | --- |
| `tidbSeed` | 脚本从宿主机直连 TiDB，用于可选建库 / schema / seed 数据；主要用于本机开发测试和本机 demo smoke | `127.0.0.1:4000` / `127.0.0.1:4001` |
| `tidbConnector` | 写入 Wren 产品连接配置，由 UI / engine / ibis-server 使用；所有环境都通过它接入业务 TiDB | 本机 Docker 网络：`tidb-demo:4000`；真实环境：真实 TiDB host |

环境变量示例：

```bash
TIDB_SEED_ENABLED=true
TIDB_SEED_RESET_DATABASE=true
TIDB_SEED_HOST=127.0.0.1
TIDB_SEED_PORT=4000
TIDB_SEED_USER=root
TIDB_SEED_PASSWORD=
TIDB_SEED_DATABASE=tidb_business_demo

TIDB_CONNECTOR_HOST=tidb-demo
TIDB_CONNECTOR_PORT=4000
TIDB_CONNECTOR_USER=root
TIDB_CONNECTOR_PASSWORD=
TIDB_CONNECTOR_DATABASE=tidb_business_demo
TIDB_CONNECTOR_SSL=false
```

演示 / 生产真实环境通常只配置 connector，不做 seed：

```bash
TIDB_SEED_ENABLED=false
TIDB_SEED_RESET_DATABASE=false
TIDB_CONNECTOR_HOST=<真实 TiDB host>
TIDB_CONNECTOR_PORT=4000
TIDB_CONNECTOR_USER=<真实 TiDB user>
TIDB_CONNECTOR_PASSWORD=<真实 TiDB password>
TIDB_CONNECTOR_DATABASE=<真实 TiDB database>
TIDB_CONNECTOR_SSL=false
```

`demo` / `prod` / `test` 的 env 模板已经包含这些变量：

```text
docker/env/demo.example
docker/env/prod.example
docker/env/test.example
```

## TiDB seed 数据来源与本地化

`tidbSeed` 默认使用 `docs/业务需求/seed_data_local/` 作为可直接导入 TiDB 的 v1.3 seed 入口：

- `regression_reference_window.sql`：默认用于本地 / demo / 回归测试的真实参考窗口 seed，覆盖 `tenant_plat_id=72`、`channel_id=1932`、`2026-04-10~2026-04-16`，以及 T02 的 `1867/1760` 渠道和 FULL 外部指标样例；它来自 `seed_data_refer/` 规范化后的参考数据，但不是全量原始 dump。
- `regression_fixture.sql`：固定对账窗口 `tenant_plat_id=990001` / `channel_id=990011`，直接按 v1.3 表结构维护，是 legacy SQL 模板专项回归的数据源。
- `saas_prod_v1_3.sql` / `saas_warehouse_v1_3.sql`：由 `seed_data_refer/` 规范化生成的全量参考 dump，文件较大，保留为离线诊断 / 大数据量专项，不作为默认 post-deploy seed，避免本机 standalone TiDB 因全量导入被 OOM kill。
- `external_metrics.sql`：FULL 回归所需的外部投放与流量指标样例；默认已经并入 `regression_reference_window.sql`。

`seed_data_refer/` 只保留原始参考导出，不直接改、不直接导入。重新拿到参考 dump 后，先生成本地 v1.3 seed：

```bash
python3 docs/业务需求/generate_seed_data_local.py
```

对应配置项：

```json
{
  "tidbSeed": {
    "schemaFile": "docs/业务需求/local_tidb_schema.sql",
    "seedFiles": [
      "docs/业务需求/seed_data_local/regression_reference_window.sql",
      "docs/业务需求/seed_data_local/regression_fixture.sql"
    ]
  }
}
```

旧 `docs/业务需求/seed.sql` 已废弃；固定对账数据已经迁入 `seed_data_local/regression_fixture.sql`。

运行时优先读取同名 `.local`：

```text
docker/env/demo.local
docker/env/prod.local
docker/env/test.local
```

## 生产安全规则

- `profile=demo/prod` 默认 `tidbSeed.enabled=false`、`resetDatabase=false`，不会隐式启动或重置内置 TiDB。
- 本机验证 demo 脚本时，必须在 `docker/env/demo.local` 显式设置 `TIDB_DEMO_ENABLED=true`、`TIDB_SEED_ENABLED=true` 和 `TIDB_SEED_RESET_DATABASE=true`。
- 真实演示 / 生产环境必须通过 `TIDB_CONNECTOR_*` 指向真实 TiDB；不要依赖 `tidb-demo`。
- `profile=prod` 默认 `tidbSeed.enabled=false`、`resetDatabase=false`。
- 即使配置打开了 prod 重置，也必须显式加 `--allow-prod-reset`，否则脚本会拒绝执行。
- 生产建议先跑 `--dry-run`，再跑 `--prepare-only`，最后视情况只跑核心 smoke。
- Wren 产品数据只能通过 UI 同源 API 创建，不允许脚本直接写 Wren PostgreSQL。
- 直接连 TiDB 只用于业务源数据 seed / reset。

## 常用命令

静态检查配置和知识资产，不写入任何服务：

```bash
./docker/scripts/postdeploy-tidb-business-bootstrap.sh --profile demo --dry-run
```

演示环境完整初始化：

```bash
./docker/scripts/postdeploy-tidb-business-bootstrap.sh --profile demo
```

只准备 workspace / KB / 连接 / 知识资产 / 建模生成，不跑问数和保存数据表：

```bash
./docker/scripts/postdeploy-tidb-business-bootstrap.sh --profile demo --prepare-only
```

不重置 TiDB，仅导入 / 生成 / 验证：

```bash
./docker/scripts/postdeploy-tidb-business-bootstrap.sh --profile demo --no-reset-tidb
```

只跑核心问数和 11 张降级表保存：

```bash
./docker/scripts/postdeploy-tidb-business-bootstrap.sh --profile demo --run-cases-only
```

只跑 11 张降级表保存：

```bash
./docker/scripts/postdeploy-tidb-business-bootstrap.sh --profile demo --run-cases-only --run-only save-degraded-tables
```

指定自定义配置和 env：

```bash
./docker/scripts/postdeploy-tidb-business-bootstrap.sh \
  --profile prod \
  --config docker/config/tidb-business-bootstrap.local.json \
  --env-file docker/env/prod.local \
  --dry-run
```

## 输出报告

脚本会输出两份报告：

```text
wren-ui/tmp/postdeploy-tidb-business-bootstrap/report.json
wren-ui/tmp/postdeploy-tidb-business-bootstrap/report.md
```

同时会生成日期化业务报告：

```text
docs/业务需求/部署后TiDB业务初始化结果-YYYY-MM-DD.md
```

报告需要至少包含：

- workspace / knowledge base id
- deploy hash
- 各类知识资产导入数量
- suggested questions / 语义提示 / 关联关系生成结果
- 核心用例 thread / response / SQL 生成状态
- 11 张降级数据表 spreadsheet id

## 与完整回归测试的边界

此脚本不是 `docs/业务需求/问数回归测试计划.md` 的全量替代，它是部署后初始化和 smoke 自动化：

- 覆盖核心模板链路和 11 张降级数据表保存。
- 不覆盖所有 OQ / LING / EDGE / ROUTE / RANK / FULL 外部补数用例。
- 严格全量 UI E2E 回归仍以 `docs/业务需求/问数回归测试计划.md` 为准。

## 故障排查

1. 登录失败：检查 `WREN_BOOTSTRAP_EMAIL` / `WREN_BOOTSTRAP_PASSWORD` 是否与目标环境一致。
2. TiDB seed 失败：检查 `TIDB_SEED_*` 是否能从宿主机访问。
3. 连接建模失败：检查 `TIDB_CONNECTOR_*` 是否能从 Wren/ibis/engine 访问，容器化环境通常不要写 `127.0.0.1`。
4. deploy 卡住：检查 AI Service `/v1/semantics-preparations`、LLM key、embedding 维度和 provider rate limit。
5. suggested questions 或 modeling AI 很慢：它们会调用 AI Service / LLM，按测试计划节流和重试规则记录 429。
6. 数据表保存失败：如果结果为空，UI API 会拒绝保存并返回“当前查询没有返回数据，暂不能保存为数据表”。
