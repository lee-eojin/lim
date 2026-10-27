# Pitfalls

Most surprises with review-loop come from the same few places. Each one below was reproduced in a small repository under `/tmp`.

## A check that times out is not a pass

Each check gets 5 minutes, and all checks together, in every folder, get 9. A check that runs longer is stopped and marked "not verified". It does not become a finding, so the loop can stop clean with a test that never finished. Here the per-check limit was set to 1 second, and the test takes 3:

```
$ LIM_CHECK_TIMEOUT_MS=1000 node "$LOOP" start
{
  ...
  "checks": [
    { "name": "lint", "command": "npm run lint", "exitCode": 0, "timedOut": false, ... },
    { "name": "test", "command": "npm run test", "exitCode": null, "timedOut": true, ... }
  ]
}
```

The report after the review (the `report` field of `loop record`):

```
Review round 1 of 3 (reviewer: session model)
Checks: lint (npm run lint) passed, test (npm run test) timed out (not verified)

Trend (P1 + P2): 0
Stopped: no P1 or P2 left in this change
Left for you: P3 0, P4 0, P5 0
```

Before the commit, `loop status` returns `"notVerifiedChecks": ["test"]`, and Claude asks whether to run it. Running `loop checks` without the short limit showed the test passing, and `"notVerified": []`. If your tests are slow, raise the limit with `LIM_CHECK_TIMEOUT_MS` (in milliseconds) where Claude Code runs, or give review-loop a faster `test` script. The 9-minute total is fixed.

Claude Code passes the variable to the checks only if it was set when Claude Code started, so set it before you start the session. Then, when Claude asks before the commit whether to run the check that timed out, answer:

```
Yes, run the checks that timed out again before we commit.
```

A timeout inside `loop rule` makes the proof `unproven`, for the same reason.

## Monorepos: a project the change does not touch is not checked

review-loop runs the checks of the repository root and of each subfolder project the change touches ([page 6](06-other-languages.md)). A project that only uses the changed code is not one of them. In `/tmp/mono`, `packages/web` imports `limit` from `packages/api`, and the change lowers the limit from 100 to 50 and updates the api test to match. The root `package.json` has workspaces but no scripts:

```
$ node "$LOOP" start
{
  ...
  "checks": [
    { "name": "test", "folder": "packages/api", "command": "npm run test", "exitCode": 0, "timedOut": false, ... }
  ]
}
```

The report says `Checks: packages/api: test (npm run test) passed`. The web test that expects 100 rows never ran.

Add a root script that runs every workspace, for example `"test": "npm run test --workspaces --if-present"`. The review you already have ran without it, so ask for a new one:

```
/review-loop:review-loop start the review over.
```

Claude runs `loop start`, and `loop start --fresh` if the old loop is still in progress. The root test now runs next to the api project's own test, and catches the break before any reviewer reads the diff (start of the report):

```
Review round 1 of 3 (reviewer: session model)
Checks: test (npm run test) failed, packages/api: test (npm run test) passed

Fixing next:
- F-1 [P1] npm run test test fails
  was: npm run test
  why: exit code 1: r: npm error code 1 npm error path /tmp/mono/packages/web npm error workspace web npm error location /tmp/mono/packages/web npm error command failed npm error command sh -c node --test
  basis: measured
```

The api test now runs twice, once from the root and once in its folder. That costs time, not correctness.

## Ignored files are missing in the rule's temporary copy

`loop rule` writes the code from before the fix to a temporary folder from git's view of the tree. Files that git ignores are not there. Only the `node_modules` folders of the root and of the projects that hold the finding and the drafts are linked in. In `/tmp/settings` the tests read `.env.test`, which `.gitignore` lists. Claude wrote a regression test for F-1, a default of 20 that hides a missing `PAGE_SIZE`, and the test check in the copy fails with or without it (excerpt):

```
$ node "$LOOP" rule --id F-1 --draft test/page-size-missing.test.js
{
  "id": "F-1",
  "kind": "regression",
  "proof": "unproven",
  "caughtBy": [],
  "withDrafts": [
    { "name": "test", "command": "npm run test", "exitCode": 1, "timedOut": false, ... }
  ],
  "withoutDrafts": [
    { "name": "test", "command": "npm run test", "exitCode": 1, "timedOut": false, ... }
  ]
}
```

The full log, in `.git/lim/review-loop/rule.baseline.log`, names the cause: `Error: ENOENT: no such file or directory, open '.env.test'`. Make tests create what they need, or commit a test fixture instead of reading an ignored file.

A draft in an ignored path is refused, because it would not be committed with the fix:

```
$ node "$LOOP" rule --id F-1 --draft test/local.test.js
{"error":"test/local.test.js is ignored by git, so it would not be committed with the rule"}
```

## The commit gate does not see your terminal or inline aliases

The gate is a hook on Claude's Bash tool. A commit you type in your own terminal never reaches it. That is on purpose: it gates Claude, not you.

It reads the git aliases in the repository. With `git config alias.ci commit`, `git config alias.save '!git add -A && git commit -m save'`, and a change nobody reviewed, the gate denied `git ci -am wip` with the same reason as `git commit -am wip`, and asked about the shell alias, because it cannot see inside it:

```
$ echo '{"tool_name":"Bash","tool_input":{"command":"git ci -am wip"},"cwd":"/tmp/shop"}' | node "$HOOK"
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"review-loop: HEAD moved after the last review started (for example the review was already committed, or you pulled or switched branches), so these changes have not been reviewed. Run /review-loop:review-loop before committing, or ask to skip the review once."}}
$ echo '{"tool_name":"Bash","tool_input":{"command":"git save"},"cwd":"/tmp/shop"}' | node "$HOOK"
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"review-loop: git save is a shell alias that runs git commit, so the commit gate cannot check it. Confirm before Claude runs it."}}
```

An alias set inline is not read. The same commit through `git -c alias.c2=commit c2` printed nothing:

```
$ echo '{"tool_name":"Bash","tool_input":{"command":"git -c alias.c2=commit c2 -am wip"},"cwd":"/tmp/shop"}' | node "$HOOK"
$
```

No answer means the gate has no opinion, and Claude Code's normal permission rules decide. The same goes for a script or npm script that commits for you. If Claude commits that way in your repository, tell it to use `git commit`:

```
Commit with git add -A and git commit, not the npm script, so the commit gate sees it.
```

## The `.lim-review/` folder

Claude writes each review to `.lim-review/round-<n>.json` and records it with `loop record --file`. `loop start` and `loop next` add the folder to `.git/info/exclude`:

```
$ tail -1 .git/info/exclude
.lim-review/
```

After a successful record, the file is deleted, and the folder too when it is empty. If the JSON is not valid, the file stays so Claude can fix it:

```
$ node "$LOOP" record --file .lim-review/round-1.json
{"error":"reviewer output is not JSON: Unexpected token 'H', \"Here is th\"... is not valid JSON"}
$ ls .lim-review
round-1.json
```

Two things follow. Writing the file uses Claude's file-write permission, so a run with `claude -p` needs `acceptEdits` or an allow rule for Write. And a tool that ignores git's exclude file, such as a file watcher or a linter that scans every file, can see the folder for a moment. It never ends up in the review or the commit.

If the JSON is still not valid after Claude asks the reviewer once to fix the format, Claude stops and reports it. To try again with a new review of the same change:

```
/review-loop:review-loop start the review over.
```

> **Pitfall:** deleting `.git/lim/review-loop/` resets everything for the repository: the review, the decisions, the gate, and delegation. To redo only the review, ask Claude to start it over as above; that runs `loop start --fresh` and keeps the gate and delegation settings.

Next: [Checks in other languages and subfolders](06-other-languages.md).
