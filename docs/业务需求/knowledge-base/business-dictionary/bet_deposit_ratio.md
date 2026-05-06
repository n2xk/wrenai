---
kb_asset_type: business_term
import_target: business_dictionary
import_format_version: v2
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
canonical_expression: SUM(dwd_bet_order.valid_bet_amount) / NULLIF(SUM(dwd_order_deposit.amount), 0)
source_tables:
  - dwd_bet_order
  - dwd_order_deposit
source_fields:
  - dwd_bet_order.valid_bet_amount
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
conflict_terms:
  - roi
  - kill_rate
source_documents:
  - 第一期数据报表需求V1.xlsx
applicable_scenarios:
  - 统计投充比、投注充值比、投注/充值比例
  - 综合日报、投充比与杀率报表中的区间汇总或渠道汇总
  - 需要同时使用成功充值金额与有效投注金额的比率分析
not_applicable_scenarios:
  - 只查询投注金额、充值金额或玩家明细，不要求比率
  - 查询 ROI、获客成本、首存成本等依赖投放金额的指标
  - 查询杀率或输赢率，分子分母不是投注/充值
required_slots:
  - tenant_plat_id
supported_grains:
  - biz_date
  - date_range
  - channel_id
  - player_segment
---

# 投充比

## 定义

投注金额与存款金额的比率，应先汇总分子分母再相除

## 规范表达式

```sql
SUM(dwd_bet_order.valid_bet_amount) / NULLIF(SUM(dwd_order_deposit.amount), 0)
```

## Runtime 用途

- 通过 aliases 辅助识别用户问题中的业务概念。
- 通过 related_rules / related_templates 联动分析规则和 SQL 模板。
- 通过 features 参与 SQL 模板重排与 gating。
