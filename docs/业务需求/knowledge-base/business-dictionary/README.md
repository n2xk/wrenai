# 业务词典

本目录维护业务概念、同义词、定义、来源字段、关联规则与 SQL 模板。导入目标为 `business_dictionary`。

补充约定：

- 核心业务词统一使用 `import_format_version: v2`。
- `applicable_scenarios` / `not_applicable_scenarios` 用于降低业务词泛化误判和 SQL 模板误锚定。
- `required_slots` 用于沉淀业务必填槽位；运行时硬门槛仍由问数策略和模板参数共同执行。
- `supported_grains` 是面向 SemanticPlan 的治理字段，当前主要作为文档元数据保留。
