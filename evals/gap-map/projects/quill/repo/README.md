# Quill

Quill is a small calculator language. `node quill.js program.q` runs a program and prints each `print`.

## What it promises

- Integers add, subtract, and multiply: `print 2 + 3 * 4` prints `14`.
- Division by zero is refused with `error: division by zero` and exit code 1.
- `**` is right-associative: `2 ** 3 ** 2` is `2 ** 9`, which is `512`.
- Comments start with `--` and run to the end of the line.
- Numbers are 64-bit signed integers.

Every test in `tests/` ends in the `#|` lines its run must print.
