---
kb_asset_type: analysis_rule
import_target: instruction
import_format_version: v1
id: R14
title: ES 数据使用限制
scope: question_match
priority: high
status: draft
applies_to:
  - ROI回收表
  - 投充比与杀率
  - 游戏类型流水分布
questions:
  - 如果需求里提到ES指标该怎么处理？
  - 玩家日汇总或VIP日快照现在走ES还是TiDB？
  - legacy ES 指标没有TiDB映射时怎么回答？
keywords:
  - ES
  - 玩家日汇总
  - VIP日快照
source_documents:
  - 第一期数据报表需求V1.xlsx
  - 数据报表API对应SQL&DSL语句整理.xlsx
---

# R14 ES 数据使用限制

## 规则内容

当问题需要使用 legacy ES 指标（如玩家日 VIP、玩家日游戏或线路汇总）时，如果 ES 索引已经与 TiDB 表 / 视图存在映射，统一使用对应 TiDB SQL 模板或 SQL pair；不要保留也不要输出独立 ES DSL / ES sql_pair。若尚未提供 TiDB SQL 映射，则明确说明当前系统仅支持 SQL 模板，不能直接走 ES。

## 导入建议

- scope = `question_match`
- 后续建议导入为 knowledge instruction

## 作用报表

- ROI回收表
- 投充比与杀率
- 游戏类型流水分布

## 关键词

- ES
- 玩家日汇总
- VIP日快照

## 备注

当前系统 SQL pair 创建时会做 SQL 校验，且当前运行时只连 TiDB；因此 ES 索引类能力只能通过 TiDB 映射表 / 视图落成 SQL。
