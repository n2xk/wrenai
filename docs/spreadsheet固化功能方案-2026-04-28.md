# Spreadsheet 固化功能方案

日期：2026-04-28

## 1. 背景

我们需要把“问数结果中的数据表格”从“看板展示组件”中拆出来，作为独立的一等数据资产管理。最终产品边界为：

- **固定到看板**：只用于图表 / 指标等可视化结果。
- **保存为数据表**：用于表格型查询结果，保存为 Spreadsheet / 数据表资产。
- **Dashboard TABLE**：仅保留历史兼容渲染，不再作为新建入口或新建 API 能力暴露。

同时，我们对 Wren Cloud 的 Spreadsheet 页面进行了只读观察：

```text
https://cloud.getwren.ai/projects/15008/home/spreadsheets/5656
```

观察结论是：Cloud 的 Spreadsheet 固化并不是简单的“看板表格卡片”，而是一个独立的一等资源，具备 SQL 固化、分页预览、列设置、版本历史、AI 数据操作、保存/撤销等完整工作流。

## 2. 官方 Cloud Spreadsheet 的实现形态

### 2.1 产品入口

Cloud 页面路由：

```text
/projects/:projectId/home/spreadsheets/:id
```

左侧导航中 Spreadsheet 与 Dashboard、Thread 并列：

```text
Dashboards
Spreadsheets
Threads
```

这说明 Spreadsheet 是独立资源，而不是 Dashboard 内部的一个 item。

### 2.2 数据实体

GraphQL `Spreadsheet` 查询返回的核心字段：

```ts
spreadsheet {
  id
  projectId
  name
  createdBy
  updatedBy
  sql
  matchedQuestion
  matchedViewId
  currentVersion
  createdAt
  updatedAt
  history {
    id
    version
    createdBy
    type
    sql
    payload
    createdAt
  }
  setting {
    id
    spreadsheetId
    hiddenColumns
    pinnedColumns
    unpinnedColumns
    createdAt
    updatedAt
  }
  isShared
  folder
}
```

核心含义：

- `sql`：固化的 SQL。
- `matchedQuestion`：来源问题或匹配问题。
- `matchedViewId`：与语义视图的关联。
- `currentVersion`：当前保存版本。
- `history[]`：保存历史和版本记录。
- `setting`：列显示、列顺序、固定列等配置。
- `folder` / `isShared`：资源组织和共享能力。

### 2.3 数据预览和分页

Cloud 使用服务端分页预览，而不是一次性加载全部数据。

预览数据：

```graphql
mutation PreviewSpreadsheetData($where: PreviewSpreadsheetDataInput!) {
  previewSpreadsheetData(where: $where)
}
```

请求参数包含：

```json
{
  "sql": "...",
  "page": 0,
  "spreadsheetSettingId": 6468
}
```

分页信息：

```graphql
mutation GetSpreadsheetPaginationInfo($data: SpreadsheetPaginationInfoInput!) {
  getSpreadsheetPaginationInfo(data: $data) {
    pageSize
    rowCount
    totalPages
  }
}
```

观察到的页面示例：

```text
pageSize: 100
rowCount: 5978
totalPages: 60
```

### 2.4 列设置

Cloud 的 `setting` 中包含：

```ts
{
  hiddenColumns: [],
  pinnedColumns: [],
  unpinnedColumns: [
    "first_name",
    "last_name",
    "department_name",
    "average_salary",
    "age",
    "tenure"
  ]
}
```

页面上有 `Update columns` 入口，可进行列显示和列顺序管理。

### 2.5 版本历史和保存工作流

页面中存在：

```text
Undo
Redo
Save
Discard Changes
History
```

History 抽屉展示：

```text
Unsaved changes
Saved Versions
Version: ...
```

前端 bundle 中可观察到相关 mutation：

```graphql
CreateSpreadsheet
UpdateSpreadsheet
SaveSpreadsheet
DeleteSpreadsheet
CreateSpreadsheetSetting
UpdateSpreadsheetSetting
DeleteSpreadsheetSetting
```

这说明 Cloud Spreadsheet 有“未保存变更 / 保存版本 / 历史恢复”的完整模型。

### 2.6 AI 数据操作

页面提供 AI Assistant 操作：

```text
Filter
Cleaning
Grouping
Enrichment
```

这些不是普通前端筛选，而是通过自然语言生成新的 SQL 或 SQL 变换。

观察到的相关 GraphQL 能力：

```graphql
CreateAISpreadsheetOperation
GetAISpreadsheetOperationResult
ValidateSpreadsheetSQL
```

推断流程：

1. 用户输入自然语言操作。
2. 创建 AI Spreadsheet Operation。
3. 后端异步生成新的 SQL。
4. 前端轮询操作结果。
5. 预览新 SQL。
6. 用户确认后 Save，形成新版本。

## 3. 我们当前目标实现

当前目标实现是：

```text
问数结果 SQL
  → 保存为数据表
  → 创建 Spreadsheet
  → 在数据表工作台中查看、分页、加工和版本化
```

关键特征：

- 存储在 `spreadsheet` / `spreadsheet_setting` / `spreadsheet_history`。
- 保存 SQL、sqlMode、sourceResponseId、sourceThreadId、sourceQuestion、runtime scope 等来源信息。
- 数据表详情页按 Spreadsheet 的语义进行预览、列设置、历史记录和 AI 数据操作。
- 数据表列表放在 Home 工作区右侧 rail，与知识库 / 数据看板列表的信息架构对齐。
- 新建入口使用“保存为数据表”，不再使用“固定表格到看板”。

历史上已经存在的 `DashboardItemType.TABLE` 可继续渲染，避免破坏旧数据；但新的问数结果表格不应再创建 Dashboard TABLE。

## 4. 差异对比

| 维度        | Cloud Spreadsheet / 目标实现                              | 历史 Dashboard TABLE                                     |
| ----------- | --------------------------------------------------------- | -------------------------------------------------------- |
| 产品定位    | 独立数据表/分析工作表                                     | 看板里的表格卡片                                         |
| 路由        | `/home/spreadsheets/:id`                                  | 数据看板页面内部                                         |
| 资源类型    | `spreadsheet`                                             | `dashboard_item`                                         |
| 固化内容    | SQL + matchedQuestion + matchedViewId + version + setting | SQL + sourceResponseId + sourceThreadId + sourceQuestion |
| 数据预览    | 服务端分页，支持 rowCount / totalPages                    | 按 preview limit 重新查询                                |
| 列配置      | hidden / pinned / unpinned columns                        | 暂无                                                     |
| 版本历史    | Save / Discard / History                                  | 暂无                                                     |
| AI 操作     | Filter / Cleaning / Grouping / Enrichment                 | 暂无                                                     |
| 文件夹/共享 | 支持 folder / isShared                                    | 依赖看板自身                                             |
| 使用场景    | 数据分析资产，可持续加工                                  | 历史兼容展示                                             |

## 5. 产品边界建议

明确区分两个能力，并禁止表格结果继续混入看板资产：

### 5.1 固定到看板

继续保留，但只面向图表 / 指标：

```text
问数结果图表 → 固定到看板 → DashboardItem(Chart / Number)
```

定位：

- 用于可视化展示和监控。
- 适合放在数据看板中定期刷新。
- 不承载表格型明细数据的二次加工、版本管理和列设置。
- 前端不提供“表格固定到看板”入口。
- API 层拒绝新的 `DashboardItemType.TABLE` 创建请求。

### 5.2 保存为数据表 / Spreadsheet

表格型查询结果使用独立功能：

```text
问数结果 → 保存为数据表 → Spreadsheet
```

定位：

- 用于保存查询结果对应的 SQL。
- 支持分页查看。
- 支持列配置。
- 支持后续 AI 数据处理。
- 支持版本历史。
- 支持在右侧数据表列表中查找、打开和管理。

## 6. 建议的数据模型

### 6.1 `spreadsheet`

```ts
spreadsheet {
  id
  project_id
  workspace_id
  knowledge_base_id
  kb_snapshot_id
  deploy_hash
  actor_user_id

  name
  sql
  sql_mode
  matched_question
  matched_view_id
  source_thread_id
  source_response_id

  current_version
  is_shared
  folder_id

  created_by
  updated_by
  created_at
  updated_at
}
```

### 6.2 `spreadsheet_history`

```ts
spreadsheet_history {
  id
  spreadsheet_id
  version
  type                // INITIALIZE / SAVE / AI_OPERATION / RESTORE
  sql
  payload
  created_by
  created_at
}
```

### 6.3 `spreadsheet_setting`

```ts
spreadsheet_setting {
  id
  spreadsheet_id
  hidden_columns
  pinned_columns
  unpinned_columns
  column_widths
  created_at
  updated_at
}
```

## 7. API 设计

### 7.1 创建 Spreadsheet

```http
POST /api/v1/spreadsheets
```

body：

```ts
{
  responseId?: number;
  sql?: string;
  name?: string;
}
```

使用场景：

- 从问数结果保存。
- 从手写 SQL 创建。

### 7.2 获取列表

```http
GET /api/v1/spreadsheets
```

支持 runtime scope：

- workspaceId
- knowledgeBaseId
- kbSnapshotId
- deployHash

### 7.3 获取详情

```http
GET /api/v1/spreadsheets/:id
```

返回：

- spreadsheet 基础信息
- setting
- history 摘要

### 7.4 预览数据

```http
POST /api/v1/spreadsheets/:id/preview
```

body：

```ts
{
  page: number;
  pageSize?: number;
  refresh?: boolean;
}
```

返回：

```ts
{
  columns: Array<{ name: string; type: string }>;
  data: unknown[][];
  page: number;
  pageSize: number;
  rowCount: number;
  totalPages: number;
}
```

### 7.5 更新列设置

```http
PATCH /api/v1/spreadsheets/:id/setting
```

body：

```ts
{
  hiddenColumns?: string[];
  pinnedColumns?: string[];
  unpinnedColumns?: string[];
  columnWidths?: Record<string, number>;
}
```

### 7.6 保存版本

```http
POST /api/v1/spreadsheets/:id/save
```

body：

```ts
{
  sql: string;
  payload?: Record<string, any>;
  type?: 'SAVE' | 'AI_OPERATION' | 'RESTORE';
}
```

### 7.7 删除

```http
DELETE /api/v1/spreadsheets/:id
```

## 8. 前端设计

### 8.1 入口

问数结果区按结果类型暴露动作：

```text
图表结果：固定到看板
表格结果：保存为数据表
```

二者不要混用：

- 固定到看板：进入 Dashboard，只服务图表 / 指标。
- 保存为数据表：进入 Spreadsheet。
- 表格结果不应显示“固定到看板”或“固定为表格”。

### 8.2 数据表列表位置

数据表列表不放进左侧全局导航，避免和历史对话混在一起。建议和知识库 / 数据看板列表一致，放在 Home 工作区右侧 rail：

```text
左侧全局导航：新对话 / 知识库 / 数据看板 / 历史对话
右侧工作区 rail：数据表列表 / 数据看板列表 / 知识库列表
```

进入数据表资产时：

```text
左侧保持全局导航稳定
中间为当前数据表详情
右侧为数据表列表，可切换其他数据表
```

### 8.3 Spreadsheet 页面

页面结构建议：

```text
标题 / 来源问题 / 更新时间

AI Assistant:
[Filter] [Cleaning] [Grouping] [Enrichment]

Changes:
[Undo] [Redo] [Save] [Discard Changes] [History]

Columns:
[Update columns]

数据表格
分页
Show SQL
```

### 8.4 MVP 可以先做的内容

第一阶段不必一次性实现全部 Cloud 能力，建议先做：

1. 保存为数据表。
2. 数据表列表。
3. 数据表详情页。
4. Show SQL。
5. 服务端分页预览。
6. 列隐藏和列顺序。
7. 保存历史。

第二阶段再做：

1. AI Filter。
2. AI Cleaning。
3. AI Grouping。
4. AI Enrichment。
5. 文件夹/共享。

## 9. 和 Dashboard TABLE 的关系

最终边界是：Spreadsheet 替代表格固化场景，Dashboard TABLE 只保留历史兼容。

两者关系：

```text
Spreadsheet = 数据分析资产
Dashboard TABLE = 历史看板表格组件，仅兼容旧数据
```

处理原则：

- 继续允许已有 `DashboardItem(TABLE)` 渲染和预览，防止旧数据不可用。
- 前端不再提供表格固定到看板入口。
- 新建 Dashboard item 的公开 API / controller / service 应拒绝 `TABLE` 类型。
- Spreadsheet 页面不提供“固定到看板为表格”的入口。
- 如果未来确实需要“数据表上墙”，应另开产品议题设计，不复用当前“保存为数据表”语义，也不默认回退到 `DashboardItem(TABLE)`。

## 10. 验收标准

### 10.1 MVP 验收

- 用户可以从问数结果保存为 Spreadsheet。
- 右侧数据表 rail 可以看到 Spreadsheet 列表。
- 点击 Spreadsheet 可以进入详情页。
- 详情页可以查看 SQL。
- 详情页可以分页查看数据。
- 列隐藏/显示刷新后仍然保留。
- 保存后可以在 History 中看到版本。
- 权限和 runtime scope 正确隔离。
- 表格结果不出现“固定到看板 / 固定为表格”入口。
- 通过 API / service 尝试创建 `DashboardItemType.TABLE` 会失败。

### 10.2 回归测试

- 从 TiDB workspace 问数结果保存为 Spreadsheet。
- 重新进入页面后 Spreadsheet 仍存在。
- 数据预览结果与原问数 SQL 一致。
- 翻页可用。
- Show SQL 展示正确。
- 修改列设置后刷新页面仍保留。
- 从问数预览区、SQL 预览区、右侧工作台预览区保存数据表均进入 `/home/spreadsheets/:id`。
- 图表结果仍可固定到看板。
- 表格结果不能固定到看板。

## 11. 结论

官方 Cloud 的 Spreadsheet 固化是“可持续加工、可版本化的数据表资产”；因此我们也应把表格固化定义为 Spreadsheet 资产，而不是 Dashboard item。

最终建议：

- 图表 / 指标：固定到看板。
- 表格 / 明细数据：保存为数据表。
- Dashboard TABLE：只兼容历史数据，不再作为新功能入口。
- 后续继续补齐 Spreadsheet 的分页、列设置、历史、AI 数据操作、文件夹和共享能力。
