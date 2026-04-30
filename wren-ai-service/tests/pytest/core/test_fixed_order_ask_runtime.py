import pytest

from src.core.ask_policy import AskPolicyConfig, AskPolicyRule
from src.core.fixed_order_ask_runtime import (
    AskExecutionState,
    BaseFixedOrderAskRuntime,
    NL2SQLToolset,
    build_minimal_semantic_plan,
    build_reusable_template_sql,
    build_template_decision,
    detect_missing_external_source_requirement,
    detect_missing_required_slot_requirement,
    detect_missing_template_parameter_requirement,
    detect_missing_tenant_plat_id_requirement,
    filter_active_sql_samples,
    ground_template_sql_to_retrieved_tables,
    rerank_sql_samples,
)


def test_filter_active_sql_samples_excludes_deprecated_templates():
    active_sample = {
        "id": "template-active",
        "question": "首存金额分桶",
        "sql": "SELECT 1",
        "status": "active",
    }
    deprecated_sample = {
        "id": "template-deprecated",
        "question": "首存金额分桶",
        "sql": "SELECT 1",
        "status": "deprecated",
    }

    filtered_samples, inactive_sample = filter_active_sql_samples(
        [deprecated_sample, active_sample]
    )

    assert filtered_samples == [active_sample]
    assert inactive_sample == deprecated_sample


def test_filter_active_sql_samples_excludes_future_effective_templates():
    active_sample = {
        "id": "template-active",
        "question": "首存金额分桶",
        "sql": "SELECT 1",
        "status": "active",
    }
    future_sample = {
        "id": "template-future",
        "question": "首存金额分桶",
        "sql": "SELECT 1",
        "status": "active",
        "effective_from": "2099-01-01",
    }

    filtered_samples, inactive_sample = filter_active_sql_samples(
        [future_sample, active_sample]
    )

    assert filtered_samples == [active_sample]
    assert inactive_sample == future_sample


def test_build_template_decision_downgrades_unapproved_user_saved_template():
    result = build_template_decision(
        [
            {
                "id": "template-user-saved",
                "question": "首存金额分桶",
                "sql": "SELECT bucket, COUNT(*) FROM deposits GROUP BY bucket",
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "user_saved",
                "score": 0.95,
                "status": "active",
            }
        ],
        query="首存金额分桶",
    )

    assert result["mode"] == "reference"
    assert result["fallback_reason"] == "template_confidence_below_threshold"
    assert result["sql_source"] == "generated"


def test_build_template_decision_marks_inactive_only_template_for_fallback():
    result = build_template_decision(
        [],
        query="首存金额分桶",
        inactive_sample={
            "id": "template-future",
            "question": "首存金额分桶",
            "sql": "SELECT 1",
            "asset_kind": "sql_template",
            "template_level": "L2",
            "template_mode": "anchored_template",
            "source_type": "business_import",
            "status": "active",
            "effective_from": "2099-01-01",
            "score": 0.99,
        },
    )

    assert result["mode"] == "reference"
    assert result["fallback_reason"] == "inactive_template"
    assert result["template_id"] == "template-future"


def test_build_template_decision_downgrades_low_margin_business_template_conflict():
    result = build_template_decision(
        [
            {
                "id": "template-bucket-1",
                "question": "首存金额分桶",
                "sql": "SELECT bucket, COUNT(*) FROM deposits GROUP BY bucket",
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "score": 0.92,
                "status": "active",
            },
            {
                "id": "template-bucket-2",
                "question": "首存金额分桶口径",
                "sql": "SELECT bucket, SUM(amount) FROM deposit_summary GROUP BY bucket",
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "business_signature": {"templateId": "T99"},
                "score": 0.84,
                "status": "active",
            },
        ],
        query="首存金额分桶",
    )

    assert result["mode"] == "trusted_reference"
    assert result["fallback_reason"] == "template_conflict_low_margin"
    assert result["template_id"] == "template-bucket-1"


def test_build_template_decision_downgrades_daily_template_for_channel_period_summary():
    result = build_template_decision(
        [
            {
                "id": "T01",
                "question": "按天查看某渠道综合日报指标",
                "title": "渠道日基础汇总",
                "sql": (
                    "SELECT :tenant_plat_id, :channel_id, :start_date, :end_date, "
                    "biz_date FROM daily_report"
                ),
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "business_signature": {
                    "templateId": "T01",
                    "features": ["daily_summary", "channel_summary"],
                    "resultGrain": "biz_date + channel_id",
                },
                "score": 0.97,
                "status": "active",
            }
        ],
        query=(
            "对比租户平台990001下渠道990011、990012、990013、990014在"
            "2026-04-08到2026-04-14的成功充值订单笔数和充值金额"
        ),
    )

    assert result["template_id"] == "T01"
    assert result["mode"] == "reference"
    assert result["fallback_reason"] == (
        "template_guard_channel_period_summary_mismatch"
    )
    assert result["sql_source"] == "generated"


def test_build_template_decision_downgrades_segment_template_for_channel_period_summary():
    result = build_template_decision(
        [
            {
                "id": "T09",
                "question": (
                    "统计某渠道区间内 ALL、TOP3 和非 TOP3 用户的存款、投注、"
                    "投充比和杀率"
                ),
                "title": "ALL、TOP3和非TOP3用户区间汇总",
                "sql": (
                    "SELECT :tenant_plat_id, :channel_id, :start_date, :end_date, "
                    ":top_n, user_segment FROM topn_summary"
                ),
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "business_signature": {
                    "templateId": "T09",
                    "features": ["topn_segment", "deposit_summary"],
                    "dimensions": ["user_segment"],
                    "expected_grain": "user_segment",
                },
                "score": 0.98,
                "status": "active",
            }
        ],
        query=(
            "对比租户平台990001下渠道990011、990012、990013、990014在"
            "2026-04-08到2026-04-14的成功充值订单笔数和充值金额"
        ),
    )

    assert result["template_id"] == "T09"
    assert result["mode"] == "reference"
    assert result["fallback_reason"] == (
        "template_guard_channel_period_summary_mismatch"
    )
    assert result["sql_source"] == "generated"


def test_build_template_decision_downgrades_template_when_plain_sql_requested():
    result = build_template_decision(
        [
            {
                "id": "T01",
                "question": "按天查看某渠道综合日报指标",
                "title": "渠道日基础汇总",
                "sql": (
                    "SELECT :tenant_plat_id, :channel_id, :start_date, :end_date, "
                    "biz_date FROM daily_report"
                ),
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "business_signature": {
                    "templateId": "T01",
                    "features": ["daily_summary", "channel_summary"],
                    "resultGrain": "biz_date + channel_id",
                },
                "score": 0.97,
                "status": "active",
            }
        ],
        query=(
            "不用业务报表模板，直接查询租户平台990001下渠道990011在"
            "2026-04-01到2026-04-07每天成功充值订单笔数和充值金额"
        ),
    )

    assert result["template_id"] == "T01"
    assert result["mode"] == "reference"
    assert result["fallback_reason"] == "template_guard_plain_sql_requested"
    assert result["sql_source"] == "generated"


def test_build_template_decision_downgrades_template_when_raw_table_requested():
    result = build_template_decision(
        [
            {
                "id": "T11",
                "question": "按游戏类型分布统计投注次数和有效投注",
                "title": "游戏类型分布",
                "sql": (
                    "SELECT :tenant_plat_id, :channel_id, :start_date, :end_date, "
                    "game_type_id FROM game_type_report"
                ),
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "business_signature": {
                    "templateId": "T11",
                    "features": ["game_type"],
                    "resultGrain": "game_type_id",
                },
                "score": 0.97,
                "status": "active",
            }
        ],
        query=(
            "直接基于投注订单表，查询租户平台990001渠道990011在"
            "2026-04-01到2026-04-07按game_type_id汇总的投注订单笔数和"
            "有效投注金额"
        ),
    )

    assert result["template_id"] == "T11"
    assert result["mode"] == "reference"
    assert result["fallback_reason"] == "template_guard_plain_sql_requested"
    assert result["sql_source"] == "generated"


def test_build_template_decision_downgrades_template_when_raw_order_requested():
    result = build_template_decision(
        [
            {
                "id": "T01",
                "question": "按天查看某渠道综合日报指标",
                "title": "渠道日基础汇总",
                "sql": (
                    "SELECT :tenant_plat_id, :channel_id, :start_date, :end_date, "
                    "biz_date FROM daily_report"
                ),
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "business_signature": {
                    "templateId": "T01",
                    "features": ["daily_summary", "channel_summary"],
                    "resultGrain": "biz_date + channel_id",
                },
                "score": 0.97,
                "status": "active",
            }
        ],
        query=(
            "直接查原始提现订单，统计租户平台990001下渠道990011在"
            "2026-04-01到2026-04-07每天成功提现金额"
        ),
    )

    assert result["template_id"] == "T01"
    assert result["mode"] == "reference"
    assert result["fallback_reason"] == "template_guard_plain_sql_requested"
    assert result["sql_source"] == "generated"


def test_build_template_decision_downgrades_cohort_template_for_login_without_deposit():
    result = build_template_decision(
        [
            {
                "id": "T03",
                "question": "查询某渠道在指定时间段的首存用户名单与首存金额",
                "title": "首存 cohort 提取",
                "sql": (
                    "SELECT :tenant_plat_id, :channel_id, :cohort_start_date, "
                    ":cohort_end_date FROM first_deposit_cohort"
                ),
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "business_signature": {
                    "templateId": "T03",
                    "features": ["cohort", "first_deposit"],
                    "resultGrain": "first_deposit_user",
                },
                "score": 0.96,
                "status": "active",
            }
        ],
        query=(
            "找出租户平台990001渠道990011在2026-04-01到2026-04-07"
            "登录过但没有成功充值的玩家"
        ),
    )

    assert result["template_id"] == "T03"
    assert result["mode"] == "reference"
    assert result["fallback_reason"] == (
        "template_guard_login_without_deposit_mismatch"
    )
    assert result["sql_source"] == "generated"


def test_detect_missing_tenant_plat_id_requirement_for_channel_query():
    result = detect_missing_tenant_plat_id_requirement(
        "统计渠道990011在2026-04-01到2026-04-03首充用户的二存到六存情况"
    )

    assert result is not None
    assert result["missing_parameters"] == ["tenant_plat_id"]
    assert "租户平台" in result["content"]


def test_detect_missing_tenant_plat_id_requirement_uses_unique_history_context():
    result = detect_missing_tenant_plat_id_requirement(
        "统计渠道990011在2026-04-01到2026-04-03首充用户的二存到六存情况",
        histories=[
            {
                "question": (
                    "统计租户平台990001下渠道990011在2026-04-01到"
                    "2026-04-03首存cohort从D1到D7的累计收入"
                )
            }
        ],
    )

    assert result is None


def test_detect_missing_required_slot_requirement_clarifies_vague_channel_performance():
    result = detect_missing_required_slot_requirement("帮我看看这个渠道最近表现怎么样")

    assert result is not None
    assert result["slot"] == "channel_performance_context"
    assert result["missing_parameters"] == [
        "tenant_plat_id",
        "channel_id",
        "date_range",
        "metric_focus",
    ]
    assert "关注的指标方向" in result["content"]


def test_detect_missing_required_slot_requirement_keeps_metric_specific_channel_query():
    result = detect_missing_required_slot_requirement("这个渠道新客首充成本是多少")

    assert result is None


def test_detect_missing_required_slot_requirement_clarifies_ratio_scope():
    result = detect_missing_required_slot_requirement(
        "查询无充值但有投注或无投注日期的投充比/杀率"
    )

    assert result is not None
    assert result["slot"] == "financial_ratio_scope"
    assert result["missing_parameters"] == [
        "tenant_plat_id",
        "channel_id",
        "date_range",
    ]


def test_detect_missing_required_slot_requirement_clarifies_distribution_scope():
    result = detect_missing_required_slot_requirement("查询游戏类型投注占比或首存金额桶占比")

    assert result is not None
    assert result["slot"] == "distribution_scope"
    assert result["missing_parameters"] == ["tenant_plat_id", "date_range"]


def test_build_minimal_semantic_plan_marks_reference_without_template_as_normal_sql():
    plan = build_minimal_semantic_plan(
        "不要用综合日报模板，直接查充值订单表的成功充值笔数",
        template_decision={
            "mode": "reference",
            "template_id": None,
            "sql_source": "generated",
            "fallback_reason": None,
        },
    )

    assert plan["decision"]["route"] == "normal_text_to_sql"


def test_build_minimal_semantic_plan_treats_plain_sql_guard_as_normal_sql():
    plan = build_minimal_semantic_plan(
        "不用业务报表模板，直接查询充值订单",
        template_decision={
            "mode": "reference",
            "template_id": "13",
            "sql_source": "generated",
            "fallback_reason": "template_guard_plain_sql_requested",
        },
    )

    assert plan["decision"]["route"] == "normal_text_to_sql"


def test_build_minimal_semantic_plan_exposes_blocking_slot_clarification():
    plan = build_minimal_semantic_plan(
        "统计渠道990011在2026-04-01到2026-04-03首充用户的二存到六存情况"
    )

    assert plan["version"] == "p1_structured_v1"
    assert plan["source"] == "deterministic"
    assert plan["subject"] == "cohort"
    assert "first_deposit" in plan["metrics"]
    assert "retention_deposit" in plan["metrics"]
    assert "channel_id" in plan["dimensions"]
    assert "biz_date" in plan["dimensions"]
    assert plan["filters"] == {
        "channel_id": 990011,
        "start_date": "2026-04-01",
        "end_date": "2026-04-03",
    }
    assert plan["decision"]["route"] == "clarification_required"
    assert plan["decision"]["reason_codes"] == ["missing_required_slot"]
    assert plan["missing_slots"] == ["tenant_plat_id"]
    assert plan["missing_slot_details"] == [
        {
            "slot": "tenant_plat_id",
            "label": "租户平台",
            "required": True,
            "source": "tenant_plat_id",
        }
    ]
    assert plan["resolved_slots"]["channel_id"] == {
        "value": 990011,
        "source": "explicit_user_input",
    }
    assert plan["decision"]["resolved_slots"]["channel_id"] == {
        "value": 990011,
        "source": "explicit_user_input",
    }
    assert plan["clarification_request"]["slot"] == "tenant_plat_id"
    assert plan["clarification_request"]["blocking"] is True
    assert plan["clarification_request"]["pending_slots"][0]["slot"] == (
        "tenant_plat_id"
    )
    assert "租户平台" in plan["clarification_request"]["prompt"]


def test_build_minimal_semantic_plan_marks_vague_channel_question_as_clarification():
    plan = build_minimal_semantic_plan("帮我看看这个渠道最近效果怎么样")

    assert plan["subject"] == "channel"
    assert plan["decision"]["route"] == "clarification_required"
    assert plan["missing_slots"] == [
        "tenant_plat_id",
        "channel_id",
        "date_range",
        "metric_focus",
    ]
    assert plan["clarification_request"]["slot"] == "channel_performance_context"
    assert "指标方向" in plan["clarification_request"]["prompt"]


def test_detect_missing_template_parameter_requirement_clarifies_cohort_dates():
    result = detect_missing_template_parameter_requirement(
        "输出租户平台990001渠道990011首存用户从D1到D30每日充值趋势",
        {
            "missing_parameters": ["cohort_start_date", "cohort_end_date"],
        },
    )

    assert result is not None
    assert result["slot"] == "cohort_date_range"
    assert result["missing_parameters"] == ["cohort_start_date", "cohort_end_date"]
    assert "首存 cohort 日期范围" in result["content"]


def test_detect_missing_template_parameter_requirement_clarifies_broad_context():
    result = detect_missing_template_parameter_requirement(
        "对TOP5和非TOP5用户存款、有效投注、输赢生成分组对比图",
        {
            "missing_parameters": [
                "tenant_plat_id",
                "channel_id",
                "start_date",
                "end_date",
            ],
        },
    )

    assert result is not None
    assert result["slot"] == "template_required_context"
    assert result["missing_parameters"] == [
        "tenant_plat_id",
        "channel_id",
        "start_date",
        "end_date",
    ]
    assert "关键查询范围" in result["content"]


def test_build_minimal_semantic_plan_uses_history_slot_and_template_grain():
    plan = build_minimal_semantic_plan(
        "那只看渠道990011在2026-04-02的首存 cohort 呢？",
        histories=[
            {
                "question": (
                    "统计租户平台990001下渠道990011在2026-04-01到"
                    "2026-04-03首存cohort从D1到D7的累计收入"
                )
            }
        ],
        template_decision={
            "template_id": "T04",
            "mode": "anchored_template",
            "sql_source": "anchored_template",
            "business_signature": {"expectedGrain": "first_deposit_date + channel_id"},
        },
    )

    assert plan["filters"]["tenant_plat_id"] == 990001
    assert plan["resolved_slots"]["tenant_plat_id"] == {
        "value": 990001,
        "source": "history_context",
    }
    assert plan["filters"]["channel_id"] == 990011
    assert plan["filters"]["date"] == "2026-04-02"
    assert plan["grain"] == "first_deposit_date + channel_id"
    assert plan["missing_slots"] == []
    assert plan["clarification_request"] is None
    assert plan["template"]["template_id"] == "T04"
    assert plan["decision"]["route"] == "template_answer"
    assert plan["decision"]["candidate_templates"] == [
        {
            "id": "T04",
            "title": None,
            "template_type": "anchored_template",
            "decision": "accepted",
            "sql_source": "anchored_template",
            "reason_codes": [],
            "missing_parameters": [],
        }
    ]


class _SemanticPlanStub:
    async def run(self, **kwargs):
        return {
            "post_process": {
                "subject": "channel",
                "metrics": ["roi"],
                "dimensions": ["channel_id", "biz_date"],
                "filters": {"channel_id": 990011},
                "grain": "biz_date + channel_id",
                "missing_slots": [],
                "resolved_slots": {"channel_id": {"value": 990011}},
                "decision": {"reason_codes": ["llm_subject_match"]},
                "confidence": 0.82,
            }
        }


class _FailingSemanticPlanStub:
    async def run(self, **kwargs):
        raise RuntimeError("provider unavailable")


@pytest.mark.asyncio
async def test_maybe_enhance_semantic_plan_state_uses_optional_llm_plan():
    runtime = BaseFixedOrderAskRuntime(
        toolset=NL2SQLToolset({"semantic_plan": _SemanticPlanStub()}),
        allow_semantic_plan_llm=True,
    )
    state = AskExecutionState(
        user_query="租户平台990001渠道990011在2026-04-01到2026-04-07的ROI"
    )
    runtime._sync_semantic_plan_state(state, histories=[])

    await runtime._maybe_enhance_semantic_plan_state(
        state,
        histories=[],
        configuration=object(),
    )

    assert state.semantic_plan["source"] == "llm_enhanced"
    assert state.semantic_plan["subject"] == "channel"
    assert state.semantic_plan["grain"] == "biz_date + channel_id"
    assert state.semantic_plan["filters"]["tenant_plat_id"] == 990001
    assert state.semantic_plan["filters"]["channel_id"] == 990011
    assert "llm_semantic_plan_applied" in state.semantic_plan["decision"][
        "reason_codes"
    ]
    assert "llm_subject_match" in state.semantic_plan["decision"]["reason_codes"]


@pytest.mark.asyncio
async def test_maybe_enhance_semantic_plan_state_falls_back_on_llm_failure():
    runtime = BaseFixedOrderAskRuntime(
        toolset=NL2SQLToolset({"semantic_plan": _FailingSemanticPlanStub()}),
        allow_semantic_plan_llm=True,
    )
    state = AskExecutionState(user_query="统计渠道990011首充用户")
    runtime._sync_semantic_plan_state(state, histories=[])

    await runtime._maybe_enhance_semantic_plan_state(
        state,
        histories=[],
        configuration=object(),
    )

    assert state.semantic_plan["source"] == "deterministic"
    assert "llm_semantic_plan_failed" in state.semantic_plan["decision"][
        "reason_codes"
    ]


def test_apply_policy_state_downgrades_forbidden_template():
    runtime = BaseFixedOrderAskRuntime(toolset=NL2SQLToolset({}))
    runtime._ask_policy_config = AskPolicyConfig(
        version="test_policy_v1",
        rules=(
            AskPolicyRule(
                id="forbid_t08",
                reason_code="policy_forbid_t08",
                query_contains_any=("普通充值",),
                forbidden_templates=("T08",),
            ),
        ),
    )
    state = AskExecutionState(user_query="统计普通充值订单")
    state.template_decision = {
        "template_id": "T08",
        "mode": "anchored_template",
        "sql_source": "anchored_template",
    }
    runtime._sync_semantic_plan_state(state, histories=[])

    runtime._apply_policy_state(state)

    assert state.template_decision["mode"] == "reference"
    assert state.template_decision["sql_source"] == "generated"
    assert state.template_decision["fallback_reason"] == "policy_forbidden_template"
    assert state.template_decision["policy_version"] == "test_policy_v1"
    assert state.semantic_plan["decision"]["route"] == "normal_text_to_sql"
    assert "policy_forbid_t08" in state.semantic_plan["decision"][
        "policy_reason_codes"
    ]


def test_apply_policy_state_prefers_request_level_policy():
    runtime = BaseFixedOrderAskRuntime(toolset=NL2SQLToolset({}))
    runtime._ask_policy_config = AskPolicyConfig(
        version="file_policy_v1",
        rules=(
            AskPolicyRule(
                id="file_policy",
                reason_code="file_policy",
                query_contains_any=("普通充值",),
                forbidden_templates=("T99",),
            ),
        ),
    )
    state = AskExecutionState(user_query="统计普通充值订单")
    state.template_decision = {
        "template_id": "T08",
        "mode": "anchored_template",
        "sql_source": "anchored_template",
    }
    runtime._sync_semantic_plan_state(state, histories=[])

    runtime._apply_policy_state(
        state,
        request_policy={
            "policy_id": "workspace_policy",
            "version": "workspace_policy_v2",
            "rules": [
                {
                    "id": "request_forbid_t08",
                    "reason_code": "request_policy_forbid_t08",
                    "query_contains_any": ["普通充值"],
                    "forbidden_templates": ["T08"],
                }
            ],
        },
    )

    assert state.template_decision["fallback_reason"] == "policy_forbidden_template"
    assert state.template_decision["policy_id"] == "workspace_policy"
    assert state.template_decision["policy_version"] == "workspace_policy_v2"
    assert "request_policy_forbid_t08" in state.semantic_plan["decision"][
        "policy_reason_codes"
    ]


def test_apply_policy_state_marks_required_slots_as_clarification():
    runtime = BaseFixedOrderAskRuntime(toolset=NL2SQLToolset({}))
    state = AskExecutionState(user_query="统计首充用户")
    runtime._sync_semantic_plan_state(state, histories=[])

    runtime._apply_policy_state(
        state,
        request_policy={
            "policy_id": "workspace_policy",
            "version": "workspace_policy_v3",
            "rules": [
                {
                    "id": "require_tenant",
                    "reason_code": "policy_require_tenant",
                    "query_contains_any": ["首充"],
                    "required_slots": ["tenant_plat_id"],
                }
            ],
        },
    )

    assert state.semantic_plan["decision"]["route"] == "clarification_required"
    assert state.semantic_plan["missing_slots"] == ["tenant_plat_id"]
    assert state.semantic_plan["clarification_request"]["slot"] == "tenant_plat_id"
    assert "租户平台" in state.semantic_plan["clarification_request"]["prompt"]
    assert "policy_require_tenant" in state.semantic_plan["decision"][
        "policy_reason_codes"
    ]
    assert "missing_required_slot" in state.semantic_plan["decision"]["reason_codes"]


def test_build_template_decision_keeps_same_family_low_margin_business_template_anchor():
    result = build_template_decision(
        [
            {
                "id": "template-daily-1",
                "question": "按天查看某渠道综合日报指标",
                "sql": "SELECT :tenant_plat_id AS tenant_plat_id, :channel_id AS channel_id",
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "business_signature": {
                    "templateId": "T01",
                    "questionVariants": [
                        "按天查看某渠道综合日报指标",
                        "统计某渠道最近7天的登录、注册、充值、提现、投注汇总",
                    ],
                },
                "score": 0.91,
                "status": "active",
            },
            {
                "id": "template-daily-2",
                "question": "统计某渠道最近7天的登录、注册、充值、提现、投注汇总",
                "sql": "SELECT :tenant_plat_id AS tenant_plat_id, :channel_id AS channel_id",
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "business_signature": {
                    "templateId": "T01",
                    "questionVariants": [
                        "按天查看某渠道综合日报指标",
                        "统计某渠道最近7天的登录、注册、充值、提现、投注汇总",
                    ],
                },
                "score": 0.83,
                "status": "active",
            },
        ],
        query="按天查看 tenant_plat_id=990001 下 channel_id=990011 的某渠道综合日报指标",
    )

    assert result["mode"] == "anchored_template"
    assert result["fallback_reason"] is None
    assert result["sql_source"] == "anchored_template"
    assert result["template_id"] == "template-daily-1"
    assert result["parameters"] == {
        "tenant_plat_id": 990001,
        "channel_id": 990011,
    }


def test_build_template_decision_keeps_followup_history_template_anchor():
    wrong_template = {
        "id": "template-13",
        "question": "按首存金额固定档位输出人数与占比",
        "sql": (
            "SELECT * FROM deposits WHERE tenant_plat_id = :tenant_plat_id "
            "AND channel_id = :channel_id AND dt >= :start_date "
            "AND dt < DATE_ADD(:end_date, INTERVAL 1 DAY)"
        ),
        "asset_kind": "sql_template",
        "template_level": "L2",
        "template_mode": "executable_template",
        "source_type": "business_import",
        "score": 0.94,
        "status": "active",
    }
    correct_template = {
        "id": "template-04",
        "question": "统计某渠道首存 cohort 在指定回收周期内的累计渠道收入",
        "sql": (
            "WITH RECURSIVE seq AS ( SELECT 1 AS relative_day_no UNION ALL "
            "SELECT relative_day_no + 1 FROM seq WHERE relative_day_no < :period_days), "
            "first_deposit_cohort AS ( SELECT d.player_id, DATE(MIN(d.callback_time)) "
            "AS first_deposit_date FROM dwd_order_deposit d WHERE d.tenant_plat_id "
            "= :tenant_plat_id AND d.channel_id = :channel_id AND d.callback_time "
            ">= :cohort_start_date AND d.callback_time < DATE_ADD(:cohort_end_date, "
            "INTERVAL 1 DAY) GROUP BY d.player_id ) SELECT * FROM first_deposit_cohort"
        ),
        "asset_kind": "sql_template",
        "template_level": "L2",
        "template_mode": "executable_template",
        "source_type": "business_import",
        "score": 0.22,
        "status": "active",
    }

    result = build_template_decision(
        [correct_template, wrong_template],
        query="那只看 2026-04-02 的首存 cohort 呢？",
        histories=[
            {
                "question": (
                    "统计租户平台990001下渠道990011在2026-04-01到2026-04-03"
                    "首存cohort从D1到D7的累计收入"
                ),
                "sql": (
                    "WITH RECURSIVE seq AS (SELECT 1 AS relative_day_no UNION ALL "
                    "SELECT relative_day_no + 1 FROM seq WHERE relative_day_no < 7) "
                    "SELECT * FROM first_deposit_cohort"
                ),
            }
        ],
    )

    assert result["template_id"] == "template-04"
    assert result["mode"] == "anchored_template"
    assert result["parameters"]["tenant_plat_id"] == 990001
    assert result["parameters"]["channel_id"] == 990011
    assert result["parameters"]["cohort_start_date"] == "2026-04-02"
    assert result["parameters"]["cohort_end_date"] == "2026-04-02"
    assert result["history_backed_template_continuity"] is True


def test_build_template_decision_keeps_history_backed_anchor_for_low_margin_followup():
    correct_template = {
        "id": "template-04",
        "question": "统计某渠道首存 cohort 在指定回收周期内的累计渠道收入",
        "sql": (
            "WITH RECURSIVE seq AS ( SELECT 1 AS relative_day_no UNION ALL "
            "SELECT relative_day_no + 1 FROM seq WHERE relative_day_no < :period_days), "
            "first_deposit_cohort AS ( SELECT d.player_id, DATE(MIN(d.callback_time)) "
            "AS first_deposit_date FROM dwd_order_deposit d WHERE d.tenant_plat_id "
            "= :tenant_plat_id AND d.channel_id = :channel_id AND d.callback_time "
            ">= :cohort_start_date AND d.callback_time < DATE_ADD(:cohort_end_date, "
            "INTERVAL 1 DAY) GROUP BY d.player_id ) SELECT * FROM first_deposit_cohort"
        ),
        "asset_kind": "sql_template",
        "template_level": "L2",
        "template_mode": "anchored_template",
        "source_type": "business_import",
        "business_signature": {"templateId": "T04"},
        "score": 0.82,
        "status": "active",
    }
    competing_template = {
        "id": "template-10",
        "question": "统计首存 cohort 从首存当日开始的每日趋势",
        "sql": (
            "WITH RECURSIVE seq AS ( SELECT 1 AS relative_day_no UNION ALL "
            "SELECT relative_day_no + 1 FROM seq WHERE relative_day_no < :n_days), "
            "first_deposit_cohort AS ( SELECT d.player_id, DATE(MIN(d.callback_time)) "
            "AS first_deposit_date FROM dwd_order_deposit d WHERE d.tenant_plat_id "
            "= :tenant_plat_id AND d.channel_id = :channel_id AND d.callback_time "
            ">= :cohort_start_date AND d.callback_time < DATE_ADD(:cohort_end_date, "
            "INTERVAL 1 DAY) GROUP BY d.player_id ) SELECT * FROM first_deposit_cohort"
        ),
        "asset_kind": "sql_template",
        "template_level": "L2",
        "template_mode": "anchored_template",
        "source_type": "business_import",
        "business_signature": {"templateId": "T10"},
        "score": 0.82,
        "status": "active",
    }

    result = build_template_decision(
        [correct_template, competing_template],
        query="那只看 2026-04-02 的首存 cohort 呢？",
        histories=[
            {
                "question": (
                    "统计租户平台990001下渠道990011在2026-04-01到2026-04-03"
                    "首存cohort从D1到D7的累计收入"
                ),
                "sql": (
                    "WITH RECURSIVE tidb_business_demo_seq AS (SELECT 1 AS "
                    "relative_day_no UNION ALL SELECT relative_day_no + 1 FROM "
                    "tidb_business_demo_seq WHERE relative_day_no < 7), "
                    "tidb_business_demo_first_deposit_cohort AS (SELECT * FROM "
                    "tidb_business_demo_dwd_order_deposit) SELECT * FROM "
                    "tidb_business_demo_first_deposit_cohort"
                ),
            }
        ],
    )

    assert result["template_id"] == "template-04"
    assert result["mode"] == "anchored_template"
    assert result["fallback_reason"] is None
    assert result["parameters"]["tenant_plat_id"] == 990001
    assert result["parameters"]["channel_id"] == 990011
    assert result["parameters"]["cohort_start_date"] == "2026-04-02"
    assert result["parameters"]["cohort_end_date"] == "2026-04-02"


def test_build_template_decision_extracts_explicit_period_day_list():
    result = build_template_decision(
        [
            {
                "id": "template-04",
                "question": "统计某渠道首存 cohort 在指定回收周期内的累计渠道收入",
                "sql": (
                    "SELECT :tenant_plat_id, :channel_id, :cohort_start_date, "
                    ":cohort_end_date, :period_days"
                ),
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "score": 0.95,
                "status": "active",
            }
        ],
        query=(
            "统计租户平台990001下渠道990011在2026-04-01到2026-04-03"
            "首存cohort的D1、D3、D7、D15、D30累计渠道收入"
        ),
    )

    assert result["template_id"] == "template-04"
    assert result["parameters"]["period_days"] == [1, 3, 7, 15, 30]
    assert result["missing_parameters"] == []
    assert result["sql_source"] == "anchored_template"


def test_build_template_decision_ignores_optional_is_null_placeholders():
    result = build_template_decision(
        [
            {
                "id": "template-02",
                "question": "查询某平台下各渠道的折扣配置与渠道商信息",
                "sql": (
                    "SELECT * FROM channel c WHERE c.tenant_plat_id = :tenant_plat_id "
                    "AND (:channel_id IS NULL OR c.id = :channel_id) "
                    "AND (:channel_partner_id IS NULL OR "
                    "c.channel_partner_id = :channel_partner_id)"
                ),
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "parameter_schema": {
                    "type": "object",
                    "required": [
                        "tenant_plat_id",
                        "channel_id",
                        "channel_partner_id",
                    ],
                },
                "score": 0.95,
                "status": "active",
            }
        ],
        query="查询 tenant_plat_id=990001 下各渠道的折扣配置与渠道商信息",
    )

    assert result["template_id"] == "template-02"
    assert result["mode"] == "anchored_template"
    assert result["sql_source"] == "anchored_template"
    assert result["parameters"] == {"tenant_plat_id": 990001}
    assert result["missing_parameters"] == []
    assert result["fallback_reason"] is None


def test_build_template_decision_extracts_multiple_channel_ids():
    result = build_template_decision(
        [
            {
                "id": "template-02",
                "question": "查询某平台下各渠道的折扣配置与渠道商信息",
                "sql": (
                    "SELECT * FROM channel c WHERE c.tenant_plat_id = :tenant_plat_id "
                    "AND (:channel_id IS NULL OR c.id = :channel_id) "
                    "AND (:channel_partner_id IS NULL OR "
                    "c.channel_partner_id = :channel_partner_id)"
                ),
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "parameter_schema": {
                    "type": "object",
                    "required": [
                        "tenant_plat_id",
                        "channel_id",
                        "channel_partner_id",
                    ],
                },
                "score": 0.95,
                "status": "active",
            }
        ],
        query="查询 tenant_plat_id=990001 下各渠道的折扣配置与渠道商信息，重点看 channel_id 990011 和 990012。",
    )

    assert result["template_id"] == "template-02"
    assert result["parameters"] == {
        "tenant_plat_id": 990001,
        "channel_id": [990011, 990012],
    }
    assert result["missing_parameters"] == []


def test_build_template_decision_backfills_generic_segment_breakdown_top_n():
    result = build_template_decision(
        [
            {
                "id": "template-09",
                "title": "所有用户区间汇总",
                "question": (
                    "所有用户区间汇总；统计某渠道在指定区间内全部用户的投充比和杀率；"
                    "统计某渠道 TOP3 用户的投充比和杀率；"
                    "统计某渠道在指定区间内全部用户/分层用户的存款、充提差、"
                    "有效投注、输赢、投充比、杀率"
                ),
                "sql": (
                    "SELECT :tenant_plat_id AS tenant_plat_id, "
                    ":channel_id AS channel_id, :start_date AS start_date, "
                    ":end_date AS end_date, :user_segment AS user_segment, "
                    ":top_n AS top_n"
                ),
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "score": 0.96,
                "status": "active",
            }
        ],
        query=(
            "统计 tenant_plat_id=990001、channel_id=990011 在 2026-04-01 到 "
            "2026-04-07 指定区间内全部用户/分层用户的存款、充提差、"
            "有效投注、输赢、投充比、杀率。"
        ),
    )

    assert result["template_id"] == "template-09"
    assert result["mode"] == "anchored_template"
    assert result["sql_source"] == "anchored_template"
    assert result["fallback_reason"] is None
    assert result["missing_parameters"] == []
    assert result["parameters"] == {
        "tenant_plat_id": 990001,
        "channel_id": 990011,
        "start_date": "2026-04-01",
        "end_date": "2026-04-07",
        "user_segment": ["ALL", "TOPN", "NON_TOPN"],
        "top_n": 3,
    }


def test_build_template_decision_prefers_player_level_template_for_detail_query():
    query = (
        "统计 tenant_plat_id=990001、channel_id=990011 在 2026-04-01 到 "
        "2026-04-07 按有效投注排名的TOP3和非TOP3用户分层，给出玩家ID、"
        "有效投注、输赢、投注次数和分层"
    )
    reranked_samples = rerank_sql_samples(
        query,
        [
            {
                "id": "template-09",
                "title": "所有用户区间汇总",
                "question": "统计某渠道在指定区间内全部用户/分层用户的存款、充提差、有效投注、输赢、投充比、杀率",
                "sql": "SELECT :tenant_plat_id, :channel_id, :start_date, :end_date, :top_n",
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "business_signature": {
                    "templateId": "T09",
                    "resultGrain": "time_range + user_segment",
                },
                "score": 0.97,
                "status": "active",
            },
            {
                "id": "template-06",
                "title": "TOP3/非TOP3 分层",
                "question": "统计某渠道在指定区间内 TOPN 与非TOPN 用户分层结果",
                "sql": "SELECT :tenant_plat_id, :channel_id, :start_date, :end_date, :top_n",
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "business_signature": {
                    "templateId": "T06",
                    "resultGrain": "player_id",
                },
                "score": 0.8,
                "status": "active",
            },
        ],
    )
    result = build_template_decision(reranked_samples, query=query)

    assert result["template_id"] == "template-06"
    assert result["mode"] == "anchored_template"
    assert result["fallback_reason"] is None
    assert result["parameters"]["top_n"] == 3


def test_build_template_decision_prefers_cohort_extract_template_for_player_list_query():
    query = (
        "列出租户平台990001下渠道990011在2026-04-01到2026-04-03的首存cohort名单，"
        "包含首存日期、玩家ID、首存金额、注册日期和是否新客首存"
    )
    reranked_samples = rerank_sql_samples(
        query,
        [
            {
                "id": "template-08",
                "title": "首存 cohort 续存",
                "question": "统计某日/某段首存 cohort 的 2~6 存人数、率、人均金额",
                "sql": (
                    "SELECT :tenant_plat_id, :channel_id, :cohort_start_date, "
                    ":cohort_end_date"
                ),
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "business_signature": {
                    "templateId": "T08",
                    "resultGrain": "first_deposit_date + channel_id",
                },
                "score": 0.83,
                "status": "active",
            },
            {
                "id": "template-03",
                "title": "首存 cohort 提取",
                "question": "查询某渠道在指定时间段的首存用户名单与首存金额",
                "sql": (
                    "SELECT :tenant_plat_id, :channel_id, :cohort_start_date, "
                    ":cohort_end_date"
                ),
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "business_signature": {
                    "templateId": "T03",
                    "resultGrain": "first_deposit_user",
                },
                "score": 0.82,
                "status": "active",
            },
        ],
    )
    result = build_template_decision(reranked_samples, query=query)

    assert result["template_id"] == "template-03"
    assert result["mode"] == "anchored_template"
    assert result["fallback_reason"] is None
    assert result["parameters"] == {
        "tenant_plat_id": 990001,
        "channel_id": 990011,
        "cohort_start_date": "2026-04-01",
        "cohort_end_date": "2026-04-03",
    }


def test_build_template_decision_keeps_retention_template_anchored_for_2_to_6_deposit_query():
    query = (
        "统计租户平台990001下渠道990011在2026-04-01到2026-04-03首存cohort的"
        "2存到6存人数、比率和均额"
    )
    reranked_samples = rerank_sql_samples(
        query,
        [
            {
                "id": "template-03",
                "title": "首存 cohort 提取",
                "question": "查询某渠道在指定时间段的首存用户名单与首存金额",
                "sql": (
                    "SELECT :tenant_plat_id, :channel_id, :cohort_start_date, "
                    ":cohort_end_date"
                ),
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "business_signature": {
                    "templateId": "T03",
                    "resultGrain": "first_deposit_user",
                },
                "score": 0.8,
                "status": "active",
            },
            {
                "id": "template-08",
                "title": "首存 cohort 续存",
                "question": "统计某日/某段首存 cohort 的 2~6 存人数、率、人均金额",
                "sql": (
                    "SELECT :tenant_plat_id, :channel_id, :cohort_start_date, "
                    ":cohort_end_date"
                ),
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "business_signature": {
                    "templateId": "T08",
                    "resultGrain": "first_deposit_date + channel_id",
                },
                "score": 0.83,
                "status": "active",
            },
        ],
    )
    result = build_template_decision(reranked_samples, query=query)

    assert result["template_id"] == "template-08"
    assert result["mode"] == "anchored_template"
    assert result["fallback_reason"] is None
    assert result["parameters"] == {
        "tenant_plat_id": 990001,
        "channel_id": 990011,
        "cohort_start_date": "2026-04-01",
        "cohort_end_date": "2026-04-03",
    }


def test_build_template_decision_backfills_top_n_from_related_template_candidate():
    template_sql = (
        "SELECT :tenant_plat_id AS tenant_plat_id, "
        ":channel_id AS channel_id, :start_date AS start_date, "
        ":end_date AS end_date, :user_segment AS user_segment, "
        ":top_n AS top_n"
    )
    result = build_template_decision(
        [
            {
                "id": "template-09-generic",
                "question": "统计某渠道在指定区间内全部用户/分层用户的存款、充提差、有效投注、输赢、投充比、杀率",
                "sql": template_sql,
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "score": 0.97,
                "status": "active",
            },
            {
                "id": "template-09-canonical",
                "question": (
                    "所有用户区间汇总；统计某渠道在指定区间内全部用户的投充比和杀率；"
                    "统计某渠道 TOP3 用户的投充比和杀率；"
                    "统计某渠道在指定区间内全部用户/分层用户的存款、充提差、"
                    "有效投注、输赢、投充比、杀率"
                ),
                "sql": template_sql,
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "score": 0.10,
                "status": "active",
                "business_signature": {
                    "templateId": "T09",
                    "questionVariants": [
                        "统计某渠道在指定区间内全部用户的投充比和杀率",
                        "统计某渠道 TOP3 用户的投充比和杀率",
                        "统计某渠道在指定区间内全部用户/分层用户的存款、充提差、有效投注、输赢、投充比、杀率",
                    ],
                },
            },
        ],
        query=(
            "统计 tenant_plat_id=990001、channel_id=990011 在 2026-04-01 到 "
            "2026-04-07 指定区间内全部用户/分层用户的存款、充提差、"
            "有效投注、输赢、投充比、杀率。"
        ),
    )

    assert result["template_id"] == "template-09-generic"
    assert result["sql_source"] == "anchored_template"
    assert result["fallback_reason"] is None
    assert result["missing_parameters"] == []
    assert result["parameters"]["user_segment"] == ["ALL", "TOPN", "NON_TOPN"]
    assert result["parameters"]["top_n"] == 3


def test_build_template_decision_does_not_guess_ambiguous_template_top_n():
    result = build_template_decision(
        [
            {
                "id": "template-12",
                "title": "TOP3/5 游戏类型分层",
                "question": "对比某渠道 TOP3/5 与非TOP3/5 用户在各游戏类型上的投注分布",
                "sql": (
                    "SELECT :tenant_plat_id AS tenant_plat_id, "
                    ":channel_id AS channel_id, :start_date AS start_date, "
                    ":end_date AS end_date, :user_segment AS user_segment, "
                    ":top_n AS top_n"
                ),
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "score": 0.96,
                "status": "active",
            }
        ],
        query=(
            "统计 tenant_plat_id=990001、channel_id=990011 在 2026-04-01 到 "
            "2026-04-07 指定区间内全部用户/分层用户的投注分布。"
        ),
    )

    assert result["template_id"] == "template-12"
    assert result["mode"] == "anchored_template"
    assert result["sql_source"] == "anchored_generated"
    assert result["fallback_reason"] == "missing_template_parameters"
    assert result["missing_parameters"] == ["top_n"]
    assert result["parameters"]["user_segment"] == ["ALL", "TOPN", "NON_TOPN"]
    assert "top_n" not in result["parameters"]


def test_detect_missing_external_source_requirement_lists_all_requested_traffic_metrics():
    result = detect_missing_external_source_requirement(
        "按渠道/日期把 PV、UV 和下载点击UV 并入综合日报"
    )

    assert result is not None
    assert result["instruction"]["required_metrics"] == [
        "下载点击UV",
        "访问PV",
        "访问UV",
    ]
    assert "访问PV" in result["content"]
    assert "访问UV" in result["content"]
    assert "下载点击UV" in result["content"]
    assert "缺失指标" in result["content"]
    assert "需要粒度" in result["content"]
    assert "示例表头：日期, 渠道ID" in result["content"]
    assert result["instruction"]["example_columns"] == [
        "日期",
        "渠道ID",
        "下载点击UV",
        "访问PV",
        "访问UV",
    ]


def test_detect_missing_external_source_requirement_handles_cjk_adjacent_pv_uv():
    result = detect_missing_external_source_requirement(
        "统计渠道日报，并补充PV、UV、下载点击UV、UV下载率和UV注册率"
    )

    assert result is not None
    required_metrics = result["instruction"]["required_metrics"]
    assert "访问PV" in required_metrics
    assert "访问UV" in required_metrics
    assert "下载点击UV" in required_metrics
    assert "访问PV" in result["content"]
    assert "访问UV" in result["content"]
    assert "下载点击UV" in result["content"]
    assert "缺失指标" in result["content"]
    assert "需要粒度：日期、渠道" in result["content"]
    assert "示例表头" in result["content"]


def test_detect_missing_external_source_requirement_handles_plain_traffic_aliases():
    result = detect_missing_external_source_requirement(
        "帮我把访问量、独立访客、下载点击人数一起放进渠道日报"
    )

    assert result is not None
    required_metrics = result["instruction"]["required_metrics"]
    assert "访问PV" in required_metrics
    assert "访问UV" in required_metrics
    assert "下载点击UV" in required_metrics


def test_detect_missing_external_source_requirement_handles_roi_synonyms():
    result = detect_missing_external_source_requirement(
        "看这个渠道首存用户投放回收和回本情况"
    )

    assert result is not None
    assert result["instruction"]["required_metrics"] == ["投放金额"]
    assert "缺失指标：投放金额" in result["content"]
    assert "需要粒度：对应统计周期" in result["content"]


def test_detect_missing_external_source_requirement_uses_configured_grain():
    result = detect_missing_external_source_requirement(
        "按投放计划计算首存成本",
        instructions=[
            {
                "knowledge_asset_type": "external_dependency",
                "external_dependency_id": "ad_spend",
                "name": "投放金额",
                "source_status": "missing",
                "missing_behavior": "ask_user",
                "required_grain": ["日期", "渠道ID", "计划ID"],
                "metadata": {"required_by_terms": ["首存成本"]},
            }
        ],
    )

    assert result is not None
    assert "需要粒度：日期、渠道ID、计划ID" in result["content"]
    assert "示例表头：日期, 渠道ID, 计划ID, 投放金额" in result["content"]
    assert result["instruction"]["required_grain"] == ["日期", "渠道ID", "计划ID"]


def test_detect_missing_external_source_requirement_respects_trigger_cues():
    instructions = [
        {
            "knowledge_asset_type": "external_dependency",
            "external_dependency_id": "ad_spend",
            "name": "投放金额",
            "source_status": "missing",
            "missing_behavior": "ask_user",
            "required_grain": ["日期", "渠道ID"],
            "metadata": {
                "trigger_when": ["ROI", "投放成本"],
                "not_trigger_when": ["充值明细"],
            },
        }
    ]

    unrelated = detect_missing_external_source_requirement(
        "查询玩家充值明细",
        instructions=instructions,
    )
    matched = detect_missing_external_source_requirement(
        "按渠道计算 ROI",
        instructions=instructions,
    )

    assert unrelated is None
    assert matched is not None
    assert matched["required_external_dependencies"] == ["ad_spend"]


def test_build_reusable_template_sql_nulls_optional_placeholders():
    sample = {
        "id": "template-02",
        "sql": (
            "SELECT * FROM channel c WHERE c.tenant_plat_id = :tenant_plat_id "
            "AND (:channel_id IS NULL OR c.id = :channel_id) "
            "AND (:channel_partner_id IS NULL OR "
            "c.channel_partner_id = :channel_partner_id)"
        ),
    }

    rendered_sql = build_reusable_template_sql(
        sample,
        {"parameters": {"tenant_plat_id": 990001}},
    )

    assert ":channel_id" not in rendered_sql
    assert ":channel_partner_id" not in rendered_sql
    assert "c.tenant_plat_id = 990001" in rendered_sql
    assert "(NULL IS NULL OR c.id = NULL)" in rendered_sql


def test_build_reusable_template_sql_expands_multiple_channel_ids():
    sample = {
        "id": "template-02",
        "sql": (
            "SELECT * FROM channel c WHERE c.tenant_plat_id = :tenant_plat_id "
            "AND (:channel_id IS NULL OR c.id = :channel_id) "
            "AND (:channel_partner_id IS NULL OR "
            "c.channel_partner_id = :channel_partner_id)"
        ),
    }

    rendered_sql = build_reusable_template_sql(
        sample,
        {
            "parameters": {
                "tenant_plat_id": 990001,
                "channel_id": [990011, 990012],
            }
        },
    )

    assert rendered_sql.count("UNION ALL") == 1
    assert "c.id = 990011" in rendered_sql
    assert "c.id = 990012" in rendered_sql


def test_ground_template_sql_to_retrieved_tables_rewrites_logical_table_names():
    sample = {
        "sql": (
            "SELECT p.id FROM dim_player p "
            "JOIN dwd_order_deposit d ON d.player_id = p.id"
        ),
        "business_signature": {
            "sourceTables": ["dim_player", "dwd_order_deposit"],
        },
    }

    grounded_sql = ground_template_sql_to_retrieved_tables(
        sample["sql"],
        selected_template=sample,
        retrieved_table_names=[
            "tidb_business_demo_dim_player",
            "tidb_business_demo_dwd_order_deposit",
        ],
    )

    assert "FROM tidb_business_demo_dim_player p" in grounded_sql
    assert "JOIN tidb_business_demo_dwd_order_deposit d" in grounded_sql
    assert "FROM dim_player p" not in grounded_sql


def test_ground_template_sql_to_retrieved_tables_keeps_ambiguous_source_table():
    sample = {
        "sql": "SELECT * FROM dim_player",
        "business_signature": {
            "sourceTables": ["dim_player"],
        },
    }

    grounded_sql = ground_template_sql_to_retrieved_tables(
        sample["sql"],
        selected_template=sample,
        retrieved_table_names=["foo_dim_player", "bar_dim_player"],
    )

    assert grounded_sql == sample["sql"]


def test_ground_template_sql_to_retrieved_tables_infers_shared_prefix_for_missing_tables():
    sample = {
        "sql": (
            "SELECT p.id FROM dim_player p "
            "JOIN dwd_order_deposit d ON d.player_id = p.id "
            "JOIN dwd_player_login_log l ON l.player_id = p.id"
        ),
        "business_signature": {
            "sourceTables": [
                "dim_player",
                "dwd_order_deposit",
                "dwd_player_login_log",
                "dwd_order_rebate",
            ],
        },
    }

    grounded_sql = ground_template_sql_to_retrieved_tables(
        sample["sql"],
        selected_template=sample,
        retrieved_table_names=[
            "tidb_business_demo_dwd_order_rebate",
            "tidb_business_demo_dwd_order_task",
            "tidb_business_demo_dwd_bet_order",
        ],
    )

    assert "FROM tidb_business_demo_dim_player p" in grounded_sql
    assert "JOIN tidb_business_demo_dwd_order_deposit d" in grounded_sql
    assert "JOIN tidb_business_demo_dwd_player_login_log l" in grounded_sql
