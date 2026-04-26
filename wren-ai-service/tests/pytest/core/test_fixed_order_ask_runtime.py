from src.core.fixed_order_ask_runtime import (
    build_reusable_template_sql,
    build_template_decision,
    detect_missing_external_source_requirement,
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
