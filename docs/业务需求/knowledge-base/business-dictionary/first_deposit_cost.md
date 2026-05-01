---
kb_asset_type: business_term
import_target: business_dictionary
import_format_version: v2
id: first_deposit_cost
name: 首存成本
category: formula
status: active
priority: high
aliases:
  - 首存成本
  - CPA
  - 获客成本
  - 首存获客成本
definition: 投放金额除以首存人数，依赖外部投放金额数据
canonical_expression: ad_spend / NULLIF(first_deposit_user_count, 0)
source_tables:
  - dwd_order_deposit
source_fields:
  - dwd_order_deposit.player_id
related_rules:
  - R13
related_templates:
  - T14
features:
  - first_deposit
  - cost
  - external_dependency
conflict_terms:
  - first_deposit
  - roi
source_documents:
  - 第一期数据报表需求V1.xlsx
applicable_scenarios:
  - 统计首存成本、CPA、获客成本
  - 需要用投放金额除以首存人数的成本分析
not_applicable_scenarios:
  - 只查询首存人数、首存金额或首存名单
  - 没有提供投放金额且问题不要求成本
  - 只查询站内充值、投注、提现指标
required_slots:
  - tenant_plat_id
supported_grains:
  - date_range + channel_id
  - biz_date + channel_id
  - cohort_period
---

# 首存成本

## 定义

投放金额除以首存人数，依赖外部投放金额数据

## 规范表达式

```sql
ad_spend / NULLIF(first_deposit_user_count, 0)
```

## Runtime 用途

- 通过 aliases 辅助识别用户问题中的业务概念。
- 通过 related_rules / related_templates 联动分析规则和 SQL 模板。
- 通过 features 参与 SQL 模板重排与 gating。
