# FULL 回归外部数据样例

本目录维护 `第一期数据报表需求V1.xlsx` FULL 同形回归所需的测试外部指标样例。

## 文件

- `full_external_metrics_daily.csv`：按 `biz_date + tenant_plat_id + channel_id` 粒度提供投放金额、访问 PV、访问 UV、下载点击 UV；默认覆盖 `tenant_plat_id=72`、`channel_id=1932`、`2026-04-10~2026-04-16`。
- `full_external_metrics_daily.sql`：把同一批样例写入本地 TiDB 表 `marketing_external_metrics_daily`。

## 使用顺序

1. 先执行 `docs/业务需求/local_tidb_schema.sql`，确保 `marketing_external_metrics_daily` 已创建。
2. 完整回归默认直接导入 `docs/业务需求/seed_data_local/external_metrics.sql`。如只排查 FULL 外部指标，也可单独执行本目录的 `full_external_metrics_daily.sql`。
3. FULL 问数回归中，如果走“对话补充外部数据”能力，也可以把 CSV 表头和行直接粘贴到外部数据补充表单中。

## 约束

- 这些数据只用于本地回归，不代表生产真实投放或流量数据。
- 不能用 0 代替缺失值；若没有导入或补充这些数据，FT01/FT02/FT04 仍应阻断，不能算 FULL_PASS。
- 样例粒度为 `biz_date + channel_id`，可满足 FT01 综合日报、FT02 渠道整体 ROI、FT04 TOP3 ROI 的外部数据口径。
