---
kb_asset_type: business_term
import_target: business_dictionary
import_format_version: v1
id: kill_rate
name: 杀率
category: formula
status: active
priority: high
aliases:
  - 杀率
  - 平台杀率
  - 输赢率
  - 用户输赢率
definition: 平台输赢或用户输赢相对投注额的比率，必须保持收入/输赢口径一致
canonical_expression: SUM(net_win_amount) / NULLIF(SUM(valid_amount), 0)
source_tables:
  - dwd_bet_order
source_fields:
  - dwd_bet_order.valid_amount
  - dwd_bet_order.net_win_amount
related_rules:
  - R08
related_templates:
  - T09
  - T10
  - T11
  - T12
features:
  - ratio
  - kill_rate
  - game_type
conflict_terms: []
source_documents:
  - 第一期数据报表需求V1.xlsx
---

# 杀率

## 定义

平台输赢或用户输赢相对投注额的比率，必须保持收入/输赢口径一致

## 规范表达式

```sql
SUM(net_win_amount) / NULLIF(SUM(valid_amount), 0)
```

## Runtime 用途

- 通过 aliases 辅助识别用户问题中的业务概念。
- 通过 related_rules / related_templates 联动分析规则和 SQL 模板。
- 通过 features 参与 SQL 模板重排与 gating。
