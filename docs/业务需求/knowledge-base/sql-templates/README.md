# SQL 模板清单

单文件模板是后续导入的**权威来源**；字段格式约定见 [`../import-format.md`](../import-format.md)，UI 导入顺序见 [`../ui-import-checklist.md`](../ui-import-checklist.md)，历史汇总页已归档到 [`../../_archive/knowledge-base/sql-templates.md`](../../_archive/knowledge-base/sql-templates.md)。

## 当前状态概览

说明：

- `status`：单文件作为**导入源**时的编写/准备状态
- `runtime_sync`：单文件在**当前 TiDB 回归 workspace** 中的实际落库状态回写

### 作为导入源的状态

| 状态 | 数量 | 说明 |
| --- | ---: | --- |
| `draft_sql` | 11 | 已有 SQL 草案 |
| `spec_only` | 0 | 仅有模板说明 |
| `blocked_missing_source` | 3 | 缺外部数据源 |

### 当前 TiDB workspace 的运行态回写（2026-04-26）

| 运行态 | 数量 | 说明 |
| --- | ---: | --- |
| `imported` | 11 | 已落库为 `sql_template` + `business_import` + `L2 anchored_template` |
| `blocked` | 3 | `T05 / T14 / T15` 仍缺外部数据源，未导入执行资产 |

## 为什么主目录里是 14 个文件，但当前环境里是 21 条记录

这两个数字代表的不是同一层含义：

- **14 个文件**：`sql-templates/` 目录下的模板定义文件数量
- **21 条记录**：当前 TiDB 回归 workspace 中 `sql_pairs` 表里的实际落库记录数量

原因是当前导入方式会把 **一个模板文件** 按 `question_variants` **展开为多条 sql_pair 记录**。  
因此，文件数统计的是“模板定义数”，记录数统计的是“问法级落库数”。

### 当前 21 条记录的展开关系

| 模板 ID | question_variants / 落库记录数 |
| --- | ---: |
| T01 | 3 |
| T02 | 2 |
| T03 | 2 |
| T04 | 2 |
| T06 | 2 |
| T08 | 1 |
| T09 | 3 |
| T10 | 2 |
| T11 | 1 |
| T12 | 2 |
| T13 | 1 |
| 合计 | 21 |

### 当前主目录为什么是 14 个文件

- 已导入模板：11 个（展开后共 21 条记录）
- 阻塞模板：3 个（`T05 / T14 / T15`，尚未导入执行资产）

所以当前主目录总数为：

- `11 + 3 = 14`

> 另外，legacy ES 占位模板 `T07` 已归档，不计入当前 `sql-templates/` 主目录。

## 单文件列表

| ID | 标题 | 源状态 `status` | 运行态 `runtime_sync.import_status` | result_grain | 链接 |
| --- | --- | --- | --- | --- | --- |
| T01 | 渠道日基础汇总 | `draft_sql` | `imported` | `biz_date + channel_id` | [T01_渠道日基础汇总.md](./T01_渠道日基础汇总.md) |
| T02 | 渠道与折扣映射 | `draft_sql` | `imported` | `channel_id` | [T02_渠道与折扣映射.md](./T02_渠道与折扣映射.md) |
| T03 | 首存 cohort 提取 | `draft_sql` | `imported` | `first_deposit_user` | [T03_首存 cohort 提取.md](./T03_首存%20cohort%20提取.md) |
| T04 | cohort 累计收入 | `draft_sql` | `imported` | `first_deposit_date + relative_day_no` | [T04_cohort 累计收入.md](./T04_cohort%20累计收入.md) |
| T05 | cohort ROI | `blocked_missing_source` | `blocked` | `first_deposit_date + relative_day_no` | [T05_cohort ROI.md](./T05_cohort%20ROI.md) |
| T06 | TOP3/非TOP3 分层 | `draft_sql` | `imported` | `player_id` | [T06_TOP3-非TOP3 分层.md](./T06_TOP3-非TOP3%20分层.md) |
| T08 | 首存 cohort 续存 | `draft_sql` | `imported` | `first_deposit_date + channel_id` | [T08_首存 cohort 续存.md](./T08_首存%20cohort%20续存.md) |
| T09 | 所有用户区间汇总 | `draft_sql` | `imported` | `time_range + user_segment` | [T09_所有用户区间汇总.md](./T09_所有用户区间汇总.md) |
| T10 | 首存用户日龄趋势 | `draft_sql` | `imported` | `first_deposit_date + relative_day_no` | [T10_首存用户日龄趋势.md](./T10_首存用户日龄趋势.md) |
| T11 | 按游戏类型分布 | `draft_sql` | `imported` | `dim_game_type_id` | [T11_按游戏类型分布.md](./T11_按游戏类型分布.md) |
| T12 | TOP3/5 游戏类型分层 | `draft_sql` | `imported` | `user_segment + dim_game_type_id` | [T12_TOP3-5 游戏类型分层.md](./T12_TOP3-5%20游戏类型分层.md) |
| T13 | 首存金额分桶 | `draft_sql` | `imported` | `first_deposit_date + bucket_name` | [T13_首存金额分桶.md](./T13_首存金额分桶.md) |
| T14 | 投放金额并表 | `blocked_missing_source` | `blocked` | `biz_date + channel_id` | [T14_投放金额并表.md](./T14_投放金额并表.md) |
| T15 | 流量指标并表 | `blocked_missing_source` | `blocked` | `biz_date + channel_id` | [T15_流量指标并表.md](./T15_流量指标并表.md) |

> legacy ES 占位模板 `T07` 已归档；当前 `sql-templates/` 只保留可沉淀为 TiDB SQL pair 的模板。
