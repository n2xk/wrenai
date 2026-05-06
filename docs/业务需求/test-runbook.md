# SQL 模板回归测试 Runbook / Checklist

## 1. 目的

这份 runbook 用来配合下面几份文件做回归：

- 主造数来源：`docs/业务需求/seed_data_local/saas_prod_v1_3.sql` + `docs/业务需求/seed_data_local/saas_warehouse_v1_3.sql`
- 可选 legacy 固定对账夹具：`docs/业务需求/seed_data_local/regression_fixture.sql`（默认不导入）
- 外部指标样例：`docs/业务需求/seed_data_local/external_metrics.sql`
- 原始参考导出：`docs/业务需求/seed_data_refer/`，仅用于重新生成 `seed_data_local`，不直接导入
- 预期结果：`docs/业务需求/expected-results.md`
- 扩展种子结果：`docs/业务需求/extended-seed-results.md`

本轮目标分两层：

- 最小回归：验证当前已经补好的 **11 个 `draft_sql` 模板** 是否与业务口径一致
- 扩展回归：验证 `seed_data_local` 已完整导入，且表间关联可对上

---

## 2. 前置条件

### 2.1 先准备表结构

先生成并执行本地 TiDB 版建表 SQL：

1. `python3 docs/业务需求/generate_local_tidb_schema.py`
2. 执行 `docs/业务需求/local_tidb_schema.sql`

说明：

- 原始设计稿 `docs/业务需求/数据报表表结构Design_with_comments（5.5 v1.3）.sql` 作为结构来源，不直接用于本地导库
- `local_tidb_schema.sql` 会自动去掉分区语句、TTL hints，以及文件尾部的 ES mapping JSON
- 这样可以避免本地 TiDB 因固定分区上界或非 SQL 尾部内容导致导入失败
- 建议在**独立测试库 / 独立 schema** 下执行，避免污染现有环境

### 2.2 再执行造数

本轮 seed 数据以 `docs/业务需求/seed_data_local/` 为直接导入入口。`seed_data_refer/` 是原始参考导出，不直接改、不直接导入；如果参考 dump 更新，先重新生成本地 v1.3 seed：

```bash
python3 docs/业务需求/generate_seed_data_local.py
```

推荐按顺序直接导入：

```bash
mysql -h127.0.0.1 -P4000 -uroot tidb_business_demo < docs/业务需求/seed_data_local/saas_prod_v1_3.sql
mysql -h127.0.0.1 -P4000 -uroot tidb_business_demo < docs/业务需求/seed_data_local/saas_warehouse_v1_3.sql
mysql -h127.0.0.1 -P4000 -uroot tidb_business_demo < docs/业务需求/seed_data_local/external_metrics.sql
```

说明：默认回归直接使用 `saas_prod_v1_3.sql` + `saas_warehouse_v1_3.sql` 中来自参考导出的真实数据；`regression_fixture.sql` 仅用于 legacy/专项复现旧 `990001/990011` 口径，旧 `seed.sql` 已废弃。

### 2.3 固定本轮参数

- `tenant_plat_id = 72`
- `channel_id = 1932`
- `T02_configured_channel_id = 1867`
- `T02_unconfigured_channel_id = 1760`
- `start_date = '2026-04-10'`
- `end_date = '2026-04-16'`
- `cohort_start_date = '2026-04-10'`
- `cohort_end_date = '2026-04-16'`
- `top_n = 3`
- `n_days = 7`
- `period_days = 7`

### 2.4 可选：一键回归

```bash
python3 docs/业务需求/verify_tidb_regression.py
```

- 当前覆盖：`schema + T01/T02/T03/T04/T06/T08/T09/T10/T11/T12/T13`
- 默认连接：`127.0.0.1:4000 / tidb_business_demo / root`
- 可通过环境变量覆盖：`TIDB_HOST`、`TIDB_PORT`、`TIDB_USER`、`TIDB_PASSWORD`、`TIDB_DATABASE`

### 2.5 可选：扩展种子回归

```bash
python3 docs/业务需求/verify_tidb_regression.py --extended-seed
```

- 在最小回归基础上，额外覆盖：
  - legacy fixture 扩展渠道 `990013 / 990014`
  - legacy fixture 扩展玩家 `990108 ~ 990121`
  - 辅助表：`dim_channel_player_statistics_of_day`
  - 体育预测表：`dwd_sport_predict_relay_record`、`dwd_sport_predict_champion_record`
  - 04-15+ 高频批量层：玩家 `990200 ~ 990459`
- 扩展种子检查仍针对 legacy fixture，只有显式导入 `regression_fixture.sql` 后才运行。

---

## 3. 本轮要测什么 / 不测什么

### 3.1 最小回归要测（11 个）

- T01 渠道日基础汇总
- T02 渠道与折扣映射
- T03 首存 cohort 提取
- T04 cohort 累计收入
- T06 TOP3/非TOP3 分层
- T08 首存 cohort 续存
- T09 所有用户区间汇总
- T10 首存用户日龄趋势
- T11 按游戏类型分布
- T12 TOP3/5 游戏类型分层
- T13 首存金额分桶

### 3.2 扩展种子已测

- 扩展渠道配置、合作方/占成代理引用关系
- 扩展玩家在渠道上的分布是否正确
- 扩展层登录、充值、提现、投注、投注明细
- 奖励/优惠相关订单子表数量
- `dim_channel_player_statistics_of_day` 的日级聚合
- 体育串关 / 冠军预测辅助表
- 高频批量层千级以上业务数据及其关联完整性

### 3.3 仍暂不测（3 个）

- T05 / T14：缺投放金额
- T15：缺 PV / UV / 下载点击 UV

---

## 4. 推荐执行顺序

> 原则：先跑基础维表 / 基础事实，再跑 cohort、分层、衍生计算。完整对账表以 `csv/00_测试参数与总校验点.csv` ~ `csv/11_T13_首存金额分桶.csv` 为准。

### Step 1 - T02 渠道与折扣映射

**目的**：先确认渠道维度、折扣配置、默认值逻辑都对。

**通过标准**：
- `channel_id=1867`：`has_percent_config = 1`，`report_percent = 100.0000`
- `channel_id=1760`：`has_percent_config = 0`，默认 `report_percent = 100.0000`

---

### Step 2 - T01 渠道日基础汇总

**目的**：先把最基础的日报类事实对齐。

**优先看这些点**：
- `2026-04-10`：充值金额 `100.0000`，有效投注 `3635.0000`
- `2026-04-13`：充值金额 `1100.0000`，提现金额 `3200.0000`，有效投注 `7920.2000`
- `2026-04-16`：充值金额 `1000.0000`，彩票金额 `60.0000`

---

### Step 3 - T03 首存 cohort 提取

**目的**：确认 cohort 用户名单没有问题。

**通过标准**：
- 结果共 `20` 行
- `2026-04-10` 包含玩家 `4543498`
- `2026-04-13` 包含玩家 `4543588`，首存金额 `500.0000`

---

### Step 4 - T08 首存 cohort 续存

**目的**：确认 2~6 存人数、率、人均金额。

**优先看这些点**：
- 汇总 / 全部用户：注册人数 `65`，首存人数 `20`，二存 `5`，三存 `2`，四存 `2`
- 汇总 / 非TOP3：注册人数 `62`，首存人数 `20`

---

### Step 5 - T10 首存用户日龄趋势

**目的**：确认 cohort 在 D1~D7 的逐日充提投指标。

**优先看这些点**：
- 汇总 / 全部：用户人数 `20`，首日杀率 `1.688032`
- 汇总 / TOP3：用户人数 `3`，2日投充比 `9.150000`
- `2026-04-15` / 非TOP3：用户人数 `5`，2日投充比 `4.000000`

---

### Step 6 - T04 cohort 累计收入

**目的**：确认累计渠道收入口径方向没算反。

**优先看这些点**：
- `2026-04-10 / 全部`：7天累计 `71.7600`
- `2026-04-13 / TOP3`：7天累计 `2480.0000`
- `2026-04-15 / 非TOP3`：7天累计 `686.4200`

---

### Step 7 - T06 TOP3/非TOP3 分层

**目的**：确认 TOPN 排名边界。

**通过标准**：
1. `4543567` -> TOP1
2. `4543571` -> TOP2
3. `4543569` -> TOP3
4. `ranked_user_count = 30`

---

### Step 8 - T09 所有用户区间汇总

**目的**：确认全部用户 / TOP3 / 非TOP3 三段汇总。

**优先看这些点**：
- 全部用户：充值 `4300.0000`，有效投注 `16225.2000`
- TOP3：有效投注 `4613.0000`
- 非TOP3：充值 `4300.0000`，有效投注 `11612.2000`

---

### Step 9 - T11 按游戏类型分布

**目的**：确认游戏类型维度的聚合和占比。

**通过标准**：
- 电子-老虎机 = `11712.0000`
- 捕鱼 = `2202.0000`
- 电子棋牌 = `1295.2000`
- 电子-街机 = `1016.0000`

---

### Step 10 - T12 TOP3/5 游戏类型分层

**目的**：确认 TOP3 和 非TOP3 在游戏类型上的差异。

**通过标准**：
- 所有用户有效投注合计 `16225.200000`
- TOP3 有效投注合计 `4613.000000`
- 非TOP3 有效投注合计 `11612.200000`

---

### Step 11 - T13 首存金额分桶

**目的**：确认首存固定档位和“其他”分桶。

**通过标准**：
- 汇总首存用户数 `20`
- `100元 = 11`
- `200元 = 7`
- `500元 = 2`

---

## 5. 快速对账口径（建议每次先看）

### 5.1 主渠道总量

- 总充值金额 = `4300.0000`
- 总提现金额 = `11000.0000`
- 总有效投注 = `16225.2000`
- 总输赢 = `20852.4600`

### 5.2 TOP3 用户

- `4543567`
- `4543571`
- `4543569`

### 5.3 特殊校验点

- 默认核心回归不再依赖 `990001 / 990011` legacy fixture。
- T02 不使用主问数渠道 `1932`，而是用真实配置渠道 `1867` 与无配置对照渠道 `1760` 验证 `has_percent_config`。
- `kill_rate / bet_deposit_ratio` 在分母为 0 时应返回 `NULL`，不是强行写 0。

---

## 6. 常见排错清单

如果跑出来和预期不一致，按下面顺序排：

### 6.1 先看过滤条件

- 是否漏了 `tenant_plat_id = 72`
- 是否漏了 `channel_id = 1932`
- T02 是否误用了主测试渠道，而不是 `tenant_plat_id=1` 下的 `1867 / 1760`
- 日期上界是否按 `< DATE_ADD(end_date, INTERVAL 1 DAY)` 处理

### 6.2 再看状态条件

- 充值是否只取 `status = 2`
- 提现是否只取 `status = 3`
- 投注是否只取 `settle_status = 1`

### 6.3 再看口径方向

- `charge_withdraw_diff = 充值 - 提现`
- `kill_rate = 输赢 / 有效投注`
- `bet_deposit_ratio = 有效投注 / 充值`
- `T04 渠道收入 = 输赢 - 洗码 - 任务 - 营销 - 优惠加扣款`

### 6.4 再看是否误把补零/NULL 改写了

- T10/T04 存在由递归 CTE 生成的补零行
- 某些比例在分母为 0 时应为 `NULL`

## 7. 回归完成标准

满足下面 4 条即可认为本轮回归通过：

- 11 个 SQL 全部能跑通
- 与 `expected-results.md` 核心结果一致
- 没有把对照渠道 / 失败单 / 缺失天数处理错
- T05 / T14 / T15 仍明确标记为“本轮不测”
