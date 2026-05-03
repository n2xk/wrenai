---
kb_asset_type: sql_template
import_target: sql_pair
import_format_version: v2
dialect: tidb_mysql8
parameter_style: colon_named
result_grain: first_deposit_date + user_segment + excel_recovery_columns
id: T04
title: cohort 累计收入
report: ROI回收表
priority: high
status: draft_sql
template_type: anchored_template
required_slots:
  - tenant_plat_id
  - channel_id
  - cohort_start_date
  - cohort_end_date
  - period_days
runtime_sync:
  last_verified_at: 2026-04-26
  sync_source: 当前TiDB workspace知识资产快照-2026-04-26
  workspace_id: e4fd1d67-59a5-42de-adf2-1777698b5f21
  knowledge_base_id: 27ea94ff-415f-4a28-af88-0b0dc226e598
  kb_snapshot_id: 27fa6535-b932-4cfc-a231-35bd15d13329
  deploy_hash: 5f88d9c5a3d8c23d2280c6f3b9fdf759543f46d0
  import_status: imported
  question_count: 2
  record_ids:
    - 82
    - 83
  asset_kind: sql_template
  source_type: business_import
  template_level: L2
  template_mode: anchored_template
business_signature:
  template_id: T04
  concepts:
    - first_deposit
  features:
    - cohort
    - revenue_accumulation
  metrics:
    - cumulative_revenue
    - relative_day_revenue
  dimensions:
    - first_deposit_date
    - user_segment
    - recovery_day_columns
  parameter_slots: []
  external_dependencies: []
  positive_cues:
    - cohort累计收入
    - 首存后收入
    - N日累计收入
    - 渠道累计收入宽表
    - TOP3累计收入
  negative_cues:
    - 投放金额
    - PV
    - UV
  expected_grain: first_deposit_date + user_segment + excel_recovery_columns
source_tables:
  - dwd_order_deposit
  - dwd_bet_order
  - dwd_order_rebate
  - dwd_order_task
  - dwd_order_activity
  - dwd_order_promote_activity
  - dwd_order_add_or_sub
parameters:
  - tenant_plat_id
  - channel_id
  - cohort_start_date
  - cohort_end_date
  - period_days
  - top_n
question_variants:
  - 计算首存 cohort 在 D1/D3/D7/D15/D30...D360 的累计渠道收入。
  - 统计某渠道首存 cohort 在指定回收周期内的累计渠道收入。
  - 统计某渠道首存 cohort 的 D30 累计渠道收入。
source_documents:
  - 第一期数据报表需求V1.xlsx
  - 数据报表API对应SQL&DSL语句整理.xlsx
  - 数据报表表结构Design_with_comments（4.15 v1.2）.sql
---

# T04 cohort 累计收入

## 模板用途

计算首存 cohort 在 D1/D3/D7/D15/D30...D360 的累计渠道收入。

## 建议问题（可转为 sql_pair.question）

- 计算首存 cohort 在 D1/D3/D7/D15/D30...D360 的累计渠道收入。
- 统计某渠道首存 cohort 在指定回收周期内的累计渠道收入。
- 统计某渠道首存 cohort 的 D30 累计渠道收入。

## 核心表/模型

- dwd_order_deposit
- dwd_bet_order
- dwd_order_rebate
- dwd_order_task
- dwd_order_activity
- dwd_order_promote_activity
- dwd_order_add_or_sub

## 参数

- tenant_plat_id
- channel_id
- cohort_start_date
- cohort_end_date
- period_days

## SQL 模板

```sql
WITH RECURSIVE seq AS (
    SELECT 1 AS relative_day_no
    UNION ALL
    SELECT relative_day_no + 1
    FROM seq
    WHERE relative_day_no < :period_days
),
top_limit AS (
    SELECT COALESCE(:top_n, 3) AS top_n
),
first_deposit_cohort AS (
    SELECT
        d.tenant_plat_id,
        d.channel_id,
        d.player_id,
        DATE(MIN(d.callback_time)) AS first_deposit_date
    FROM dwd_order_deposit d
    WHERE d.status = 2
      AND d.times = 1
      AND d.tenant_plat_id = :tenant_plat_id
      AND d.channel_id = :channel_id
      AND d.callback_time >= :cohort_start_date
      AND d.callback_time < DATE_ADD(:cohort_end_date, INTERVAL 1 DAY)
    GROUP BY d.tenant_plat_id, d.channel_id, d.player_id
),
rank_base AS (
    SELECT
        c.tenant_plat_id,
        c.channel_id,
        c.player_id,
        COALESCE(SUM(b.valid_bet_amount), 0) AS total_valid_bet_amount
    FROM first_deposit_cohort c
    LEFT JOIN dwd_bet_order b
           ON b.player_id = c.player_id
          AND b.tenant_plat_id = c.tenant_plat_id
          AND b.channel_id = c.channel_id
          AND b.settle_status = 1
          AND b.settle_time >= c.first_deposit_date
          AND b.settle_time < DATE_ADD(c.first_deposit_date, INTERVAL :period_days DAY)
    GROUP BY c.tenant_plat_id, c.channel_id, c.player_id
),
ranked_cohort AS (
    SELECT
        c.*,
        ROW_NUMBER() OVER (
            ORDER BY rb.total_valid_bet_amount DESC, c.player_id
        ) AS bet_rank
    FROM first_deposit_cohort c
    INNER JOIN rank_base rb
            ON rb.tenant_plat_id = c.tenant_plat_id
           AND rb.channel_id = c.channel_id
           AND rb.player_id = c.player_id
),
cohort_segments AS (
    SELECT
        tenant_plat_id,
        channel_id,
        player_id,
        first_deposit_date,
        '全部' AS user_segment
    FROM ranked_cohort
    UNION ALL
    SELECT
        rc.tenant_plat_id,
        rc.channel_id,
        rc.player_id,
        rc.first_deposit_date,
        CASE
            WHEN rc.bet_rank <= tl.top_n THEN CONCAT('TOP', tl.top_n)
            ELSE CONCAT('非TOP', tl.top_n)
        END AS user_segment
    FROM ranked_cohort rc
    CROSS JOIN top_limit tl
),
cohort_size AS (
    SELECT
        c.tenant_plat_id,
        c.channel_id,
        c.first_deposit_date,
        c.user_segment,
        COUNT(DISTINCT c.player_id) AS cohort_user_count
    FROM cohort_segments c
    GROUP BY c.tenant_plat_id, c.channel_id, c.first_deposit_date, c.user_segment
),
bet_revenue AS (
    SELECT
        c.player_id,
        DATE(b.settle_time) AS event_date,
        SUM(b.win_loss_amount) AS win_loss_amount,
        0 AS rebate_amount,
        0 AS task_amount,
        0 AS marketing_amount,
        0 AS discount_adjust_amount,
        SUM(b.win_loss_amount) AS channel_revenue_amount
    FROM first_deposit_cohort c
    INNER JOIN dwd_bet_order b
            ON b.player_id = c.player_id
           AND b.tenant_plat_id = c.tenant_plat_id
           AND b.channel_id = c.channel_id
    WHERE b.settle_status = 1
      AND b.settle_time >= c.first_deposit_date
      AND b.settle_time < DATE_ADD(c.first_deposit_date, INTERVAL :period_days DAY)
    GROUP BY c.player_id, DATE(b.settle_time)
),
rebate_cost AS (
    SELECT
        c.player_id,
        DATE(r.receive_time) AS event_date,
        0 AS win_loss_amount,
        SUM(r.amount) AS rebate_amount,
        0 AS task_amount,
        0 AS marketing_amount,
        0 AS discount_adjust_amount,
        -SUM(r.amount) AS channel_revenue_amount
    FROM first_deposit_cohort c
    INNER JOIN dwd_order_rebate r
            ON r.player_id = c.player_id
           AND r.tenant_plat_id = c.tenant_plat_id
           AND r.channel_id = c.channel_id
    WHERE r.status = 1
      AND r.receive_time >= c.first_deposit_date
      AND r.receive_time < DATE_ADD(c.first_deposit_date, INTERVAL :period_days DAY)
    GROUP BY c.player_id, DATE(r.receive_time)
),
task_cost AS (
    SELECT
        c.player_id,
        DATE(t.receive_time) AS event_date,
        0 AS win_loss_amount,
        0 AS rebate_amount,
        SUM(t.amount) AS task_amount,
        0 AS marketing_amount,
        0 AS discount_adjust_amount,
        -SUM(t.amount) AS channel_revenue_amount
    FROM first_deposit_cohort c
    INNER JOIN dwd_order_task t
            ON t.player_id = c.player_id
           AND t.tenant_plat_id = c.tenant_plat_id
           AND t.channel_id = c.channel_id
    WHERE t.status = 2
      AND t.receive_time >= c.first_deposit_date
      AND t.receive_time < DATE_ADD(c.first_deposit_date, INTERVAL :period_days DAY)
    GROUP BY c.player_id, DATE(t.receive_time)
),
activity_cost AS (
    SELECT
        c.player_id,
        DATE(a.receive_time) AS event_date,
        0 AS win_loss_amount,
        0 AS rebate_amount,
        0 AS task_amount,
        SUM(a.amount) AS marketing_amount,
        0 AS discount_adjust_amount,
        -SUM(a.amount) AS channel_revenue_amount
    FROM first_deposit_cohort c
    INNER JOIN dwd_order_activity a
            ON a.player_id = c.player_id
           AND a.tenant_plat_id = c.tenant_plat_id
           AND a.channel_id = c.channel_id
    WHERE a.status = 2
      AND a.receive_time >= c.first_deposit_date
      AND a.receive_time < DATE_ADD(c.first_deposit_date, INTERVAL :period_days DAY)
    GROUP BY c.player_id, DATE(a.receive_time)
),
promote_cost AS (
    SELECT
        c.player_id,
        DATE(p.send_time) AS event_date,
        0 AS win_loss_amount,
        0 AS rebate_amount,
        0 AS task_amount,
        SUM(p.amount) AS marketing_amount,
        0 AS discount_adjust_amount,
        -SUM(p.amount) AS channel_revenue_amount
    FROM first_deposit_cohort c
    INNER JOIN dwd_order_promote_activity p
            ON p.player_id = c.player_id
           AND p.tenant_plat_id = c.tenant_plat_id
           AND p.channel_id = c.channel_id
    WHERE p.status = 1
      AND p.send_time >= c.first_deposit_date
      AND p.send_time < DATE_ADD(c.first_deposit_date, INTERVAL :period_days DAY)
    GROUP BY c.player_id, DATE(p.send_time)
),
discount_adjust AS (
    SELECT
        c.player_id,
        DATE(a.modify_time) AS event_date,
        0 AS win_loss_amount,
        0 AS rebate_amount,
        0 AS task_amount,
        0 AS marketing_amount,
        SUM(
            CASE
                WHEN a.add_or_sub_type_id IN (1207, 1209) THEN a.amount
                WHEN a.add_or_sub_type_id IN (2204, 2207) THEN -a.amount
                ELSE 0
            END
        ) AS discount_adjust_amount,
        SUM(
            CASE
                WHEN a.add_or_sub_type_id IN (1207, 1209) THEN -a.amount
                WHEN a.add_or_sub_type_id IN (2204, 2207) THEN a.amount
                ELSE 0
            END
        ) AS channel_revenue_amount
    FROM first_deposit_cohort c
    INNER JOIN dwd_order_add_or_sub a
            ON a.player_id = c.player_id
           AND a.tenant_plat_id = c.tenant_plat_id
           AND a.channel_id = c.channel_id
    WHERE a.status = 2
      AND a.add_or_sub_type_id IN (1207, 1209, 2204, 2207)
      AND a.modify_time >= c.first_deposit_date
      AND a.modify_time < DATE_ADD(c.first_deposit_date, INTERVAL :period_days DAY)
    GROUP BY c.player_id, DATE(a.modify_time)
),
player_revenue_events AS (
    SELECT * FROM bet_revenue
    UNION ALL
    SELECT * FROM rebate_cost
    UNION ALL
    SELECT * FROM task_cost
    UNION ALL
    SELECT * FROM activity_cost
    UNION ALL
    SELECT * FROM promote_cost
    UNION ALL
    SELECT * FROM discount_adjust
),
daily_revenue AS (
    SELECT
        c.tenant_plat_id,
        c.channel_id,
        c.first_deposit_date,
        c.user_segment,
        DATEDIFF(e.event_date, c.first_deposit_date) + 1 AS relative_day_no,
        SUM(e.win_loss_amount) AS daily_win_loss_amount,
        SUM(e.rebate_amount) AS daily_rebate_amount,
        SUM(e.task_amount) AS daily_task_amount,
        SUM(e.marketing_amount) AS daily_marketing_amount,
        SUM(e.discount_adjust_amount) AS daily_discount_adjust_amount,
        SUM(e.channel_revenue_amount) AS daily_channel_revenue
    FROM cohort_segments c
    INNER JOIN player_revenue_events e
            ON e.player_id = c.player_id
    WHERE DATEDIFF(e.event_date, c.first_deposit_date) + 1 BETWEEN 1 AND :period_days
    GROUP BY
        c.tenant_plat_id,
        c.channel_id,
        c.first_deposit_date,
        c.user_segment,
        DATEDIFF(e.event_date, c.first_deposit_date) + 1
),
cumulative_by_day AS (
    SELECT
        cs.tenant_plat_id,
        cs.channel_id,
        cs.first_deposit_date,
        cs.user_segment,
        s.relative_day_no,
        cs.cohort_user_count,
        SUM(COALESCE(dr.daily_channel_revenue, 0)) OVER (
            PARTITION BY cs.tenant_plat_id, cs.channel_id, cs.first_deposit_date, cs.user_segment
            ORDER BY s.relative_day_no
        ) AS cumulative_channel_revenue
    FROM cohort_size cs
    CROSS JOIN seq s
    LEFT JOIN daily_revenue dr
           ON dr.tenant_plat_id = cs.tenant_plat_id
          AND dr.channel_id = cs.channel_id
          AND dr.first_deposit_date = cs.first_deposit_date
          AND dr.user_segment = cs.user_segment
          AND dr.relative_day_no = s.relative_day_no
),
pivot_result AS (
    SELECT
        tenant_plat_id,
        channel_id,
        first_deposit_date,
        user_segment,
        cohort_user_count,
        MAX(CASE WHEN relative_day_no = 1 THEN cumulative_channel_revenue END) AS cumulative_1_day,
        MAX(CASE WHEN relative_day_no = 3 THEN cumulative_channel_revenue END) AS cumulative_3_day,
        MAX(CASE WHEN relative_day_no = 7 THEN cumulative_channel_revenue END) AS cumulative_7_day,
        MAX(CASE WHEN relative_day_no = 15 THEN cumulative_channel_revenue END) AS cumulative_15_day,
        MAX(CASE WHEN relative_day_no = 30 THEN cumulative_channel_revenue END) AS cumulative_30_day,
        MAX(CASE WHEN relative_day_no = 60 THEN cumulative_channel_revenue END) AS cumulative_60_day,
        MAX(CASE WHEN relative_day_no = 90 THEN cumulative_channel_revenue END) AS cumulative_90_day,
        MAX(CASE WHEN relative_day_no = 120 THEN cumulative_channel_revenue END) AS cumulative_120_day,
        MAX(CASE WHEN relative_day_no = 150 THEN cumulative_channel_revenue END) AS cumulative_150_day,
        MAX(CASE WHEN relative_day_no = 180 THEN cumulative_channel_revenue END) AS cumulative_180_day,
        MAX(CASE WHEN relative_day_no = 210 THEN cumulative_channel_revenue END) AS cumulative_210_day,
        MAX(CASE WHEN relative_day_no = 240 THEN cumulative_channel_revenue END) AS cumulative_240_day,
        MAX(CASE WHEN relative_day_no = 270 THEN cumulative_channel_revenue END) AS cumulative_270_day,
        MAX(CASE WHEN relative_day_no = 300 THEN cumulative_channel_revenue END) AS cumulative_300_day,
        MAX(CASE WHEN relative_day_no = 330 THEN cumulative_channel_revenue END) AS cumulative_330_day,
        MAX(CASE WHEN relative_day_no = 360 THEN cumulative_channel_revenue END) AS cumulative_360_day
    FROM cumulative_by_day
    GROUP BY tenant_plat_id, channel_id, first_deposit_date, user_segment, cohort_user_count
),
with_dims AS (
    SELECT
        pr.*,
        tp.name AS site_name,
        ch.channel_partner_username AS channel_partner_name,
        ch.name AS channel_name
    FROM pivot_result pr
    LEFT JOIN tenant_plat tp
           ON tp.id = pr.tenant_plat_id
    LEFT JOIN channel ch
           ON ch.id = pr.channel_id
          AND ch.tenant_plat_id = pr.tenant_plat_id
)
SELECT
    first_deposit_date AS `日期`,
    site_name AS `站点名称`,
    channel_partner_name AS `所属渠道商`,
    channel_name AS `渠道名称`,
    user_segment AS `用户类型`,
    cohort_user_count AS `首存用户数`,
    cumulative_1_day AS `累计1天`,
    cumulative_3_day AS `3天`,
    cumulative_7_day AS `7天`,
    cumulative_15_day AS `15天`,
    cumulative_30_day AS `30天`,
    cumulative_60_day AS `60天`,
    cumulative_90_day AS `90天`,
    cumulative_120_day AS `120天`,
    cumulative_150_day AS `150天`,
    cumulative_180_day AS `180天`,
    cumulative_210_day AS `210天`,
    cumulative_240_day AS `240天`,
    cumulative_270_day AS `270天`,
    cumulative_300_day AS `300天`,
    cumulative_330_day AS `330天`,
    cumulative_360_day AS `360天`,
    ROUND(
        (cumulative_360_day - LAG(cumulative_360_day) OVER (PARTITION BY user_segment ORDER BY first_deposit_date))
        / NULLIF(LAG(cumulative_360_day) OVER (PARTITION BY user_segment ORDER BY first_deposit_date), 0),
        6
    ) AS `环比系数`
FROM with_dims
ORDER BY first_deposit_date,
    CASE user_segment WHEN '全部' THEN 0 WHEN CONCAT('TOP', COALESCE(:top_n, 3)) THEN 1 ELSE 2 END;
```

## 备注

- 渠道收入口径：`输赢金额 - 洗码金额 - 任务彩金 - 营销金额 - 优惠加扣款`。
- 这里的“营销金额”按 `dwd_order_activity + dwd_order_promote_activity` 处理；若后续确认还要纳入其他营销表，再补到模板中。
- `period_days` 建议直接传最大回收天数（如 30 / 60 / 90 / 180 / 360），用户表达为“D30”“首存后 D30”“30 天回收周期”时都应映射为 `period_days=30`；结果会返回 `D1 ~ Dn` 的每日值和累计值。
- SQL 按 TiDB / MySQL 8 风格编写；若运行环境不支持递归 CTE，可改成数字维表/日期维表实现。
- 当前可视为 SQL 草案，校验通过后可转为 sql_pair。
