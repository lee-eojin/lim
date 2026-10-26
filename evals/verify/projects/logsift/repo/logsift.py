#!/usr/bin/env python3
import sys

from logfilter import UnknownLevel, count_levels, level_rank, select

USAGE = "Usage: logsift [--min LEVEL] [--grep TEXT] [--levels] FILE"


def parse_args(args):
    options = {"min": None, "grep": None, "levels": False, "path": None}
    remaining = list(args)
    while remaining:
        arg = remaining.pop(0)
        if arg in ("--min", "--grep"):
            if not remaining:
                return None
            options[arg[2:]] = remaining.pop(0)
        elif arg == "--levels":
            options["levels"] = True
        elif arg.startswith("-") or options["path"] is not None:
            return None
        else:
            options["path"] = arg
    return options if options["path"] is not None else None


def main(args):
    options = parse_args(args)
    if options is None:
        print(USAGE, file=sys.stderr)
        return 2
    try:
        floor = level_rank(options["min"]) if options["min"] is not None else None
    except UnknownLevel as error:
        print(error, file=sys.stderr)
        return 2
    try:
        with open(options["path"], encoding="utf-8") as log:
            lines = log.readlines()
    except FileNotFoundError:
        print(f"No such file: {options['path']}", file=sys.stderr)
        return 2
    entries = select(lines, floor, options["grep"])
    if not entries:
        return 1
    if options["levels"]:
        for level, total in count_levels(entries).items():
            print(f"{level} {total}")
    else:
        for _, line in entries:
            print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
