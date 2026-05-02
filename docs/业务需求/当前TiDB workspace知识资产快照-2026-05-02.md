# 当前 TiDB workspace 知识资产快照（2026-05-02）

> 本文件记录 `docs/业务需求/问数回归测试计划.md` 本轮重置全量 UI 回归的 B0 准备结果。UI / 同源 API 为主证据，PostgreSQL 查询仅作旁证。

## 1. 运行环境

| 项 | 值 |
| --- | --- |
| 记录时间 | 2026-05-02 01:13:05  |
| UI | `http://127.0.0.1:3002` / PM2 `test-ui` |
| AI Service | `http://127.0.0.1:5555` / PM2 `test-ai-service` |
| Docker project | `local` |
| PostgreSQL | `local-postgres-1` / `127.0.0.1:9432` |
| TiDB demo | `local-tidb-demo` / `127.0.0.1:4000` |
| Engine | `local-engine-1` / `127.0.0.1:8080` |
| Ibis Server | `local-ibis-server-1` / `127.0.0.1:8000` |
| Trino | `local-trino-1` / `127.0.0.1:8081` |

## 2. 本轮运行态 selector

| 字段 | 值 |
| --- | --- |
| workspaceId | `a638cb62-bd08-4eae-ada8-77e7ecdffd36` |
| workspace name | `TiDB 全量回归空间 20260501164429` |
| knowledgeBaseId | `1f6a5a74-0c6d-4e08-911e-0dbc41eb1a8f` |
| knowledge base name | `TiDB 业务知识库 20260501164429` |
| kbSnapshotId | `b7abc388-0690-4043-8cfc-f771bd8a5028` |
| deployHash | `e88bc926bdc724265a794d057c080246e1b8f813`（已切回 68 条关系的成功部署） |

后续 B1~B6 测试 URL 使用 `deployHash=e88bc926bdc724265a794d057c080246e1b8f813`。该 deploy 为 68 条关系、0 个重复关系组的成功部署；已将 `kb_snapshot.deploy_hash` 切回该 hash。重复关系污染后的 `ba87ad1422487d2382417da9b0caa901f8b450c7` 不再用于本轮测试。

## 3. TiDB connector

```json
{
  "connectorId": "270916ee-4798-4864-b64a-2c7424e599b3",
  "provider": "mysql",
  "host": "host.docker.internal",
  "port": 4000,
  "database": "tidb_business_demo",
  "user": "root"
}
```

## 4. B0 知识资产导入数量

| 资产 | 数量 | 说明 |
| --- | ---: | --- |
| models | 25 | TiDB schema 建模后模型数 |
| columns | 747 | TiDB schema 建模后字段数 |
| analysis rules / instructions | 14 | 来自 `knowledge-base/analysis-rules/` |
| business terms | 10 | 来自 `knowledge-base/business-dictionary/` |
| external dependencies | 4 | 来自 `knowledge-base/external-dependencies/` |
| ask policies | 4 | 来自 `问数策略配置建议-2026-05-01.md` |
| SQL pair variants | 21 | 11 个主模板的问题变体展开 |

## 5. 用户补充要求三项执行证据

### 5.1 suggested questions

- 执行方式：MCP Playwright 同源 API `GET /api/v1/suggested-questions`。
- 结果：成功返回 6 条建议问题。
- 示例：
  1. `统计某站点/渠道在指定日期范围内每日的登录、注册、充值、提现、投注、优惠、返水、任务彩金。`
  2. `按天查看某渠道综合日报指标`
  3. `统计某渠道最近7天的登录、注册、充值、提现、投注汇总`

### 5.2 modeling AI assistant 生成语义提示

- 执行方式：MCP Playwright 同源 API `POST /api/v1/semantics-descriptions` → 轮询 → `PATCH /api/v1/models/{modelId}/metadata` 保存。
- taskId：`07cb5271-afa8-49fd-b719-41e6df26dc80`。
- 结果：
  - selected models：25
  - generated models：24
  - saved models：24
  - 运行态已描述 models：25 / 25
  - 运行态已描述 columns：747 / 747
- 注意：语义描述保存在 `properties.description`，不是顶层 `description`。

### 5.3 modeling AI assistant 生成关联关系

- 执行方式：MCP Playwright 同源 API `POST /api/v1/relationship-recommendations` → 轮询 → `POST /api/v1/relationships/import` 保存。
- taskId：`2466eef9-db6a-4ea9-a3ca-0355a7e7a6b7`。
- 结果：AI 推荐 68 条、可映射 68 条、已保存 68 条。
- 初次保存后重新 deploy：`ba87ad1422487d2382417da9b0caa901f8b450c7`。
- 发现重复导入后已在测试数据中去重：PostgreSQL `relation` 当前 68 条，重复组 0。
- 关系去重后的重试 deploy：`c70cae742a6603a294f445f46009cc88ae6fb523`，manifest 关系数 68，但 AI service 部署请求曾卡住，最终失败为 `read ECONNRESET`。
- 本轮已采用已成功的 68 关系 deploy：`e88bc926bdc724265a794d057c080246e1b8f813`，并将 `kb_snapshot.deploy_hash` 切回该值。
- 注意：不要再次执行关系导入，否则会再次产生重复关系。

## 6. 已发现问题

| 编号 | 严重性 | 问题 | 影响 | 后续建议 |
| --- | --- | --- | --- | --- |
| B0-UX-01 | P2 | 关联关系重复导入 | 本轮已有 68 条关系，再执行 AI 推荐导入后总数变为 136。已人工去重回 68 条、0 重复组，但重复关系 deployHash 仍存在。 | 关系导入需要新增去重/覆盖确认/重复预览，避免用户重复点击后污染模型关系。继续 B1 前需先收敛 68 关系 manifest 的 deploy。 |
| B0-TECH-01 | P1 | 关系去重后 deploy 卡住/失败 | `deploy_log` 生成 `c70cae742a6603a294f445f46009cc88ae6fb523`，manifest 关系数 68，但部署请求卡住后失败为 `read ECONNRESET`。 | 已临时绕过：切回已成功的 68 关系 deployHash `e88bc926bdc724265a794d057c080246e1b8f813`。后续仍需修复部署超时/失败回写体验。 |

## 7. B0 结论

B0 环境与知识库准备的三项用户补充步骤已执行：suggested questions、语义提示、关联关系生成均有证据。关联关系重复导入后的 DB 已去重；由于 `c70...` 重试部署卡住/失败，本轮 selector 已切回成功的 68 关系 deployHash `e88bc926bdc724265a794d057c080246e1b8f813`，可继续 B1。
