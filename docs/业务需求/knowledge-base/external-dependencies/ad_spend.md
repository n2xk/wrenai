---
kb_asset_type: external_dependency
import_target: external_dependency
import_format_version: v2
id: ad_spend
name: 投放金额
status: active
source_status: missing
missing_behavior: ask_user
aliases:
  - 投放金额
  - 买量成本
  - 广告消耗
  - 推广成本
  - 投放成本
required_grain:
  - biz_date + channel_id
  - date_range + channel_id
  - cohort_period
trigger_when:
  - 问题要求 ROI、获客成本、首存成本、投充比中明确包含投放成本口径
  - SQL 模板或业务词明确依赖投放金额
not_trigger_when:
  - 只查询站内充值、提现、投注、登录、注册指标
  - 只查询首存名单、续存人数、玩家明细，不要求成本或 ROI
  - 用户明确说明不用外部数据、去掉投放金额，或暂时不计算 ROI / 首存成本等投放派生指标
lifecycle: per_question
input_modes:
  - single_value
  - csv_upload
required_by_terms:
  - roi
  - first_deposit_cost
required_by_templates:
  - T05
  - T14
related_rules:
  - R13
ask_user_prompt: 请提供当前问题对应统计粒度的投放金额。
validation:
  value_type: number
  min: 0
source_documents:
  - 第一期数据报表需求V1.xlsx
required_grain_schema:
  required_columns:
    - date
    - channel_id
    - ad_spend
  accepted_grains:
    - biz_date + channel_id
    - date_range + channel_id
    - cohort_period
value_schema:
  ad_spend:
    type: number
    min: 0
    description: 投放金额
join_contract:
  status: target_design
  join_keys:
    - biz_date
    - channel_id
  join_type: left_join_after_user_confirmation
  note: 当前运行时只做缺失阻断和追问，不自动生成联邦 join。
---

# 投放金额

## 缺失处理

当前 TiDB 数据源不包含 `投放金额`，当问数问题或 SQL 模板依赖该指标时，runtime 应按 `missing_behavior = ask_user` 向用户索取对应粒度的数据，而不是编造结果。

## 追问话术

请提供当前问题对应统计粒度的投放金额。
