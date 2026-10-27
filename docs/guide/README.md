# The review-loop guide

You are about to commit a change Claude wrote, and the only review so far came from the context that wrote it. This guide shows review-loop catching something in a real change, what you decide at the end, and what a review costs. The [README](../../README.md) explains how review-loop works. These pages show it running.

1. [Your first review](01-first-review.md). Install, run it on a change, and read the report.
2. [Deciding what is left](02-deciding.md). Keep as is, fix this time only, or make it a rule, and how `loop rule` proves a rule.
3. [The commit gate and delegation](03-commit-gate.md). What the hook blocks, what it asks, and what it lets through.
4. [When not to use it, and what it costs](04-cost-and-limits.md). Measured costs, a cheaper reviewer model, and which parts are enforced by code and which are instructions to Claude.
5. [Pitfalls](05-pitfalls.md). Checks that time out, monorepos, ignored files, what the gate cannot see, and the `.lim-review/` folder.
6. [Checks in other languages and subfolders](06-other-languages.md). What review-loop runs for Go, Rust, Python, JVM, .NET, Ruby, and Makefile projects, subfolder projects and the cap of 4, and tools that are not installed.
7. [Reproducing a finding with verify](07-reproduce-with-verify.md). `loop reproduce` before the fix, and the verify run after it that closes the finding.

Read them in order the first time. Each page takes a few minutes.

## Where the output comes from

Every command and every report or JSON output in this guide was run on 2026-10-27 with review-loop 0.10.0, in small repositories created for it. They are shown under `/tmp`: `/tmp/shop`, whose `package.json` has `lint` and `test` scripts, for pages 1 to 4, `/tmp/slow` for the reviewer model and the pitfalls, `/tmp/mono` and `/tmp/settings` for the other pitfalls, `/tmp/apps` and `/tmp/sites` for page 6, and `/tmp/cart` for page 7. No model was called. The reviewer's findings in the examples were written by hand for the examples and recorded with `loop record --file`, the same way Claude records a real reviewer's JSON. So the findings show what the script does with a review, not how good a reviewer is. For that, see the measured section of the [README](../../README.md), and page 4 for the cost. Long JSON is shortened to the fields that matter, and the page says so. Paths and times will differ on your machine.

To run the same commands yourself, point `LOOP` at the script, `HOOK` at the commit gate, and `VERIFY` at verify's script for page 7, with absolute paths, then run them from your repository. In an installed plugin they are under `~/.claude/plugins/cache/lim/review-loop/<version>/` and `~/.claude/plugins/cache/lim/verify/<version>/`. From the root of a clone of this repository:

```
LOOP="$PWD/plugins/review-loop/skills/review-loop/scripts/loop.mjs"
HOOK="$PWD/plugins/review-loop/hooks/commit-gate.mjs"
VERIFY="$PWD/plugins/verify/skills/verify/scripts/verify.mjs"
```

Claude runs the same script during a review, as `node ${CLAUDE_SKILL_DIR}/scripts/loop.mjs <command>`.

**If you remember one thing:** type `/review-loop:review-loop` before you commit, and read the report Claude shows first.

Next: [Your first review](01-first-review.md).
