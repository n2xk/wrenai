-- Test-only external metrics used by FULL Excel regression.
-- Safe to re-run after docs/业务需求/local_tidb_schema.sql has created marketing_external_metrics_daily.
-- Default rows align with the v1.3 reference-data core window: tenant_plat_id=72 / channel_id=1932 / 2026-04-10~2026-04-16.

DELETE FROM marketing_external_metrics_daily
WHERE tenant_plat_id = 72
  AND biz_date BETWEEN '2026-04-10' AND '2026-04-16'
  AND channel_id IN (1932);

INSERT INTO marketing_external_metrics_daily (
    biz_date, tenant_plat_id, channel_id,
    ad_spend, access_pv, access_uv, download_click_uv
) VALUES
('2026-04-10', 72, 1932, 1120.0000, 12530, 3150, 845),
('2026-04-11', 72, 1932, 1240.0000, 13060, 3300, 890),
('2026-04-12', 72, 1932, 1360.0000, 13590, 3450, 935),
('2026-04-13', 72, 1932, 1480.0000, 14120, 3600, 980),
('2026-04-14', 72, 1932, 1600.0000, 14650, 3750, 1025),
('2026-04-15', 72, 1932, 1720.0000, 15180, 3900, 1070),
('2026-04-16', 72, 1932, 1840.0000, 15710, 4050, 1115);
