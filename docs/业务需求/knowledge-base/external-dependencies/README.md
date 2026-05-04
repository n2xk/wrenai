# 外部数据依赖

本目录维护当前系统缺失但业务问数会依赖的外部指标，以及缺失时的追问/阻塞策略。导入目标为 `external_dependency`。

补充约定：

- 外部依赖统一使用 `import_format_version: v2`。
- `trigger_when` / `not_trigger_when` 必须成对维护，避免 ROI / 流量指标误触发或漏触发。
- `lifecycle` 当前统一为 `per_question`，防止用户补充的外部数据污染其他对话、workspace 或知识库。
- `required_grain_schema` / `value_schema` / `join_contract` 是结构化补数和联邦 join 的治理字段；当前运行时已支持缺失时进入 clarification 补数表单，并把本次补充值注入 SQL 生成上下文，但仍不会自动创建持久外部表或跨问题复用数据。
