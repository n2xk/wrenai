---
kb_asset_type: external_dependency
import_target: external_dependency
import_format_version: v1
id: ad_spend
name: 投放金额
status: active
source_status: missing
missing_behavior: ask_user
aliases:
  - 投放金额
  - 买量成本
  - 广告消耗
  - 推广成本
  - 投放成本
required_grain:
  - biz_date + channel_id
  - date_range + channel_id
  - cohort_period
required_by_terms:
  - roi
  - first_deposit_cost
required_by_templates:
  - T05
  - T14
related_rules:
  - R13
ask_user_prompt: 请提供当前问题对应统计粒度的投放金额。
validation:
  value_type: number
  min: 0
source_documents:
  - 第一期数据报表需求V1.xlsx
---

# 投放金额

## 缺失处理

当前 TiDB 数据源不包含 `投放金额`，当问数问题或 SQL 模板依赖该指标时，runtime 应按 `missing_behavior = ask_user` 向用户索取对应粒度的数据，而不是编造结果。

## 追问话术

请提供当前问题对应统计粒度的投放金额。
