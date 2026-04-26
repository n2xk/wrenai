---
kb_asset_type: external_dependency
import_target: external_dependency
import_format_version: v1
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
---

# 访问PV

## 缺失处理

当前 TiDB 数据源不包含 `访问PV`，当问数问题或 SQL 模板依赖该指标时，runtime 应按 `missing_behavior = ask_user` 向用户索取对应粒度的数据，而不是编造结果。

## 追问话术

请提供当前问题对应统计粒度的访问 PV。
