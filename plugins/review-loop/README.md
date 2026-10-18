# review-loop

Review before you commit. Checks run first, a fresh reviewer labels findings P1 to P5, P1 and P2 are fixed and re-reviewed, and the rest is your call. Loop, I am.

## Install

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

Needs Node.js 18 or later and git.

## Use

Ask Claude to review or commit your changes, or run `/review-loop`.

## How it works

1. Runs your project's typecheck, lint, and test scripts from `package.json`. A project without them is reviewed from the diff alone.
2. A fresh reviewer subagent reads the diff and labels findings P1 to P5. P1 and P2 need evidence: the exact line, a failure scenario, and why nothing already prevents it.
3. Claude says what it will fix, then fixes P1 and P2. If a fix needs a design choice (more than one fix, a visible behavior change, removing a feature, changing tests), you choose first.
4. A new reviewer checks only the fixes and the open findings. Up to 3 rounds.
5. A script, not the model, stops the loop: no P1 or P2 left, the round limit, a finding that survives two fixes, a resolved finding that comes back, P1 + P2 that stops decreasing, or a fix that weakens tests or checks.
6. You decide the rest once: keep as is, fix this time only, or make it a rule.
7. Claude asks before committing unless you chose "stop asking in this repo". It never pushes.

Every round ends with a report like this:

```
Review round 2 of 3
Checks: typecheck passed, lint passed, test passed

Resolved since last round:
- F-1 [P2] Coupon branch adds the item twice

Trend (P1 + P2): 2 -> 0
Stopped: no P1 or P2 left in this change
Left for you: P3 1, P4 0, P5 2
```

## Severity

Based on Banksalad's public Pn rule: P1 must fix, P2 should fix, P3 worth fixing, P4 optional, P5 trivial.

## Measured behavior

[`evals/review-loop/behaviors.csv`](../../evals/review-loop/behaviors.csv) lists 27 behaviors across do, tell, ask, silence, stop, and evidence. Unit tests in CI cover 25 of them. The other 2 (asking about P3 to P5 once, and asking before a commit) need a model run and are planned for `claude plugin eval`.

## Data

State, diffs, check logs, and a decision ledger are stored in `.git/lim/review-loop/` inside your repository. Nothing leaves your machine. Delete that folder to reset. Snapshots add blob objects to git's object store; `git gc` removes the unreferenced ones.

## Limits in v0.1

- Check detection reads `package.json` scripts only.
- Each check gets up to 5 minutes, and all checks together up to 9 minutes. A check past its limit is reported as "timed out (not verified)" instead of failing, and Claude tells you before committing. Set `LIM_CHECK_TIMEOUT_MS` to change the per-check limit.
- Asking before a commit is an instruction to Claude, not a hook. A hook-based commit gate is planned for v0.2.
- It reviews everything `git add -A` would include, not a hand-picked set of staged changes.
- "Make it a rule" is recorded but does not create a lint rule yet.
