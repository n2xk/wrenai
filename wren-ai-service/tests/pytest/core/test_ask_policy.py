from pathlib import Path

from src.core.ask_policy import (
    AskPolicyConfig,
    AskPolicyRule,
    evaluate_policy_context,
    load_ask_policy_config,
)


def test_evaluate_policy_context_blocks_forbidden_template():
    evaluation = evaluate_policy_context(
        query="统计登录但未成功充值的玩家",
        semantic_plan={"resolved_slots": {"tenant_plat_id": {"value": 990001}}},
        template_decision={"template_id": "T08"},
        config=AskPolicyConfig(
            version="test_policy_v1",
            rules=(
                AskPolicyRule(
                    id="forbid_cohort_for_login_without_deposit",
                    reason_code="policy_login_without_deposit_template_guard",
                    query_contains_any=("登录但未成功充值",),
                    forbidden_templates=("T08",),
                ),
            ),
        ),
    )

    assert evaluation.blocks_template is True
    assert evaluation.policy_version == "test_policy_v1"
    assert evaluation.forbidden_template_ids == ("T08",)
    assert evaluation.reason_codes == ("policy_login_without_deposit_template_guard",)
    assert evaluation.violations[0]["type"] == "forbidden_template"


def test_evaluate_policy_context_reports_missing_required_slots():
    evaluation = evaluate_policy_context(
        query="统计渠道990011首充用户",
        semantic_plan={"filters": {"channel_id": 990011}},
        template_decision={"template_id": "T04"},
        config=AskPolicyConfig(
            rules=(
                AskPolicyRule(
                    id="require_tenant_for_channel_first_deposit",
                    reason_code="policy_missing_tenant_for_channel_metric",
                    query_contains_any=("渠道", "首充"),
                    required_slots=("tenant_plat_id",),
                ),
            ),
        ),
    )

    assert evaluation.required_slots == ("tenant_plat_id",)
    assert evaluation.missing_required_slots == ("tenant_plat_id",)
    assert evaluation.violations[0]["type"] == "missing_required_slot"


def test_load_ask_policy_config_from_yaml(tmp_path: Path):
    policy_file = tmp_path / "ask_policy.yaml"
    policy_file.write_text(
        """
policy_id: semantic_governance
version: custom_v2
rules:
  - id: forbid_template
    reason_code: policy_forbid_template
    when:
      query_contains_any:
        - 普通充值
    forbidden_templates:
      - T08
""",
        encoding="utf-8",
    )

    config = load_ask_policy_config(str(policy_file))

    assert config.version == "custom_v2"
    assert config.rules[0].id == "forbid_template"
    assert config.rules[0].query_contains_any == ("普通充值",)
    assert config.rules[0].forbidden_templates == ("T08",)
