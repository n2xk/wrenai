# 当前 TiDB workspace 知识资产快照 - 2026-05-03

## 本轮 selector

```json
{
  "workspaceId": "30de9fce-90f4-45ce-84cd-0c3826800adf",
  "workspaceSlug": "tidb-clean-regression-20260503",
  "knowledgeBaseId": "cd5efb36-8d8d-4022-8174-5a28c361ab10",
  "kbSnapshotId": "9481437c-4ddb-402c-aa15-b986523a9b16",
  "deployHash": "5e269f7df7b3680f146a1ed5d9bec484e0788e61"
}
```

## B0 导入与生成结果

| 资产 | 数量 / 状态 |
| --- | --- |
| TiDB connector | 1 |
| TiDB tables / models | 25 / 25 |
| Columns | 747 |
| 分析规则 | 14 |
| 业务词典 | 10 |
| 外部数据依赖 | 4 |
| 问数策略 | 4 |
| SQL pairs | 23 |
| 覆盖 SQL 模板 | T01/T02/T03/T04/T06/T08/T09/T10/T11/T12/T13 |
| Suggested questions | 6 |
| 语义提示 | 25 models / 747 columns 已保存 |
| 关联关系 | recommended=121, mapped=121, saved=121 |
| 最终部署 | SUCCESS |

## 回归后主 workspace 资产状态

| 类型 | 数量 | 说明 |
| --- | ---: | --- |
| knowledge_base | 2 | 本轮 TiDB KB + 默认/系统相关 KB |
| connector | 1 | TiDB connector |
| model | 25 | 本轮 TiDB KB |
| model_column | 747 | 本轮 TiDB KB |
| relation | 121 | 本轮 TiDB KB 保存的 AI 推荐关系 |
| instruction | 14 | 分析规则 |
| knowledge_business_terms | 10 | 业务词典 |
| knowledge_external_dependencies | 4 | 外部数据依赖 |
| ask_policy_rule | 4 | 问数策略 |
| sql_pair | 25 | 含导入模板及本轮保存 SQL 模板验证产物 |
| thread | 122 | 本轮 UI E2E 问数历史 |
| thread_response | 131 | 本轮 UI E2E 响应历史 |
| spreadsheet | 12 | B1 的 11 张 FT-D + B3 非 FT 表格验证 |
| dashboard | 1 | B3 图表固定验证 |
| dashboard_item | 1 | B3 图表固定验证 |
| feedback | 2 | B3 正/负反馈验证 |

## 数据表资产

| ID | 名称 | 来源 Thread | 来源 Response | 当前版本 |
| ---: | --- | ---: | ---: | ---: |
| 1 | FT01-D_综合日报内部指标表 | 4 | 4 | 1 |
| 2 | FT02-D_渠道累计收入替代ROI表 | 5 | 5 | 1 |
| 3 | FT03-D_渠道累计收入内部指标表 | 6 | 6 | 1 |
| 4 | FT04-D_TOP3累计收入替代ROI表 | 7 | 7 | 1 |
| 5 | FT05-D_TOP3累计收入内部指标表 | 8 | 8 | 1 |
| 6 | FT06-D_首存及续存率内部指标表 | 9 | 9 | 1 |
| 7 | FT07-D_首存用户杀率趋势内部指标表 | 10 | 10 | 1 |
| 8 | FT08-D_首存用户投充比趋势内部指标表 | 11 | 11 | 1 |
| 9 | FT09-D_所有用户杀率投充比内部指标表 | 12 | 12 | 1 |
| 10 | FT10-D_游戏类型流水分布内部指标表 | 13 | 13 | 1 |
| 11 | FT11-D_首存金额分布内部指标表 | 14 | 14 | 1 |
| 12 | B3_T01_非FT表格保存验证 | 16 | 16 | 9 |

## 注意事项

- 数据库总量中出现系统样例 workspace / KB 是当前应用初始化行为，统计本轮结果时必须使用上面的 selector 过滤。
- FULL Excel 同形覆盖尚未完全通过，主要缺 PV/UV/下载点击 UV/投放金额等外部数据输入能力。
