from .cache import Cache

_sessions = Cache()


def remember(token, user_id):
    _sessions.put(token, user_id)


def user_for(token):
    try:
        return _sessions.get(token)
    except KeyError:
        return None
