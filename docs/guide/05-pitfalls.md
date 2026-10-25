# Pitfalls

Most surprises with review-loop come from the same few places. Each one below was reproduced in a small repository under `/tmp`.

## A check that times out is not a pass

Each check gets 5 minutes, and all checks together get 9. A check that runs longer is stopped and marked "not verified". It does not become a finding, so the loop can stop clean with a test that never finished. Here the per-check limit was set to 1 second, and the test takes 3:

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
Checks: lint passed, test timed out (not verified)

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

## Monorepos: only the root package.json counts

review-loop reads the `typecheck`, `lint`, and `test` scripts from the `package.json` at the repository root, wherever you start it. In this workspace the root has no scripts, and `packages/api` has a test that the change breaks:

```
$ cd packages/api && node "$LOOP" start
{
  "status": "review",
  "round": 1,
  "maxRounds": 3,
  "unattended": false,
  "reviewerModel": "inherit",
  "diffPath": "/private/tmp/mono/.git/lim/review-loop/round-1.diff",
  "reviewPath": "/private/tmp/mono/.lim-review/round-1.json",
  "checks": []
}
```

The report says `Checks: none detected, reviewing the diff only`. Without checks, "make it a rule" has nothing to run the rule:

```
$ node "$LOOP" decide --id F-1 --choice rule
{
  "recorded": true,
  "id": "F-1",
  "choice": "once",
  "pending": [],
  "ruleSkipped": "package.json has no typecheck, lint, or test script, so nothing would run a rule"
}
```

Add root scripts that run the workspaces, for example `"test": "npm run test --workspaces --if-present"`. The review you already have ran without checks, so ask for a new one:

```
/review-loop:review-loop start the review over.
```

Claude runs `loop start`, and `loop start --fresh` if the old loop is still in progress. The next review ran the package's test and caught the break before any reviewer read the diff (start of the report):

```
Review round 1 of 3 (reviewer: session model)
Checks: test failed

Fixing next:
- F-1 [P1] npm run test test fails
  was: npm run test
  why: exit code 1: r: npm error code 1 npm error path /private/tmp/mono/packages/api npm error workspace api npm error location /private/tmp/mono/packages/api npm error command failed npm error command sh -c node --test
  basis: measured
```

The runner follows the lockfile at the root: `pnpm-lock.yaml` runs `pnpm`, `yarn.lock` runs `yarn`, `bun.lock` or `bun.lockb` runs `bun`, and anything else runs `npm`.

## Ignored files are missing in the rule's temporary copy

`loop rule` writes the code from before the fix to a temporary folder from git's view of the tree. Files that git ignores are not there. Only the root `node_modules` is linked in. In `/tmp/settings` the test reads `.env.test`, which `.gitignore` lists, so every check in the copy fails, with or without the draft (excerpt):

```
$ node "$LOOP" rule --id F-1 --draft test/page-size-missing.test.js
{
  "id": "F-1",
  "kind": "rule",
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

The full log, in `.git/lim/review-loop/rule.baseline.log`, names the cause: `Error: ENOENT: no such file or directory, open '.env.test'`. Make tests create what they need, or commit a test fixture instead of reading an ignored file. A nested `node_modules`, such as one inside a workspace package, is missing the same way.

A draft in an ignored path is refused, because it would not be committed with the fix:

```
$ node "$LOOP" rule --id F-1 --draft test/local.test.js
{"error":"test/local.test.js is ignored by git, so it would not be committed with the rule"}
```

## The commit gate does not see your terminal or your git aliases

The gate is a hook on Claude's Bash tool. A commit you type in your own terminal never reaches it. That is on purpose: it gates Claude, not you.

It also only recognizes `git commit` and `git push` by name. With `git config alias.ci commit` and an unreviewed change, the gate denied `git commit -am wip`, and printed nothing for the alias:

```
$ echo '{"tool_name":"Bash","tool_input":{"command":"git ci -am wip"},"cwd":"/tmp/shop"}' | node "$HOOK"
$
```

No answer means the gate has no opinion, and Claude Code's normal permission rules decide. The same goes for a script or npm script that commits for you. If Claude commits through an alias or a script in your repository, tell it to use `git commit`:

```
Commit with git add -A and git commit, not the ci alias, so the commit gate sees it.
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

That is the guide. Run one review on a change you care about, and read the report before anything else.

Back to the [guide index](README.md).
