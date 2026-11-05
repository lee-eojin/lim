---
name: prove-it
description: Require measured evidence before calling work in this repository done. Use it before saying a change works, a check passes, a bug is fixed, or a number improved.
---

# Prove it

Reply in the user's language.

**The rule.** "Done" means measured output is shown. Never claim PASS without a run from this session. A run from an earlier session, a reading of the code, or a result you expect is not proof. If you could not run something, the verdict is `NOT_RUN` or `BLOCKED`, not PASS.

## Free checks

These cost no tokens, so run them before any claim:

```bash
claude plugin validate --strict .
node --test
scripts/check.sh
node scripts/check-i18n.mjs
node scripts/sync-counts.mjs --check
```

When a change touches `loop.mjs` or the loop model, also run `node scripts/check-loop-model.mjs`.

## Evidence contract

Every claim or report carries these six fields:

| Field | What it holds |
| --- | --- |
| `REVISION` | The commit the run used, and whether the working tree was clean |
| `REPRO` | The exact commands someone can run again |
| `RUN` | What ran, where, and how many times |
| `PROOF` | The measured output: counts, exit codes, before and after |
| `LIMITS` | What was not measured or not run |
| `Verdict` | `PASS`, `FAIL`, `NOT_RUN`, or `BLOCKED` |

`MUTATION` is optional and is described below.

Write the report as text or as a JSON object with the same names in lowercase:

```text
REVISION: f779ad9, clean tree
REPRO: node --test tests/scripts/check-skills.test.mjs
RUN: one local run on Linux, Node 24
PROOF: 13 pass, 0 fail
LIMITS: Windows not run
Verdict: PASS
```

A label starts its line. A value can continue on the next lines, so indent pasted output to keep a line like `RUN: ...` from reading as a new label.

Before you present a claim as done, validate the report:

```bash
node scripts/check-evidence-report.mjs <file>
```

The script checks the report's shape, not its truth. The run behind it is still your job.

## New or changed checks

A check that has never failed proves nothing. For a new or changed automated check, show it catching a real failure once, with a mutation of the code or a negative fixture, then show it passing on the real code. Record what you broke and what the check said under `MUTATION`. If you skipped this, say so in `LIMITS`.

## Model benchmarks

The runners in `evals/*/run-*.mjs` use a Claude account and cost real tokens. Ask before you run one. For review-loop changes, follow "Changing review-loop's SKILL.md or reviewer.md" in `CONTRIBUTING.md`.

## Formal model

For the review-loop model, follow `.claude/skills/check-loop-model/SKILL.md`. It holds the commands and the expected results. Do not copy them into other docs, where they would drift.
