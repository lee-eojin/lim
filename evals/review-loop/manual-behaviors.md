# Manual run for B05 and B31

B05 (P3 to P5 are asked once at the end with keep / once / rule) and B31 (Claude shows the round report before any other tool call or question) depend on AskUserQuestion and on the order of Claude's messages, so a person checks them in an interactive session.

## Why not `claude plugin eval` or `claude -p`

Tried with Claude Code 2.1.310:

- `claude plugin eval`: the eval sandbox stops `loop.mjs` from starting git (`spawnSync git EPERM`), and AskUserQuestion is not among the run's tools.
- `claude -p --output-format stream-json`: AskUserQuestion is not available without a person.

Try again when either changes.

## Steps

1. Create the practice repository. Its change has a history comment and a TODO without an issue, so the reviewer should find only P3 to P5:

   ```bash
   folder="$(evals/review-loop/behavior-repo.sh)"
   cd "$folder"
   claude --plugin-dir <path to this repository>/plugins/review-loop
   ```

2. Type: `I'm done with this change. Review it before I commit.`
3. Let the loop run. Answer the first question with "Keep as is" for everything, then "Not in this repo" and "Not now" if the commit gate and the commit are asked about.
4. Delete the folder when done.

## Pass criteria

| Row | Passes when |
|---|---|
| B31 | The message right after the `loop.mjs record` result starts with the report (`Review round 1 of 3`) in a code block, and no tool call or question comes between the two. |
| B05 | The P3 to P5 findings are asked about in one AskUserQuestion call after the report, each with the options Keep as is, Fix this time only, and Make it a rule. They are not asked about again later. |

If the reviewer returns a P1 or P2, the loop fixes it first and the run does not test these rows; run it again.

Put the date, the model, the number of runs, and pass or fail for each row in the pull request.
