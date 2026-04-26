---
kb_asset_type: business_term
import_target: business_dictionary
import_format_version: v1
id: roi
name: ROI
category: formula
status: active
priority: high
aliases:
  - ROI
  - 投放回收
  - 投入产出比
  - 回收率
definition: 收入或回收金额与投放金额的比率，依赖外部投放金额数据
canonical_expression: SUM(revenue_amount) / NULLIF(ad_spend, 0)
source_tables:
  - dwd_order_deposit
  - dwd_bet_order
source_fields:
  - revenue_amount
related_rules:
  - R09
  - R13
related_templates:
  - T05
features:
  - roi
  - external_dependency
conflict_terms: []
source_documents:
  - 第一期数据报表需求V1.xlsx
---

# ROI

## 定义

收入或回收金额与投放金额的比率，依赖外部投放金额数据

## 规范表达式

```sql
SUM(revenue_amount) / NULLIF(ad_spend, 0)
```

## Runtime 用途

- 通过 aliases 辅助识别用户问题中的业务概念。
- 通过 related_rules / related_templates 联动分析规则和 SQL 模板。
- 通过 features 参与 SQL 模板重排与 gating。
