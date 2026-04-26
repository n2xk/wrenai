---
kb_asset_type: external_dependency
import_target: external_dependency
import_format_version: v1
id: access_uv
name: 访问UV
status: active
source_status: missing
missing_behavior: ask_user
aliases:
  - UV
  - 访问UV
  - 访问人数
  - 独立访客数
required_grain:
  - biz_date + channel_id
required_by_terms:
  - traffic_metrics
required_by_templates:
  - T15
related_rules:
  - R13
ask_user_prompt: 请提供当前问题对应统计粒度的访问 UV。
validation:
  value_type: number
  min: 0
source_documents:
  - 第一期数据报表需求V1.xlsx
---

# 访问UV

## 缺失处理

当前 TiDB 数据源不包含 `访问UV`，当问数问题或 SQL 模板依赖该指标时，runtime 应按 `missing_behavior = ask_user` 向用户索取对应粒度的数据，而不是编造结果。

## 追问话术

请提供当前问题对应统计粒度的访问 UV。
