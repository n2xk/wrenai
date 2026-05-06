# seed_data_local

本目录是本地 / demo / 回归测试可直接导入 TiDB 的 v1.3 seed 数据入口。

- `regression_reference_window.sql`：默认 post-deploy / demo / 回归 seed，来自真实参考数据窗口，覆盖 `tenant_plat_id=72`、`channel_id=1932`、`2026-04-10~2026-04-16`，T02 的 `1867/1760`，以及 FULL 外部指标样例。
- `regression_fixture.sql`：legacy 固定对账窗口 `tenant_plat_id=990001` / `channel_id=990011` 的可选夹具；默认核心回归不再依赖它，只有专项复现旧对账口径时显式导入。
- `external_metrics.sql`：FULL 回归外部投放 / 流量指标样例；默认已并入 `regression_reference_window.sql`。
- `saas_prod_v1_3.sql` / `saas_warehouse_v1_3.sql`：由 `../seed_data_refer/` 规范化生成的全量参考 dump，文件较大，保留为离线诊断 / 大数据量专项，不作为默认 post-deploy seed，避免本机 standalone TiDB 因全量导入被 OOM kill。

`seed_data_refer/` 是原始参考导出，不直接修改；重新拿到参考 dump 后运行：

```bash
python3 docs/业务需求/generate_seed_data_local.py
```

生成后的 `saas_*_v1_3.sql` 体积较大，默认由本目录 `.gitignore` 忽略。
默认按单行 INSERT 输出，只做表名 / 字段兼容转换，避免过大的批量 INSERT 导致 TiDB 导入连接中断。
如需临时压缩体积，可显式传入 `--batch-size <N>`，但完整回归推荐保留默认值。
默认不会覆盖 `regression_fixture.sql`；如果需要从旧 fixture 迁移一次，可显式传入
`--legacy-regression-overlay-file <path>`。

当前默认核心回归参数来自真实参考数据：`tenant_plat_id=72`、`channel_id=1932`、`2026-04-10~2026-04-16`；T02 渠道费率专项使用 `tenant_plat_id=1` 下的 `channel_id=1867/1760`。
