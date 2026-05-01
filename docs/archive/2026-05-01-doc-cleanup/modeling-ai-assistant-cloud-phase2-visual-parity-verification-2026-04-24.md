# Modeling AI Assistant Cloud Phase 2 Visual Parity Verification（2026-04-24）

> Phase 2 / P0 视觉对齐验收文档。
> 本文只回答一个问题：**当前本地 Modeling AI Assistant 的主交互层，是否已经对齐 Cloud 的信息架构与视觉节奏。**

---

## 1. Evidence set

### Cloud captures

- `docs/assets/modeling-ai-assistant-phase2-2026-04-24/cloud-recommend-relationships-2026-04-24.png`
- `docs/assets/modeling-ai-assistant-phase2-2026-04-24/cloud-recommend-semantics-pick-2026-04-24.png`
- `docs/assets/modeling-ai-assistant-phase2-2026-04-24/cloud-recommend-semantics-generate-2026-04-24.png`
- `docs/assets/modeling-ai-assistant-phase2-2026-04-24/cloud-recommend-semantics-generated-2026-04-24.png`

### Local captures

- `docs/assets/modeling-ai-assistant-phase2-2026-04-24/local-modeling-launcher-2026-04-24.png`
- `docs/assets/modeling-ai-assistant-phase2-2026-04-24/local-modeling-launcher-expanded-2026-04-24.png`
- `docs/assets/modeling-ai-assistant-phase2-2026-04-24/local-recommend-relationships-tidb-2026-04-24.png`
- `docs/assets/modeling-ai-assistant-phase2-2026-04-24/local-recommend-semantics-pick-tidb-2026-04-24.png`
- `docs/assets/modeling-ai-assistant-phase2-2026-04-24/local-recommend-semantics-generated-tidb-2026-04-24.png`

注意：

- Cloud 与本地截图使用的不是同一份数据，因此 **内容数量不做逐项比对**；
- 本文比对的是：
  - 页面骨架
  - 状态表达
  - 信息层级
  - action 区布局
  - review / generate / save 的视觉语言

---

## 2. Verdict summary

| Surface | Cloud baseline | Local status | Verdict |
| --- | --- | --- | --- |
| Launcher | status-driven guidance block | 已对齐为可折叠 launcher，带 Todo/Done / pending / workflow summary | 对齐 |
| Relationships | intro + state + review table + footer actions | 已对齐为 intro card / metrics / review table card / footer action bar | 对齐 |
| Semantics pick | step-led picker | 已对齐为 step chip + pick list + footer next action | 对齐 |
| Semantics generate | prompt-first generation step | 已对齐为 metrics + prompt card + example/generated section + footer bar | 对齐 |
| Semantics generated | review cards + save/regenerate | 已对齐为 generated review + save/regenerate/back hierarchy | 对齐 |
| Readonly / error / loading | Cloud 风格状态卡 | 本地已统一进 assistant state card | 对齐 |

一句话结论：

> **P0 的目标不是像素级复刻 Cloud，而是把 Modeling AI Assistant 的主交互表面收敛到同一套 Cloud contract。这个目标已经完成。**

---

## 3. Detailed parity readout

## 3.1 Launcher

本地对齐点：

- 顶部从普通工程快捷卡，升级为 **status-driven launcher**
- 有清晰的：
  - title / description
  - workflow summary
  - pending / completed 状态 pill
  - collapsed / expanded affordance
- 每个 action item 都有：
  - status
  - count
  - detail label

对应代码：

- `wren-ui/src/features/modeling/components/ModelingAssistantLauncher.tsx`
- `wren-ui/src/features/modeling/components/modelingAssistantStatus.ts`

结论：

- **信息架构已与 Cloud 同类**
- 不是逐像素复刻，但不再是“本地工程版按钮堆叠”

## 3.2 Recommend relationships

Cloud 观察重点：

- intro 区块先讲当前任务与状态
- review 结果区与 action footer 明确分层
- row-level edit/delete affordance 明显

本地现在：

- intro card
- status pills
- metrics cards
- review table card
- row-level edit/delete icon button
- footer action bar

对应代码：

- `wren-ui/src/features/modeling/assistant/recommendRelationships/RecommendRelationshipsPage.tsx`
- `wren-ui/src/features/modeling/assistant/modelingAssistantVisuals.tsx`

结论：

- **结构和节奏已对齐**
- Cloud 空态截图与本地结果态截图内容不同，但容器语言已经统一

## 3.3 Recommend semantics

Cloud 观察重点：

- step-based workflow 明确
- pick / generate / generated 三态清晰分离
- prompt 不是埋在表单里，而是单独成为 generation context
- generated review 区块与 save/regenerate action hierarchy 非常稳定

本地现在：

- step chips
- selected models / prompt summary metrics
- pick list card
- prompt card
- example prompt / generated review 区块
- Back / Save / Generate(Regenerate) footer hierarchy

对应代码：

- `wren-ui/src/features/modeling/assistant/recommendSemantics/RecommendSemanticsPage.tsx`
- `wren-ui/src/features/modeling/assistant/recommendSemantics/GeneratedSemanticsReview.tsx`
- `wren-ui/src/features/modeling/assistant/modelingAssistantVisuals.tsx`

结论：

- **Cloud 的 wizard 信息架构已经对齐**
- 本地视觉表达已经足够接近商业版 contract

## 3.4 State language

已统一的态：

- loading
- readonly
- request error
- empty state
- generated / ready-to-save

结论：

- 本地 assistant routes 已经不再是各页面自说自话，而是共享同一套 state-card 语言

---

## 4. What is intentionally not claimed

本文 **不声称**：

- 已逐像素复刻 Cloud 的字体、间距、阴影和微排版
- 已保证 Cloud 与本地在相同数据集上展示完全一样的内容

本文只声称：

> **Modeling AI Assistant 的 launcher / relationships / semantics 三块核心表面，已经按 Cloud contract 完成了 Phase 2 的视觉和信息架构对齐。**

---

## 5. Final verdict

### P0 / Visual parity

**Status: done**

验收口径：

- [x] launcher 具备 Cloud-style status summary
- [x] relationships review surface 具备 Cloud-style intro / review / footer hierarchy
- [x] semantics wizard 具备 Cloud-style step / prompt / review / footer hierarchy
- [x] loading / readonly / error / empty / completed 视觉语言统一
- [x] 有 Cloud 与本地截图证据沉淀到 repo
