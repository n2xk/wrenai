---
kb_asset_type: business_term
import_target: business_dictionary
import_format_version: v1
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
conflict_terms: []
source_documents:
  - 第一期数据报表需求V1.xlsx
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
