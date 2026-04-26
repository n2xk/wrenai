---
kb_asset_type: sql_template
import_target: sql_pair
import_format_version: v1
dialect: tidb_mysql8
parameter_style: colon_named
result_grain: first_deposit_date + relative_day_no
id: T05
title: cohort ROI
report: ROI回收表
priority: high
status: blocked_missing_source
runtime_sync:
  last_verified_at: 2026-04-26
  sync_source: 当前TiDB workspace知识资产快照-2026-04-26
  workspace_id: e4fd1d67-59a5-42de-adf2-1777698b5f21
  knowledge_base_id: 27ea94ff-415f-4a28-af88-0b0dc226e598
  kb_snapshot_id: 27fa6535-b932-4cfc-a231-35bd15d13329
  deploy_hash: 5f88d9c5a3d8c23d2280c6f3b9fdf759543f46d0
  import_status: blocked
  question_count: 0
  record_ids: []
  blocked_reason: blocked_missing_source
source_tables:
  - dwd_order_deposit
  - dwd_bet_order
  - dwd_order_rebate
  - dwd_order_task
  - dwd_order_activity
  - dwd_order_promote_activity
  - dwd_order_add_or_sub
  - 外部投放表
parameters:
  - cohort_start_date
  - cohort_end_date
  - period_days
question_variants:
  - 计算首存 cohort 在各周期的累计 ROI。
source_documents:
  - 第一期数据报表需求V1.xlsx
  - 数据报表API对应SQL&DSL语句整理.xlsx
  - 数据报表表结构Design_with_comments（4.15 v1.2）.sql
---

# T05 cohort ROI

## 模板用途

计算首存 cohort 在各周期的累计 ROI。

## 建议问题（可转为 sql_pair.question）

- 计算首存 cohort 在各周期的累计 ROI。

## 核心表/模型

- dwd_order_deposit
- dwd_bet_order
- dwd_order_rebate
- dwd_order_task
- dwd_order_activity
- dwd_order_promote_activity
- dwd_order_add_or_sub
- 外部投放表

## 参数

- cohort_start_date
- cohort_end_date
- period_days

## SQL 模板

```sql
-- TODO: 根据下述口径补充可执行 SQL
-- 参数示例: :cohort_start_date, :cohort_end_date, :period_days
-- 当前状态: blocked_missing_source
```

## 备注

- 依赖投放金额源；未提供时只能输出累计收入，不能输出 ROI。
- 当前缺少外部数据源或 SQL 化数据模型，暂不能形成可执行 SQL pair。
