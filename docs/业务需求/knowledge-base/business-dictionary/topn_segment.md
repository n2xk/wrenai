---
kb_asset_type: business_term
import_target: business_dictionary
import_format_version: v1
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
  - 非TOP3
  - 非TOP5
  - TOPN
  - 头部游戏
definition: 按照用户区间内投注额最高的游戏排名划分 TOPN / 非 TOPN 用户分层
canonical_expression: ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY valid_amount DESC) <= N
source_tables:
  - dwd_bet_order
source_fields:
  - dwd_bet_order.player_id
  - dwd_bet_order.game_type_id
  - dwd_bet_order.valid_amount
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
---

# TOPN 分层

## 定义

按照用户区间内投注额最高的游戏排名划分 TOPN / 非 TOPN 用户分层

## 规范表达式

```sql
ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY valid_amount DESC) <= N
```

## Runtime 用途

- 通过 aliases 辅助识别用户问题中的业务概念。
- 通过 related_rules / related_templates 联动分析规则和 SQL 模板。
- 通过 features 参与 SQL 模板重排与 gating。
