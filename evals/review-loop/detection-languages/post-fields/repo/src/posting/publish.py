from .rules import validate


class RejectedPost(Exception):
    pass


def publish(post, store):
    errors = validate(post)
    if errors:
        raise RejectedPost("; ".join(errors))
    return store.save(post)
