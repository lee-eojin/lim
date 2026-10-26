import re

AMOUNT = re.compile(r"^(-?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$")


def to_cents(text):
    match = AMOUNT.match(str(text).strip())
    if not match:
        raise ValueError(f"Not an amount: {text!r}")
    sign, whole, fraction = match.groups()
    cents = int(whole.replace(",", "")) * 100 + int((fraction or "0").ljust(2, "0"))
    return -cents if sign else cents


def from_cents(cents):
    sign = "-" if cents < 0 else ""
    whole, rest = divmod(abs(cents), 100)
    return f"{sign}{whole:,}.{rest:02d}"


def allocate(amount, parts):
    if not isinstance(parts, int) or isinstance(parts, bool) or parts < 1:
        raise ValueError("parts must be an int of 1 or more")
    total = to_cents(amount)
    if total < 0:
        raise ValueError(f"Cannot allocate a negative amount: {amount!r}")
    share, extra = divmod(total, parts)
    return [from_cents(share + 1 if index < extra else share) for index in range(parts)]
