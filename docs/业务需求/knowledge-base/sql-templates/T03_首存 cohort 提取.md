---
kb_asset_type: sql_template
import_target: sql_pair
import_format_version: v2
dialect: tidb_mysql8
parameter_style: colon_named
result_grain: first_deposit_user
id: T03
title: 首存 cohort 提取
report: ROI回收表
priority: high
status: draft_sql
template_type: anchored_template
required_slots:
  - tenant_plat_id
  - channel_id
  - cohort_start_date
  - cohort_end_date
expected_grain: first_deposit_user
positive_scenarios:
  - 首存 cohort 名单
  - 首存用户明细
  - 首次存款用户及首存金额
negative_scenarios:
  - 登录但未充值玩家
  - 普通充值汇总
  - 续存率或二存到六存分析
external_dependencies: []
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
    - 80
    - 81
  asset_kind: sql_template
  source_type: business_import
  template_level: L2
  template_mode: anchored_template
business_signature:
  template_id: T03
  concepts:
    - first_deposit
    - new_customer_first_deposit
  features:
    - cohort
    - first_deposit
  metrics:
    - first_deposit_user_count
    - first_deposit_amount
  dimensions:
    - first_deposit_date
    - channel_id
    - player_id
  parameter_slots: []
  external_dependencies: []
  positive_cues:
    - 首存cohort
    - 首存用户
    - 首次存款用户
    - 新客首存
  negative_cues:
    - 续存
    - ROI
    - TOP3
    - 非TOP3
    - TOPN
    - 有效投注排名
    - 投注次数
    - 输赢
    - 用户分层
  expected_grain: first_deposit_user
source_tables:
  - dwd_order_deposit
  - dim_player
parameters:
  - tenant_plat_id
  - channel_id
  - cohort_start_date
  - cohort_end_date
question_variants:
  - 找出某时间段内某渠道的首存用户、首存日期、首存金额。
  - 查询某渠道在指定时间段的首存用户名单与首存金额
source_documents:
  - 第一期数据报表需求V1.xlsx
  - 数据报表API对应SQL&DSL语句整理.xlsx
  - 数据报表表结构Design_with_comments（4.15 v1.2）.sql
---

# T03 首存 cohort 提取

## 模板用途

找出某时间段内某渠道的首存用户、首存日期、首存金额。

## 建议问题（可转为 sql_pair.question）

- 找出某时间段内某渠道的首存用户、首存日期、首存金额。
- 查询某渠道在指定时间段的首存用户名单与首存金额

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
WITH first_deposit_cohort AS (
    SELECT
        d.tenant_plat_id,
        d.channel_id,
        DATE(d.callback_time) AS first_deposit_date,
        d.player_id,
        d.player_username,
        d.actual_amount AS first_deposit_amount,
        d.callback_time AS first_deposit_time,
        d.regist_time
    FROM dwd_order_deposit d
    WHERE d.status = 2
      AND d.times = 1
      AND d.tenant_plat_id = :tenant_plat_id
      AND d.channel_id = :channel_id
      AND d.callback_time >= :cohort_start_date
      AND d.callback_time < DATE_ADD(:cohort_end_date, INTERVAL 1 DAY)
)
SELECT
    c.first_deposit_date,
    c.tenant_plat_id,
    c.channel_id,
    c.player_id,
    c.player_username,
    c.first_deposit_amount,
    c.first_deposit_time,
    DATE(c.regist_time) AS register_date,
    CASE
        WHEN DATE(c.regist_time) = DATE(c.first_deposit_time) THEN 1
        ELSE 0
    END AS is_new_customer_first_deposit,
    p.vip_id AS current_vip_id,
    p.regist_device,
    p.regist_domain
FROM first_deposit_cohort c
LEFT JOIN dim_player p
       ON p.id = c.player_id
      AND p.tenant_plat_id = c.tenant_plat_id
ORDER BY c.first_deposit_date, c.player_id;
```

## 备注

- 首存定义按 times = 1 且状态成功。
- SQL 按 TiDB / MySQL 8 风格编写；导入前需在实际 runtime datasource 下做一次校验。
- 当前可视为 SQL 草案，校验通过后可转为 sql_pair。
