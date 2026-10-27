from posting.rules import validate


def test_short_post_passes():
    assert validate({"title": "Hello", "summary": "A first post"}) == []
