# Deciding what is left

The loop stopped, and a P3 and a P4 are left. If you wave them through, the same comments come back in the next review. If you fix them by hand every time, you are the rule. This page shows the three choices and what each one does after you pick it.

## The question

Claude asks once, at the end, with every P3 to P5 and any P1 or P2 still open. For each one you pick:

| Choice | What happens |
|---|---|
| Keep as is | Nothing changes. A later review does not ask about it again until its quoted line changes. |
| Fix this time only | Claude fixes it. A P1 or P2 gets a regression test, proven like F-1 on the previous page. |
| Make it a rule | Claude fixes it and drafts a lint rule or a test that catches the same mistake, then proves the draft. |

You answer in the question Claude shows, or in plain words:

```
Make F-2 a rule. Keep F-3 as is.
```

Claude records each answer:

```
$ node "$LOOP" decide --id F-2 --choice rule
{
  "recorded": true,
  "id": "F-2",
  "choice": "rule",
  "pending": [
    "F-3"
  ]
}
$ node "$LOOP" decide --id F-3 --choice keep
{
  "recorded": true,
  "id": "F-3",
  "choice": "keep",
  "pending": []
}
```

`pending` lists what is still undecided. While it is not empty, the commit gate, if you turned it on, blocks the commit.

## Make it a rule

F-2 was a TODO comment without an issue link. The example project has a small linter that loads every file in `lint-rules/`, so Claude drafts a rule there, never in the file the finding is about, and changes the TODO to `// TODO(#12): express shipping`.

`loop rule` then writes the code from before the fix to a temporary folder, adds the draft, and runs your checks. The first draft only matched a TODO at the start of a line, and the TODO in `src/shipping.js` is indented (excerpt):

```
$ node "$LOOP" rule --id F-2 --draft lint-rules/todo-needs-issue.mjs
{
  "id": "F-2",
  "kind": "rule",
  "proof": "missed",
  "caughtBy": [],
  ...
}
```

`missed` means every check passed with the draft, so the rule would not have caught the mistake. Claude revises the draft once:

```js
export default {
  name: 'todo-needs-issue',
  check: (line) => (/\/\/\s*TODO(?!\(#\d+\))/.test(line) ? 'link the issue, for example // TODO(#12): ...' : null),
};
```

And runs it again (excerpt):

```
$ node "$LOOP" rule --id F-2 --draft lint-rules/todo-needs-issue.mjs
{
  "id": "F-2",
  "kind": "rule",
  "proof": "caught",
  "caughtBy": [
    "lint"
  ],
  "withDrafts": [
    {
      "name": "lint",
      "command": "npm run lint",
      "exitCode": 1,
      "timedOut": false,
      "tail": "\n> lint\n> node scripts/lint.mjs\n\nsrc/shipping.js:6 todo-needs-issue: link the issue, for example // TODO(#12): ...\n"
    },
    ...
  ],
  "withoutDrafts": [
    {
      "name": "lint",
      "command": "npm run lint",
      "exitCode": 0,
      ...
    }
  ]
}
```

`caught` means lint failed on the old code with the draft and passed without it. Claude reads the `tail` to confirm the failure is the rule's own message, not a syntax error in the draft. The third result, `unproven`, means a check timed out or also failed without the draft. [Pitfalls](05-pitfalls.md) shows one.

## Check the fixed code

Then `loop checks` runs the checks on the code as it is now (excerpt):

```
$ node "$LOOP" checks
{
  "checks": [ ... ],
  "passed": true,
  "notVerified": []
}
```

And `loop status` shows what the script saw done, which Claude compares with its todo list before it commits (excerpt):

```
$ node "$LOOP" status
{
  "review": {
    ...
    "pendingDecisions": [],
    "rules": [
      {
        "id": "F-2",
        "drafts": [
          "lint-rules/todo-needs-issue.mjs"
        ],
        "proof": "caught"
      }
    ],
    "notVerifiedChecks": [],
    "doneSteps": [
      "start",
      "review",
      "record",
      "fix",
      "re-review",
      "decide",
      "rules",
      "checks"
    ],
    ...
  },
  "treeMatchesReview": false,
  ...
}
```

`treeMatchesReview` is false because the F-2 fix and the rule came after the last review. The rule goes into the same commit as the fix.

## Keep as is

F-3 stayed. In the next change in `/tmp/shop`, the reviewer raised the same comment again. The report (the `report` field of `loop record`) counts it instead of asking:

```
Review round 1 of 3 (reviewer: session model)
Checks: lint passed, test passed

1 finding you kept before was raised again

Trend (P1 + P2): 0
Stopped: no P1 or P2 left in this change
Left for you: P3 0, P4 0, P5 0
```

A kept P1 or P2 is still listed by name with its severity, so a serious finding never disappears quietly.

> **Pitfall:** the gate trusts a rule draft only while its content matches what `loop rule` checked. If you edit the draft afterwards, run `loop rule` again, or the gate blocks the commit as a file nobody reviewed.

Next: [The commit gate and delegation](03-commit-gate.md).
