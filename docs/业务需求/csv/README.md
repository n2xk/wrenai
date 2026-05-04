# CSV 导出说明

这批 CSV 是把 `expected-results.md` 和 `test-runbook.md` 拆成更适合 Excel 打开的结构化文件。

- 编码：UTF-8 with BOM（`utf-8-sig`），便于 Excel 直接打开中文
- 建议打开顺序：
  1. `00_测试参数与总校验点.csv`
  2. `01_T01_渠道日基础汇总.csv` ~ `11_T13_首存金额分桶.csv`
  3. `12_第一期全覆盖增量用例.csv`
  4. `13_普通问数补充用例.csv`
  5. `14_业务泛化补充用例.csv`
  6. `15_第一期Excel示例表格全覆盖保存清单.csv`（FULL 同形验收）
  7. `16_第一期Excel示例表格降级保存清单.csv`（DEGRADED 降级优先验证）
  8. `17_第一期Excel_FULL泛化变体清单.csv`（FULL P2 泛化补强）
  9. `18_知识库导入异常用例.csv`（导入异常 / 幂等 / 删除引用专项）
  10. `99_回归执行清单.csv`

说明：CSV 不支持多 sheet，所以这里按“每个模板一份 CSV”的方式来模拟 Excel 多页签。

`12_第一期全覆盖增量用例.csv` 对应 `../第一期需求全覆盖补充用例.md`，用于补齐 `第一期数据报表需求V1.xlsx` 的全字段、全维度、全周期和外部指标补齐后实算场景。

`15_第一期Excel示例表格全覆盖保存清单.csv` 对应 `../第一期Excel示例表格全覆盖清单-2026-05-01.md` 的 FULL 版，用于验证原始 Excel 中 11 张示例表格是否已经同形输出。CSV 中的 `save_as_data_table_name` 是 FULL 资产化扩展时使用的推荐名称，默认 FULL 回归不强制逐张保存数据表。

该 CSV 还包含严格 FULL 同形断言字段：

- `strict_gate`：标记该 FT 是必须返回真实 SQL 结果，还是必须先补外部输入后才能通过。
- `required_external_dependencies`：FULL 通过前必须补齐的外部依赖或数据模型。
- `strict_required_columns_or_segments`：必须在问数结果 / 导出 / SQL 证据中出现的关键列、分组、周期或枚举。
- `strict_forbidden_pass_signals`：一旦出现就不能计为 FULL PASS 的缺口信号，例如“缺投放金额”“未包含 VIP”“未单独汇总所有用户”等。
- `strict_full_pass_rule`：该 FT 的最终同形通过规则。

`16_第一期Excel示例表格降级保存清单.csv` 对应同一清单文档的 DEGRADED 版，用于在外部数据缺失时先验证内部指标降级输出、SQL 可执行、结果可预览并可保存为数据表资产。DEGRADED 通过不等于 FULL 同形覆盖通过。

`17_第一期Excel_FULL泛化变体清单.csv` 是 P2 泛化补强清单：每张 FT 至少 3 条变体，覆盖单渠道基线、多渠道 / 渠道商 / TOP5 / VIP / 全枚举 / 时间粒度变化等。变体通过不能替代 FTxx-FULL 基线同形通过，但任何失败都必须记录为泛化缺口。

`13_普通问数补充用例.csv` 对应 `../普通问数补充用例.md`，用于验证不以命中业务 SQL 模板为主要目标的普通 text-to-SQL、metadata 和澄清链路。

`14_业务泛化补充用例.csv` 对应 `../业务需求泛化测试用例设计.md`，用于验证同一业务需求在参数变化、语言变化、边界数据、不同路由路径和相邻模板竞争下的稳定性与可解释性。当前包含 PX / LING / EDGE / ROUTE / RANK 共 55 条；`precondition` 字段必须写明执行前系统状态，例如是否新建 thread、是否沿用前置 thread、是否已补槽、是否需要同一 thread 外部补数。

`18_知识库导入异常用例.csv` 对应 `../问数回归测试计划.md` 的 Step 10A，用于隔离验证格式错误、重复导入、删除被引用资产和外部依赖 validation 异常等运营异常路径。该专项必须使用隔离知识库，不得污染正式 B0~B6 回归知识库。
