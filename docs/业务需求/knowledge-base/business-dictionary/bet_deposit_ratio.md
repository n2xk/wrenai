---
kb_asset_type: business_term
import_target: business_dictionary
import_format_version: v1
id: bet_deposit_ratio
name: 投充比
category: formula
status: active
priority: high
aliases:
  - 投充比
  - 投注充值比
  - 投注/充值
  - 投注除以充值
definition: 投注金额与存款金额的比率，应先汇总分子分母再相除
canonical_expression: SUM(valid_amount) / NULLIF(SUM(deposit_amount), 0)
source_tables:
  - dwd_bet_order
  - dwd_order_deposit
source_fields:
  - dwd_bet_order.valid_amount
  - dwd_order_deposit.amount
related_rules:
  - R07
related_templates:
  - T01
  - T09
  - T10
features:
  - ratio
  - bet_deposit
conflict_terms: []
source_documents:
  - 第一期数据报表需求V1.xlsx
---

# 投充比

## 定义

投注金额与存款金额的比率，应先汇总分子分母再相除

## 规范表达式

```sql
SUM(valid_amount) / NULLIF(SUM(deposit_amount), 0)
```

## Runtime 用途

- 通过 aliases 辅助识别用户问题中的业务概念。
- 通过 related_rules / related_templates 联动分析规则和 SQL 模板。
- 通过 features 参与 SQL 模板重排与 gating。
