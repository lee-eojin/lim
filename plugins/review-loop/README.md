# review-loop

Review before you commit. Checks run first, a fresh reviewer labels findings P1 to P5, P1 and P2 are fixed and re-reviewed, and the rest is your call. Loop, I am.

## Install

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

Needs Node.js 18 or later and git.

## Use

Run `/review-loop:review-loop`. Asking Claude to review or commit your changes can also start it, but that depends on the model noticing, so the command is the reliable way.

If a session ends in the middle of a loop, running it again offers to continue where it stopped.

## How it works

1. Runs your project's typecheck, lint, and test scripts from `package.json`. A project without them is reviewed from the diff alone.
2. A fresh reviewer subagent reads the diff and labels findings P1 to P5. P1 and P2 need evidence: the exact line, a failure scenario, and why nothing already prevents it.
3. Claude says what it will fix, then fixes P1 and P2. If a fix needs a design choice (more than one fix, a visible behavior change, removing a feature, changing tests), you choose first. To see every P2 (or every P1 and P2) before anything changes, ask Claude to confirm them with you first.
4. A new reviewer checks only the fixes and the open findings. Up to 3 rounds.
5. A script, not the model, stops the loop: no P1 or P2 left, the round limit, a finding that survives two fixes, a resolved finding that comes back, P1 + P2 that stops decreasing, or a fix that weakens tests or checks.
6. You decide the rest once (P3 to P5, plus any P1 or P2 that is still open, could not be verified, or is about a file outside the reviewed diff): keep as is, fix this time only, or make it a rule.
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

## Commit gate

The commit gate is a hook that is off until you turn it on in a repository. At the end of a review, Claude asks once whether to turn it on. With the gate on, every `git commit` that Claude runs is checked first:

| Situation | What the gate does |
|---|---|
| No review, or files changed that the review did not cover | Blocks the commit and tells Claude to run the review |
| A review loop is in progress, or decisions are still pending | Blocks the commit |
| The review passed | Asks you before committing, or allows it if you delegated commits in this repository |
| Only reviewed files changed after the review (for example fixes from the decision step) | Asks you |
| `git push` or a force push | Always asks, even with delegation |
| A commit with `--no-verify` | Asks, even with delegation, and still blocks a commit without a passing review |
| A commit in a folder the gate cannot read, such as `cd "$(...)"` or a path that does not exist | Asks you, even with delegation, if the gate is on in the repository where you started Claude Code |

To commit once without a review, ask Claude to skip the review this time. The gate checks only commands that Claude runs through its Bash tool. Commits you type in your own terminal are not checked. The gate setting and commit delegation apply to the whole repository, including its linked worktrees. Each worktree keeps its own review.

## Severity

Based on Banksalad's public Pn rule: P1 must fix, P2 should fix, P3 worth fixing, P4 optional, P5 trivial. A P1 or P2 about a file that is not in the diff the round reviewed is not fixed in the loop. It comes to you at the end, marked as outside the reviewed diff, and keeps its severity.

## Measured behavior

[`evals/review-loop/behaviors.csv`](../../evals/review-loop/behaviors.csv) lists 78 behaviors across do, tell, ask, silence, stop, and evidence. Unit tests in CI cover 76 of them. The other 2 (asking about P3 to P5 once, and showing the report before any question) need a model run and are planned for `claude plugin eval`.

## Data

State, diffs, check logs, and a decision ledger are stored in `.git/lim/review-loop/` inside your repository. Delete that folder to reset. review-loop makes no network calls of its own; Claude and the reviewer read the diff, findings, and check output like any other file, so that content goes to the model provider like the rest of your session. Snapshots add blob objects to git's object store; `git gc` removes the unreferenced ones.

## Limits in v0.1

- Check detection reads `package.json` scripts only.
- Each check gets up to 5 minutes, and all checks together up to 9 minutes. A check past its limit is reported as "timed out (not verified)" instead of failing, and Claude tells you before committing. Set `LIM_CHECK_TIMEOUT_MS` to change the per-check limit.
- Without the commit gate, asking before a commit is an instruction to Claude, not a guarantee. Turn the gate on to make it a hook.
- The commit gate does not resolve git aliases. A commit made through an alias such as `git ci` is not checked.
- If you start Claude Code in a folder that is not a repository, the gate cannot check a commit whose repository it cannot tell, for example after `cd "$(...)"`.
- It reviews everything `git add -A` would include, not a hand-picked set of staged changes.
- "Make it a rule" is recorded but does not create a lint rule yet.
