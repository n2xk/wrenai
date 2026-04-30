---
kb_asset_type: business_term
import_target: business_dictionary
import_format_version: v2
id: first_deposit
name: 首存
category: metric
status: active
priority: high
aliases:
  - 首存
  - 首充
  - 首次存款
  - 第一次充值
  - first deposit
definition: 成功存款且 times = 1
canonical_expression: dwd_order_deposit.status = 2 AND dwd_order_deposit.times = 1
source_tables:
  - dwd_order_deposit
source_fields:
  - dwd_order_deposit.status
  - dwd_order_deposit.times
  - dwd_order_deposit.callback_time
related_rules:
  - R02
related_templates:
  - T03
  - T04
  - T08
  - T10
  - T13
applicable_scenarios:
  - 首存 cohort 用户提取
  - 首存后续存、留存、日龄趋势分析
  - 首存金额分桶
not_applicable_scenarios:
  - 普通成功充值订单汇总
  - 玩家所有充值明细
  - 登录但未充值用户筛选
required_slots:
  - tenant_plat_id
features:
  - cohort
  - first_deposit
conflict_terms: []
source_documents:
  - 第一期数据报表需求V1.xlsx
---

# 首存

## 定义

成功存款且 times = 1

## 规范表达式

```sql
dwd_order_deposit.status = 2 AND dwd_order_deposit.times = 1
```

## Runtime 用途

- 通过 aliases 辅助识别用户问题中的业务概念。
- 通过 related_rules / related_templates 联动分析规则和 SQL 模板。
- 通过 features 参与 SQL 模板重排与 gating。
