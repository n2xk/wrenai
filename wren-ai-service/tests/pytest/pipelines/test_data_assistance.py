from haystack.components.builders.prompt_builder import PromptBuilder

from src.pipelines.generation.data_assistance import (
    data_assistance_user_prompt_template,
    prompt,
)


def test_data_assistance_prompt_includes_user_instructions():
    result = prompt(
        query="首充用户怎么定义？",
        db_schemas=["CREATE TABLE dwd_order_deposit (times int, status int);"],
        language="zh-CN",
        histories=[],
        prompt_builder=PromptBuilder(template=data_assistance_user_prompt_template),
        custom_instruction="",
        instructions=[{"instruction": "首存定义为成功存款且 times = 1"}],
    )

    assert "### USER INSTRUCTIONS ###" in result["prompt"]
    assert "首存定义为成功存款且 times = 1" in result["prompt"]
