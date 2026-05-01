---
kb_asset_type: business_term
import_target: business_dictionary
import_format_version: v2
id: traffic_metrics
name: 流量指标
category: metric
status: active
priority: high
aliases:
  - 流量指标
  - PV
  - UV
  - 访问PV
  - 访问UV
  - 下载点击UV
  - UV下载率
  - UV注册率
definition: 访问、下载、注册等上游流量指标，当前依赖外部数据源补充
canonical_expression: external traffic metrics by biz_date + channel_id
source_tables: []
source_fields: []
related_rules:
  - R13
related_templates:
  - T15
features:
  - traffic
  - external_metrics
conflict_terms:
  - roi
  - first_deposit_cost
source_documents:
  - 第一期数据报表需求V1.xlsx
applicable_scenarios:
  - 统计 PV、UV、访问人数、下载点击 UV
  - 统计 UV 下载率、UV 注册率等流量转化指标
not_applicable_scenarios:
  - 只查询站内充值、投注、首存、续存、提现指标
  - 只查询 ROI 或投放成本，不涉及访问或下载流量
required_slots:
  - date_range
  - channel_id
supported_grains:
  - biz_date + channel_id
  - date_range + channel_id
---

# 流量指标

## 定义

访问、下载、注册等上游流量指标，当前依赖外部数据源补充

## 规范表达式

```sql
external traffic metrics by biz_date + channel_id
```

## Runtime 用途

- 通过 aliases 辅助识别用户问题中的业务概念。
- 通过 related_rules / related_templates 联动分析规则和 SQL 模板。
- 通过 features 参与 SQL 模板重排与 gating。
