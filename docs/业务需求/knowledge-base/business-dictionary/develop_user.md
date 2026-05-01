---
kb_asset_type: business_term
import_target: business_dictionary
import_format_version: v2
id: develop_user
name: 开发人数
category: metric
status: active
priority: high
aliases:
  - 开发人数
  - 老客首存
  - 非当日注册首存
  - 非新客首存
definition: 非注册当天完成首次成功存款的用户数
canonical_expression: DATE(dim_player.register_time) <> DATE(dwd_order_deposit.callback_time) AND dwd_order_deposit.times = 1
source_tables:
  - dim_player
  - dwd_order_deposit
source_fields:
  - dim_player.register_time
  - dwd_order_deposit.callback_time
  - dwd_order_deposit.times
related_rules:
  - R04
related_templates:
  - T01
features:
  - first_deposit
  - develop_user
conflict_terms:
  - new_customer_first_deposit
source_documents:
  - 第一期数据报表需求V1.xlsx
applicable_scenarios:
  - 统计开发人数、老客首存、非当日注册首存
  - 综合日报中区分新客首存与开发首存
not_applicable_scenarios:
  - 统计注册当天首存的新客首存
  - 统计全部首存用户且不区分注册日期
  - 统计普通充值或续存用户
required_slots:
  - tenant_plat_id
supported_grains:
  - biz_date
  - date_range
  - channel_id
---

# 开发人数

## 定义

非注册当天完成首次成功存款的用户数

## 规范表达式

```sql
DATE(dim_player.register_time) <> DATE(dwd_order_deposit.callback_time) AND dwd_order_deposit.times = 1
```

## Runtime 用途

- 通过 aliases 辅助识别用户问题中的业务概念。
- 通过 related_rules / related_templates 联动分析规则和 SQL 模板。
- 通过 features 参与 SQL 模板重排与 gating。
