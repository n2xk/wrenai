---
kb_asset_type: sql_template
import_target: sql_pair
import_format_version: v2
dialect: tidb_mysql8
parameter_style: colon_named
result_grain: summary + user_segment
id: T08
title: 首存 cohort 续存
report: 首存及续存率
priority: high
status: draft_sql
template_type: anchored_template
required_slots:
  - tenant_plat_id
  - channel_id
  - cohort_start_date
  - cohort_end_date
expected_grain: summary + user_segment
positive_scenarios:
  - 首存 cohort 的二存到六存
  - 首存后续存人数、比率、人均金额
negative_scenarios:
  - 登录但未充值玩家
  - 普通充值订单笔数与金额
  - 只要求首存名单明细
external_dependencies: []
runtime_sync:
  last_verified_at: 2026-04-26
  sync_source: 当前TiDB workspace知识资产快照-2026-04-26
  workspace_id: e4fd1d67-59a5-42de-adf2-1777698b5f21
  knowledge_base_id: 27ea94ff-415f-4a28-af88-0b0dc226e598
  kb_snapshot_id: 27fa6535-b932-4cfc-a231-35bd15d13329
  deploy_hash: 5f88d9c5a3d8c23d2280c6f3b9fdf759543f46d0
  import_status: imported
  question_count: 1
  record_ids:
    - 86
  asset_kind: sql_template
  source_type: business_import
  template_level: L2
  template_mode: anchored_template
business_signature:
  template_id: T08
  concepts:
    - first_deposit
    - retention_deposit
  features:
    - cohort
    - retention
    - deposit_times
  metrics:
    - second_deposit_user_count
    - second_deposit_rate
    - second_deposit_avg_amount
  dimensions:
    - summary
    - user_segment
  parameter_slots: []
  external_dependencies: []
  positive_cues:
    - 首存cohort
    - 2~6存
    - 二存
    - 三存
    - 续存
    - 复存
    - 首存及续存率完整表
    - TOP3
    - 非TOP3
  negative_cues:
    - ROI
    - 投放金额
  expected_grain: summary + user_segment
source_tables:
  - dwd_order_deposit
  - dim_player
  - dwd_bet_order
parameters:
  - tenant_plat_id
  - channel_id
  - cohort_start_date
  - cohort_end_date
question_variants:
  - 生成首存及续存率完整表，输出汇总、全部用户、TOP3、非TOP3的首存及2~6存人数、率、均额宽表
source_documents:
  - 第一期数据报表需求V1.xlsx
  - 数据报表API对应SQL&DSL语句整理.xlsx
  - 数据报表表结构Design_with_comments（4.15 v1.2）.sql
---

# T08 首存 cohort 续存

## 模板用途

统计首存 cohort 的 2~6 存人数、率、人均金额，并按全部用户、TOP3、非TOP3输出 Excel 同形汇总宽表。

## 建议问题（可转为 sql_pair.question）

- 生成首存及续存率完整表，输出汇总、全部用户、TOP3、非TOP3的首存及2~6存人数、率、均额宽表

## 核心表/模型

- dwd_order_deposit
- dim_player

## 参数

- tenant_plat_id
- channel_id
- cohort_start_date
- cohort_end_date

## SQL 模板

```sql
WITH register_base AS (
    SELECT
        p.id AS player_id,
        DATE(p.create_time) AS register_date,
        p.channel_id
    FROM dim_player p
    WHERE p.tenant_plat_id = :tenant_plat_id
      AND p.channel_id = :channel_id
      AND p.create_time >= :cohort_start_date
      AND p.create_time < DATE_ADD(:cohort_end_date, INTERVAL 1 DAY)
),
first_deposit_cohort AS (
    SELECT
        DATE(d.callback_time) AS first_deposit_date,
        d.channel_id,
        d.player_id
    FROM dwd_order_deposit d
    WHERE d.status = 2
      AND d.times = 1
      AND d.tenant_plat_id = :tenant_plat_id
      AND d.channel_id = :channel_id
      AND d.callback_time >= :cohort_start_date
      AND d.callback_time < DATE_ADD(:cohort_end_date, INTERVAL 1 DAY)
),
bet_rank_base AS (
    SELECT
        b.player_id,
        SUM(b.valid_bet_amount) AS total_valid_bet_amount
    FROM dwd_bet_order b
    WHERE b.settle_status = 1
      AND b.tenant_plat_id = :tenant_plat_id
      AND b.channel_id = :channel_id
      AND b.settle_time >= :cohort_start_date
      AND b.settle_time < DATE_ADD(:cohort_end_date, INTERVAL 1 DAY)
    GROUP BY b.player_id
),
ranked_users AS (
    SELECT
        br.player_id,
        ROW_NUMBER() OVER (
            ORDER BY br.total_valid_bet_amount DESC, br.player_id
        ) AS bet_rank
    FROM bet_rank_base br
),
player_deposit_pivot AS (
    SELECT
        c.first_deposit_date,
        c.channel_id,
        c.player_id,
        CASE WHEN COALESCE(ru.bet_rank, 999999) <= 3 THEN 'TOP3' ELSE '非TOP3' END AS top3_segment,
        MAX(CASE WHEN d.times = 1 THEN d.actual_amount END) AS amount_1,
        MAX(CASE WHEN d.times = 2 THEN d.actual_amount END) AS amount_2,
        MAX(CASE WHEN d.times = 3 THEN d.actual_amount END) AS amount_3,
        MAX(CASE WHEN d.times = 4 THEN d.actual_amount END) AS amount_4,
        MAX(CASE WHEN d.times = 5 THEN d.actual_amount END) AS amount_5,
        MAX(CASE WHEN d.times = 6 THEN d.actual_amount END) AS amount_6
    FROM first_deposit_cohort c
    LEFT JOIN ranked_users ru
           ON ru.player_id = c.player_id
    LEFT JOIN dwd_order_deposit d
           ON d.player_id = c.player_id
          AND d.tenant_plat_id = :tenant_plat_id
          AND d.channel_id = c.channel_id
          AND d.status = 2
          AND d.times BETWEEN 1 AND 6
    GROUP BY c.first_deposit_date, c.channel_id, c.player_id, top3_segment
),
cohort_segments AS (
    SELECT '全部用户' AS user_segment, 1 AS segment_sort, p.*
    FROM player_deposit_pivot p
    UNION ALL
    SELECT p.top3_segment AS user_segment,
           CASE WHEN p.top3_segment = 'TOP3' THEN 2 ELSE 3 END AS segment_sort,
           p.*
    FROM player_deposit_pivot p
),
register_segments AS (
    SELECT '全部用户' AS user_segment, 1 AS segment_sort, rb.player_id
    FROM register_base rb
    UNION ALL
    SELECT CASE WHEN COALESCE(ru.bet_rank, 999999) <= 3 THEN 'TOP3' ELSE '非TOP3' END AS user_segment,
           CASE WHEN COALESCE(ru.bet_rank, 999999) <= 3 THEN 2 ELSE 3 END AS segment_sort,
           rb.player_id
    FROM register_base rb
    LEFT JOIN ranked_users ru
           ON ru.player_id = rb.player_id
),
register_counts AS (
    SELECT
        user_segment,
        segment_sort,
        COUNT(DISTINCT player_id) AS register_user_count
    FROM register_segments
    GROUP BY user_segment, segment_sort
),
retention_summary AS (
    SELECT
        '汇总' AS `日期`,
        cs.user_segment AS `用户分层`,
        cs.segment_sort,
        COUNT(DISTINCT cs.player_id) AS first_deposit_user_count,
        SUM(COALESCE(cs.amount_1, 0)) AS first_deposit_amount,
        SUM(CASE WHEN cs.amount_2 IS NOT NULL THEN 1 ELSE 0 END) AS second_deposit_user_count,
        SUM(COALESCE(cs.amount_2, 0)) AS second_deposit_amount,
        SUM(CASE WHEN cs.amount_3 IS NOT NULL THEN 1 ELSE 0 END) AS third_deposit_user_count,
        SUM(COALESCE(cs.amount_3, 0)) AS third_deposit_amount,
        SUM(CASE WHEN cs.amount_4 IS NOT NULL THEN 1 ELSE 0 END) AS fourth_deposit_user_count,
        SUM(COALESCE(cs.amount_4, 0)) AS fourth_deposit_amount,
        SUM(CASE WHEN cs.amount_5 IS NOT NULL THEN 1 ELSE 0 END) AS fifth_deposit_user_count,
        SUM(COALESCE(cs.amount_5, 0)) AS fifth_deposit_amount,
        SUM(CASE WHEN cs.amount_6 IS NOT NULL THEN 1 ELSE 0 END) AS sixth_deposit_user_count,
        SUM(COALESCE(cs.amount_6, 0)) AS sixth_deposit_amount
    FROM cohort_segments cs
    GROUP BY cs.user_segment, cs.segment_sort
)
SELECT
    rs.`日期`,
    rs.`用户分层`,
    GREATEST(COALESCE(rc.register_user_count, 0), rs.first_deposit_user_count) AS `注册人数`,
    rs.first_deposit_user_count AS `首存人数`,
    ROUND(rs.first_deposit_user_count / NULLIF(GREATEST(COALESCE(rc.register_user_count, 0), rs.first_deposit_user_count), 0), 4) AS `首存率`,
    ROUND(rs.first_deposit_amount / NULLIF(rs.first_deposit_user_count, 0), 2) AS `首存人均金额`,
    rs.second_deposit_user_count AS `二存人数`,
    ROUND(rs.second_deposit_user_count / NULLIF(rs.first_deposit_user_count, 0), 4) AS `二存率`,
    ROUND(rs.second_deposit_amount / NULLIF(rs.second_deposit_user_count, 0), 2) AS `二存均额`,
    rs.third_deposit_user_count AS `三存人数`,
    ROUND(rs.third_deposit_user_count / NULLIF(rs.first_deposit_user_count, 0), 4) AS `三存率`,
    ROUND(rs.third_deposit_amount / NULLIF(rs.third_deposit_user_count, 0), 2) AS `三存均额`,
    rs.fourth_deposit_user_count AS `四存人数`,
    ROUND(rs.fourth_deposit_user_count / NULLIF(rs.first_deposit_user_count, 0), 4) AS `四存率`,
    ROUND(rs.fourth_deposit_amount / NULLIF(rs.fourth_deposit_user_count, 0), 2) AS `四存均额`,
    rs.fifth_deposit_user_count AS `五存人数`,
    ROUND(rs.fifth_deposit_user_count / NULLIF(rs.first_deposit_user_count, 0), 4) AS `五存率`,
    ROUND(rs.fifth_deposit_amount / NULLIF(rs.fifth_deposit_user_count, 0), 2) AS `五存均额`,
    rs.sixth_deposit_user_count AS `六存人数`,
    ROUND(rs.sixth_deposit_user_count / NULLIF(rs.first_deposit_user_count, 0), 4) AS `六存率`,
    ROUND(rs.sixth_deposit_amount / NULLIF(rs.sixth_deposit_user_count, 0), 2) AS `六存均额`
FROM retention_summary rs
LEFT JOIN register_counts rc
       ON rc.user_segment = rs.`用户分层`
      AND rc.segment_sort = rs.segment_sort
ORDER BY rs.segment_sort;
```

## 备注

- 输出固定汇总宽表行，满足第一期 Excel「首存及续存率」FULL 同形校验。
- SQL 按 TiDB / MySQL 8 风格编写；导入前需在实际 runtime datasource 下做一次校验。
- 当前可视为 SQL 草案，校验通过后可转为 sql_pair。
