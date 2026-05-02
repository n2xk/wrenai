---
kb_asset_type: external_dependency
import_target: external_dependency
import_format_version: v2
id: access_pv
name: 访问PV
status: active
source_status: missing
missing_behavior: ask_user
aliases:
  - PV
  - 访问PV
  - 页面访问量
  - 页面浏览量
required_grain:
  - biz_date + channel_id
required_by_terms:
  - traffic_metrics
required_by_templates:
  - T15
related_rules:
  - R13
ask_user_prompt: 请提供当前问题对应统计粒度的访问 PV。
validation:
  value_type: number
  min: 0
source_documents:
  - 第一期数据报表需求V1.xlsx
trigger_when:
  - 问题要求 PV、访问PV、页面访问量、页面浏览量
  - 问题要求 UV 注册率、UV 下载率且公式需要访问 PV 作为补充指标
  - SQL 模板或业务词明确依赖 access_pv
not_trigger_when:
  - 只查询站内充值、投注、首存、续存、提现指标
  - 只查询 ROI、投放金额、首存成本且不涉及访问 PV
  - 用户明确说明不用外部数据、去掉 PV / 访问PV，或只展示系统内可查询原始指标
lifecycle: per_question
input_modes:
  - single_value
  - csv_upload
required_grain_schema:
  required_columns:
    - date
    - channel_id
    - access_pv
  accepted_grains:
    - biz_date + channel_id
    - date_range + channel_id
value_schema:
  access_pv:
    type: number
    min: 0
    description: 访问 PV
join_contract:
  status: target_design
  join_keys:
    - biz_date
    - channel_id
  join_type: left_join_after_user_confirmation
  note: 当前运行时只做缺失阻断和追问，不自动生成联邦 join。
---

# 访问PV

## 缺失处理

当前 TiDB 数据源不包含 `访问PV`，当问数问题或 SQL 模板依赖该指标时，runtime 应按 `missing_behavior = ask_user` 向用户索取对应粒度的数据，而不是编造结果。

## 追问话术

请提供当前问题对应统计粒度的访问 PV。
