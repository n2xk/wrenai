# 问数全量回归结果（Instruction-first Prompt 顺序，2026-05-04）

## 结论摘要

本轮按用户要求把测试环境切换为：

```text
WREN_PROMPT_INSTRUCTION_FIRST_ENABLED=1
```

即 Text-to-SQL prompt 中 `USER INSTRUCTIONS` 前置于 `SQL SAMPLES`，并执行了一次重置环境后的 TiDB 问数全量 UI E2E 回归。

整体结论：**instruction-first 没有造成 SQL 生成失败或系统级阻塞，但本轮不是“全量无条件通过”。**

- B0 环境 / 知识库 / 建模 / 部署：通过。
- B1 降级版 11 张数据表生成并保存：11/11 PASS。
- B2 核心业务模板：13/15 PASS，2 条 PARTIAL。
- B3 产品化能力：11/11 PASS。
- B4 普通问数 / 路由安全：10/10 PASS。
- B5 泛化 / 模板竞争：55/55 PASS。
- B6 FULL 同形覆盖：6/11 PASS，5 条 PARTIAL；其中 3 条外部输入专项补测通过。
- 专项多轮补槽 / 外部输入 / 图表：3/3 PASS。
- 对话内“推荐几个问题给我”：DB 生成 3 条推荐追问；UI 卡片可见性仍需人工复核。
- 未发现 OpenRouter 429。
- 未发现 `answerStatus=FAILED`。
- 未发现普通 SQL_RESULT 用例 SQL 缺失。

因此，当前证据仍不支持直接把 instruction-first 改成默认；更稳妥的结论是：**保留开关，继续用默认顺序作为主线，instruction-first 可继续作为实验配置扩大观测。**

## 测试环境

### 服务配置

- UI：PM2 `test-ui`
- AI service：PM2 `test-ai-service`
- Prompt 顺序：`WREN_PROMPT_INSTRUCTION_FIRST_ENABLED=1`
- UI / AI service 已在测试前通过 `./docker/scripts/test-apps-restart.sh all` 重启。

### 数据重置

- PostgreSQL 应用数据：已清理并重建测试用户 / bootstrap workspace。
- TiDB：已 `DROP DATABASE tidb_business_demo` 后重建。
- TiDB schema：重新生成并导入 `docs/业务需求/local_tidb_schema.sql`。
- TiDB seed：重新导入 `docs/业务需求/seed.sql`。
- 外部样例表校验：`marketing_external_metrics_daily` 中 `tenant_plat_id=990001`、`2026-04-01~2026-04-07`、渠道 `990011~990014` 共 28 行。
- SQL seed 对账：`docs/业务需求/verify_tidb_regression.py` 12/12 PASS。

### 本轮 selector

```text
WORKSPACE_ID=a231c0e1-ec4e-4b68-b5ce-3779e48c9ed1
KNOWLEDGE_BASE_ID=4c927100-f4c1-4149-8ca2-80b286f19a67
KB_SNAPSHOT_ID=95916c3a-921f-4024-b88a-af1d719fe2ed
DEPLOY_HASH=790a506459fbdc23e14ba03f39793d71c6a8d5e9
```

## B0：环境与知识库准备

输出文件：`wren-ui/tmp/stability-import-generation-b0-result.json`

| 项目 | 结果 |
| --- | ---: |
| 分析规则 | 14 |
| 业务词典 | 10 |
| 外部数据依赖 | 4 |
| 问数策略 | 4 |
| SQL pair / 模板变体 | 23 |
| 模型 | 26 |
| 字段 | 756 |
| Suggested questions | 6 |
| 语义提示生成 / 保存 | 26 模型 / 756 字段 |
| 关系推荐 / 导入 | 109 / 109 |
| 最终 deploy | SUCCESS |

## B1：第一期 Excel 降级数据表生成与保存

输出文件：`wren-ui/tmp/instruction-first-full-b1-spreadsheet/summary.json`

| 用例 | 状态 | 行数 | 数据表 ID |
| --- | --- | ---: | ---: |
| FT01-D | PASS | 6 | 1 |
| FT02-D | PASS | 7 | 2 |
| FT03-D | PASS | 63 | 3 |
| FT04-D | PASS | 7 | 4 |
| FT05-D | PASS | 63 | 5 |
| FT06-D | PASS | 3 | 6 |
| FT07-D | PASS | 10 | 7 |
| FT08-D | PASS | 10 | 8 |
| FT09-D | PASS | 7 | 9 |
| FT10-D | PASS | 18 | 10 |
| FT11-D | PASS | 4 | 11 |

结论：11 张降级版内部指标表均可生成并保存到「数据表」。

## B2~B6 + B3 产品化主回归

输出目录：`wren-ui/tmp/instruction-first-full-b2-b6/`

| 批次 | 用例数 | PASS | PARTIAL | FAIL |
| --- | ---: | ---: | ---: | ---: |
| B2 | 15 | 13 | 2 | 0 |
| B3 | 11 | 11 | 0 | 0 |
| B4 | 10 | 10 | 0 | 0 |
| B5 | 55 | 55 | 0 | 0 |
| B6 | 11 | 6 | 5 | 0 |
| 合计 | 102 | 95 | 7 | 0 |

### B2 PARTIAL

| 用例 | 现象 | 判断 |
| --- | --- | --- |
| T01 | 首跑 answer 文本未命中关键字 `2080`；专项重跑 T01 后 PASS | 偏 LLM 表述 / 断言波动，不是 SQL 生成失败 |
| T03 | SQL 有 `player_id`，结果行数 5；answer 摘要只展示 `player_username`，未展示 `990101 / 990105` | 结果 SQL 正常，但回答正文没有保留 player_id，需产品/回答格式优化 |

### B6 PARTIAL

| 用例 | 现象 | 判断 |
| --- | --- | --- |
| FT01-FULL | 主回归被外部数据依赖阻断；外部输入专项补测 PASS | 需要按 FULL 外部输入链路执行 |
| FT02-FULL | 主回归被投放金额缺失阻断；外部输入专项补测 PASS | 需要按 FULL 外部输入链路执行 |
| FT03-FULL | 有 SQL 和结果，但 FULL 严格同形仍判 PARTIAL | Excel 同形列序 / 宽表形态仍需细化 |
| FT04-FULL | 主回归被投放金额缺失阻断；外部输入专项补测 PASS | 需要按 FULL 外部输入链路执行 |
| FT08-FULL | 有 SQL 和结果，但 FULL 严格同形仍判 PARTIAL | Excel 同形列序 / 展示形态仍需细化 |

## 外部输入专项

输出目录：`wren-ui/tmp/instruction-first-full-external-supply/`

| 用例 | 状态 | 行数 | 列数 |
| --- | --- | ---: | ---: |
| FT01-FULL-EXTERNAL | PASS | 7 | 33 |
| FT02-FULL-EXTERNAL | PASS | 9 | 22 |
| FT04-FULL-EXTERNAL | PASS | 9 | 22 |

结论：FULL 中依赖投放金额 / PV / UV / 下载点击 UV 的 3 条阻断用例，在对话中补充外部数据后可继续问数并通过。

## 多轮补槽 / 外部输入 / 图表专项

输出目录：`wren-ui/tmp/instruction-first-followup-special/`

| 用例 | 状态 | 说明 |
| --- | --- | --- |
| ROUTE05 | PASS | 外部投放金额阻断后，补充外部数据继续生成 SQL |
| ROUTE13 | PASS | 多轮补槽携带 tenant / channel / date，再补外部投放金额成功 |
| PX12 | PASS | TOP5 / 非 TOP5 并生成图表链路通过 |

## 对话内推荐追问 RECQ01

输出目录：`wren-ui/tmp/instruction-first-recq01/`

- 在 thread 19 中输入：“推荐几个问题给我”。
- `thread_response.recommendation_detail.status = FINISHED`。
- DB 生成 3 条推荐追问：
  - 非TOP3用户每日存款与投注趋势
  - TOP3 vs 非TOP3 关键指标对比
  - 非TOP3用户按游戏类型钻取
- UI `innerText` 只采集到推荐追问标题，推荐项卡片文本未被脚本完整采集；建议后续用截图或 DOM 定位补一条更强的 UI 断言。

## 错误与风险扫描

| 项目 | 结果 |
| --- | --- |
| OpenRouter 429 | 未发现 |
| `answerStatus=FAILED` | 未发现 |
| SQL_RESULT 用例 SQL 缺失 | 未发现 |
| 普通问数 / 路由安全失败 | 未发现 |
| B3 图表生成 | PASS |
| 固定到数据看板 | PASS |
| 导出 CSV / Excel | PASS |
| 保存数据表 | PASS |
| 反馈 | PASS |
| Diagnostics | PASS |

控制台警告：仍可见 Ant Design warning：

- `Modal destroyOnClose is deprecated`
- `useForm is not connected to any Form element`

这些没有阻断本轮测试，但属于 UI 技术债。

## 对 Prompt 顺序的判断

本轮 instruction-first 全量回归说明：

1. instruction-first 可以跑通主链路，没有造成系统性 SQL 失败。
2. 但相比默认顺序，仍出现 T03 回答正文字段遗漏、B6 FULL 同形 PARTIAL 等问题。
3. 这些问题不一定全部由 prompt 顺序造成，但也没有证据证明 instruction-first 明显更优。
4. 结合代表性 A/B 结果和本轮全量结果，当前不建议直接改默认顺序。

建议：

- 继续保持默认 `SQL SAMPLES` 在 `USER INSTRUCTIONS` 前。
- 保留 `WREN_PROMPT_INSTRUCTION_FIRST_ENABLED=1` 作为实验开关。
- 如果要再评估 instruction-first，应先修复或补强：
  - T03 回答正文必须展示 player_id；
  - FT03 / FT08 FULL 同形列序和宽表格式；
  - RECQ01 UI 推荐卡片可见性自动断言。
