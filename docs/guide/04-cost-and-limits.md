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

`claude plugin details` estimates the plugin's own cost (shortened to the version and cost lines, run on 2026-10-25 with Claude Code 2.1.310):

```
$ claude --plugin-dir plugins/review-loop plugin details review-loop
review-loop 0.4.0
...
Projected token cost
  Always-on:   ~212 tok   added to every session

Per-component (rounded)
  component    always-on  on-invoke
  review-loop       ~140      ~5.6k
  reviewer           ~70      ~1.7k
```

The skill's on-invoke cost is paid once per review. The reviewer's is paid once per round, plus the diff and the code it reads. The detection benchmark measured that per reviewer run. Each run is one reviewer on one small change (12 to 39 diff lines in the regular set, 20 to 183 in the harder set), all on 2026-10-25 with Claude Code 2.1.310, from the files in [`evals/review-loop/results/`](../../evals/review-loop/results/):

| Reviewer model | Set | Runs | Tokens per run, average (range) | Seconds per run, average | Cost per run | Results file |
|---|---|---|---|---|---|---|
| claude-opus-5-5 | regular | 54 | 22,167 (16,962 to 31,428) | 16 | $0.042 | [opus, regular](../../evals/review-loop/results/2026-10-25-claude-opus-5-5-detection-3runs.json) |
| claude-opus-5-5 | harder | 30 | 27,929 (18,351 to 38,785) | 20 | $0.059 | [opus, harder](../../evals/review-loop/results/2026-10-25-claude-opus-5-5-detection-hard-3runs.json) |
| claude-sonnet-5-5 | harder | 30 | 22,971 (17,556 to 34,009) | 11 | $0.025 | [sonnet, harder](../../evals/review-loop/results/2026-10-25-claude-sonnet-5-5-detection-hard-3runs.json) |
| claude-haiku-5-5 | harder | 30 | 25,597 (18,415 to 50,825) | 13 | $0.002, as reported by Claude Code | [haiku, harder](../../evals/review-loop/results/2026-10-25-claude-haiku-5-5-detection-hard-3runs.json) |

Most of those tokens are cache reads: on Opus, an average of about 19,000 per run in the regular set and 23,000 in the harder set. Cost per run is the file's total cost divided by its runs.

So a review of a small change on Opus is about 5,600 tokens for the skill plus about 22,000 to 28,000 per round, for one to three rounds. Not measured here: the tokens Claude spends fixing findings and writing regression tests, and any reviewer run on a large diff. Your checks run on your machine and cost no tokens, but they cost time: up to 5 minutes per check and 9 minutes in total, each time they run.

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
Checks: lint passed, test passed

Trend (P1 + P2): 0
Stopped: no P1 or P2 left in this change
Left for you: P3 0, P4 0, P5 0
```

Which model to pick comes from the detection benchmark in the measured section of the [README](../../README.md), with 3 runs per case on 2026-10-25:

| Reviewer model | Harder set: bugs found as P1 or P2 | Harder set: false P1 or P2 on clean changes | Cost of the harder set (30 runs) |
|---|---|---|---|
| claude-opus-5-5 | 18 of 18 | 0 of 12 | $1.77 |
| claude-sonnet-5-5 | 18 of 18 | 1 of 12 | $0.76 |
| claude-haiku-5-5 | 17 of 18 | 3 of 12 | $0.06, as reported by Claude Code |

On the regular set, Opus found 36 of 36 with no false P1 or P2 in 18 clean runs. The other models were not run on it, and `fable` was not measured. On the harder set, Sonnet found every seeded bug at about 43% of Opus's cost, with a false P1 or P2 in 1 of 12 clean runs, so it is the cheaper choice when you want the reviewer on a different model than the one that wrote the change. Haiku costs the least, but it missed a bug and drew a false P1 or P2 in 3 of 12 clean runs. A false P1 or P2 is not free either: Claude tries to fix it, or you have to decide about it.

To go back:

```
/review-loop:review-loop run the reviewer on the session's model.
```

## What code enforces, and what Claude is asked to do

[`loop.mjs`](../../plugins/review-loop/skills/review-loop/scripts/loop.mjs) and the [commit gate hook](../../plugins/review-loop/hooks/commit-gate.mjs) are code. [`SKILL.md`](../../plugins/review-loop/skills/review-loop/SKILL.md) and the [reviewer instructions](../../plugins/review-loop/agents/reviewer.md) are text a model reads.

| Enforced by code | Instructions to Claude or the reviewer |
|---|---|
| When the loop stops: no P1 or P2 left, the round limit, a finding still open after two fixes, a resolved finding that comes back, P1 + P2 that stops going down, a fix that weakens tests | Use a fresh reviewer each round, and never pass it Claude's reasoning |
| A P1 or P2 is fixed only with a quote that exists in the file or diff, a scenario, and a reason; a guessed one is never fixed | Fix only the listed findings, with the smallest change |
| The fixes between rounds are scanned for skipped or focused tests, `eslint-disable`, `@ts-ignore`, removed test cases, deleted test files, changed snapshots, and CI changes | Write a regression test from the scenario for each fixed P1 or P2 |
| `loop rule` decides `caught`, `missed`, or `unproven` by running your checks | Show the report before anything else, and ask about P3 to P5 once |
| "Make it a rule" becomes "fix this time only" when no check would run the rule | Label each fix measured or inferred, and check again before agreeing when you push back |
| With the gate on: no commit without a passing review, and a question before every push | Never push, and ask before committing when the gate is off |

Here is the test-weakening check stopping a loop in `/tmp/shop`. Round 1 asked for a fix of F-1, and the "fix" changed the code and skipped the test that covered it. The command prints JSON; this is its `report` field:

```
$ node "$LOOP" next
Review round 2 of 3
Checks: not run

Still open (P1 or P2):
- F-1 [P2] src/shipping.js:15 Express shipping becomes free from 50
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
