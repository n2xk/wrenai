---
kb_asset_type: business_term
import_target: business_dictionary
import_format_version: v2
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
applicable_scenarios:
  - 统计首存 cohort 后的二存到六存人数、金额或续存率
  - 按首存日期、相对日龄或渠道分析续存表现
not_applicable_scenarios:
  - 统计普通成功充值订单汇总
  - 只提取首存用户名单或首存金额
  - 统计所有用户区间充值，不以首存 cohort 为分母
required_slots:
  - tenant_plat_id
supported_grains:
  - first_deposit_date
  - relative_day_no
  - channel_id
  - deposit_times
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
