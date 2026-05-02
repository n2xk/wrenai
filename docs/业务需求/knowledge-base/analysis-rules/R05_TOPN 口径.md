---
kb_asset_type: analysis_rule
import_target: instruction
import_format_version: v1
id: R05
title: TOPN 口径
scope: question_match
priority: high
status: draft
applies_to:
  - ROI回收表
  - 首存及续存率
  - 投充比与杀率
  - 游戏类型流水分布
questions:
  - TOP3渠道按什么口径划分？
  - 非TOP3用户怎么定义？
  - TOP5或非TOP5是按整段时间累计有效投注排序吗？
  - 大户、头部用户、投注流水最高的前N个用户按什么口径识别？
  - 活跃用户不足N人时，TOPN和非TOPN怎么处理？
keywords:
  - TOP3
  - TOP5
  - 非TOP3
  - 非TOP5
  - 大户
  - 头部用户
  - 高流水用户
  - 投注流水最高
  - 前N个用户
related_business_terms:
  - topn_segment
related_external_dependencies: []
runtime_usage:
  participates_in:
    - instruction_retrieval
    - template_matching
  priority_hint: high
source_documents:
  - 第一期数据报表需求V1.xlsx
  - 数据报表API对应SQL&DSL语句整理.xlsx
---

# R05 TOPN 口径

## 规则内容

当问题涉及 TOP3/TOP5/非TOP3/非TOP5、大户、头部用户、高流水用户、投注流水最高的前 N 个用户时，必须按所选统计区间内的用户累计有效投注排序，不按单日排序，也不按充值金额、输赢或注册时间排序。

默认口径：

- TOPN 排序指标：统计区间内累计有效投注额 `SUM(valid_bet_amount)`。
- 活跃用户：统计区间内有充值、提现或有效投注任一行为的去重玩家。
- 当活跃用户数不足 N：TOPN 使用实际活跃用户数，非 TOPN 为空集合或 0，并在回答中说明“活跃用户不足 N 人”。
- 当用户同时说“前 N 个大户”和“其他用户 / 其余用户 / 非 TOPN”时，应返回 TOPN 与 NON_TOPN 两组结果用于对比。

## 导入建议

- scope = `question_match`
- 后续建议导入为 knowledge instruction

## 作用报表

- ROI回收表
- 首存及续存率
- 投充比与杀率
- 游戏类型流水分布

## 关键词

- TOP3
- TOP5
- 非TOP3
- 非TOP5
- 大户
- 头部用户
- 高流水用户
- 投注流水最高
- 前N个用户

## 备注

TOPN 应先在整段区间内按用户累计有效投注排名，再回写到指标统计。不要因为用户使用“大户”等口语表达就改用充值金额或单日投注额。
