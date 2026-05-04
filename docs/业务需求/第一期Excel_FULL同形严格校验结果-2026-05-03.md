# 第一期 Excel FULL 同形严格校验结果

- 执行时间：2026-05-03T13:31:13Z
- FULL 用例数：11
- 严格状态统计：{"FULL_PASS": 11}

## 判定规则

- `FULL_PASS`：必须有真实 SQL/结果、没有缺口/阻断/提示型 message SQL，并包含该 FT 的关键列、分组和宽表信号。
- `BLOCKED_EXTERNAL`：外部投放/PV/UV/下载点击UV等能力缺失被正确阻断；这是安全行为，但不能计入 FULL 同形通过。
- `SHAPE_GAP`：有结果但字段、分组、宽表/透视形态、汇总行或周期列不足；不能计入 FULL 同形通过。
- `NOT_RUN`：未找到该 FT 的执行证据。

## 明细

| FT | Excel sheet | 示例表格 | 严格状态 | 泛化变体数 | 主要原因 |
| --- | --- | --- | --- | ---: | --- |
| FT01 | 综合日报表 | 每日数据表格示例 | FULL_PASS | 3 | 2026-05-03 自动化补测：UI thread 165 原问题先触发投放金额/PV/UV/下载点击UV补充，脚本补入完整外部指标 CSV 后在同一 thread 继续；response 186 生成 `external_metrics` 确定性 SQL，preview 返回 33 列、7 行（汇总 + 2026-04-01~2026-04-06），列序贴合 Excel A41:AG46，含投放金额、PV、UV、下载点击UV、UV下载率、UV注册率、首存成本、首存率、有效投注、会员输赢、杀率、合计优惠。 |
| FT02 | ROI回收表 | 渠道整体ROI表 | FULL_PASS | 3 | 2026-05-03 自动化补测：UI thread 166 原问题先触发投放金额补充，脚本补入 ad_spend CSV 后在同一 thread 继续；response 188 生成 `supplied_external_ad_spend` 确定性 SQL，preview 返回 22 列、9 行，列为 日期/站点名称/所属渠道商/渠道名称/投放金额/用户类型/累计1天/3天/.../360天，含环比系数行。 |
| FT03 | ROI回收表 | 渠道累计收入表 | FULL_PASS | 3 | 累计收入不依赖投放金额；必须直接生成D1~D360累计收入宽表和环比。 |
| FT04 | ROI回收表 | 渠道TOP3 ROI表 | FULL_PASS | 3 | 2026-05-03 自动化补测：UI thread 167 原问题先触发投放金额补充，脚本补入同一 ad_spend CSV 后在同一 thread 继续；response 190 生成 `bet_rank <= 3` + `TOP3` 用户类型的确定性 ROI SQL，preview 返回 22 列、9 行，固定 D1/D3/.../D360 ROI 宽表与环比系数行通过。 |
| FT05 | ROI回收表 | 渠道TOP3累计收入表 | FULL_PASS | 3 | TOP3累计收入不依赖投放金额；必须直接生成TOP3 D1~D360累计收入宽表和环比。 |
| FT06 | 首存及续存率 | 首存及2~6存率表 | FULL_PASS | 3 | 必须同时有汇总行、全部/TOP3/非TOP3分层和首存到六存人数/率/均额。 |
| FT07 | 投充比与杀率 | 首存用户杀率趋势 | FULL_PASS | 3 | 必须明确周期并输出首日到截止日杀率宽表；缺n_days澄清不算FULL PASS。 |
| FT08 | 投充比与杀率 | 首存用户投充比趋势 | FULL_PASS | 3 | 必须明确周期并输出首日到截止日投充比宽表；缺n_days澄清不算FULL PASS。 |
| FT09 | 投充比与杀率 | 渠道所有用户杀率及投充比 | FULL_PASS | 3 | 必须包含全部用户、TOP3、非TOP3、VIP0~VIP3固定分层和存款/充提差/有效投注/输赢/杀率/投充比。 |
| FT10 | 游戏类型流水分布 | 所有用户/TOP3/非TOP3游戏类型流水分布 | FULL_PASS | 3 | 必须有所有用户/TOPN/非TOPN三块和Excel全游戏类型列；少枚举或少所有用户块不算FULL。 |
| FT11 | 首存金额分布与占比 | 首存金额分布与占比 | FULL_PASS | 3 | 必须输出汇总和固定金额桶/占比交替列；桶位缺失或长表不算FULL。 |

## 结论

截至 2026-05-03T13:31Z，FT01/FT02/FT04 均已通过可复跑 UI 外部补数自动化专项，严格同形达到 11/11 FULL_PASS。可以声明：`第一期数据报表需求V1.xlsx` 原始 FULL 示例表格已在当前 TiDB 回归 selector 下完成同形覆盖验证；其中依赖外部数据的表格必须以用户补充/导入的投放金额、PV、UV、下载点击UV为前提，不能在未补数时直接生成。


## 2026-05-03 外部补数专项补测

| 用例 | Thread | 补充方式 | Response | 关键 SQL/结果证据 | 结论 |
| --- | ---: | --- | ---: | --- | --- |
| FT01 综合日报 FULL 表 | 165 | 自动化 UI 脚本粘贴 `biz_date,tenant_plat_id,channel_id,ad_spend,access_pv,access_uv,download_click_uv` CSV，2026-04-01~2026-04-06 外部指标 | 186 | SQL 含 `external_metrics AS`、2026-04-01 外部指标行；preview 200，33 列、7 行；列为 日期/所属站点/所属渠道商/渠道名称/投放金额/登陆人数/.../合计优惠 | FULL_PASS |
| FT02 渠道整体 ROI 表 | 166 | 自动化 UI 脚本粘贴 `date,channel_id,ad_spend` CSV，点击“补充并继续” | 188 | SQL 含 `supplied_external_ad_spend AS`、2026-04-01 投放金额 1120；中文 22 列、`环比系数` 行；preview 200，返回 9 行 | FULL_PASS |
| FT04 渠道 TOP3 ROI 表 | 167 | 自动化 UI 脚本粘贴同一 `ad_spend` CSV，点击“补充并继续” | 190 | SQL 含 `bet_rank <= 3`、`'TOP3' AS user_type`、`supplied_external_ad_spend AS`；中文 22 列、`环比系数` 行；preview 200，返回 9 行 | FULL_PASS |

补测中先发现 `template_decision.sql_source=supplied_external_roi_template` 超出 AI Service API 枚举，导致旧 thread 157 后台结果卡在 SEARCHING；已将该分支的 `sql_source` 调整为现有合法值 `rendered_template`。随后新增 FT01 外部补数后的确定性综合日报 SQL 分支，避免补数后继续落入自由 SQL 生成/SQL correction 循环。最后新增 `wren-ui/scripts/tidb-full-external-supply-e2e.mjs`，把 FT01/FT02/FT04 的补数 CSV、同一 thread 继续、SQL 关键片段、preview 列序和行数断言固化为可复跑 UI E2E 自动化。验证：`node --check wren-ui/scripts/tidb-full-external-supply-e2e.mjs` 通过；自动化专项输出 `wren-ui/tmp/tidb-full-external-supply-e2e-output/summary.json` → PASS 3/3；`poetry run pytest tests/pytest/core/test_fixed_order_ask_runtime.py tests/pytest/services/test_ask.py -q` → 90 passed, 1 skipped。
