def _at_most(limit):
    def check(text):
        return len(text) <= limit

    return check


VALIDATORS = {
    "title": _at_most(80),
    "summary": _at_most(280),
}


def validate(post):
    errors = []
    for field, check in VALIDATORS.items():
        text = post.get(field, "")
        if not check(text):
            errors.append(f"{field} is too long")
    return errors
