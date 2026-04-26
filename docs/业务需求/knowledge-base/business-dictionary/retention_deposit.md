---
kb_asset_type: business_term
import_target: business_dictionary
import_format_version: v1
id: retention_deposit
name: 续存
category: metric
status: active
priority: high
aliases:
  - 续存
  - 复存
  - 二存
  - 三存
  - 2存
  - 3存
  - 2~6存
  - 二存到六存
definition: 首存后第 2 至第 6 次成功存款行为，用于续存人数、金额和续存率统计
canonical_expression: dwd_order_deposit.status = 2 AND dwd_order_deposit.times BETWEEN 2 AND 6
source_tables:
  - dwd_order_deposit
source_fields:
  - dwd_order_deposit.status
  - dwd_order_deposit.times
  - dwd_order_deposit.callback_time
related_rules:
  - R10
related_templates:
  - T08
features:
  - retention
  - cohort
  - deposit_times
conflict_terms:
  - first_deposit
source_documents:
  - 第一期数据报表需求V1.xlsx
---

# 续存

## 定义

首存后第 2 至第 6 次成功存款行为，用于续存人数、金额和续存率统计

## 规范表达式

```sql
dwd_order_deposit.status = 2 AND dwd_order_deposit.times BETWEEN 2 AND 6
```

## Runtime 用途

- 通过 aliases 辅助识别用户问题中的业务概念。
- 通过 related_rules / related_templates 联动分析规则和 SQL 模板。
- 通过 features 参与 SQL 模板重排与 gating。
