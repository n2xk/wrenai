---
kb_asset_type: external_dependency
import_target: external_dependency
import_format_version: v2
id: download_click_uv
name: 下载点击UV
status: active
source_status: missing
missing_behavior: ask_user
aliases:
  - 下载点击UV
  - 下载UV
  - 下载点击人数
  - 点击下载人数
required_grain:
  - biz_date + channel_id
required_by_terms:
  - traffic_metrics
required_by_templates:
  - T15
related_rules:
  - R13
ask_user_prompt: 请提供当前问题对应统计粒度的下载点击 UV。
validation:
  value_type: number
  min: 0
source_documents:
  - 第一期数据报表需求V1.xlsx
trigger_when:
  - 问题要求下载点击 UV、下载UV、下载点击人数、点击下载人数
  - 问题要求 UV 下载率或下载转化率
  - SQL 模板或业务词明确依赖 download_click_uv
not_trigger_when:
  - 只查询站内充值、投注、首存、续存、提现指标
  - 只查询 PV / UV 但不要求下载转化
  - 用户明确说明不用外部数据、去掉下载点击UV，或只展示系统内可查询原始指标
lifecycle: per_question
input_modes:
  - single_value
  - csv_upload
required_grain_schema:
  required_columns:
    - date
    - channel_id
    - download_click_uv
  accepted_grains:
    - biz_date + channel_id
    - date_range + channel_id
value_schema:
  download_click_uv:
    type: number
    min: 0
    description: 下载点击 UV
join_contract:
  status: target_design
  join_keys:
    - biz_date
    - channel_id
  join_type: left_join_after_user_confirmation
  note: 当前运行时只做缺失阻断和追问，不自动生成联邦 join。
---

# 下载点击UV

## 缺失处理

当前 TiDB 数据源不包含 `下载点击UV`，当问数问题或 SQL 模板依赖该指标时，runtime 应按 `missing_behavior = ask_user` 向用户索取对应粒度的数据，而不是编造结果。

## 追问话术

请提供当前问题对应统计粒度的下载点击 UV。
