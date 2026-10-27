# Your first review

Claude finished a change and says it works. Tests pass. But the tests were written by the same context that wrote the code, so they test what it thought the code should do. This page runs one review on a small change and reads the report.

## Install

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

You need Claude Code, git, and Node.js 18 or later. The [README](../../README.md) has the details.

## Run it on a change

Pick a real change that is not committed yet. Say in one line what you wanted, because the reviewer judges the change against that line:

```
/review-loop:review-loop I made orders of 50 or more ship free. Check it before I commit.
```

In the example, `/tmp/shop` has a `shippingFor(subtotal)` function, and the uncommitted change adds a free shipping threshold of 50. The tests cover a subtotal of 20 and one of 80.

## What `loop start` does

Claude first runs `loop start`. It snapshots everything `git add -A` would commit, writes the diff for the reviewer, and runs the `typecheck`, `lint`, and `test` checks your project declares. In `/tmp/shop` those are the `lint` and `test` scripts in `package.json`. [Checks in other languages and subfolders](06-other-languages.md) shows the rest. Output from `/tmp/shop`, with the `tail` of each check shortened:

```
$ node "$LOOP" start
{
  "status": "review",
  "round": 1,
  "maxRounds": 3,
  "unattended": false,
  "reviewerModel": "inherit",
  "diffPath": "/tmp/shop/.git/lim/review-loop/round-1.diff",
  "reviewPath": "/tmp/shop/.lim-review/round-1.json",
  "checks": [
    { "name": "lint", "command": "npm run lint", "exitCode": 0, "timedOut": false, ... },
    { "name": "test", "command": "npm run test", "exitCode": 0, "timedOut": false, ... }
  ]
}
```

Both checks pass. A failing check would already be a P1 finding here, before any reviewer reads the code.

If the repository has a verify feature map, `start` also returns `featureMapPath`, and the reviewer gets it too. [Reproducing a finding with verify](07-reproduce-with-verify.md) shows that case.

Then Claude starts the reviewer agent with `diffPath` and your one line, and nothing else. `SKILL.md` tells it never to pass its own reasoning about the change.

## Read the report

The reviewer returns JSON. Claude writes it to `reviewPath` and runs `loop record --file`. For this example the review was written by hand: one P2 about the threshold, one P3 about a TODO comment, and one P4 about a comment that records history. The script turns it into the report Claude must show before anything else:

```
$ node "$LOOP" record --file .lim-review/round-1.json
Review round 1 of 3 (reviewer: session model)
Checks: lint (npm run lint) passed, test (npm run test) passed

Fixing next:
- F-1 [P2] src/shipping.js:7 An order of exactly 50 still pays shipping
  was: if (subtotal > FREE_SHIPPING_FROM) return 0;
  why: shippingFor(50) returns 4.99, but the intent is free shipping from 50
  basis: inferred

Trend (P1 + P2): 1
Next: fix, then re-review in round 2 of 3
```

(The command prints JSON. The text above is its `report` field.)

How to read it:

- **Checks** names each check with the command it ran, so you can run the same command yourself.
- **Fixing next** is the list Claude may fix in this round. Only P1 and P2 with evidence get here, and only when the fix needs no design choice from you: a quoted line that really is in the file or diff, a failure scenario, and a reason nothing prevents it. The script checks that the quote exists.
- **basis** says how the reviewer knows: `measured` (a search or check showed it), `inferred` (it read the code), or `guessed`. A guessed P1 or P2 is never fixed in the loop.
- **Trend** counts open P1 and P2 per round. If it stops going down, the script stops the loop.
- The P3 and P4 are not listed yet. They wait for the end, so they do not slow the loop down.

## The fix and its proof

Claude says what it will fix, changes `>` to `>=`, and writes a regression test from the scenario in a new test file. Then it proves the test with `loop rule`, which runs your checks on the code from before the fix, in a temporary folder, with and without the test (excerpt):

```
$ node "$LOOP" rule --id F-1 --draft test/shipping-boundary.test.js
{
  "id": "F-1",
  "kind": "regression",
  "proof": "caught",
  "caughtBy": [
    "test"
  ],
  ...
}
```

The `tail` of the failing run shows the test's own assertion, `4.99 !== 0`, so the test fails for the reason the scenario gives. Without the test, the old code passes.

## Round 2

`loop next` reruns the checks on the fixed code and writes a diff of only the fixes. A new reviewer checks that diff and the open finding. Its JSON here says `"resolved": ["F-1"]` and nothing new:

```
$ node "$LOOP" record --file .lim-review/round-2.json
Review round 2 of 3 (reviewer: session model)
Checks: lint (npm run lint) passed, test (npm run test) passed

Resolved since last round:
- F-1 [P2] An order of exactly 50 still pays shipping (fixed, inferred: the re-review read the fix)
  test: test/shipping-boundary.test.js (before the fix: caught, after: passed)

Trend (P1 + P2): 1 -> 0
Stopped: no P1 or P2 left in this change
Left for you: P3 1, P4 1, P5 0, rule candidates 1
```

The script decided to stop, not Claude. "Left for you" is what the next page is about.

> **Pitfall:** review-loop reviews everything `git add -A` would commit, untracked files included. A scratch file or a log you left in the working tree gets reviewed, and at the end it gets committed. Delete it or add it to `.gitignore` before you start.

**If you remember one thing:** the report comes from the script, so "Stopped" and "Fixing next" mean the same thing every time.

Next: [Deciding what is left](02-deciding.md).
