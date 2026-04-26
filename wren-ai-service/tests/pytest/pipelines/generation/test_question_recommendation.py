from src.pipelines.generation.question_recommendation import normalized


def test_normalized_wraps_legacy_list_payload_into_questions_object():
    payload = normalized(
        {
            "replies": [
                '[{"question":"本月 GMV 是多少","category":"sales"},{"question":"近 7 天趋势如何","category":"trend"}]'
            ]
        }
    )

    assert payload == {
        "questions": [
            {"question": "本月 GMV 是多少", "category": "sales"},
            {"question": "近 7 天趋势如何", "category": "trend"},
        ]
    }


def test_normalized_preserves_questions_object_payload():
    payload = normalized(
        {
            "replies": [
                '{"questions":[{"question":"本月 GMV 是多少","category":"sales"}]}'
            ]
        }
    )

    assert payload == {
        "questions": [{"question": "本月 GMV 是多少", "category": "sales"}]
    }
