# Knowledge Base 导入字段格式（v1）

该文档约定 `docs/业务需求/knowledge-base/` 下 Markdown 的统一 front matter 字段，方便后续系统批量导入。

## 1. SQL 模板（`import_target = sql_pair`）

建议字段顺序：

```yaml
kb_asset_type: sql_template
import_target: sql_pair
import_format_version: v1
dialect: tidb_mysql8
parameter_style: colon_named
result_grain: biz_date + channel_id
id: T01
title: 渠道日基础汇总
report: 综合日报表
priority: high
status: draft_sql
source_tables:
  - dwd_order_deposit
parameters:
  - tenant_plat_id
question_variants:
  - 统计某渠道每日存款金额
source_documents:
  - 第一期数据报表需求V1.xlsx
```

### 字段说明

- `kb_asset_type`：资产类型，SQL 模板固定为 `sql_template`
- `import_target`：未来导入目标，SQL 模板固定为 `sql_pair`
- `import_format_version`：导入字段版本，当前为 `v1`
- `dialect`：SQL 方言，当前统一约定为 `tidb_mysql8`
- `parameter_style`：参数占位风格，当前统一约定为 `colon_named`
- `result_grain`：结果粒度描述，便于后续导入时做展示/缓存策略
- `status`：当前推荐值：`spec_only` / `draft_sql` / `blocked_missing_source` / `blocked_missing_sql_model`

### 可选运行态回写字段

如果已经完成一次真实 workspace 导入并验证，可在 SQL 模板 front matter 中追加只读的 `runtime_sync` 字段块，用来记录“当前环境实际落库状态”。

示例：

```yaml
runtime_sync:
  last_verified_at: 2026-04-26
  sync_source: 当前TiDB workspace知识资产快照-2026-04-26
  workspace_id: e4fd1d67-59a5-42de-adf2-1777698b5f21
  knowledge_base_id: 27ea94ff-415f-4a28-af88-0b0dc226e598
  kb_snapshot_id: 27fa6535-b932-4cfc-a231-35bd15d13329
  deploy_hash: 5f88d9c5a3d8c23d2280c6f3b9fdf759543f46d0
  import_status: imported
  question_count: 3
  record_ids:
    - 75
    - 76
    - 77
  asset_kind: sql_template
  source_type: business_import
  template_level: L2
  template_mode: anchored_template
```

说明：

- `runtime_sync` 是**运行态事实回写**，不是新的导入源字段
- 导入脚本应忽略 `runtime_sync`，只把它当作审计/对账信息
- `status` 仍表示源文档编写/准备状态；`runtime_sync.import_status` 表示某个实际环境是否已导入
- 如果模板未导入，可写为：
  - `import_status: blocked`
  - `blocked_reason: blocked_missing_source`
  - `record_ids: []`

## 2. 分析规则（`import_target = instruction`）

建议字段顺序：

```yaml
kb_asset_type: analysis_rule
import_target: instruction
import_format_version: v1
id: R01
title: 汇总口径
scope: global
priority: high
status: draft
applies_to:
  - 综合日报表
questions: []
keywords: []
source_documents:
  - 第一期数据报表需求V1.xlsx
```

### 字段说明

- `kb_asset_type`：资产类型，规则固定为 `analysis_rule`
- `import_target`：未来导入目标，规则固定为 `instruction`
- `scope`：业务文档侧仍使用 `global` 或 `question_match`；导入到系统时应映射为：
  - `global` -> `isGlobal = true` / `isDefault = true`
  - `question_match` -> `isGlobal = false` / `isDefault = false`
- `questions`：仅 `question_match` 规则必填，导入后对应系统的 `instruction.questions`，必须填写完整自然语言问法，不能只写关键词
- `keywords`：可选，仅作为人工维护时的辅助标签；当前运行时不会直接用它做 instruction 检索
- `status`：当前统一先用 `draft`

## 3. 正文结构约定

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

## 4. 当前实现建议

- 单文件 Markdown 作为**权威来源**
- 汇总页（`analysis-rules.md` / `sql-templates.md`）仅做浏览，不作为导入源
- 系统真正做导入时，规则至少要解析 front matter 中的 `questions` 与 `## 规则内容` 主体
- SQL 模板导入时，应将 `question_variants` 展开为多条 `sql_pair.question + sql_pair.sql`

## 业务知识配置中心扩展字段（2026-04-26）

为支持业务知识配置中心，导入器需识别以下新增资产与结构化字段。

### 业务词典 `business_dictionary`

- 文件目录：`business-dictionary/`
- `kb_asset_type`: `business_term`
- `import_target`: `business_dictionary`
- 核心字段：`id`, `name`, `category`, `aliases`, `definition`, `canonical_expression`, `source_tables`, `source_fields`, `related_rules`, `related_templates`, `features`, `conflict_terms`, `status`

导入到 UI/API 时字段映射为：

| 文档字段 | API 字段 |
| --- | --- |
| `id` | `termId` |
| `name` | `name` |
| `category` | `category` |
| `aliases` | `aliases` |
| `definition` | `definition` |
| `canonical_expression` | `canonicalExpression` |
| `source_tables` | `sourceTables` |
| `source_fields` | `sourceFields` |
| `related_rules` | `relatedRules` |
| `related_templates` | `relatedTemplates` |
| `features` | `features` |
| `conflict_terms` | `conflictTerms` |
| `status` | `status` |

### 外部数据依赖 `external_dependency`

- 文件目录：`external-dependencies/`
- `kb_asset_type`: `external_dependency`
- `import_target`: `external_dependency`
- 核心字段：`id`, `name`, `aliases`, `source_status`, `missing_behavior`, `required_grain`, `required_by_terms`, `required_by_templates`, `related_rules`, `ask_user_prompt`, `validation`, `status`

导入到 UI/API 时字段映射为：

| 文档字段 | API 字段 |
| --- | --- |
| `id` | `dependencyId` |
| `source_status` | `sourceStatus` |
| `missing_behavior` | `missingBehavior` |
| `required_grain` | `requiredGrain` |
| `required_by_terms` | `requiredByTerms` |
| `required_by_templates` | `requiredByTemplates` |
| `related_rules` | `relatedRules` |
| `ask_user_prompt` | `askUserPrompt` |
| `validation` | `validation` |

### SQL 模板结构化字段 `business_signature`

所有 `sql-templates/T*.md` 可增加：

```yaml
business_signature:
  template_id: T08
  concepts: []
  features: []
  metrics: []
  dimensions: []
  parameter_slots: []
  external_dependencies: []
  positive_cues: []
  negative_cues: []
  expected_grain: first_deposit_date + channel_id
```

导入到 UI/API 时可直接保存到 SQL pair 的 `businessSignature` JSON 字段；runtime 同时兼容 snake_case 与 camelCase key。

### 分析规则结构化字段

所有 `analysis-rules/R*.md` 可增加：

```yaml
related_business_terms: []
related_external_dependencies: []
runtime_usage:
  participates_in:
    - instruction_retrieval
  priority_hint: high
```

导入到 UI/API 时字段映射为 `relatedBusinessTerms`、`relatedExternalDependencies`、`runtimeUsage`。
