---
kb_asset_type: business_term
import_target: business_dictionary
import_format_version: v2
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
  - marketing_external_metrics_daily
source_fields:
  - dwd_order_deposit.amount
  - dwd_bet_order.win_loss_amount
  - marketing_external_metrics_daily.ad_spend
related_rules:
  - R09
  - R13
related_templates:
  - T05
features:
  - roi
  - external_dependency
conflict_terms:
  - bet_deposit_ratio
  - kill_rate
  - first_deposit_cost
source_documents:
  - 第一期数据报表需求V1.xlsx
applicable_scenarios:
  - 统计 ROI、投放回收、投入产出比、回收率
  - 需要使用渠道收入或累计收入除以投放金额
not_applicable_scenarios:
  - 只查询站内充值、投注、提现、输赢或渠道收入
  - 没有投放金额且问题不要求投放回收
  - 查询投充比或杀率等不依赖投放成本的比率
required_slots:
  - tenant_plat_id
supported_grains:
  - date_range + channel_id
  - biz_date + channel_id
  - cohort_period
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
