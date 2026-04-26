---
kb_asset_type: business_term
import_target: business_dictionary
import_format_version: v1
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
conflict_terms: []
source_documents:
  - 第一期数据报表需求V1.xlsx
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
