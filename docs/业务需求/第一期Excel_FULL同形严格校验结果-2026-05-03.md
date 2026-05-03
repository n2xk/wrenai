# 第一期 Excel FULL 同形严格校验结果

- 执行时间：2026-05-03T08:57:42.335083+00:00
- FULL 用例数：11
- 严格状态统计：{"BLOCKED_EXTERNAL": 4, "SHAPE_GAP": 7}

## 判定规则

- `FULL_PASS`：必须有真实 SQL/结果、没有缺口/阻断/提示型 message SQL，并包含该 FT 的关键列、分组和宽表信号。
- `BLOCKED_EXTERNAL`：外部投放/PV/UV/下载点击UV/VIP模型等能力缺失被正确阻断；这是安全行为，但不能计入 FULL 同形通过。
- `SHAPE_GAP`：有结果但字段、分组、宽表/透视形态、汇总行或周期列不足；不能计入 FULL 同形通过。
- `NOT_RUN`：未找到该 FT 的执行证据。

## 明细

| FT | Excel sheet | 示例表格 | 严格状态 | 泛化变体数 | 主要原因 |
| --- | --- | --- | --- | ---: | --- |
| FT01 | 综合日报表 | 每日数据表格示例 | BLOCKED_EXTERNAL | 3 | runner_status=FAIL；SQL 缺失；命中阻断/缺口信号：SQL 缺失、缺失 |
| FT02 | ROI回收表 | 渠道整体ROI表 | BLOCKED_EXTERNAL | 3 | 返回的是提示型 message SQL，不是原始 Excel 同形结果；命中阻断/缺口信号：缺少、请提供、无法计算、ad_spend；缺少同形字段/分组：用户类型、累计1天、3天、7天、15天、30天、60天、90天、120天、150天、180天、210天 |
| FT03 | ROI回收表 | 渠道累计收入表 | SHAPE_GAP | 3 | runner_status=PARTIAL；SQL 缺失；命中阻断/缺口信号：SQL 缺失、缺少、缺失、不能编造、当前知识库还缺少 |
| FT04 | ROI回收表 | 渠道TOP3 ROI表 | BLOCKED_EXTERNAL | 3 | runner_status=PARTIAL；SQL 缺失；命中阻断/缺口信号：SQL 缺失、缺少、缺失、不能编造、当前知识库还缺少 |
| FT05 | ROI回收表 | 渠道TOP3累计收入表 | SHAPE_GAP | 3 | runner_status=PARTIAL；SQL 缺失；命中阻断/缺口信号：SQL 缺失、缺少、缺失、不能编造、当前知识库还缺少 |
| FT06 | 首存及续存率 | 首存及2~6存率表 | SHAPE_GAP | 3 | 缺少同形字段/分组：全部用户、首存人均金额 |
| FT07 | 投充比与杀率 | 首存用户杀率趋势 | SHAPE_GAP | 3 | runner_status=PARTIAL；SQL 缺失；命中阻断/缺口信号：SQL 缺失、缺失、需要补充回收周期、请说明要累计到 |
| FT08 | 投充比与杀率 | 首存用户投充比趋势 | SHAPE_GAP | 3 | runner_status=PARTIAL；SQL 缺失；命中阻断/缺口信号：SQL 缺失、缺失、需要补充回收周期、请说明要累计到 |
| FT09 | 投充比与杀率 | 渠道所有用户杀率及投充比 | BLOCKED_EXTERNAL | 3 | 命中阻断/缺口信号：请提供、未包含VIP、如需补充请提供VIP；缺少同形字段/分组：非TOP3、VIP0、VIP1、VIP2、VIP3、存款金额、充提差 |
| FT10 | 游戏类型流水分布 | 所有用户/TOP3/非TOP3游戏类型流水分布 | SHAPE_GAP | 3 | 命中阻断/缺口信号：仅包含TOP3；缺少同形字段/分组：有效投注流水、下注次数、均注金额、输赢、杀率、投注占比、捕鱼、彩票、电竞、电子-老虎机、电子-街机、电子棋牌 |
| FT11 | 首存金额分布与占比 | 首存金额分布与占比 | SHAPE_GAP | 3 | 命中阻断/缺口信号：请提供；缺少同形字段/分组：首存用户数、其他金额 |

## 结论

当前不能声明 `第一期数据报表需求V1.xlsx` 原始 FULL 示例表格 11/11 同形覆盖。
只有所有 FT 均达到 `FULL_PASS`，才允许在最终报告中写“原始 Excel 示例表格已完全覆盖且查出来一样”。
