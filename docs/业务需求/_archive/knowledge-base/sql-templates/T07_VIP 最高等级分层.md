---
kb_asset_type: sql_template
import_target: sql_pair
import_format_version: v1
dialect: tidb_mysql8
parameter_style: colon_named
result_grain: player_id
id: T07
title: VIP 最高等级分层
report: ROI/投充比与杀率
priority: high
status: blocked_missing_sql_model
source_tables:
  - 玩家日 VIP SQL 模型（建议由 ads_player_line_day_of_report / ads_player_game_day_of_report 同步而来）
parameters:
  - tenant_plat_id
  - channel_id
  - start_date
  - end_date
question_variants:
  - 按统计区间内达到的最高 VIP 等级给用户分层
source_documents:
  - 第一期数据报表需求V1.xlsx
  - 数据报表API对应SQL&DSL语句整理.xlsx
  - 数据报表表结构Design_with_comments（4.15 v1.2）.sql
---

# T07 VIP 最高等级分层

> 已于 2026-04-24 从当前 `knowledge-base/sql-templates/` 主链路归档。
> 原因：当前系统只保留 TiDB 表 / 视图可执行 SQL pair，不再保留独立 ES sql_pair 占位模板。

## 模板用途

按统计区间内达到的最高 VIP 等级给用户分层。

## 建议问题（历史记录）

- 按统计区间内达到的最高 VIP 等级给用户分层

## 核心表/模型

- 玩家日 VIP SQL 模型（建议由 ads_player_line_day_of_report / ads_player_game_day_of_report 同步而来）

## 参数

- tenant_plat_id
- channel_id
- start_date
- end_date

## SQL 模板

```sql
-- BLOCKED: 需先补 SQL 化 VIP 日模型
```

## 备注

- 当前仓库是 SQL-first；ES 指标如需保留，应直接改写为 TiDB 可执行 SQL。
- 当前缺少可 SQL 查询的数据模型，因此本模板仅保留为历史归档。
