import pytest

from src.core.ask_policy import AskPolicyConfig, AskPolicyRule
from src.core.fixed_order_ask_runtime import (
    AskExecutionState,
    BaseFixedOrderAskRuntime,
    NL2SQLToolset,
    _build_execution_result_signature,
    _build_sql_candidate_fingerprint,
    _build_sql_correction_candidate_inputs,
    _can_retry_template_core_rejection_as_reference,
    _score_sql_business_guards,
    _select_best_sql_correction_result,
    _semantic_metric_patterns,
    _supplied_external_sql_builders_enabled,
    build_minimal_semantic_plan,
    build_query_decomposition_plan,
    build_reusable_template_sql,
    build_sql_core_signature,
    build_supplied_external_daily_report_sql,
    build_supplied_external_dependency_instruction,
    build_supplied_external_roi_sql,
    build_template_decision,
    detect_missing_external_source_requirement,
    detect_missing_required_slot_requirement,
    detect_missing_template_parameter_requirement,
    detect_missing_tenant_plat_id_requirement,
    detect_supplied_external_dependency_coverage,
    filter_active_sql_samples,
    ground_template_sql_to_retrieved_tables,
    is_template_core_preserved,
    rerank_sql_samples,
    should_override_general_intent_to_text_to_sql,
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


def test_missing_external_source_returns_clarification_slots():
    requirement = detect_missing_external_source_requirement(
        "统计租户平台990001下渠道990011在2026-04-01到2026-04-03的ROI",
        instructions=[
            {
                "knowledge_asset_type": "external_dependency",
                "external_dependency_id": "ad_spend",
                "name": "投放金额",
                "source_status": "missing",
                "missing_behavior": "ask_user",
                "required_grain": ["biz_date + channel_id"],
                "metadata": {
                    "trigger_when": ["ROI"],
                    "validation": {"required_columns": ["ad_spend"]},
                },
            }
        ],
    )

    assert requirement is not None
    assert requirement["pending_external_dependency_slots"] == [
        "external_dependency:ad_spend"
    ]
    assert requirement["external_dependency_request"]["example_columns"] == [
        "biz_date + channel_id",
        "投放金额",
    ]


def test_supplied_external_dependency_csv_satisfies_coverage():
    coverage = detect_supplied_external_dependency_coverage(
        "统计租户平台990001下渠道990011在2026-04-01到2026-04-03的ROI",
        instructions=[
            {
                "knowledge_asset_type": "external_dependency",
                "external_dependency_id": "ad_spend",
                "name": "投放金额",
                "source_status": "missing",
                "missing_behavior": "ask_user",
                "required_grain": ["biz_date + channel_id", "cohort_period"],
                "metadata": {
                    "trigger_when": ["ROI"],
                    "validation": {"required_columns": ["ad_spend"]},
                },
            }
        ],
        supplied_external_dependencies={
            "external_dependency:ad_spend": (
                "date,channel_id,ad_spend\n"
                "2026-04-01,990011,1000\n"
                "2026-04-02,990011,1200"
            )
        },
    )

    assert coverage is not None
    assert coverage["source"] == "external_dependency_user_supplied"
    assert coverage["required_external_dependencies"] == ["ad_spend"]
    assert coverage["evaluations"][0]["satisfied"] is True
    assert coverage["supplies"]["ad_spend"]["grain"] == [
        "biz_date + channel_id",
        "date + channel_id",
    ]


def test_supplied_external_dependency_instruction_contains_inline_select_cte():
    instruction = build_supplied_external_dependency_instruction(
        {
            "external_dependency:投放金额": (
                "date,channel_id,ad_spend\n"
                "2026-04-01,990011,1120\n"
                "2026-04-02,990011,1240"
            )
        }
    )

    assert instruction is not None
    text = instruction["instruction"]
    assert "WITH supplied_external_ad_spend" in text
    assert (
        "SELECT DATE '2026-04-01' AS biz_date, 990011 AS channel_id, 1120 AS ad_spend"
        in text
    )
    assert "UNION ALL" in text
    assert "不要假设存在 dwd_ad_spend" in text


def test_supplied_external_daily_report_sql_uses_external_metrics_and_excel_columns():
    sql = build_supplied_external_daily_report_sql(
        "生成第一期综合日报表完整宽表：租户平台990001渠道990011在2026-04-01到2026-04-06每日综合日报，"
        "包含汇总行、投放金额、PV、UV、下载点击UV、UV下载率、UV注册率、首存成本、首存率、有效投注、会员输赢、杀率、合计优惠。",
        {
            "external_dependency:投放金额": (
                "biz_date,tenant_plat_id,channel_id,ad_spend,access_pv,access_uv,download_click_uv\n"
                "2026-04-01,990001,990011,1120,12530,3150,845\n"
                "2026-04-02,990001,990011,1240,13060,3300,890"
            )
        },
    )

    assert sql is not None
    assert "external_metrics AS" in sql
    assert (
        "SELECT DATE '2026-04-01' AS biz_date, 990001 AS tenant_plat_id, 990011 AS channel_id"
        in sql
    )
    assert 'report_date AS "日期"' in sql
    assert 'site_name AS "所属站点"' in sql
    assert 'ad_spend AS "投放金额"' in sql
    assert 'access_pv AS "PV"' in sql
    assert 'access_uv AS "UV"' in sql
    assert 'download_click_uv AS "下载点击UV"' in sql
    assert 'download_click_uv / NULLIF(access_uv, 0) AS "UV下载率"' in sql
    assert 'register_user_count / NULLIF(access_uv, 0) AS "UV注册率"' in sql
    assert 'ad_spend / NULLIF(first_deposit_user_count, 0) AS "首存成本"' in sql
    assert (
        'task_amount + rebate_amount + discount_adjust_amount + marketing_lottery_amount AS "合计优惠"'
        in sql
    )
    assert "'汇总' AS report_date" in sql
    assert "tidb_business_demo_dwd_player_login_log" in sql


def test_supplied_external_daily_report_sql_accepts_clarification_session_slots():
    supplied_csv = (
        "biz_date,tenant_plat_id,channel_id,ad_spend,access_pv,access_uv,download_click_uv\n"
        "2026-04-01,990001,990011,1120,12530,3150,845"
    )

    sql = build_supplied_external_daily_report_sql(
        "生成第一期综合日报表完整宽表：租户平台990001渠道990011在2026-04-01到2026-04-06每日综合日报，"
        "包含汇总行、投放金额、PV、UV、下载点击UV。",
        {
            "external_dependencies": {
                "投放金额": supplied_csv,
                "访问PV": supplied_csv,
                "访问UV": supplied_csv,
                "下载点击UV": supplied_csv,
            }
        },
    )

    assert sql is not None
    assert "external_metrics AS" in sql
    assert "1120 AS ad_spend" in sql
    assert "12530 AS access_pv" in sql
    assert "3150 AS access_uv" in sql
    assert "845 AS download_click_uv" in sql


def test_supplied_external_roi_sql_uses_excel_shape_after_ad_spend_supply():
    sql = build_supplied_external_roi_sql(
        "生成第一期ROI回收表里的渠道整体ROI表：租户平台990001渠道990011首存日期"
        "2026-04-01到2026-04-07，输出Excel固定回收周期列"
        "D1/D3/D7/D15/D30/D60/D90/D120/D150/D180/D210/D240/D270/D300/D330/D360"
        "的ROI宽表和环比。",
        {
            "external_dependency:投放金额": (
                "date,channel_id,ad_spend\n"
                "2026-04-01,990011,1120\n"
                "2026-04-02,990011,1240"
            )
        },
    )

    assert sql is not None
    assert "supplied_external_ad_spend AS" in sql
    assert (
        "SELECT DATE '2026-04-01' AS biz_date, 990011 AS channel_id, 1120 AS ad_spend"
        in sql
    )
    assert '"投放金额"' in sql
    assert '"用户类型"' in sql
    assert '"累计1天"' in sql
    assert '"360天"' in sql
    assert "'环比系数' AS d1" in sql
    assert "D3_ROI" not in sql
    assert (
        "DATE_DIFF('day', c.first_deposit_date, CAST(b.settle_time AS DATE)) + 1" in sql
    )


def test_supplied_external_roi_sql_supports_topn_roi_shape():
    sql = build_supplied_external_roi_sql(
        "生成TOP3 ROI表：租户平台990001渠道990011首存日期2026-04-01到2026-04-07",
        {
            "external_dependency:ad_spend": (
                "日期,渠道ID,投放金额\n" "2026-04-01,990011,1120"
            )
        },
    )

    assert sql is not None
    assert "WHERE bet_rank <= 3" in sql
    assert "'TOP3' AS user_type" in sql


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


def test_runtime_template_decision_state_filters_inactive_templates():
    runtime = BaseFixedOrderAskRuntime(toolset=NL2SQLToolset({}))
    state = AskExecutionState(
        user_query="首存金额分桶",
        sql_samples=[
            {
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
            }
        ],
    )

    runtime._build_template_decision_state(state, histories=[])

    assert state.sql_samples == []
    assert state.template_decision["mode"] == "reference"
    assert state.template_decision["fallback_reason"] == "inactive_template"
    assert state.template_decision["template_id"] == "template-future"


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


def test_general_intent_override_keeps_business_rule_attached_data_query_on_sql_path():
    assert should_override_general_intent_to_text_to_sql(
        "查询租户平台990001渠道990011在2026-04-01到2026-04-07成功充值金额，并说明失败充值66是否计入。"
    )


def test_general_intent_override_ignores_pure_business_rule_question():
    assert not should_override_general_intent_to_text_to_sql(
        "失败充值是否计入充值金额？"
    )


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


def test_detect_missing_tenant_plat_id_requirement_skips_metadata_inventory_query():
    result = detect_missing_tenant_plat_id_requirement(
        "当前TiDB workspace里和充值、提现、投注相关的主要表有哪些？分别大概记录什么？"
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


def test_detect_missing_required_slot_requirement_uses_clarification_slot_values():
    result = detect_missing_required_slot_requirement(
        "帮我看看这个渠道最近表现怎么样",
        resolved_slots={
            "tenant_plat_id": 990001,
            "channel_id": 990011,
            "date_range": "2026-04-01 到 2026-04-07",
            "metric_focus": "充值表现",
        },
    )

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
    result = detect_missing_required_slot_requirement(
        "查询游戏类型投注占比或首存金额桶占比"
    )

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


def test_text_to_sql_thinking_marks_direct_template_reasoning_as_skipped():
    runtime = BaseFixedOrderAskRuntime(toolset=NL2SQLToolset({}))
    state = AskExecutionState(user_query="统计租户平台990001渠道990011首存趋势")
    state.template_decision = {
        "mode": "anchored_template",
        "sql_source": "anchored_template",
        "missing_parameters": [],
    }
    state.api_results = [{"sql": "select 1", "type": "sql_pair"}]
    state.table_names = ["dws_first_deposit"]

    thinking = runtime._build_text_to_sql_thinking(state=state, status="finished")

    sql_reasoned = next(
        step for step in thinking["steps"] if step["key"] == "ask.sql_reasoned"
    )
    assert sql_reasoned["status"] == "skipped"
    assert "已校验模板直接生成" in sql_reasoned["detail"]


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


def test_build_minimal_semantic_plan_consumes_clarification_slot_values():
    plan = build_minimal_semantic_plan(
        "帮我看看这个渠道最近表现怎么样",
        resolved_slot_values={
            "tenant_plat_id": 990001,
            "channel_id": 990011,
            "date_range": "2026-04-01 到 2026-04-07",
            "metric_focus": "充值表现",
        },
    )

    assert plan["missing_slots"] == []
    assert plan["clarification_request"] is None
    assert plan["filters"] == {
        "tenant_plat_id": 990001,
        "channel_id": 990011,
        "start_date": "2026-04-01",
        "end_date": "2026-04-07",
    }
    assert plan["resolved_slots"]["metric_focus"] == {
        "value": "充值表现",
        "source": "clarification_reply",
    }
    assert plan["decision"]["route"] == "normal_text_to_sql"


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
                "period_days",
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


def test_detect_missing_template_parameter_requirement_clarifies_period_days():
    result = detect_missing_template_parameter_requirement(
        "统计租户平台990001下渠道990011在2026-04-01到2026-04-03首存cohort累计收入",
        {
            "missing_parameters": ["period_days"],
        },
    )

    assert result is not None
    assert result["slot"] == "period_days"
    assert result["missing_parameters"] == ["period_days"]
    assert "回收周期" in result["content"]
    assert "D7" in result["content"]


def test_detect_missing_template_parameter_requirement_clarifies_n_days():
    result = detect_missing_template_parameter_requirement(
        "统计租户平台990001下渠道990011首存 cohort 的杀率趋势",
        {
            "missing_parameters": ["n_days"],
        },
    )

    assert result is not None
    assert result["slot"] == "n_days"
    assert result["missing_parameters"] == ["n_days"]
    assert "回收周期" in result["content"]
    assert "D7" in result["content"]


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


def test_build_minimal_semantic_plan_exposes_template_external_dependencies():
    plan = build_minimal_semantic_plan(
        "按渠道计算 ROI",
        template_decision={
            "template_id": "T09",
            "mode": "anchored_template",
            "sql_source": "anchored_generated",
            "required_external_dependencies": ["ad_spend"],
        },
    )

    assert plan["template"]["required_external_dependencies"] == ["ad_spend"]
    assert plan["decision"]["route"] == "template_reference_sql"
    assert plan["decision"]["external_dependencies"] == []


def test_semantic_metric_patterns_accept_env_extension(monkeypatch):
    monkeypatch.setenv("WREN_SEMANTIC_METRIC_PATTERNS", '{"gmv": ["GMV", "总流水"]}')

    patterns = _semantic_metric_patterns()

    assert patterns["gmv"] == ("GMV", "总流水")
    assert "deposit_amount" in patterns


def test_semantic_metric_patterns_can_replace_defaults(monkeypatch):
    monkeypatch.setenv("WREN_SEMANTIC_METRIC_PATTERNS", '{"gmv": ["GMV"]}')
    monkeypatch.setenv("WREN_SEMANTIC_METRIC_PATTERNS_REPLACE", "1")

    patterns = _semantic_metric_patterns()

    assert patterns == {"gmv": ("GMV",)}


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


class _RouteRelaxingSemanticPlanStub:
    async def run(self, **kwargs):
        return {
            "post_process": {
                "subject": "channel",
                "metrics": ["first_deposit"],
                "dimensions": ["channel_id"],
                "filters": {"channel_id": 990011},
                "missing_slots": [],
                "decision": {
                    "route": "normal_text_to_sql",
                    "reason_codes": ["llm_relaxed_route"],
                },
                "confidence": 0.9,
            }
        }


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
    assert (
        "llm_semantic_plan_applied" in state.semantic_plan["decision"]["reason_codes"]
    )
    assert "llm_subject_match" in state.semantic_plan["decision"]["reason_codes"]


@pytest.mark.asyncio
async def test_maybe_enhance_semantic_plan_state_can_shadow_llm_plan():
    runtime = BaseFixedOrderAskRuntime(
        toolset=NL2SQLToolset({"semantic_plan": _SemanticPlanStub()}),
        semantic_plan_mode="shadow",
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

    assert state.semantic_plan["source"] == "deterministic"
    assert state.semantic_plan["semantic_plan_mode"] == "shadow"
    assert state.semantic_plan["llm_shadow_plan"]["subject"] == "channel"
    assert (
        "llm_semantic_plan_shadowed" in state.semantic_plan["decision"]["reason_codes"]
    )


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
    assert "llm_semantic_plan_failed" in state.semantic_plan["decision"]["reason_codes"]


@pytest.mark.asyncio
async def test_maybe_enhance_semantic_plan_state_keeps_deterministic_route_guard():
    runtime = BaseFixedOrderAskRuntime(
        toolset=NL2SQLToolset({"semantic_plan": _RouteRelaxingSemanticPlanStub()}),
        allow_semantic_plan_llm=True,
    )
    state = AskExecutionState(user_query="统计渠道990011首充用户")
    runtime._sync_semantic_plan_state(state, histories=[])

    await runtime._maybe_enhance_semantic_plan_state(
        state,
        histories=[],
        configuration=object(),
    )

    assert state.semantic_plan["source"] == "llm_enhanced"
    assert state.semantic_plan["decision"]["route"] == "clarification_required"
    assert "tenant_plat_id" in state.semantic_plan["missing_slots"]
    assert "llm_relaxed_route" in state.semantic_plan["decision"]["reason_codes"]


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
    assert "policy_forbid_t08" in state.semantic_plan["decision"]["policy_reason_codes"]


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
    assert (
        "request_policy_forbid_t08"
        in state.semantic_plan["decision"]["policy_reason_codes"]
    )


def test_apply_policy_state_falls_back_to_file_policy_for_empty_request_rules():
    runtime = BaseFixedOrderAskRuntime(toolset=NL2SQLToolset({}))
    runtime._ask_policy_config = AskPolicyConfig(
        version="file_policy_v1",
        rules=(
            AskPolicyRule(
                id="file_policy",
                reason_code="file_policy_forbid_t08",
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

    runtime._apply_policy_state(
        state,
        request_policy={"policy_id": "workspace_policy", "rules": []},
    )

    assert state.template_decision["fallback_reason"] == "policy_forbidden_template"
    assert state.template_decision["policy_version"] == "file_policy_v1"
    assert (
        "file_policy_forbid_t08"
        in state.semantic_plan["decision"]["policy_reason_codes"]
    )


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
    assert (
        "policy_require_tenant"
        in state.semantic_plan["decision"]["policy_reason_codes"]
    )
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


def test_build_template_decision_extracts_single_d_period_day():
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
            "统计租户平台990001下渠道990011首存日期在2026-04-01到"
            "2026-04-07的首存 cohort D30 累计渠道收入"
        ),
    )

    assert result["template_id"] == "template-04"
    assert result["parameters"]["period_days"] == 30
    assert result["missing_parameters"] == []
    assert result["sql_source"] == "anchored_template"


def test_build_template_decision_extracts_chinese_n_days_range():
    result = build_template_decision(
        [
            {
                "id": "template-10",
                "question": "统计首存 cohort 从首日开始的 D1~DN 投充比/杀率趋势",
                "sql": (
                    "SELECT :tenant_plat_id, :channel_id, :cohort_start_date, "
                    ":cohort_end_date, :n_days"
                ),
                "asset_kind": "sql_template",
                "template_level": "L2",
                "template_mode": "anchored_template",
                "source_type": "business_import",
                "business_signature": {"templateId": "T10"},
                "score": 0.95,
                "status": "active",
            }
        ],
        query=(
            "统计租户平台990001下渠道990011首存日期在2026-04-01到"
            "2026-04-07的首存 cohort 首日到第7日杀率趋势，只用内部数据"
        ),
    )

    assert result["template_id"] == "template-10"
    assert result["parameters"]["n_days"] == 7
    assert result["missing_parameters"] == []
    assert result["sql_source"] == "anchored_template"


def test_template_core_reference_retry_requires_complete_parameters():
    assert not _can_retry_template_core_rejection_as_reference(
        {
            "mode": "anchored_template",
            "template_mode": "anchored_template",
            "missing_parameters": ["n_days"],
        },
        retry_used=False,
    )
    assert _can_retry_template_core_rejection_as_reference(
        {
            "mode": "anchored_template",
            "template_mode": "anchored_template",
            "missing_parameters": [],
        },
        retry_used=False,
    )


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


def test_build_template_decision_keeps_retention_template_after_tenant_clarification_resume():
    query = (
        "统计渠道990011在2026-04-01到2026-04-03首充用户的二存到六存情况"
        "（已补充：租户平台990001）"
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
                    "features": ["cohort", "first_deposit"],
                    "positiveCues": ["首存用户", "首次存款用户"],
                    "negativeCues": ["续存", "二存", "六存"],
                    "resultGrain": "first_deposit_user",
                },
                "score": 0.85,
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
                    "features": ["cohort", "retention"],
                    "concepts": ["first_deposit", "retention_deposit"],
                    "positiveCues": ["二存", "六存", "续存", "复存"],
                    "resultGrain": "first_deposit_date + channel_id",
                },
                "score": 0.78,
                "status": "active",
            },
        ],
    )
    result = build_template_decision(reranked_samples, query=query)

    assert result["template_id"] == "template-08"
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


def test_build_template_decision_extracts_topn_big_player_aliases():
    result = build_template_decision(
        [
            {
                "id": "template-09",
                "title": "所有用户区间汇总",
                "question": (
                    "统计某渠道 TOPN 与非TOPN 用户的存款、有效投注、输赢、"
                    "投充比和杀率"
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
                "business_signature": {
                    "templateId": "T09",
                    "features": ["segment", "financial_ratio"],
                    "positiveCues": ["大户", "投注流水最高", "投充比", "杀率"],
                    "resultGrain": "time_range + user_segment",
                },
                "score": 0.92,
                "status": "active",
            }
        ],
        query=(
            "找出租户平台990001渠道990011在2026-04-01到2026-04-07"
            "投注流水最高的前5个大户，和其他用户对比投充比与杀率"
        ),
    )

    assert result["template_id"] == "template-09"
    assert result["mode"] == "anchored_template"
    assert result["sql_source"] == "anchored_template"
    assert result["missing_parameters"] == []
    assert result["parameters"] == {
        "tenant_plat_id": 990001,
        "channel_id": 990011,
        "start_date": "2026-04-01",
        "end_date": "2026-04-07",
        "user_segment": ["TOPN", "NON_TOPN"],
        "top_n": 5,
    }


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


def test_detect_missing_external_source_requirement_ignores_legacy_fallback_by_default(
    monkeypatch,
):
    monkeypatch.delenv(
        "WREN_LEGACY_EXTERNAL_DEPENDENCY_FALLBACK_ENABLED", raising=False
    )

    result = detect_missing_external_source_requirement(
        "按渠道/日期把 PV、UV 和下载点击UV 并入综合日报"
    )

    assert result is None


def test_detect_missing_external_source_requirement_lists_all_requested_traffic_metrics(
    monkeypatch,
):
    monkeypatch.setenv("WREN_LEGACY_EXTERNAL_DEPENDENCY_FALLBACK_ENABLED", "1")

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


def test_detect_missing_external_source_requirement_handles_cjk_adjacent_pv_uv(
    monkeypatch,
):
    monkeypatch.setenv("WREN_LEGACY_EXTERNAL_DEPENDENCY_FALLBACK_ENABLED", "1")

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


def test_detect_missing_external_source_requirement_handles_plain_traffic_aliases(
    monkeypatch,
):
    monkeypatch.setenv("WREN_LEGACY_EXTERNAL_DEPENDENCY_FALLBACK_ENABLED", "1")

    result = detect_missing_external_source_requirement(
        "帮我把访问量、独立访客、下载点击人数一起放进渠道日报"
    )

    assert result is not None
    required_metrics = result["instruction"]["required_metrics"]
    assert "访问PV" in required_metrics
    assert "访问UV" in required_metrics
    assert "下载点击UV" in required_metrics


def test_detect_missing_external_source_requirement_handles_roi_synonyms(monkeypatch):
    monkeypatch.setenv("WREN_LEGACY_EXTERNAL_DEPENDENCY_FALLBACK_ENABLED", "1")

    result = detect_missing_external_source_requirement(
        "看这个渠道首存用户投放回收和回本情况"
    )

    assert result is not None
    assert result["instruction"]["required_metrics"] == ["投放金额"]
    assert "缺失指标：投放金额" in result["content"]
    assert "需要粒度：对应统计周期" in result["content"]


def test_detect_missing_external_source_requirement_allows_internal_only_degraded_query():
    result = detect_missing_external_source_requirement(
        "统计租户平台990001下渠道990011在2026-04-01到2026-04-06的综合日报，"
        "暂时不用外部数据，只展示系统内可查询的原始指标，"
        "去掉投放金额、PV、UV、下载点击UV及其派生率和首存成本",
        sql_samples=[
            {
                "id": "T01",
                "question": "按天查看某渠道综合日报指标",
                "business_signature": {
                    "external_dependencies": [
                        "ad_spend",
                        "access_pv",
                        "access_uv",
                        "download_click_uv",
                    ]
                },
            }
        ],
        instructions=[
            {
                "knowledge_asset_type": "external_dependency",
                "external_dependency_id": "ad_spend",
                "name": "投放金额",
                "source_status": "missing",
                "missing_behavior": "ask_user",
            },
            {
                "knowledge_asset_type": "external_dependency",
                "external_dependency_id": "access_pv",
                "name": "访问PV",
                "source_status": "missing",
                "missing_behavior": "ask_user",
            },
            {
                "knowledge_asset_type": "external_dependency",
                "external_dependency_id": "access_uv",
                "name": "访问UV",
                "source_status": "missing",
                "missing_behavior": "ask_user",
            },
            {
                "knowledge_asset_type": "external_dependency",
                "external_dependency_id": "download_click_uv",
                "name": "下载点击UV",
                "source_status": "missing",
                "missing_behavior": "ask_user",
            },
        ],
    )

    assert result is None


def test_detect_missing_external_source_requirement_allows_explicit_roi_degraded_query():
    result = detect_missing_external_source_requirement(
        "统计租户平台990001下渠道990011首存 cohort 的渠道累计收入，"
        "暂时不用投放金额，不计算 ROI，只输出累计收入和可查询的首存 cohort 指标",
        instructions=[
            {
                "knowledge_asset_type": "external_dependency",
                "external_dependency_id": "ad_spend",
                "name": "投放金额",
                "source_status": "missing",
                "missing_behavior": "ask_user",
                "metadata": {"trigger_when": ["ROI", "投放金额"]},
            }
        ],
    )

    assert result is None


def test_detect_missing_external_source_requirement_ignores_roi_report_name_for_cumulative_revenue():
    result = detect_missing_external_source_requirement(
        "生成第一期ROI回收表里的渠道累计收入表："
        "租户平台990001渠道990011首存日期2026-04-01到2026-04-07，"
        "输出D1到D360累计渠道收入宽表和环比"
    )

    assert result is None


def test_detect_missing_external_source_requirement_treats_no_fabrication_as_guard():
    result = detect_missing_external_source_requirement(
        "生成第一期ROI回收表里的渠道整体ROI表："
        "租户平台990001渠道990011首存日期2026-04-01到2026-04-07，"
        "输出D1到D360 ROI宽表和环比；如果缺投放金额，请先说明需要补充，不要编造。",
        instructions=[
            {
                "knowledge_asset_type": "external_dependency",
                "external_dependency_id": "ad_spend",
                "name": "投放金额",
                "source_status": "missing",
                "missing_behavior": "ask_user",
                "required_grain": ["biz_date + channel_id"],
                "metadata": {
                    "trigger_when": ["ROI", "投放金额"],
                    "not_trigger_when": ["暂时不用投放金额"],
                },
            }
        ],
    )

    assert result is not None
    assert result["required_external_dependencies"] == ["ad_spend"]
    assert "缺失指标：投放金额" in result["content"]


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


def test_detect_missing_external_source_requirement_accepts_valid_user_supplied_data():
    instructions = [
        {
            "knowledge_asset_type": "external_dependency",
            "external_dependency_id": "ad_spend",
            "name": "投放金额",
            "source_status": "missing",
            "missing_behavior": "ask_user",
            "required_grain": ["日期", "渠道ID"],
            "metadata": {
                "trigger_when": ["ROI"],
                "validation": {
                    "required_columns": ["日期", "渠道ID", "投放金额"],
                },
            },
        }
    ]

    result = detect_missing_external_source_requirement(
        "按渠道计算 ROI",
        instructions=instructions,
        supplied_external_dependencies={
            "external_dependency_values": {
                "ad_spend": {
                    "columns": ["日期", "渠道ID", "投放金额"],
                    "grain": ["日期", "渠道ID"],
                }
            }
        },
    )
    coverage = detect_supplied_external_dependency_coverage(
        "按渠道计算 ROI",
        instructions=instructions,
        supplied_external_dependencies={
            "external_dependency_values": {
                "ad_spend": {
                    "columns": ["日期", "渠道ID", "投放金额"],
                    "grain": ["日期", "渠道ID"],
                }
            }
        },
    )

    assert result is None
    assert coverage["required_external_dependencies"] == ["ad_spend"]


def test_detect_missing_external_source_requirement_rejects_invalid_user_supply():
    instructions = [
        {
            "knowledge_asset_type": "external_dependency",
            "external_dependency_id": "ad_spend",
            "name": "投放金额",
            "source_status": "missing",
            "missing_behavior": "ask_user",
            "required_grain": ["日期", "渠道ID"],
            "metadata": {
                "trigger_when": ["ROI"],
                "validation": {
                    "required_columns": ["日期", "渠道ID", "投放金额"],
                },
            },
        }
    ]

    result = detect_missing_external_source_requirement(
        "按渠道计算 ROI",
        instructions=instructions,
        supplied_external_dependencies={
            "external_dependency_values": {
                "ad_spend": {
                    "columns": ["日期", "投放金额"],
                    "grain": ["日期"],
                }
            }
        },
    )

    assert result is not None
    assert "渠道ID" in result["content"]
    assert "已补充数据校验未通过" in result["content"]


@pytest.mark.asyncio
async def test_missing_source_rule_marks_valid_user_supplied_external_dependency():
    instructions = [
        {
            "knowledge_asset_type": "external_dependency",
            "external_dependency_id": "ad_spend",
            "name": "投放金额",
            "source_status": "missing",
            "missing_behavior": "ask_user",
            "required_grain": ["日期", "渠道ID"],
            "metadata": {
                "trigger_when": ["ROI"],
                "validation": {
                    "required_columns": ["日期", "渠道ID", "投放金额"],
                },
            },
        }
    ]
    runtime = BaseFixedOrderAskRuntime(toolset=NL2SQLToolset({}))
    state = AskExecutionState(
        user_query="按渠道计算 ROI",
        instructions=instructions,
        effective_instructions=instructions,
        slot_values={
            "external_dependency_values": {
                "ad_spend": {
                    "columns": ["日期", "渠道ID", "投放金额"],
                    "grain": ["日期", "渠道ID"],
                }
            }
        },
    )
    runtime._sync_semantic_plan_state(state, histories=[])

    result = await runtime._maybe_handle_missing_source_rule(
        state=state,
        ask_request=object(),
        histories=[],
        trace_id=None,
        is_followup=False,
        is_stopped=lambda: True,
        set_result=lambda **_kwargs: None,
        build_ask_error=lambda **kwargs: kwargs,
        results={},
        orchestrator="test",
    )

    assert result is None
    decision = state.semantic_plan["decision"]
    assert "external_dependency_user_supplied" in decision["reason_codes"]
    assert decision["external_dependencies"] == ["ad_spend"]


@pytest.mark.asyncio
async def test_missing_source_rule_injects_inline_cte_for_fallback_external_supply(
    monkeypatch,
):
    monkeypatch.setenv("WREN_LEGACY_EXTERNAL_DEPENDENCY_FALLBACK_ENABLED", "1")

    runtime = BaseFixedOrderAskRuntime(toolset=NL2SQLToolset({}))
    state = AskExecutionState(
        user_query="生成渠道整体ROI表",
        instructions=[],
        effective_instructions=[],
        slot_values={
            "external_dependency:投放金额": (
                "date,channel_id,ad_spend\n" "2026-04-01,990011,1120"
            )
        },
    )
    runtime._sync_semantic_plan_state(state, histories=[])

    result = await runtime._maybe_handle_missing_source_rule(
        state=state,
        ask_request=object(),
        histories=[],
        trace_id=None,
        is_followup=False,
        is_stopped=lambda: True,
        set_result=lambda **_kwargs: None,
        build_ask_error=lambda **kwargs: kwargs,
        results={},
        orchestrator="test",
    )

    assert result is None
    assert any(
        instruction.get("knowledge_asset_type") == "external_dependency_supply"
        and "WITH supplied_external" in instruction.get("instruction", "")
        for instruction in state.effective_instructions
    )
    decision = state.semantic_plan["decision"]
    assert "external_dependency_user_supplied" in decision["reason_codes"]
    assert decision["provided_external_dependencies"] == ["投放金额"]


def test_build_sql_core_signature_allows_alias_and_whitespace_changes():
    template_sql = """
    WITH base AS (
      SELECT d.biz_date, d.channel_id, d.amount FROM deposit_summary d
    )
    SELECT b.biz_date, b.channel_id, SUM(b.amount) AS amount
    FROM base b
    GROUP BY b.biz_date, b.channel_id
    """
    candidate_sql = """
    with base as (
      select ds.biz_date, ds.channel_id, ds.amount
      from deposit_summary ds
    )
    select biz_date, channel_id, sum(amount) as amount
    from base
    group by biz_date, channel_id
    """

    assert is_template_core_preserved(template_sql, candidate_sql) is True
    assert build_sql_core_signature(template_sql)["aggregates"] == {"sum": 1}


def test_build_sql_core_signature_allows_physical_table_prefix_grounding():
    template_sql = """
    SELECT biz_date, channel_id, SUM(amount) AS amount
    FROM dwd_order_deposit
    GROUP BY biz_date, channel_id
    """
    candidate_sql = """
    SELECT biz_date, channel_id, SUM(amount) AS amount
    FROM tidb_business_demo_dwd_order_deposit
    GROUP BY biz_date, channel_id
    """

    assert is_template_core_preserved(template_sql, candidate_sql) is True
    assert build_sql_core_signature(template_sql)["source_tables"] == [
        "dwd_order_deposit"
    ]
    assert build_sql_core_signature(candidate_sql)["source_tables"] == [
        "dwd_order_deposit"
    ]


def test_is_template_core_preserved_rejects_structural_changes():
    template_sql = """
    WITH base AS (
      SELECT biz_date, channel_id, amount FROM deposit_summary
    )
    SELECT biz_date, channel_id, SUM(amount) AS amount
    FROM base
    GROUP BY biz_date, channel_id
    """

    assert (
        is_template_core_preserved(
            template_sql,
            template_sql.replace("base AS", "changed AS"),
        )
        is False
    )
    assert (
        is_template_core_preserved(
            template_sql,
            template_sql.replace("deposit_summary", "withdraw_summary"),
        )
        is False
    )
    assert (
        is_template_core_preserved(
            template_sql,
            template_sql.replace("GROUP BY biz_date, channel_id", "GROUP BY biz_date"),
        )
        is False
    )
    assert (
        is_template_core_preserved(
            template_sql,
            template_sql.replace("SUM(amount)", "COUNT(amount)"),
        )
        is False
    )


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


def test_build_minimal_semantic_plan_uses_structured_history_slots():
    plan = build_minimal_semantic_plan(
        "那只看非TOP3呢？",
        histories=[
            {
                "question": "统计租户平台990001渠道990011在2026-04-01到2026-04-07的TOP3",
                "sql": "SELECT 1",
                "resolved_slots": {
                    "tenant_plat_id": "990001",
                    "channel_id": "990011",
                    "date_range": {
                        "start_date": "2026-04-01",
                        "end_date": "2026-04-07",
                    },
                },
                "template_id": "T09",
            }
        ],
    )

    assert plan["filters"]["tenant_plat_id"] == 990001
    assert plan["filters"]["channel_id"] == 990011
    assert plan["filters"]["start_date"] == "2026-04-01"
    assert plan["filters"]["end_date"] == "2026-04-07"
    assert plan["resolved_slots"]["tenant_plat_id"]["source"] == "history_context"


def test_rerank_sql_samples_prefers_matching_question_skeleton():
    query = "统计渠道990011在2026-04-01充值金额"
    samples = [
        {
            "id": "login-template",
            "question": "统计渠道880001在2025-01-01登录人数",
            "sql": "SELECT COUNT(*) FROM login_log",
            "score": 0.7,
        },
        {
            "id": "deposit-template",
            "question": "统计渠道880001在2025-01-01充值金额",
            "sql": "SELECT SUM(amount) FROM dwd_order_deposit",
            "score": 0.7,
        },
    ]

    ranked = rerank_sql_samples(query, samples)

    assert ranked[0]["id"] == "deposit-template"


def test_supplied_external_sql_builders_can_be_disabled(monkeypatch):
    monkeypatch.setenv("WREN_SUPPLIED_EXTERNAL_SQL_BUILDERS_ENABLED", "0")

    assert _supplied_external_sql_builders_enabled() is False

    monkeypatch.setenv("WREN_SUPPLIED_EXTERNAL_SQL_BUILDERS_ENABLED", "1")

    assert _supplied_external_sql_builders_enabled() is True


def test_sql_correction_candidate_inputs_use_distinct_strategies():
    candidates = _build_sql_correction_candidate_inputs(
        original_sql="SELECT bad_col FROM orders",
        error_message="Column bad_col not found",
        diagnosis_reasoning="bad_col does not exist",
        candidate_count=3,
    )

    assert len(candidates) == 3
    assert {candidate["sql"] for candidate in candidates} == {
        "SELECT bad_col FROM orders"
    }
    assert "diagnosis_first" in candidates[0]["error"]
    assert "schema_first" in candidates[1]["error"]
    assert "dialect_first" in candidates[2]["error"]


def test_select_best_sql_correction_result_prefers_valid_minimal_change():
    original_sql = "SELECT bad_col FROM orders"
    broad_rewrite = {
        "post_process": {
            "valid_generation_result": {
                "sql": "SELECT COUNT(*) AS order_count FROM orders"
            },
            "invalid_generation_result": {},
        }
    }
    minimal_fix = {
        "post_process": {
            "valid_generation_result": {"sql": "SELECT good_col FROM orders"},
            "invalid_generation_result": {},
        }
    }
    invalid = {
        "post_process": {
            "valid_generation_result": {},
            "invalid_generation_result": {
                "sql": "SELECT bad_col FROM orders",
                "original_sql": original_sql,
                "error": "still invalid",
                "type": "DRY_RUN",
            },
        }
    }

    best, first_invalid = _select_best_sql_correction_result(
        [invalid, broad_rewrite, minimal_fix],
        original_sql=original_sql,
    )

    assert best is minimal_fix
    assert first_invalid == invalid["post_process"]["invalid_generation_result"]


def test_query_decomposition_plan_for_complex_roi_topn_question():
    plan = build_query_decomposition_plan(
        "统计租户平台990001下渠道990011首存用户TOP3和非TOP3的D1、D3、D7 ROI宽表",
        table_names=[
            "tidb_business_demo_dwd_order_deposit",
            "tidb_business_demo_dwd_bet_order",
            "tidb_business_demo_dim_player",
        ],
    )

    assert plan["enabled"] is True
    assert "topn_segment" in plan["features"]
    assert "cohort" in plan["features"]
    assert "external_metric" in plan["features"]
    assert [step["name"] for step in plan["steps"]] == [
        "base_scope",
        "cohort_users",
        "segment_users",
        "external_metrics",
        "metric_aggregation",
        "final_pivot",
    ]
    assert plan["strategy"] == "structured_cte_dag"
    assert plan["composer"] == {
        "mode": "single_sql_with_named_ctes",
        "final_step": "final_pivot",
    }
    assert plan["required_ctes"] == [
        "base_scope",
        "cohort_users",
        "segment_users",
        "external_metrics",
        "metric_aggregation",
        "final_pivot",
    ]
    assert any("GROUP BY" in check for check in plan["validation_checks"])


def test_sql_candidate_business_guard_scores_required_slots_and_decomposition_ctes():
    sql = """
    WITH base_scope AS (
      SELECT * FROM dwd_order_deposit
      WHERE tenant_plat_id = 990001
        AND channel_id = 990011
        AND callback_time >= '2026-04-01'
        AND callback_time < DATE_ADD('2026-04-07', INTERVAL 1 DAY)
    ),
    segment_users AS (
      SELECT player_id, ROW_NUMBER() OVER (ORDER BY SUM(actual_amount) DESC) AS rn
      FROM base_scope
      GROUP BY player_id
    ),
    metric_aggregation AS (
      SELECT channel_id, COUNT(*) AS cnt FROM base_scope GROUP BY channel_id
    ),
    final_select AS (
      SELECT channel_id, cnt FROM metric_aggregation
    )
    SELECT * FROM final_select
    """
    semantic_plan = {
        "filters": {
            "tenant_plat_id": 990001,
            "channel_id": 990011,
            "start_date": "2026-04-01",
            "end_date": "2026-04-07",
        }
    }
    decomposition = {
        "features": ["topn_segment"],
        "required_ctes": [
            "base_scope",
            "segment_users",
            "metric_aggregation",
            "final_select",
        ],
    }

    guard = _score_sql_business_guards(
        sql=sql,
        semantic_plan=semantic_plan,
        query_decomposition=decomposition,
    )

    assert guard["failed_count"] == 0
    assert guard["normalized_score"] == 1
    fingerprint = _build_sql_candidate_fingerprint(sql)
    assert fingerprint["window_count"] == 1
    assert "dwd_order_deposit" in fingerprint["source_tables"]


@pytest.mark.asyncio
async def test_select_best_sql_generation_result_votes_by_execution_and_guards():
    class VotingToolset(NL2SQLToolset):
        async def preview_sql_execution(self, *, sql, runtime_scope_id, limit=None):
            if "without_tenant" in sql:
                return {
                    "success": True,
                    "result": {},
                    "signature": _build_execution_result_signature(
                        {"columns": [{"name": "cnt"}], "data": [{"cnt": 10}]}
                    ),
                    "error": "",
                }
            return {
                "success": True,
                "result": {},
                "signature": _build_execution_result_signature(
                    {"columns": [{"name": "cnt"}], "data": [{"cnt": 20}]}
                ),
                "error": "",
            }

    def candidate(index: int, strategy: str, sql: str) -> dict:
        return {
            "candidate_index": index,
            "candidate_strategy": strategy,
            "post_process": {
                "valid_generation_result": {"sql": sql},
                "invalid_generation_result": {},
            },
        }

    weak_candidate = candidate(
        0,
        "template_first",
        "SELECT COUNT(*) AS cnt FROM without_tenant",
    )
    guarded_candidate = candidate(
        1,
        "business_guard_first",
        "SELECT COUNT(*) AS cnt FROM dwd_order_deposit WHERE tenant_plat_id = 990001",
    )
    equivalent_result_candidate = candidate(
        2,
        "result_consistency_first",
        (
            "SELECT COUNT(1) AS cnt FROM dwd_order_deposit "
            "WHERE tenant_plat_id = 990001"
        ),
    )

    best, first_invalid = await VotingToolset({}).select_best_sql_generation_result(
        [weak_candidate, guarded_candidate, equivalent_result_candidate],
        runtime_scope_id="kb-test",
        semantic_plan={"filters": {"tenant_plat_id": 990001}},
    )

    assert first_invalid is None
    assert best is guarded_candidate
    assert best["execution_vote"]["vote_count"] == 2
    assert best["execution_vote"]["business_guard"]["failed_count"] == 0
    assert best["execution_voting"]["selected_strategy"] == "business_guard_first"
    assert best["execution_voting"]["valid_candidate_count"] == 3
    assert best["execution_voting"]["execution_vote_groups"] == 2


def test_execution_result_signature_normalizes_preview_rows():
    signature = _build_execution_result_signature(
        {
            "columns": [{"name": "biz_date"}, {"name": "amount"}],
            "data": [
                {"biz_date": "2026-04-01", "amount": 123.45},
                {"biz_date": "2026-04-02", "amount": object()},
            ],
        }
    )

    assert signature["columns"] == ["biz_date", "amount"]
    assert signature["row_count"] == 2
    assert signature["sample"][0] == {"biz_date": "2026-04-01", "amount": 123.45}
    assert isinstance(signature["sample"][1]["amount"], str)
