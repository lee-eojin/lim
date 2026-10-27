# The commit gate and delegation

The skill tells Claude to ask before every commit. That is an instruction, and a long session can drift away from instructions. The commit gate turns "no commit without a review" into a hook: code that runs before every Bash command Claude runs and answers allow, ask, or deny. This page shows its answers in the `/tmp/shop` example.

## Turn it on

At the end of your first review, Claude asks once whether to turn the gate on for the repository. Or ask for it in plain words. A request for a setting starts review-loop without starting a review:

```
/review-loop:review-loop turn on the commit gate in this repo.
```

```
$ node "$LOOP" gate --on
{
  "enabled": true,
  "configured": true,
  "skipOnce": false
}
```

The setting is for the whole repository, linked worktrees included. Until you turn it on, the hook does nothing in that repository.

## What it answered

Claude Code sends the hook the command Claude is about to run. You can send it the same input yourself. With `HOOK` pointing at `hooks/commit-gate.mjs` in the plugin:

```
$ echo '{"tool_name":"Bash","tool_input":{"command":"git add -A && git commit -m wip"},"cwd":"/tmp/shop"}' | node "$HOOK"
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"review-loop: reviewed files or checked rule drafts changed after the last review, for example fixes and rules chosen in the decision step. Commit them without another review?"}}
```

That was right after page 2: the F-2 fix and its proven rule changed after the review, so the gate asks you instead of blocking. Every answer below came from the same kind of call in `/tmp/shop`, as the example moved on: the F-2 change was committed, the next change added a shipping label, and its review passed with nothing left open.

| Situation | Command Claude runs | Answer | Reason the hook gives (shortened) |
|---|---|---|---|
| A file appeared after the review | `git add -A && git commit -m wip` | deny | `src/scratch.js changed after the last review and were not reviewed.` |
| The last review was committed, and a new change was not reviewed | `git add -A && git commit -m wip` | deny | `HEAD moved after the last review started (...), so these changes have not been reviewed.` |
| The review has started but not finished | `git add -A && git commit -m wip` | deny | `a review loop is in progress (round 1, waiting for review).` |
| The review passed, commits not delegated | `git add -A && git commit -m wip` | ask | `the review passed with no open P1 or P2. Commit now?` |
| The review passed, commits delegated | `git add -A && git commit -m "feat: shipping label"` | allow | `the review passed and commits are delegated in this repository.` |
| Delegated, but the commit skips hooks | `git commit --no-verify -m wip` | ask | `The commit also skips git hooks with --no-verify. Confirm before Claude runs it.` |
| Delegated, but the command does more | `npm test && git commit -m wip` | ask | `The command also runs other commands, so review-loop does not approve it on its own.` |
| Any push | `git push origin main` | ask | `pushing publishes commits. review-loop asks before every push.` |

A deny reason names the next step (`Run /review-loop:review-loop before committing, or ask to skip the review once.`), so Claude knows what to do instead of retrying.

## Delegate commits

Once you trust the loop in a repository, you can stop being asked:

```
/review-loop:review-loop stop asking before commits in this repo.
```

```
$ node "$LOOP" delegate --scope repo
{
  "scope": "repo",
  "grantedAt": "2026-10-27T05:55:42.037Z"
}
```

Delegation only turns the last "ask" into "allow" when the review passed and nothing changed since. A missing review is still denied, and a push, `--no-verify`, or a compound command still asks. To take it back:

```
/review-loop:review-loop turn off commit delegation.
```

## Skip the review once

For a commit that really does not need a review:

```
/review-loop:review-loop commit this without a review, just this once.
```

```
$ node "$LOOP" gate --skip-once
{
  "enabled": true,
  "configured": true,
  "skipOnce": true
}
```

The gate allowed the next commit (`review skipped once at your request.`), because commits were delegated. Asked about the same commit again before it ran, it allowed it again: the skip lasts until a commit lands. Once that commit was made, the next change was denied (`HEAD moved after the last review started (...)`), and resetting the branch to the commit before did not bring the skip back.

Without delegation, the gate asks instead (`review skipped once at your request. Commit without a review?`). If you answer no, nothing is committed and the skip stays. In `/tmp/shop`, after `loop delegate --scope off` and with a new file the review had not seen, the same commit was asked about twice, and `loop gate` still returned `"skipOnce": true` after the second question. A chained command that fails before it reaches `git commit` also keeps the skip for the next try. [Issue #61](https://github.com/lee-eojin/lim/issues/61) tracked the change to this behavior.

> **Pitfall:** the gate reads the commands Claude's Bash tool runs, nothing else. A commit you type in your own terminal never reaches it. A git alias such as `git ci` is checked like `git commit`, but an alias set inline with `git -c` is not. [Pitfalls](05-pitfalls.md) shows both.

**If you remember one thing:** the gate is code, so "Claude will ask before committing" stops depending on Claude remembering to.

Next: [When not to use it, and what it costs](04-cost-and-limits.md).
