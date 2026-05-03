# 第一期 Excel FULL 同形严格校验结果

- 执行时间：2026-05-03T10:28:28.081830+00:00
- FULL 用例数：11
- 严格状态统计：{"FULL_PASS": 4, "NOT_RUN": 7}

## 判定规则

- `FULL_PASS`：必须有真实 SQL/结果、没有缺口/阻断/提示型 message SQL，并包含该 FT 的关键列、分组和宽表信号。
- `BLOCKED_EXTERNAL`：外部投放/PV/UV/下载点击UV/VIP模型等能力缺失被正确阻断；这是安全行为，但不能计入 FULL 同形通过。
- `SHAPE_GAP`：有结果但字段、分组、宽表/透视形态、汇总行或周期列不足；不能计入 FULL 同形通过。
- `NOT_RUN`：未找到该 FT 的执行证据。

## 明细

| FT | Excel sheet | 示例表格 | 严格状态 | 泛化变体数 | 主要原因 |
| --- | --- | --- | --- | ---: | --- |
| FT01 | 综合日报表 | 每日数据表格示例 | NOT_RUN | 3 | 未找到该 FULL 用例的 ask-summary 结果 |
| FT02 | ROI回收表 | 渠道整体ROI表 | NOT_RUN | 3 | 未找到该 FULL 用例的 ask-summary 结果 |
| FT03 | ROI回收表 | 渠道累计收入表 | FULL_PASS | 3 | 累计收入不依赖投放金额；必须直接生成D1~D360累计收入宽表和环比。 |
| FT04 | ROI回收表 | 渠道TOP3 ROI表 | NOT_RUN | 3 | 未找到该 FULL 用例的 ask-summary 结果 |
| FT05 | ROI回收表 | 渠道TOP3累计收入表 | FULL_PASS | 3 | TOP3累计收入不依赖投放金额；必须直接生成TOP3 D1~D360累计收入宽表和环比。 |
| FT06 | 首存及续存率 | 首存及2~6存率表 | NOT_RUN | 3 | 未找到该 FULL 用例的 ask-summary 结果 |
| FT07 | 投充比与杀率 | 首存用户杀率趋势 | FULL_PASS | 3 | 必须明确周期并输出首日到截止日杀率宽表；缺n_days澄清不算FULL PASS。 |
| FT08 | 投充比与杀率 | 首存用户投充比趋势 | FULL_PASS | 3 | 必须明确周期并输出首日到截止日投充比宽表；缺n_days澄清不算FULL PASS。 |
| FT09 | 投充比与杀率 | 渠道所有用户杀率及投充比 | NOT_RUN | 3 | 未找到该 FULL 用例的 ask-summary 结果 |
| FT10 | 游戏类型流水分布 | 所有用户/TOP3/非TOP3游戏类型流水分布 | NOT_RUN | 3 | 未找到该 FULL 用例的 ask-summary 结果 |
| FT11 | 首存金额分布与占比 | 首存金额分布与占比 | NOT_RUN | 3 | 未找到该 FULL 用例的 ask-summary 结果 |

## 结论

当前不能声明 `第一期数据报表需求V1.xlsx` 原始 FULL 示例表格 11/11 同形覆盖。
只有所有 FT 均达到 `FULL_PASS`，才允许在最终报告中写“原始 Excel 示例表格已完全覆盖且查出来一样”。
