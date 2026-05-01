# Modeling AI Assistant AI Quality Evaluation (2026-04-24)

> Phase 2B completion-quality artifact for Modeling AI Assistant.
>
> Evidence sources used for this artifact:
> - `docs/modeling-ai-assistant-cloud-phase2-parity-and-quality-plan-2026-04-24.md`
> - `docs/modeling-ai-assistant-cloud-phase2-implementation-pack-2026-04-24.md`
> - `wren-ui/e2e/specs/modelingAssistantQualityEvaluation.spec.ts`
> - `wren-ui/e2e/specs/modelingAssistantTidbReal.spec.ts`
> - `wren-ui/tmp/modeling-ai-assistant-quality-evaluation-tidb.md`
> - `wren-ui/tmp/modeling-ai-assistant-tidb-live-route-verification-2026-04-24.md`
> - `docs/modeling-ai-assistant-cloud-phase2-visual-parity-verification-2026-04-24.md`

## 1. Local vs Cloud framing

This document is **not** a Cloud-vs-local golden-output comparison yet.

What it does establish:
- the **local** non-mocked Modeling AI Assistant pipeline can run end to end for representative sample datasets;
- the local relationship recommendation and semantics description APIs can both reach `FINISHED` state;
- the local outputs are at least plausibly useful on three datasets.

What it does **not** establish yet:
- that local output quality is already **equivalent** to Cloud output quality;
- that local ranking/coverage matches Cloud on the same manifests;
- that save/apply behavior plus generated content quality together are fully parity-complete.

Per the Phase 2 plan/implementation pack, Cloud is currently the **experience and product baseline**, while this artifact is the **local quality snapshot** needed to decide whether prompt/pipeline follow-up is still required.

## 1.1 2026-04-24 completion update

Phase 2B 在 2026-04-24 的收口口径如下：

- **样例集（HR / ECOMMERCE / NBA）** 继续保留为基础 smoke benchmark；
- **TiDB 空间 knowledge base** 升级为本轮最重要的真实业务 benchmark；
- quality spec 已升级为：
  - 产出 full JSON artifact
  - 计算 relationship / semantics 基础分数
  - 支持对 external runtime 做 save verification
- real UI spec 已升级为：
  - 默认选择 3 个 model
  - 生成 launcher / relationships / semantics 截图 artifact
  - 打开 save 时校验 relationship / semantics persistence

换句话说：

> **Phase 2B 现在不再只是“看起来能跑”，而是已经有真实 TiDB 基准、评分输出、artifact contract 和 save verification hook。**

## 2. What was actually evaluated

The evaluated run was the Playwright manual-quality spec at:
- `wren-ui/e2e/specs/modelingAssistantQualityEvaluation.spec.ts`

`wren-ui/e2e/specs/modelingAssistantQualityEvaluation.spec.ts` 现在会在每个 target 上做这些事情：
1. created/selected a real local sample-runtime scope;
2. called `/api/v1/models/list`;
3. picked the configured model subset for semantics generation;
4. triggered `POST /api/v1/relationship-recommendations` and polled until `FINISHED` or `FAILED`;
5. triggered `POST /api/v1/semantics-descriptions` with prompt:
   - `Generate concise business-friendly model and column descriptions.`
6. emitted:
   - markdown report
   - full JSON artifact
   - relationship / semantics quality labels
   - optional save verification for external runtime targets

Datasets actually evaluated:
- `HR`
- `ECOMMERCE`
- `NBA`

Additional real-world probe completed on 2026-04-24:
- **TiDB workspace knowledge base**
  - live selector-backed run against the local business workspace at `http://127.0.0.1:3002`
  - raw evidence artifact:
    - `wren-ui/tmp/modeling-ai-assistant-quality-evaluation-tidb.md`
  - additional live route verification artifact:
    - `wren-ui/tmp/modeling-ai-assistant-tidb-live-route-verification-2026-04-24.md`
  - real UI spec:
    - `wren-ui/e2e/specs/modelingAssistantTidbReal.spec.ts`
  - screenshot evidence:
    - `docs/assets/modeling-ai-assistant-phase2-2026-04-24/local-recommend-relationships-tidb-2026-04-24.png`
    - `docs/assets/modeling-ai-assistant-phase2-2026-04-24/local-recommend-semantics-pick-tidb-2026-04-24.png`
    - `docs/assets/modeling-ai-assistant-phase2-2026-04-24/local-recommend-semantics-generated-tidb-2026-04-24.png`

Important scope limits:
- this was a **local-only** run, not a same-dataset Cloud A/B run;
- sample dataset semantics evaluation still only covered a subset of listed models, not the full project manifest;
- this run validated **output presence and apparent usefulness**, not full precision/recall.

## 2.1 Primary benchmark decision

本轮 quality gate 明确采用两层 benchmark：

### Layer 1 — sample datasets

- HR
- ECOMMERCE
- NBA

作用：

- 保证 assistant pipeline 在样例集上没有退化
- 保持跨 manifest 的基础可用性

### Layer 2 — TiDB workspace knowledge base

作用：

- 用真实业务 shape 评估 relationship recommendation
- 用真实业务 schema 评估 semantics 生成质量
- 作为是否值得继续 prompt / pipeline hardening 的主判断依据

结论：

> **TiDB workspace knowledge base 是当前 Phase 2B 的主 benchmark。**

## 2.2 Scorecard

| Target | Relationships | Cardinality risk | Semantics model descriptions | Semantics column descriptions | Save verification |
| --- | --- | --- | --- | --- | --- |
| HR | usable | low | usable | unverified in frozen artifact | unverified |
| ECOMMERCE | usable | low | good | unverified in frozen artifact | unverified |
| NBA | usable | review needed on `ONE_TO_ONE` candidate | good | unverified in frozen artifact | unverified |
| TiDB workspace KB | good | low | good | good | route-level evidence captured; save verification hook implemented in spec |

解释：

- `usable` = 能用、方向正确，但证据还不够细；
- `good` = 在当前 artifact 粒度下已经明显有业务价值；
- `unverified` = 当前冻结 artifact 没有足够证据，不强行下结论。

## 3. Observed local outputs already captured

### 3.1 HR

- Relationship task status: `FINISHED`
- Relationship recommendation count: `5`
- First relationship: `dept_emp.dept_no -> departments.dept_no (MANY_TO_ONE)`
- First relationship reason: `将员工分配记录与部门信息关联，确保数据引用完整性。`
- Semantics task status: `FINISHED`
- Semantics model count: `2`
- First semantics model: `dept_emp`
- First semantics description: `记录员工与部门之间关联关系的映射表。`

Assessment from captured output:
- relationship example is structurally plausible and business-relevant;
- semantics description is concise and understandable, but still short/simple.

### 3.2 ECOMMERCE

- Relationship task status: `FINISHED`
- Relationship recommendation count: `7`
- First relationship: `olist_orders_dataset.customer_id -> olist_customers_dataset.customer_id (MANY_TO_ONE)`
- First relationship reason: `每个订单都关联到一个特定的客户，通过customer_id建立外键关系以确保数据一致性。`
- Semantics task status: `FINISHED`
- Semantics model count: `2`
- First semantics model: `olist_products_dataset`
- First semantics description: `该数据集包含产品的详细信息，包括类别、物理尺寸、重量及展示规格，用于支持电商平台的商品管理与用户体验优化。`

Assessment from captured output:
- relationship example matches an obvious order-to-customer join and reads correctly;
- semantics description is richer than HR and feels closer to user-facing business copy.

### 3.3 NBA

- Relationship task status: `FINISHED`
- Relationship recommendation count: `6`
- First relationship: `line_score.GameId -> game.Id (ONE_TO_ONE)`
- First relationship reason: `线路得分表中的GameId与比赛表中的Id一一对应，用于获取比赛的详细分节得分。`
- Semantics task status: `FINISHED`
- Semantics model count: `2`
- First semantics model: `line_score`
- First semantics description: `记录NBA比赛中主客双方在各节及加时赛的得分详情及最终总分。`

Assessment from captured output:
- relationship example is plausible for a scoreboard/game-detail dataset, though `ONE_TO_ONE` should still be checked against actual cardinality expectations;
- semantics description is readable and domain-aware.

### 3.4 TiDB workspace knowledge base

- Relationship task status: `FINISHED`
- Relationship recommendation count: `6`
- First relationship: `report_demo_dwd_player_login_log.player_id -> report_demo_dim_player.id (MANY_TO_ONE)`
- First relationship reason: `登录日志记录了玩家ID，通过此关系可以关联获取玩家的详细维度信息。`
- Semantics task status: `FINISHED`
- Semantics model count: `3`
- Selected models:
  - `report_demo_dim_player`
  - `report_demo_dwd_player_login_log`
  - `report_demo_dwd_bet_order`
- First semantics model: `report_demo_dwd_player_login_log`
- First semantics description: `玩家登录日志明细表，记录玩家登录行为、设备信息及渠道来源，用于分析用户活跃度。`

Assessment from captured output:
- compared with sample datasets, this probe is closer to the intended real-world business shape;
- relationship outputs are domain-relevant and structurally plausible, especially the repeated `player_id -> dim_player.id` family;
- semantics output quality is materially stronger here because model- and column-level descriptions are concrete, operational, and not generic filler.

## 4. Readout by evaluation dimension

### 4.1 Relationships

What this run supports:
- all three datasets produced non-empty recommendations;
- all three tasks completed successfully;
- the first visible recommendation in each dataset appears directionally reasonable.

What this run still does not prove:
- whether the **entire returned relationship set** is correct;
- whether the returned **cardinality** is consistently right;
- whether recommendation ordering/coverage is close to Cloud;
- whether the generated set is already the best possible modeling graph versus Cloud on the same dataset.

### 4.2 Semantics

What this run supports:
- semantics generation finished on all three datasets;
- the generated descriptions are readable and not empty;
- at least some outputs are business-friendly rather than raw schema restatements.

What this run still does not prove:
- whether column-level descriptions are consistently strong across all generated models;
- whether the wording quality is close to Cloud;
- whether the descriptions remain stable across reruns;
- whether the same dataset would score equally well against Cloud outputs.

## 5. Judgment of current quality level

### Overall judgment

**Current local quality looks promising but not parity-proven.**

Recommended judgment label:
- **Relationships:** `usable / promising`
- **Semantics:** `usable / moderately good`
- **Local quality evidence confidence:** `medium`
- **Local-vs-Cloud confidence:** `medium-low`

Why this is the right judgment:
- the local assistant is clearly **working**, not just mocked;
- the outputs are not empty, broken, or obviously nonsensical on HR/ECOMMERCE/NBA;
- the TiDB workspace probe shows the same pipelines still hold on a more business-shaped knowledge base, not only on demo datasets;
- the captured examples are reasonable enough to justify Phase 2 continuing from quality review into targeted improvement;
- but the evidence is still too thin to claim **“local is already close enough to Cloud”**.

A stronger claim would require same-dataset Cloud evidence, full-payload review, and more explicit correctness scoring.

## 6. Likely causes of remaining gaps

Based on the Phase 2 plan plus what this artifact actually measured, the remaining gap is most likely driven by a mix of:

1. **Manifest / dataset quality differences**
   - even with the same UI flow, relationship and semantics quality depends heavily on schema naming, column clarity, and sample dataset shape.

2. **Prompt and generation-policy differences**
   - this run used a single generic semantics prompt (`Generate concise business-friendly model and column descriptions.`), which may be weaker than whatever effective instructions Cloud uses in practice.

3. **Pipeline behavior differences**
   - ranking, filtering, cardinality inference, and post-processing may differ between local and Cloud-adjacent environments.

4. **Evaluation artifact granularity is still too shallow**
   - the repo contract now supports full JSON payload artifacts and save verification on rerun, but the frozen 2026-04-24 markdown snapshot still summarizes only the key visible evidence.

5. **No same-dataset Cloud benchmark in repo state**
   - the repo currently contains strong Cloud **UX/contract** observations, but not matching Cloud **quality goldens** for HR/ECOMMERCE/NBA.

## 7. Concrete next actions

### Highest-value next actions

1. **Add same-dataset Cloud comparison evidence**
   - run HR / ECOMMERCE / NBA against Cloud-equivalent assistant flows if available, or capture product-side goldens for the same manifests.
   - for the next real-world benchmark, prioritize the **TiDB workspace knowledge base** instead of only relying on sample datasets.

2. **Re-run the upgraded artifact pipeline on the primary TiDB benchmark**
   - `wren-ui/e2e/specs/modelingAssistantQualityEvaluation.spec.ts`
   - `wren-ui/e2e/specs/modelingAssistantTidbReal.spec.ts`
   - use the new full-payload artifact + save verification outputs as the next frozen evidence set.

3. **Expand semantics coverage beyond the first selected subset**
   - current sample evidence is still partial coverage, even though the spec now supports richer artifact output.

4. **Investigate the most likely technical gap if quality still trails**
   - `manifest quality`
   - `prompt wording / system instructions`
   - `generation pipeline / post-processing`
   - `runtime model/config differences`

### If a tuning pass is needed, start here

- UI/API boundary:
  - `wren-ui/src/pages/api/v1/relationship-recommendations/**`
  - `wren-ui/src/pages/api/v1/semantics-descriptions/**`
- adaptor layer:
  - `wren-ui/src/server/adaptors/wrenAIAdaptor.ts`
  - `wren-ui/src/server/adaptors/wrenAIAdaptorTypes.ts`
  - `wren-ui/src/server/models/adaptor.ts`
- AI service:
  - `wren-ai-service/src/web/v1/routers/relationship_recommendation.py`
  - `wren-ai-service/src/web/v1/routers/semantics_description.py`
  - `wren-ai-service/src/web/v1/services/relationship_recommendation.py`
  - `wren-ai-service/src/web/v1/services/semantics_description.py`
  - `wren-ai-service/src/pipelines/generation/relationship_recommendation.py`
  - `wren-ai-service/src/pipelines/generation/semantics_description.py`

## 8. Bottom line

This artifact is enough to say:
- **local Modeling AI Assistant quality is real, non-mocked, and directionally useful across HR / ECOMMERCE / NBA**;
- **TiDB workspace knowledge base is now the correct primary benchmark for the next hardening pass**;
- **current evidence is not yet enough to declare Cloud-level parity**.

So Phase 2B should be considered:
- **started and materially useful:** yes
- **complete as an initial quality snapshot:** yes
- **complete as a Cloud parity proof:** no
