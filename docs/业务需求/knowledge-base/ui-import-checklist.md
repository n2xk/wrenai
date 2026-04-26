# UI 导入检查清单

这份清单面向“通过 UI / MCP Playwright 导入业务知识资产”的场景，目标是让导入顺序、导入范围、字段校验和阻塞项清楚可执行。

## 1. 当前结论

当前知识库导入范围已经从旧版：

```text
分析规则 + SQL 模板
```

扩展为：

```text
分析规则 + 业务词典 + 外部数据依赖 + SQL 模板
```

本轮应导入 / 验证的资产包括：

- **分析规则**：14 个
  - 1 个 `global` 规则可直接作为全局 instruction 导入
  - 13 个 `question_match` 规则需带 `questions` 后再导入
- **业务词典**：10 个
  - 用于业务概念、同义词、规范表达式、关联规则/模板配置
- **外部数据依赖**：4 个
  - 用于缺失外部指标检测与 `ask_user` 追问
- **SQL 模板**：14 个
  - 可执行主范围：11 个 `draft_sql`
  - 阻塞验证范围：3 个 `blocked_missing_source`（`T05/T14/T15`）

> 2026-04-26 更新：业务词典和外部数据依赖已成为正式导入与回归对象；不能只验证分析规则和 SQL 模板。

---

## 2. 导入前统一检查

在 UI 导入前，逐条确认所有 Markdown 文件满足基础格式：

- front matter 存在
- `id` 唯一
- `kb_asset_type` / `import_target` 正确
- `import_format_version = v1`
- `title` 或 `name` 已填写
- `priority` / `status` 已填写（如资产类型需要）
- 主体内容存在，且与 front matter 不冲突

### 2.1 分析规则检查

目录：

- `docs/业务需求/knowledge-base/analysis-rules/`

检查字段：

- `kb_asset_type = analysis_rule`
- `import_target = instruction`
- `scope`
- `questions`（仅 `question_match` 必填）
- `keywords`
- `related_business_terms`
- `related_external_dependencies`
- `runtime_usage`
- `## 规则内容`

### 2.2 业务词典检查

目录：

- `docs/业务需求/knowledge-base/business-dictionary/`

检查字段：

- `kb_asset_type = business_term`
- `import_target = business_dictionary`
- `id`
- `name`
- `category`
- `aliases`
- `definition`
- `canonical_expression`
- `source_tables`
- `source_fields`
- `related_rules`
- `related_templates`
- `features`
- `conflict_terms`
- `status`

必须确认：

- `aliases` 不为空
- `related_rules` 指向存在的 Rxx
- `related_templates` 指向存在的 Txx
- `canonical_expression` 与规则口径一致

### 2.3 外部数据依赖检查

目录：

- `docs/业务需求/knowledge-base/external-dependencies/`

检查字段：

- `kb_asset_type = external_dependency`
- `import_target = external_dependency`
- `id`
- `name`
- `aliases`
- `source_status`
- `missing_behavior`
- `required_grain`
- `required_by_terms`
- `required_by_templates`
- `related_rules`
- `ask_user_prompt`
- `validation`
- `status`

必须确认：

- 当前缺失指标的 `source_status = missing`
- 当前缺失处理的 `missing_behavior = ask_user`
- `required_by_terms` 指向存在的业务词典 ID
- `required_by_templates` 指向 T05/T14/T15 或相关模板
- `ask_user_prompt` 明确表达需要用户补充什么数据

### 2.4 SQL 模板检查

目录：

- `docs/业务需求/knowledge-base/sql-templates/`

检查字段：

- `kb_asset_type = sql_template`
- `import_target = sql_pair`
- `dialect = tidb_mysql8`
- `parameter_style = colon_named`
- `result_grain`
- `id`
- `title`
- `status`
- `parameters`
- `question_variants`
- `business_signature`
- `## SQL 模板`

必须确认：

- `question_variants` 非空（仅可执行模板）
- `business_signature.template_id` 与 front matter `id` 一致
- `business_signature.concepts/features/metrics/dimensions` 与业务词典一致
- `business_signature.external_dependencies` 与外部依赖一致
- T05/T14/T15 保持 `blocked_missing_source`，不作为可执行 SQL pair 主链路

---

## 3. 建议导入顺序

### Step 1：先导入分析规则

建议顺序：

1. `R01_汇总口径.md`
2. `R02_首存定义.md`
3. `R03_新客首存.md`
4. `R04_开发人数.md`
5. `R05_TOPN 口径.md`
6. `R06_VIP 分层口径.md`
7. `R07_投充比公式.md`
8. `R08_杀率公式.md`
9. `R09_ROI 收入口径.md`
10. `R10_续存口径.md`
11. `R11_游戏类型分布口径.md`
12. `R12_首存金额分桶.md`
13. `R13_缺失数据源处理.md`
14. `R14_ES 数据使用限制.md`

说明：

- 规则建议优先导入，因为它们会影响后续问答和 SQL 模板解释边界。
- `R13` 和 `R14` 属于“缺失源 / ES 限制”类规则，必须导入。
- `R13` 导入后，应验证它是否会在命中“投放金额 / PV / UV / 下载点击UV / 首存成本 / ROI”时，先要求用户补充外部数据。

### Step 2：导入业务词典

建议顺序：

1. `first_deposit.md`
2. `new_customer_first_deposit.md`
3. `develop_user.md`
4. `retention_deposit.md`
5. `topn_segment.md`
6. `bet_deposit_ratio.md`
7. `kill_rate.md`
8. `roi.md`
9. `first_deposit_cost.md`
10. `traffic_metrics.md`

说明：

- 业务词典应在 SQL 模板前导入，便于模板的 `business_signature` 与词典概念对齐。
- 导入后应确认 alias 已进入检索索引，例如“首充”“二存”“TOP3”“投充比”“杀率”。

### Step 3：导入外部数据依赖

建议顺序：

1. `ad_spend.md`
2. `access_pv.md`
3. `access_uv.md`
4. `download_click_uv.md`

说明：

- 外部依赖应在 SQL 模板前导入，便于 T05/T14/T15 的 `external_dependencies` 能正确关联。
- 当前四条依赖均为 `source_status = missing`，导入后的预期行为是要求用户补充数据，而不是执行 SQL 编造结果。

### Step 4：再导入可用 SQL 模板

建议先导入这 11 个可执行模板：

1. `T01_渠道日基础汇总.md`
2. `T02_渠道与折扣映射.md`
3. `T03_首存 cohort 提取.md`
4. `T04_cohort 累计收入.md`
5. `T06_TOP3-非TOP3 分层.md`
6. `T08_首存 cohort 续存.md`
7. `T09_所有用户区间汇总.md`
8. `T10_首存用户日龄趋势.md`
9. `T11_按游戏类型分布.md`
10. `T12_TOP3-5 游戏类型分层.md`
11. `T13_首存金额分桶.md`

导入后应确认：

- `source_type = business_import`
- `template_level = L2`
- `template_mode = anchored_template`
- `parameter_schema` 已生成或已保存
- `business_signature` 已保存或能在 diagnostics 中体现

### Step 5：阻塞模板作为缺失依赖场景验证

下面 3 个文件建议在 UI 中标记为“待补齐 / 缺失外部依赖”，不要当作可执行 SQL 模板导入：

| ID | 文件 | 当前状态 | 阻塞原因 | 关联外部依赖 |
| --- | --- | --- | --- | --- |
| T05 | `T05_cohort ROI.md` | `blocked_missing_source` | 缺投放金额数据源 | `ad_spend` |
| T14 | `T14_投放金额并表.md` | `blocked_missing_source` | 缺投放金额数据源 | `ad_spend` |
| T15 | `T15_流量指标并表.md` | `blocked_missing_source` | 缺 PV / UV / 下载点击 UV 数据源 | `access_pv` / `access_uv` / `download_click_uv` |

补充说明：

- 原 `T07_VIP 最高等级分层.md` 依赖 legacy ES 指标映射，现已移入 `_archive`，不参与当前 UI 导入。

---

## 4. UI 导入后的验证顺序

导入完成后，建议按下面顺序验证。

### 4.1 资产列表验证

- 分析规则：14 条
- 业务词典：10 条
- 外部数据依赖：4 条
- SQL 主模板：11 个可执行模板或其问题变体
- T05/T14/T15：保持阻塞模板状态

### 4.2 运行时索引验证

至少验证：

- 业务词典进入 instruction / retrieval 索引：`knowledge_asset_type = business_term`
- 外部依赖进入 instruction / retrieval 索引：`knowledge_asset_type = external_dependency`
- SQL 模板 diagnostics 能看到 `business_import / L2 / anchored_template`

### 4.3 规则类问题验证

先问规则类问题，确认口径是否被正确约束：

- 首存定义
- 新客首存
- TOPN 口径
- VIP 分层口径
- 缺失数据源处理
- ES 数据使用限制

### 4.4 业务词典 alias 验证

推荐问题：

> 统计租户平台990001下渠道990011在2026-04-01到2026-04-03首充 cohort 的二存到六存人数、比率和均额

预期：

- “首充”命中 `first_deposit`
- “二存到六存”命中 `retention_deposit`
- 结果与 T08 标准答案一致

### 4.5 模板类问题验证

再问模板类问题，确认是否能命中对应 SQL 模板：

- 综合日报
- 渠道与折扣映射
- cohort 收入
- TOPN 分层
- 日龄趋势
- 游戏类型分布
- 首存金额分桶

### 4.6 外部依赖阻断验证

推荐问题：

> 统计租户平台990001下渠道990011在2026-04-01到2026-04-03首存cohort从D1到D7的ROI

预期：

- 命中 `roi`
- 检测到 `ad_spend / 投放金额` 缺失
- 要求用户补充投放金额
- 不编造 ROI

推荐问题：

> 统计租户平台990001下渠道990011在2026-04-01到2026-04-06的渠道日报，并补充PV、UV、下载点击UV、UV下载率和UV注册率

预期：

- 检测到 `access_pv / 访问PV`
- 检测到 `access_uv / 访问UV`
- 检测到 `download_click_uv / 下载点击UV`
- 要求用户按日期、渠道补充外部指标
- 不编造流量指标

### 4.7 最后用测试数据做验收

- 造数：`../seed.sql`
- 执行说明：`../test-runbook.md`
- 预期结果：`../expected-results.md`
- Excel / CSV 核对：`../csv/`

---

## 5. 推荐的 UI 导入批次

如果 UI 一次导入量不宜过大，建议拆成 5 批。

### 批次 A：全局 / 通用规则

- R01
- R02
- R03
- R04
- R05
- R06
- R07
- R08
- R13
- R14

### 批次 B：报表专项规则

- R09
- R10
- R11
- R12

### 批次 C：业务词典

- `business-dictionary/*.md`

### 批次 D：外部数据依赖

- `external-dependencies/*.md`

### 批次 E：SQL 模板

- T01
- T02
- T03
- T04
- T06
- T08
- T09
- T10
- T11
- T12
- T13

---

## 6. 当前主数据源

当前 UI 导入应使用下面四个目录作为权威来源：

- `analysis-rules/`
- `business-dictionary/`
- `external-dependencies/`
- `sql-templates/`

下面这些都**不应作为当前 UI 导入输入源**：

- `../_archive/knowledge-base/analysis-rules.md`
- `../_archive/knowledge-base/sql-templates.md`
- `../_archive/knowledge-base/_templates/`
- `../_archive/knowledge-base/table-suggested-questions.generated.csv`
- `../_archive/knowledge-base/table-suggested-questions.generated.json`

---

## 7. 通过标准

导入阶段通过需满足：

1. 四类资产均可在知识库 UI 或同源 API 中查询到。
2. 分析规则数量为 14。
3. 业务词典数量为 10。
4. 外部数据依赖数量为 4。
5. 主 SQL 模板能进入业务模板态。
6. 业务词典 alias 能影响问数匹配。
7. 外部数据依赖能影响缺失数据源追问。
8. T05/T14/T15 不被错误当作可执行 SQL 直接输出伪造结果。
