# 业务需求知识资产（导入准备）

这套目录用于提前沉淀后续要导入系统知识库的内容。

## 当前环境快照

如果要看“当前 TiDB 回归环境**实际上已经落库了什么**”，请同时参考：

- [`../当前TiDB workspace知识资产快照-2026-04-26.md`](../当前TiDB%20workspace知识资产快照-2026-04-26.md)

如果要看“如何把当前规则/模板产品化为业务知识配置中心”，请参考：

- [`../业务知识配置中心方案-2026-04-26.md`](../业务知识配置中心方案-2026-04-26.md)

截至 2026-04-26 的最新环境快照显示：当前 TiDB 回归 workspace 中 `R01 ~ R14` 已全部落库，`T01/T02/T03/T04/T06/T08/T09/T10/T11/T12/T13` 的 21 条问题变体也都已经升级为 `L2 anchored_template`。

注意区分两类文档：

- `knowledge-base/` 下单文件：**导入权威来源**
- `当前TiDB workspace知识资产快照-2026-04-26.md`：**实际运行环境落库快照**

从 2026-04-26 开始，`sql-templates/*.md` 单文件还会额外回写 `runtime_sync` 字段块，用来记录当前 TiDB 回归 workspace 的实际落库状态；其中：

- `status` 仍表示源文档的准备状态（例如 `draft_sql` / `blocked_missing_source`）
- `runtime_sync.import_status` 表示该模板在当前回归环境中是否已实际导入

## 为什么这里建议用 Markdown

建议，**用 Markdown + YAML Front Matter** 最合适，原因是：

1. **人工可读**：产品、数据、研发都能直接看懂和改。
2. **版本友好**：Git diff 清楚，方便评审和追踪口径变更。
3. **后续易导入**：虽然现在还没有导入功能，但后续脚本可以稳定解析 front matter。
4. **能逐步演进**：先沉淀规则和模板说明，后续再补成可直接导入的 SQL pair / instruction。

## 目录约定

- `analysis-rules/`：分析规则，后续建议导入为 **instructions**
- `sql-templates/`：SQL 模板定义，后续建议导入为 **sql_pairs**
- `import-format.md`：统一 front matter 字段约定
- `ui-import-checklist.md`：当前这批规则 / 模板的 UI 导入顺序与检查清单
- `import-manifest.sample.yaml`：未来导入脚本可参考的批量导入样例
- `../_archive/knowledge-base/`：已归档的汇总页、模板草稿与生成稿，不作为当前 UI 导入主数据源

> 建议把 `analysis-rules/` 与 `sql-templates/` 下的**单文件文档**作为后续导入的权威来源；
> 已归档的汇总页、模板草稿与 suggestedQuestions 生成稿仅保留备查，不参与当前导入链路。

## 推荐导入映射

### 1. 分析规则 -> instruction

- `scope: global` 对应全局 instruction（`isGlobal = true` / `isDefault = true`）
- `scope: question_match` 对应 questions 匹配型 instruction（`isGlobal = false` / `isDefault = false`）
- `import_target` 固定为 `instruction`
- `question_match` 规则必须补 `questions`
- `keywords` 仅保留给人工维护参考，当前运行时不会直接拿 `keywords` 做 instruction 检索

### 2. SQL 模板 -> sql_pair

每个 SQL 模板文件至少补齐：
- `question_variants`
- `parameters`
- `status`
- `dialect`
- `parameter_style`
- `result_grain`
- `## SQL 模板` 正文

导入时应把 `question_variants` 展开成多条 `sql_pair` 记录，每条记录都是同一份 SQL 配一个自然语言问题。

推荐状态：
- `spec_only`：只有模板说明，还没有 SQL
- `draft_sql`：已经有 SQL 草案，但还没在实际 runtime datasource 验证
- `blocked_missing_source`：缺外部数据源
- `blocked_missing_sql_model`：缺 SQL 化模型

## 当前约束

1. 当前系统 SQL pair 创建时会做 SQL 校验，因此 **不能直接导入 ES DSL**。
2. 当前主链路只保留 **TiDB 表 / 视图可执行 SQL**；如果 legacy ES 索引已与 TiDB 表存在映射，直接保留对应 TiDB `sql_pair`，**不再单独保留 ES sql_pair**。
3. 目前已确认缺失的外部数据源：
   - 投放金额
   - 访问 PV
   - 访问 UV
   - 下载点击 UV

> 当前没有这些外部表时，仍可通过分析规则在对话中向用户索取对应数值，
> 再与 SQL 查询得到的内部指标拼接后输出数据和图表；
> 但这不等于已经具备可直接导入的 SQL 数据源，因此 `T05/T14/T15` 仍维持阻塞状态。

## 当前进度

- 分析规则单文件：14 个
- SQL 模板单文件：14 个
- 其中已补 SQL 草案：11 个
- 仍受阻模板：3 个（`T05/T14/T15`）

> 说明：原 `T07 VIP 最高等级分层` 属于 ES 指标占位模板，已归档到 `../_archive/knowledge-base/sql-templates/`，不再作为当前 `sql_pair` 主链路来源。

## 当前导入主链路

如果目标是通过 UI 方式导入并验证业务需求，当前应只使用下面这些目录 / 文件：

- `analysis-rules/`
- `sql-templates/`
- `import-format.md`
- `ui-import-checklist.md`
- `import-manifest.sample.yaml`（如需批量导入）

## 录入建议

建议先录：
- 分析规则（可先导入）
- SQL 模板定义（先文档化）
- 等 SQL 补完整并完成 runtime 校验后，再导入为 sql pairs

## 测试数据建议

- 造数方案见：[`../test-data-plan.md`](../test-data-plan.md)
- 推荐先按“1个平台 + 2渠道 + 7玩家 + 7天数据”做最小回归样例

- 示例造数入口：[`../seed_data_local/`](../seed_data_local/)
