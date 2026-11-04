# Manual run for B05

B05 (P3 to P5 are asked once at the end with keep / once / rule) depends on AskUserQuestion and on what Claude says after it, so it is checked in an interactive session. B31 used to be checked here too; a hook now shows each report, and `tests/review-loop/show-report.test.mjs` covers it.

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
| B05 | The P3 to P5 findings are asked about in one AskUserQuestion call, each with the options Keep as is, Fix this time only, and Make it a rule. They are not asked about again later, in a question or in the closing message. |

If the reviewer returns a P1 or P2, the loop fixes it first and the run does not test this row; run it again.

Put the date, the model, the number of runs, and pass or fail for each row in the pull request.
