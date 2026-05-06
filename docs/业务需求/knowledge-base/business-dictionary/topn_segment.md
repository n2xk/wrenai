---
kb_asset_type: business_term
import_target: business_dictionary
import_format_version: v2
id: topn_segment
name: TOPN 分层
category: segment
status: active
priority: high
aliases:
  - TOP3
  - TOP5
  - 前3
  - 前5
  - 前3个用户
  - 前5个用户
  - 前3个大户
  - 前5个大户
  - 非TOP3
  - 非TOP5
  - TOPN
  - 大户
  - 头部用户
  - 高流水用户
  - 投注流水最高
definition: 按用户在统计区间内的累计有效投注额从高到低排序，划分 TOPN / 非 TOPN 用户分层
canonical_expression: ROW_NUMBER() OVER (ORDER BY SUM(valid_bet_amount) DESC, player_id) <= N
source_tables:
  - dwd_bet_order
source_fields:
  - dwd_bet_order.player_id
  - dwd_bet_order.game_type_id
  - dwd_bet_order.valid_bet_amount
related_rules:
  - R05
related_templates:
  - T06
  - T09
  - T12
features:
  - topn_segment
  - ranking
conflict_terms: []
source_documents:
  - 第一期数据报表需求V1.xlsx
applicable_scenarios:
  - 按用户区间内累计有效投注划分 TOP3、TOP5、非 TOP3、非 TOP5
  - 用户说“大户”“头部用户”“投注流水最高的前 N 个用户”时，默认按累计有效投注额排序
  - 首存及续存率、投充比与杀率、游戏类型分布中的 TOPN 用户分层
not_applicable_scenarios:
  - 按渠道收入、充值金额或注册人数给渠道排名
  - 只查询单个游戏类型或单个玩家，不需要 TOPN 分层
  - 按单日投注额排序而不是区间累计投注额
required_slots:
  - tenant_plat_id
  - channel_id
  - start_date
  - end_date
  - top_n
supported_grains:
  - date_range
  - player_id
  - dim_game_type_id
  - top_n
---

# TOPN 分层

## 定义

按用户在统计区间内的累计有效投注额从高到低排序，划分 TOPN / 非 TOPN 用户分层。
当用户说“大户”“头部用户”“高流水用户”“投注流水最高的前 N 个用户”时，默认指这个口径。
如果活跃用户数不足 N，TOPN 使用实际活跃用户数，非 TOPN 为空集合或 0，并在回答中说明。

## 规范表达式

```sql
ROW_NUMBER() OVER (ORDER BY SUM(valid_bet_amount) DESC, player_id) <= N
```

## Runtime 用途

- 通过 aliases 辅助识别用户问题中的业务概念。
- 通过 related_rules / related_templates 联动分析规则和 SQL 模板。
- 通过 features 参与 SQL 模板重排与 gating。
