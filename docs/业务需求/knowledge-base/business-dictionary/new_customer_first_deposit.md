---
kb_asset_type: business_term
import_target: business_dictionary
import_format_version: v2
id: new_customer_first_deposit
name: 新客首存
category: metric
status: active
priority: high
aliases:
  - 新客首存
  - 注册当日首存
  - 当日注册首充
  - 当天注册首存
definition: 注册日期与首次成功存款日期为同一天的首存用户
canonical_expression: DATE(dwd_order_deposit.regist_time) = DATE(dwd_order_deposit.callback_time) AND dwd_order_deposit.times = 1
source_tables:
  - dwd_order_deposit
source_fields:
  - dwd_order_deposit.regist_time
  - dwd_order_deposit.callback_time
  - dwd_order_deposit.times
related_rules:
  - R03
related_templates:
  - T01
  - T03
features:
  - first_deposit
  - new_customer
conflict_terms:
  - develop_user
source_documents:
  - 第一期数据报表需求V1.xlsx
applicable_scenarios:
  - 统计新客首存、注册当日首存、当日注册首充
  - 综合日报中新客首存人数或新客首存金额
not_applicable_scenarios:
  - 统计非注册当日首存的开发人数
  - 统计全部首存用户且不区分注册日期
  - 统计普通充值或续存
required_slots:
  - tenant_plat_id
supported_grains:
  - biz_date
  - date_range
  - channel_id
---

# 新客首存

## 定义

注册日期与首次成功存款日期为同一天的首存用户

## 规范表达式

```sql
DATE(dwd_order_deposit.regist_time) = DATE(dwd_order_deposit.callback_time) AND dwd_order_deposit.times = 1
```

## Runtime 用途

- 通过 aliases 辅助识别用户问题中的业务概念。
- 通过 related_rules / related_templates 联动分析规则和 SQL 模板。
- 通过 features 参与 SQL 模板重排与 gating。
