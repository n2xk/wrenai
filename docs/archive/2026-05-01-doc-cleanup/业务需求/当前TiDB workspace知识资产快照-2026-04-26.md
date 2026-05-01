# 当前 TiDB workspace 知识资产快照（2026-04-26）

## 1. 文档目的

这份快照用于把 **当前实际回归环境** 中已经落库的分析规则（`instruction`）和 SQL 模板（`sql_pair` / `sql_template`）沉淀到 `docs/业务需求` 下，作为 2026-04-26 时点的环境事实记录。

和 `docs/业务需求/knowledge-base/` 下的单文件定义相比：

- `knowledge-base/`：**导入权威来源**
- 本文：**当前环境实际落库结果快照**

当导入源文档与实际环境出现漂移时，应优先以本文确认“当前环境到底已经导入成什么状态”。

---

## 2. 快照范围与来源

### 2.1 抽取时间

- 抽取日期：**2026-04-26**
- 抽取来源：本地回归环境 PostgreSQL（`wren-ui` 元数据库）
- 抽取方式：直接查询 `instruction` 与 `sql_pairs` 表

### 2.2 目标环境标识

| 项 | 值 |
| --- | --- |
| workspace | `TiDB 问数回归 202604250045` |
| workspace_id | `e4fd1d67-59a5-42de-adf2-1777698b5f21` |
| knowledge_base | `TiDB 问数回归知识库 202604250045` |
| knowledge_base_id | `27ea94ff-415f-4a28-af88-0b0dc226e598` |
| default_kb_snapshot_id | `27fa6535-b932-4cfc-a231-35bd15d13329` |
| runtime_project_id | `51` |
| primary_connector_id | `db5d7d2a-3aa8-4cdd-bd75-3de9709033ef` |
| deploy_hash | `5f88d9c5a3d8c23d2280c6f3b9fdf759543f46d0` |

> 说明：本文快照只对应上表这一套 TiDB 回归 workspace / knowledge base，不混入 2026-04-25 之后创建的其他测试 workspace。

### 2.3 结论先看

1. **分析规则 14 条已全部落库。**
2. **SQL 模板 / SQL pair 共 21 条已落库。**
3. **当前 21 条 SQL 记录全部已经升级为 `L2 + anchored_template`。**
4. **当前 21 条 SQL 记录全部为 `asset_kind = sql_template`、`source_type = business_import`。**
5. **当前 21 条 SQL 记录全部已经带 `parameter_schema`，且 `approved_at` 已写入。**
6. `T05 / T14 / T15` 仍未进入当前知识库执行资产，继续保持 `blocked_missing_source` 预期。

---

## 3. 分析规则快照（instruction）

### 3.1 总览

| 环境 ID | 规则 ID | 标题 | 环境形态 | questions 数量 | created_at (UTC) |
| --- | --- | --- | --- | ---: | --- |
| 81 | R01 | 汇总口径 | `is_default=true`（全局） | 0 | 2026-04-25T01:00:05.955Z |
| 82 | R02 | 首存定义 | `question_match` | 3 | 2026-04-25T01:00:06.997Z |
| 83 | R03 | 新客首存 | `question_match` | 3 | 2026-04-25T01:00:08.032Z |
| 84 | R04 | 开发人数 | `question_match` | 3 | 2026-04-25T01:00:09.066Z |
| 85 | R05 | TOPN 口径 | `question_match` | 3 | 2026-04-25T01:00:10.096Z |
| 86 | R06 | VIP 分层口径 | `question_match` | 3 | 2026-04-25T01:00:12.143Z |
| 87 | R07 | 投充比公式 | `question_match` | 3 | 2026-04-25T01:00:14.177Z |
| 88 | R08 | 杀率公式 | `question_match` | 3 | 2026-04-25T01:00:15.205Z |
| 89 | R09 | ROI 收入口径 | `question_match` | 3 | 2026-04-25T01:00:17.226Z |
| 90 | R10 | 续存口径 | `question_match` | 3 | 2026-04-25T01:00:20.256Z |
| 91 | R11 | 游戏类型分布口径 | `question_match` | 3 | 2026-04-25T01:00:21.284Z |
| 92 | R12 | 首存金额分桶 | `question_match` | 3 | 2026-04-25T01:00:22.303Z |
| 93 | R13 | 缺失数据源处理 | `question_match` | 4 | 2026-04-25T01:00:24.333Z |
| 94 | R14 | ES 数据使用限制 | `question_match` | 3 | 2026-04-25T01:00:25.355Z |

### 3.2 当前环境规则摘要

| 规则 ID | 标题 | 当前环境规则内容摘要 | 对应文档 |
| --- | --- | --- | --- |
| R01 | 汇总口径 | 汇总行人数类指标按去重后的分子汇总；比率类指标先汇总分子分母再计算。 | `knowledge-base/analysis-rules/R01_汇总口径.md` |
| R02 | 首存定义 | 首存 / 首充 / 首次存款统一定义为成功存款且 `times = 1`。 | `knowledge-base/analysis-rules/R02_首存定义.md` |
| R03 | 新客首存 | 注册日 = 首存日的首存用户。 | `knowledge-base/analysis-rules/R03_新客首存.md` |
| R04 | 开发人数 | 非当日注册但在统计日完成首存的用户数。 | `knowledge-base/analysis-rules/R04_开发人数.md` |
| R05 | TOPN 口径 | `TOP3/TOP5/非TOP3/非TOP5` 按统计区间累计有效投注排序。 | `knowledge-base/analysis-rules/R05_TOPN 口径.md` |
| R06 | VIP 分层口径 | 按统计区间内达到的最高 VIP 等级归类。 | `knowledge-base/analysis-rules/R06_VIP 分层口径.md` |
| R07 | 投充比公式 | 投充比 = 有效投注 / 存款金额；存款为 0 不允许随意补 0。 | `knowledge-base/analysis-rules/R07_投充比公式.md` |
| R08 | 杀率公式 | 杀率 = 输赢 / 有效投注；有效投注为 0 时返回空值或按产品约定处理。 | `knowledge-base/analysis-rules/R08_杀率公式.md` |
| R09 | ROI 收入口径 | 渠道收入 = 输赢 -（任务彩金 + 洗码 + 营销 + 优惠加扣款）；ROI = 渠道累计收入 / 投放金额。 | `knowledge-base/analysis-rules/R09_ROI 收入口径.md` |
| R10 | 续存口径 | 二存到六存以统计期首存 cohort 为基准；率的分母统一为首存人数。 | `knowledge-base/analysis-rules/R10_续存口径.md` |
| R11 | 游戏类型分布口径 | 均注金额 = 有效投注 / 下注次数；投注占比 = 该类型有效投注 / 合计有效投注。 | `knowledge-base/analysis-rules/R11_游戏类型分布口径.md` |
| R12 | 首存金额分桶 | 固定档位 `10/20/30/50/100/200/300/400/500/1000/2000/>2000/其他`。 | `knowledge-base/analysis-rules/R12_首存金额分桶.md` |
| R13 | 缺失数据源处理 | 缺投放金额 / PV / UV / 下载点击UV 时，必须先向用户索取外部指标，不能编造。 | `knowledge-base/analysis-rules/R13_缺失数据源处理.md` |
| R14 | ES 数据使用限制 | 已有 TiDB 映射时统一走 TiDB SQL；无映射时明确当前仅支持 SQL 模板。 | `knowledge-base/analysis-rules/R14_ES 数据使用限制.md` |

### 3.3 规则侧结论

- `R01 ~ R14` 当前环境 **全部已落库**。
- 规则文本与 `knowledge-base/analysis-rules/` 下单文件定义保持一致。
- 如果规则题仍不生效，后续排查重点应放在：
  - instruction 召回
  - runtime scope 透传
  - ask 路由 / stitching
  - follow-up 上下文继承

---

## 4. SQL 模板 / SQL pair 快照（sql_pair）

### 4.1 总览统计

| 分类 | 数量 | 说明 |
| --- | ---: | --- |
| 全部落库记录 | 21 | 当前 `deploy_hash = 5f88d9c5a3d8c23d2280c6f3b9fdf759543f46d0` 下的全部业务 SQL 记录 |
| `asset_kind = sql_template` | 21 | 全部已进入业务模板资产形态 |
| `template_level = L2` | 21 | 全部已升级为业务锚定模板 |
| `template_mode = anchored_template` | 21 | 全部为 anchored lane |
| `source_type = business_import` | 21 | 全部来自业务模板导入 |
| `parameter_schema is not null` | 21 | 参数槽结构化已补齐 |
| `approved_at is not null` | 21 | 全部已完成审批态写入 |
| `approved_by is not null` | 21 | 审批人已写入 |

### 4.2 按业务模板 ID 对照

| 模板 ID | 标题 | 环境记录 | 问题数 | 当前层级 | 当前模式 | 当前来源 | 当前状态 |
| --- | --- | --- | ---: | --- | --- | --- | --- |
| T01 | 渠道日基础汇总 | `75,76,77` | 3 | `L2` | `anchored_template` | `business_import` | 已升级完成 |
| T02 | 渠道与折扣映射 | `78,79` | 2 | `L2` | `anchored_template` | `business_import` | 已升级完成 |
| T03 | 首存 cohort 提取 | `80,81` | 2 | `L2` | `anchored_template` | `business_import` | 已升级完成 |
| T04 | cohort 累计收入 | `82,83` | 2 | `L2` | `anchored_template` | `business_import` | 已升级完成 |
| T05 | cohort ROI | 无 | 0 | 未导入 | 未导入 | `blocked_missing_source` | 按预期阻塞 |
| T06 | TOP3/非TOP3 分层 | `84,85` | 2 | `L2` | `anchored_template` | `business_import` | 已升级完成 |
| T08 | 首存 cohort 续存 | `86` | 1 | `L2` | `anchored_template` | `business_import` | 已升级完成 |
| T09 | 所有用户区间汇总 | `87,88,89` | 3 | `L2` | `anchored_template` | `business_import` | 已升级完成 |
| T10 | 首存用户日龄趋势 | `90,91` | 2 | `L2` | `anchored_template` | `business_import` | 已升级完成 |
| T11 | 按游戏类型分布 | `92` | 1 | `L2` | `anchored_template` | `business_import` | 已升级完成 |
| T12 | TOP3/5 游戏类型分层 | `93,94` | 2 | `L2` | `anchored_template` | `business_import` | 已升级完成 |
| T13 | 首存金额分桶 | `95` | 1 | `L2` | `anchored_template` | `business_import` | 已升级完成 |
| T14 | 投放金额并表 | 无 | 0 | 未导入 | 未导入 | `blocked_missing_source` | 按预期阻塞 |
| T15 | 流量指标并表 | 无 | 0 | 未导入 | 未导入 | `blocked_missing_source` | 按预期阻塞 |

### 4.3 当前环境问题文案（按模板聚合）

#### T01 渠道日基础汇总

- 环境记录：`75 / 76 / 77`
- 当前模式：`L2 anchored_template`
- 当前问题：
  - 统计某站点/渠道在指定日期范围内每日的登录、注册、充值、提现、投注、优惠、返水、任务彩金。
  - 按天查看某渠道综合日报指标
  - 统计某渠道最近7天的登录、注册、充值、提现、投注汇总
- 对应文档：`docs/业务需求/knowledge-base/sql-templates/T01_渠道日基础汇总.md`

#### T02 渠道与折扣映射

- 环境记录：`78 / 79`
- 当前模式：`L2 anchored_template`
- 当前问题：
  - 查询渠道名称、渠道商、折扣比例。
  - 查询某平台下各渠道的折扣配置与渠道商信息。
- 对应文档：`docs/业务需求/knowledge-base/sql-templates/T02_渠道与折扣映射.md`

#### T03 首存 cohort 提取

- 环境记录：`80 / 81`
- 当前模式：`L2 anchored_template`
- 当前问题：
  - 找出某时间段内某渠道的首存用户、首存日期、首存金额。
  - 查询某渠道在指定时间段的首存用户名单与首存金额
- 对应文档：`docs/业务需求/knowledge-base/sql-templates/T03_首存 cohort 提取.md`

#### T04 cohort 累计收入

- 环境记录：`82 / 83`
- 当前模式：`L2 anchored_template`
- 当前问题：
  - 计算首存 cohort 在 D1/D3/D7/D15/D30...D360 的累计渠道收入。
  - 统计某渠道首存 cohort 在指定回收周期内的累计渠道收入。
- 对应文档：`docs/业务需求/knowledge-base/sql-templates/T04_cohort 累计收入.md`

#### T06 TOP3/非TOP3 分层

- 环境记录：`84 / 85`
- 当前模式：`L2 anchored_template`
- 当前问题：
  - 按统计区间累计有效投注排名，给用户打 TOP3 / 非TOP3 标签
  - 统计某渠道在指定区间内 TOPN 与非TOPN 用户分层结果
- 对应文档：`docs/业务需求/knowledge-base/sql-templates/T06_TOP3-非TOP3 分层.md`

#### T08 首存 cohort 续存

- 环境记录：`86`
- 当前模式：`L2 anchored_template`
- 当前问题：
  - 统计某日/某段首存 cohort 的 2~6 存人数、率、人均金额
- 对应文档：`docs/业务需求/knowledge-base/sql-templates/T08_首存 cohort 续存.md`

#### T09 所有用户区间汇总

- 环境记录：`87 / 88 / 89`
- 当前模式：`L2 anchored_template`
- 当前问题：
  - 统计某渠道在指定区间内全部用户的投充比和杀率
  - 统计某渠道 TOP3 用户的投充比和杀率
  - 统计某渠道在指定区间内全部用户/分层用户的存款、充提差、有效投注、输赢、投充比、杀率
- 对应文档：`docs/业务需求/knowledge-base/sql-templates/T09_所有用户区间汇总.md`

#### T10 首存用户日龄趋势

- 环境记录：`90 / 91`
- 当前模式：`L2 anchored_template`
- 当前问题：
  - 统计首存 cohort 从首日开始的 D1~DN 投充比/杀率趋势
  - 统计某渠道首存 cohort 在首存后 N 天内的日龄趋势指标
- 对应文档：`docs/业务需求/knowledge-base/sql-templates/T10_首存用户日龄趋势.md`

#### T11 按游戏类型分布

- 环境记录：`92`
- 当前模式：`L2 anchored_template`
- 当前问题：
  - 统计某区间内各游戏类型的有效投注、下注次数、均注金额、输赢、杀率、投注占比
- 对应文档：`docs/业务需求/knowledge-base/sql-templates/T11_按游戏类型分布.md`

#### T12 TOP3/5 游戏类型分层

- 环境记录：`93 / 94`
- 当前模式：`L2 anchored_template`
- 当前问题：
  - 针对 TOP3/5 用户与非 TOP3/5 用户输出游戏类型分布
  - 对比某渠道 TOPN 与非TOPN 用户在各游戏类型上的投注分布
- 对应文档：`docs/业务需求/knowledge-base/sql-templates/T12_TOP3-5 游戏类型分层.md`

#### T13 首存金额分桶

- 环境记录：`95`
- 当前模式：`L2 anchored_template`
- 当前问题：
  - 按首存金额固定档位输出人数与占比
- 对应文档：`docs/业务需求/knowledge-base/sql-templates/T13_首存金额分桶.md`

### 4.4 模板侧结论

当前环境的 SQL 模板资产已经从“部分模板仍停留在 L0 reference”推进到：

- **11 个主测试模板全部进入 `L2 anchored_template` lane**
- **全部 21 条问题变体都已经按 `business_import` 业务模板方式落库**
- **参数结构与审批态也已经补齐**

因此，如果后续回归仍出现异常，优先排查的已不再是“模板是不是业务模板态”，而应重点检查：

- ask runtime 是否正确命中模板
- 参数抽取 / 参数补齐
- follow-up 上下文继承
- 图表生成与 preview stitching
- 缺失外部数据源时的解释与追问策略

---

## 5. 当前环境与导入源文档之间的对齐关系

### 5.1 已完全对齐部分

- `R01 ~ R14`：规则已全部落库
- `T01 / T02 / T03 / T04 / T06 / T08 / T09 / T10 / T11 / T12 / T13`：全部已进入 `L2 anchored_template`
- `T05 / T14 / T15`：仍未导入执行资产，和文档中 `blocked_missing_source` 约束一致

### 5.2 当前环境比旧快照新增的关键事实

相较于 2026-04-26 早前的旧快照，当前环境已经新增以下变化：

1. `T01 / T02 / T03 / T06 / T08 / T11 / T12` 不再停留在 `L0 reference`
2. 所有 21 条业务问题记录均已切到 `L2 anchored_template`
3. 所有 21 条业务问题记录均已写入 `parameter_schema`
4. 所有 21 条业务问题记录均已写入 `approved_at / approved_by`

---

## 6. 建议后续使用方式

后续排查 TiDB 问数回归时，建议按下面顺序看：

1. **先看本文**
   - 确认当前环境到底落了哪些规则、哪些模板、当前状态是什么
2. **再看 `knowledge-base/` 单文件**
   - 确认目标业务定义、SQL 骨架、预期问题文案
3. **最后看 ask diagnostics / 回归结果**
   - 判断是召回问题、参数抽取问题、模板执行问题，还是 correction / chart / follow-up 问题

---

## 7. 关联文档

- `docs/业务需求/问数回归测试计划.md`
- `docs/业务需求/官方问题对照与修复建议-2026-04-25.md`
- `docs/业务需求/knowledge-base/README.md`
- `docs/业务需求/knowledge-base/analysis-rules/README.md`
- `docs/业务需求/knowledge-base/sql-templates/README.md`
