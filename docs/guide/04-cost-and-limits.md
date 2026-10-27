# When not to use it, and what it costs

A review takes time and tokens. Some changes are worth it and some are not. Before you trust review-loop with more of your commits, it also helps to know which of its promises are checked by code and which are instructions Claude is asked to follow.

## When not to use it

Skip the review, or ask to skip it once, when a reviewer has nothing to judge:

- A color, a spacing value, or a copy change you checked by looking at it.
- A version bump, a lockfile update, or a generated file.
- A spike you will throw away.
- A change whose intent you cannot put in one line. The reviewer judges the change against that line, so first decide what you want.

To commit one of these without a review, ask for a skip. With the commit gate on, it lets one commit through ([page 3](03-commit-gate.md#skip-the-review-once) shows when the skip is used up):

```
/review-loop:review-loop commit this without a review, just this once.
```

Use it when a mistake would cost more than the review: logic with edge cases, money, data, permissions, error handling, and anything you will build on later.

## What a review costs

`claude plugin details` estimates the plugin's own cost (shortened to the version and cost lines, run on 2026-10-27 with Claude Code 2.1.311):

```
$ claude --plugin-dir plugins/review-loop plugin details review-loop
review-loop 0.10.0
...
Projected token cost
  Always-on:   ~275 tok   added to every session

Per-component (rounded)
  component    always-on  on-invoke
  review-loop       ~210        ~6k
  reviewer           ~60      ~1.8k
```

The README's cost table gives an earlier estimate of about 5,600 and 1,700 tokens. The numbers above are from 0.10.0.

The skill's on-invoke cost is paid once per review. The reviewer's is paid once per round, plus the diff and the code it reads. The detection benchmark measured that per reviewer run. Each run is one reviewer on one small change (12 to 39 diff lines in the regular set, 12 to 183 in the harder set), with Claude Code 2.1.310, from the files in [`evals/review-loop/results/`](../../evals/review-loop/results/):

| Reviewer model | Set | Date | Runs | Tokens per run, average (range) | Seconds per run, average | Cost per run | Results file |
|---|---|---|---|---|---|---|---|
| claude-opus-5-5 | regular | 2026-10-25 | 54 | 22,167 (16,962 to 31,428) | 16 | $0.042 | [opus, regular](../../evals/review-loop/results/2026-10-25-claude-opus-5-5-detection-3runs.json) |
| claude-opus-5-5 | harder | 2026-10-26 | 48 | 31,593 (18,509 to 51,445) | 21 | $0.065 | [opus, harder](../../evals/review-loop/results/2026-10-26-claude-opus-5-5-detection-hard-3runs.json) |
| claude-sonnet-5-5 | harder | 2026-10-26 | 48 | 24,541 (17,118 to 40,443) | 11 | $0.024 | [sonnet, harder](../../evals/review-loop/results/2026-10-26-claude-sonnet-5-5-detection-hard-3runs.json) |
| claude-haiku-5-5 | harder | 2026-10-26 | 48 | 26,447 (18,452 to 47,137) | 13 | $0.002, as reported by Claude Code | [haiku, harder](../../evals/review-loop/results/2026-10-26-claude-haiku-5-5-detection-hard-3runs.json) |

Most of those tokens are cache reads: on Opus, an average of about 19,000 per run in the regular set and 27,000 in the harder set. Cost per run is the file's total cost divided by its runs.

So a review of a small change on Opus is about 6,000 tokens for the skill plus about 22,000 to 32,000 per round, for one to three rounds. Not measured here: the tokens Claude spends fixing findings and writing regression tests, and any reviewer run on a large diff. Your checks run on your machine and cost no tokens, but they cost time: up to 5 minutes per check and 9 minutes in total, in every folder together, each time they run. In a change that touches several subfolder projects, each project's checks count toward the same 9 minutes, and at most 4 projects run per round ([page 6](06-other-languages.md)).

That is the price of a second reader that cannot see the first one's reasoning.

## A cheaper reviewer

The reviewer runs on your session's model unless you choose another one for the repository:

```
/review-loop:review-loop run the reviewer on sonnet in this repo.
```

Claude runs `loop reviewer`:

```
$ node "$LOOP" reviewer --model sonnet
{
  "model": "sonnet"
}
```

The setting is for the whole repository and applies from the next round the script hands out. `loop start` and `loop next` then return `"reviewerModel": "sonnet"`, Claude starts the reviewer on that model, and the report's first line names it. In `/tmp/slow`:

```
Review round 1 of 3 (reviewer: sonnet)
Checks: lint (npm run lint) passed, test (npm run test) passed

Trend (P1 + P2): 0
Stopped: no P1 or P2 left in this change
Left for you: P3 0, P4 0, P5 0
```

Which model to pick comes from the detection benchmark in the measured section of the [README](../../README.md), with 3 runs per case, on 2026-10-26 for the harder set:

| Reviewer model | Harder set: bugs found as P1 or P2 | Harder set: false P1 or P2 on clean changes | Cost of the harder set (48 runs) |
|---|---|---|---|
| claude-opus-5-5 | 30 of 30 | 0 of 18 | $3.11 |
| claude-sonnet-5-5 | 29 of 30 | 0 of 18 | $1.14 |
| claude-haiku-5-5 | 30 of 30 | 3 of 18 | $0.09, as reported by Claude Code |

On the regular set, Opus found 36 of 36 with no false P1 or P2 in 18 clean runs. The other models were not run on it, and `fable` was not measured. On the harder set, Sonnet missed one bug and drew no false P1 or P2, at about 37% of Opus's cost, so it is the cheaper choice when you want the reviewer on a different model than the one that wrote the change. Haiku costs the least and found every bug, but it drew a false P1 or P2 in 3 of 18 clean runs. A false P1 or P2 is not free either: Claude tries to fix it, or you have to decide about it.

To go back:

```
/review-loop:review-loop run the reviewer on the session's model.
```

## Limits

From the [plugin README](../../plugins/review-loop/README.md#limits-in-v01):

- Checks run at the repository root and in the subfolder projects the change touches, at most 4 per round. A check whose program is not installed is not verified, not failed. [Page 6](06-other-languages.md) shows both.
- Each check gets up to 5 minutes, and all checks together, in every folder, up to 9. `LIM_CHECK_TIMEOUT_MS` changes the first. [Pitfalls](05-pitfalls.md) shows a timeout.
- It reviews everything `git add -A` would include, not a hand-picked set of staged changes.
- The commit gate sees only commands Claude runs through its Bash tool. It reads git aliases, but not an alias set inline with `git -c`.
- A rule or regression test is checked in a temporary copy with your tracked files and the `node_modules` of the root and of the projects involved. Other ignored files are missing there, and in Go, Rust, and Python projects so are untracked build caches and virtual environments, so the proof can be slow or `unproven`.

## What code enforces, and what Claude is asked to do

[`loop.mjs`](../../plugins/review-loop/skills/review-loop/scripts/loop.mjs) and the [commit gate hook](../../plugins/review-loop/hooks/commit-gate.mjs) are code. [`SKILL.md`](../../plugins/review-loop/skills/review-loop/SKILL.md) and the [reviewer instructions](../../plugins/review-loop/agents/reviewer.md) are text a model reads.

| Enforced by code | Instructions to Claude or the reviewer |
|---|---|
| When the loop stops: no P1 or P2 left, the round limit, a finding still open after two fixes, a resolved finding that comes back, P1 + P2 that stops going down, a fix that weakens tests | Use a fresh reviewer each round, and never pass it Claude's reasoning |
| A P1 or P2 is fixed only with a quote that exists in the file or diff, a scenario, and a reason; a guessed one is never fixed | Fix only the listed findings, with the smallest change |
| The fixes between rounds are scanned for skipped or focused tests, `eslint-disable`, `@ts-ignore`, removed test cases, deleted test files, changed snapshots, and CI changes | Write a regression test from the scenario for each fixed P1 or P2 |
| `loop rule` decides `caught`, `missed`, or `unproven` by running your checks | Show the report before anything else, and ask about P3 to P5 once |
| A finding reproduced by a verify check stays open until that check passes on the fixed code | Run the verify check before fixing and again after the fix |
| Which checks run: what each folder declares, in a fixed order, at most 4 subfolder projects per round, and a missing program reported as not verified | Tell you before committing about a check that was not verified |
| "Make it a rule" becomes "fix this time only" when no check would run the rule | Label each fix measured or inferred, and check again before agreeing when you push back |
| With the gate on: no commit without a passing review, and a question before every push | Never push, and ask before committing when the gate is off |

Here is the test-weakening check stopping a loop in `/tmp/shop`. Round 1 asked for a fix of F-1, and the "fix" changed the code and skipped the test that covered it. The command prints JSON; this is its `report` field:

```
$ node "$LOOP" next
Review round 2 of 3
Checks: not run

Still open (P1 or P2):
- F-1 [P2] src/shipping.js:18 Express shipping becomes free from 50
  was: return subtotal >= FREE_SHIPPING_FROM ? 0 : 9.99;
  why: expressShippingFor(80) returns 0, but the intent says express always costs 9.99
  basis: inferred

Fixes that weakened tests or checks:
- test/express.test.js: test skipped or focused

Trend (P1 + P2): 1
Stopped: a fix weakened tests or checks
Left for you: P3 0, P4 0, P5 0, unproven P1/P2 1
```

The same round 1 review also had a P1 whose quote, `chargeCard(order.total + 9.99);`, is not in the code. It never reached "Fixing next". It waits for you as the `unproven P1/P2 1` at the end.

The scan covers fixes made between rounds. Fixes you choose in the decision step are not scanned again. With the gate on, they make it ask instead of allow. Running the checks on them with `loop checks` is an instruction to Claude.

> **Pitfall:** the script cannot tell who wrote the review JSON. This guide wrote its reviews by hand, and `loop record` accepted them. A fresh reviewer that never sees Claude's reasoning is an instruction in `SKILL.md`, not something the code checks.

Next: [Pitfalls](05-pitfalls.md).
