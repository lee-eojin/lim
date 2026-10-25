# The review-loop guide

You are about to commit a change Claude wrote, and the only review so far came from the context that wrote it. This guide shows review-loop catching something in a real change, what you decide at the end, and what a review costs. The [README](../../README.md) explains how review-loop works. These pages show it running.

1. [Your first review](01-first-review.md). Install, run it on a change, and read the report.
2. [Deciding what is left](02-deciding.md). Keep as is, fix this time only, or make it a rule, and how `loop rule` proves a rule.
3. [The commit gate and delegation](03-commit-gate.md). What the hook blocks, what it asks, and what it lets through.
4. [When not to use it, and what it costs](04-cost-and-limits.md). Measured costs, a cheaper reviewer model, and which parts are enforced by code and which are instructions to Claude.
5. [Pitfalls](05-pitfalls.md). Checks that time out, monorepos, ignored files, what the gate cannot see, and the `.lim-review/` folder.

Read them in order the first time. Each page takes a few minutes.

## Where the output comes from

Every command and every report or JSON output in this guide was run on 2026-10-25 with the current `loop.mjs`, in small JavaScript repositories under `/tmp`: `/tmp/shop`, whose `package.json` has `lint` and `test` scripts, and three smaller ones for the pitfalls: `/tmp/slow`, `/tmp/mono`, and `/tmp/settings`. `/tmp/slow` is also the second repository on page 3, for the commit gate when commits are not delegated, and the repository for the reviewer model on page 4. No model was called. The reviewer's findings in the examples were written by hand for the examples and recorded with `loop record --file`, the same way Claude records a real reviewer's JSON. So the findings show what the script does with a review, not how good a reviewer is. For that, see the measured section of the [README](../../README.md), and page 4 for the cost. Long JSON is shortened to the fields that matter, and the page says so.

To run the same commands yourself, point `LOOP` at the script and `HOOK` at the commit gate, with absolute paths, then run them from your repository. In an installed plugin both are under `~/.claude/plugins/cache/lim/review-loop/<version>/`. From the root of a clone of this repository:

```
LOOP="$PWD/plugins/review-loop/skills/review-loop/scripts/loop.mjs"
HOOK="$PWD/plugins/review-loop/hooks/commit-gate.mjs"
```

Claude runs the same script during a review, as `node ${CLAUDE_SKILL_DIR}/scripts/loop.mjs <command>`.

**If you remember one thing:** type `/review-loop:review-loop` before you commit, and read the report Claude shows first.

Next: [Your first review](01-first-review.md).
