import pytest

from sessions.cache import Cache


def test_put_then_get():
    cache = Cache()
    cache.put("a", 1)
    assert cache.get("a") == 1


def test_missing_key_raises():
    with pytest.raises(KeyError):
        Cache().get("missing")
