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
