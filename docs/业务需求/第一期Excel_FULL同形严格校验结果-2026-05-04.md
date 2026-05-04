# 第一期 Excel FULL 同形严格校验结果

- 执行时间：2026-05-04T10:32:30.299853+00:00
- FULL 用例数：11
- 严格状态统计：{"FULL_PASS": 11}

## 判定规则

- `FULL_PASS`：必须有真实 SQL/结果、没有缺口/阻断/提示型 message SQL，并包含该 FT 的关键列、分组和宽表信号。
- 对外部数据必需的 FT01/FT02/FT04，`FULL_PASS` 必须来自首问阻断后的 UI E2E 补数闭环专项证据。
- `BLOCKED_EXTERNAL`：外部投放/PV/UV/下载点击UV等能力缺失被正确阻断；这是安全行为，但不能计入 FULL 同形通过。
- `SHAPE_GAP`：有结果但字段、分组、宽表/透视形态、汇总行或周期列不足；不能计入 FULL 同形通过。
- `NOT_RUN`：未找到该 FT 的执行证据。

## 明细

| FT | Excel sheet | 示例表格 | 严格状态 | 泛化变体数 | 主要原因 |
| --- | --- | --- | --- | ---: | --- |
| FT01 | 综合日报表 | 每日数据表格示例 | FULL_PASS | 3 | 外部补数专项通过：thread=103 response=106 rows=7 columns=33；已补充外部槽位：external_dependency:投放金额、external_dependency:访问UV、external_dependency:下载点击UV、external_dependency:访问PV |
| FT02 | ROI回收表 | 渠道整体ROI表 | FULL_PASS | 3 | 外部补数专项通过：thread=104 response=108 rows=9 columns=22；已补充外部槽位：external_dependency:投放金额 |
| FT03 | ROI回收表 | 渠道累计收入表 | FULL_PASS | 3 | 累计收入不依赖投放金额；必须直接生成 Excel 固定周期列累计收入宽表和环比，不要误生成360个逐日列。 |
| FT04 | ROI回收表 | 渠道TOP3 ROI表 | FULL_PASS | 3 | 外部补数专项通过：thread=105 response=110 rows=9 columns=22；已补充外部槽位：external_dependency:投放金额 |
| FT05 | ROI回收表 | 渠道TOP3累计收入表 | FULL_PASS | 3 | TOP3累计收入不依赖投放金额；必须直接生成 TOP3 Excel 固定周期列累计收入宽表和环比，不要误生成360个逐日列。 |
| FT06 | 首存及续存率 | 首存及2~6存率表 | FULL_PASS | 3 | 必须同时有汇总行、全部/TOP3/非TOP3分层和首存到六存人数/率/均额。 |
| FT07 | 投充比与杀率 | 首存用户杀率趋势 | FULL_PASS | 3 | 必须明确周期并输出首日到截止日杀率宽表；缺n_days澄清不算FULL PASS。 |
| FT08 | 投充比与杀率 | 首存用户投充比趋势 | FULL_PASS | 3 | 必须明确周期并输出首日到截止日投充比宽表；缺n_days澄清不算FULL PASS。 |
| FT09 | 投充比与杀率 | 渠道所有用户杀率及投充比 | FULL_PASS | 3 | 必须包含全部用户、TOP3、非TOP3、VIP0~VIP3固定分层和存款/充提差/有效投注/输赢/杀率/投充比。 |
| FT10 | 游戏类型流水分布 | 所有用户/TOP3/非TOP3游戏类型流水分布 | FULL_PASS | 3 | 必须有所有用户/TOPN/非TOPN三块和Excel全游戏类型列；少枚举或少所有用户块不算FULL。 |
| FT11 | 首存金额分布与占比 | 首存金额分布与占比 | FULL_PASS | 3 | 必须输出汇总和固定金额桶/占比交替列；桶位缺失或长表不算FULL。 |

## 结论

全部 FT 达到严格 FULL 同形通过。
