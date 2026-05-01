# Knowledge Base 导入字段格式（v2）

该文档约定 `docs/业务需求/knowledge-base/` 下 Markdown 的统一 front matter 字段，方便系统批量导入、dry-run 校验和后续知识治理。

> 兼容原则：`v2` 是当前推荐写法；导入器必须继续兼容 `v1`，并忽略未知字段。`runtime_sync` 只记录运行态事实，不参与导入决策。

## 1. 通用约定

- 单文件 Markdown 是**导入权威来源**；汇总页只做浏览，不作为导入源。
- front matter 使用 YAML，正文仍保留人类可读说明和 SQL / 规则内容。
- `import_format_version` 支持 `v1` / `v2`；缺省按 `v1` 处理。
- `status` 表示源文档准备状态；导入 API 的 `status` 需按资产类型映射为系统支持值。
- 导入器应先做 dry-run，输出 API payload 预览，再由人工确认是否写入真实 workspace / knowledge base。

## 2. SQL 模板（`import_target = sql_pair`）

### 2.1 推荐 front matter

```yaml
kb_asset_type: sql_template
import_target: sql_pair
import_format_version: v2
dialect: tidb_mysql8
parameter_style: colon_named
id: T01
title: 渠道日基础汇总
report: 综合日报表
priority: high
status: draft_sql

# v2 治理字段
template_type: anchored_template
required_slots:
  - tenant_plat_id
  - channel_id
  - start_date
  - end_date
expected_grain: biz_date + channel_id
positive_scenarios:
  - 按天查看某渠道综合日报指标
negative_scenarios:
  - 单玩家充值明细
external_dependencies: []

# 兼容高级结构；导入器会把 v2 顶层字段合并进去
business_signature:
  template_id: T01
  concepts:
    - new_customer_first_deposit
  features:
    - daily_summary
  metrics:
    - deposit_amount
  dimensions:
    - biz_date
    - channel_id
  parameter_slots:
    - tenant_plat_id
  expected_grain: biz_date + channel_id

source_tables:
  - dwd_order_deposit
question_variants:
  - 按天查看某渠道综合日报指标
source_documents:
  - 第一期数据报表需求V1.xlsx
```

### 2.2 字段说明

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `kb_asset_type` | 是 | 固定为 `sql_template` |
| `import_target` | 是 | 固定为 `sql_pair` |
| `import_format_version` | 建议 | 推荐 `v2` |
| `template_type` | v2 建议 | `reference` / `trusted_reference` / `anchored_template` / `executable_template` |
| `required_slots` | v2 建议 | 模板硬套必须补齐的业务参数 |
| `expected_grain` | v2 建议 | 结果粒度；P0/P1 只保存和展示，完整 SemanticPlan 后再作为硬门槛 |
| `positive_scenarios` | v2 建议 | 适用场景 / 正向触发描述 |
| `negative_scenarios` | v2 建议 | 不适用场景 / 排除描述 |
| `external_dependencies` | 可选 | 依赖的外部数据 ID，如 `ad_spend` |
| `business_signature` | 可选 | 高级结构化签名，导入时与 v2 顶层字段合并 |
| `runtime_sync` | 可选 | 运行态回写，只读审计字段，导入器必须忽略 |

### 2.3 v2 到 SQL pair API 映射

| v2 文档字段 | SQL pair / API 字段 | 备注 |
| --- | --- | --- |
| `id` | `id` / `businessSignature.templateId` | 系统创建时可由后端生成 ID；模板业务 ID 放入签名 |
| `title` / `question_variants[0]` | `question` | 多问法可展开为多条 SQL pair |
| 正文 `## SQL 模板` 代码块 | `sql` | 必须是可渲染 SQL 或可信参考 SQL |
| `template_type` | `templateMode` | 缺省必须安全降级为 `reference` |
| `required_slots` | `parameterSchema.required` | v1 可从 `parameters` 兼容映射 |
| `expected_grain` | `businessSignature.expectedGrain` | 同时兼容旧 `business_signature.expected_grain` |
| `positive_scenarios` | `businessSignature.positiveCues` | runtime scoring 已消费 |
| `negative_scenarios` | `businessSignature.negativeCues` | runtime guard / scoring 已消费 |
| `external_dependencies` | `businessSignature.externalDependencies` | 外部数据缺失检测已消费 |
| `status` | `status` | `draft_sql` 是文档侧待导入/待复核状态；经治理导入 API 通过 owner/admin 审批后映射为 `active`，只有明确下线才写 `deprecated` |

## 3. 分析规则（`import_target = instruction`）

```yaml
kb_asset_type: analysis_rule
import_target: instruction
import_format_version: v2
id: R01
title: 汇总口径
scope: global
priority: high
status: draft
applies_to:
  - 综合日报表
questions: []
keywords: []
related_business_terms: []
related_external_dependencies: []
runtime_usage:
  participates_in:
    - instruction_retrieval
  priority_hint: high
source_documents:
  - 第一期数据报表需求V1.xlsx
```

映射规则：

| 文档字段 | API 字段 |
| --- | --- |
| `scope = global` | `isGlobal = true`, `isDefault = true` |
| `scope = question_match` | `isGlobal = false`, `isDefault = false` |
| `questions` | `instruction.questions` |
| `related_business_terms` | `relatedBusinessTerms` |
| `related_external_dependencies` | `relatedExternalDependencies` |
| `runtime_usage` | `runtimeUsage` |

`question_match` 规则必须提供完整自然语言问题，不能只写关键词。

## 4. 业务词典（`import_target = business_dictionary`）

```yaml
kb_asset_type: business_term
import_target: business_dictionary
import_format_version: v2
id: first_deposit
name: 首存
category: metric
status: active
aliases:
  - 首存
  - 首充
definition: 成功存款且 times = 1
canonical_expression: dwd_order_deposit.status = 2 AND dwd_order_deposit.times = 1
source_tables:
  - dwd_order_deposit
source_fields:
  - dwd_order_deposit.status
applicable_scenarios:
  - 首存 cohort
not_applicable_scenarios:
  - 普通充值订单汇总
required_slots:
  - tenant_plat_id
supported_grains:
  - first_deposit_date
  - date_range
related_rules:
  - R02
related_templates:
  - T03
features:
  - cohort
source_documents:
  - 第一期数据报表需求V1.xlsx
```

映射规则：

| 文档字段 | API 字段 |
| --- | --- |
| `id` | `termId` |
| `canonical_expression` | `canonicalExpression` |
| `source_tables` | `sourceTables` |
| `source_fields` | `sourceFields` |
| `related_rules` | `relatedRules` |
| `related_templates` | `relatedTemplates` |
| `conflict_terms` | `conflictTerms` |
| `applicable_scenarios` | `applicableScenarios` |
| `not_applicable_scenarios` | `notApplicableScenarios` |
| `required_slots` | `requiredSlots` |

`supported_grains` 是 v2 治理字段，用于描述业务词支持的日期 / 渠道 / cohort / 分层粒度。当前导入脚本可保留该字段作为知识资产元数据；完整结构化 SemanticPlan 上线后再作为 grain guard 的输入。

## 5. 外部数据依赖（`import_target = external_dependency`）

```yaml
kb_asset_type: external_dependency
import_target: external_dependency
import_format_version: v2
id: ad_spend
name: 投放金额
status: active
source_status: missing
missing_behavior: ask_user
aliases:
  - 投放金额
required_grain:
  - biz_date + channel_id
trigger_when:
  - 问题包含 ROI、获客成本、投放金额
not_trigger_when:
  - 只查询站内充值、投注、提现
lifecycle: per_question
input_modes:
  - single_value
  - csv_upload
required_by_terms:
  - roi
required_by_templates:
  - T05
ask_user_prompt: 请提供当前问题对应统计粒度的投放金额。
validation:
  value_type: number
  min: 0
required_grain_schema:
  required_columns:
    - date
    - channel_id
    - ad_spend
value_schema:
  ad_spend:
    type: number
    min: 0
join_contract:
  status: target_design
  join_keys:
    - biz_date
    - channel_id
  join_type: left_join_after_user_confirmation
```

映射规则：

| 文档字段 | API 字段 |
| --- | --- |
| `id` | `dependencyId` |
| `source_status` | `sourceStatus` |
| `missing_behavior` | `missingBehavior` |
| `required_grain` | `requiredGrain` |
| `required_by_terms` | `requiredByTerms` |
| `required_by_templates` | `requiredByTemplates` |
| `related_rules` | `relatedRules` |
| `trigger_when` | `triggerWhen` |
| `not_trigger_when` | `notTriggerWhen` |
| `lifecycle` | `lifecycle` |
| `input_modes` | `inputModes` |
| `ask_user_prompt` | `askUserPrompt` |
| `validation` | `validation` |

当前推荐 `lifecycle = per_question`，避免外部补充数据污染其他对话或 workspace。

`required_grain_schema`、`value_schema`、`join_contract` 是 v2 治理字段。当前运行时仍以“缺失阻断 + 追问”为主，不会因为配置了 `join_contract` 就自动生成联邦 join；这些字段用于后续结构化补数、CSV 校验和多知识库 / Trino 联邦能力演进。

## 6. 正文结构约定

### SQL 模板正文

1. `# 标题`
2. `## 模板用途`
3. `## 建议问题（可转为 sql_pair.question）`
4. `## 核心表/模型`
5. `## 参数`
6. `## SQL 模板`
7. `## 备注`

### 分析规则正文

1. `# 标题`
2. `## 规则内容`
3. `## 建议问题（可转为 instruction.questions，可选，建议与 front matter 同步）`
4. `## 导入建议`
5. `## 作用报表`
6. `## 关键词（可选）`
7. `## 备注`

### 业务词典 / 外部数据依赖正文

- 保留人类可读定义、触发/不触发说明、追问话术和维护备注。
- front matter 是导入结构化字段的来源；正文可用于人工审核和 AI 辅助生成建议。

## 7. v1/v2 兼容规则

- v1 文档仍可导入。
- v1 SQL 模板缺少 `template_type` 时，默认 `templateMode = reference`；不得自动提升为 `executable_template`。
- v1 SQL 模板可从 `parameters` 兼容生成 `parameterSchema.required`，但只有明确设置 `template_type` 后才允许硬套。
- v1 `business_signature.expected_grain`、`positive_cues`、`negative_cues`、`external_dependencies` 必须兼容映射到 camelCase API 字段。
- 缺少 `expected_grain` 时，不做 P0/P1 硬阻断；只作为 unknown 写入 diagnostics。
- `runtime_sync`、未知字段、注释字段必须忽略，避免未来扩展导致导入失败。
- 文档状态 `draft_sql` 不等于运行态 `draft`。导入为治理模板后，API 会补齐审批信息并进入 `active`，否则 AI runtime 会过滤该模板，导致问数路由退回到普通生成或错误参考模板。
- 已有 `reference` SQL pair 保持 `reference`；如需升级为 `anchored_template` / `executable_template`，必须补齐 `required_slots`、适用/不适用场景，并通过 dry-run / 回归验证。
