import re

LEVELS = ("DBG", "INF", "WRN", "ERR")
LINE = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} (DBG|INF|WRN|ERR) (.*)$")


class UnknownLevel(ValueError):
    pass


def level_rank(name):
    level = name.upper()
    if level not in LEVELS:
        raise UnknownLevel(f"Unknown level: {name} (use DBG, INF, WRN, or ERR)")
    return LEVELS.index(level)


def select(lines, floor=None, text=None):
    needle = text.lower() if text is not None else None
    entries = []
    for line in lines:
        match = LINE.match(line.rstrip("\n"))
        if not match:
            continue
        level, message = match.groups()
        if floor is not None and LEVELS.index(level) < floor:
            continue
        if needle is not None and needle not in message.lower():
            continue
        entries.append((level, match.group(0)))
    return entries


def count_levels(entries):
    found = [level for level, _ in entries]
    return {level: found.count(level) for level in LEVELS if level in found}
