# End-to-end sessions

Unit tests and benchmarks prove the scripts. These runs prove the skills: each one is a whole headless Claude Code session that should follow a skill from the first request to the last report, and the runner checks what the session actually did.

```bash
node evals/e2e/run-sessions.mjs                          # all four scenarios, one session each
node evals/e2e/run-sessions.mjs --scenario failing-check --keep
```

It uses your Claude account. One pass over all four scenarios costs about $1.50 with `claude-opus-5-5`.

## How a run works

For each scenario the runner copies a fixture from `fixtures/` into a temporary folder, commits it, and copies the uncommitted change over it. Then it runs `claude -p` there with `--plugin-dir` for review-loop, verify, and clear-explain, `--setting-sources ''`, `--strict-mcp-config`, `--no-session-persistence`, a spending limit, a time limit, and `--permission-mode dontAsk` with this allow list: Skill, Agent, Read, Grep, Glob, Write, Edit, TodoWrite, and Bash only for `node <plugin>/scripts/loop.mjs`, `verify.mjs`, and `check-clarity.mjs`. Anything else is denied and listed in the results.

After the session it checks expectations against three kinds of evidence:

- the main session's tool calls in order, with script commands named by their arguments (`loop record --file ...`, `verify run --id ...`); calls made inside a subagent are kept apart
- the scripts' saved state: `.git/lim/review-loop/ledger.jsonl` and `state.json`, and verify's runs in `.git/lim/verify/runs/`
- the files the session changed and the commit count

Each expectation in the results file has `pass` and the evidence for it. `--keep` keeps the repository and writes the raw stream next to it as `<folder>.stream.jsonl`. The expectation checks are pure functions of the stream and the saved state; `tests/evals/run-sessions.test.mjs` tests them on recorded streams without a model.

## Scenarios

| Scenario | Repository and change | Prompt | What it proves when it passes |
|---|---|---|---|
| `review-with-verify` | A cents formatter CLI with a `verify.features.json` map and a passing `npm test`. The change adds `--symbol` and drops the zero padding, so `cents 5` prints `$0.5` and the map's `two-decimal-places` check fails. | An unattended review before committing | review-loop starts unattended, the reviewer names the map check, the finding is reproduced with `verify run --id` and `loop reproduce`, fixed, proven with a regression test, rerun with verify, re-reviewed, resolved as measured, and summarized, with no question and no commit |
| `failing-check` | A slug library whose change drops the trailing hyphen trim, so `npm test` fails | An unattended review before committing | The failing test becomes a P1 from checks, gets fixed without weakening the test, and other fixed P1 or P2 findings get a regression test or a no-test reason |
| `verify-tool` | The cents CLI without a map; the change adds `--symbol` correctly | "Can you check that this tool's features actually work?" | verify reads the README and its format reference, writes a map that covers the README, runs it, and shows the report first without touching the code |
| `explain-korean` | Any repository | A Korean question about closures | clear-explain starts, and the answer is Korean, has no U+2014 or U+00B7, and keeps closure in English |

## Results (2026-10-27, `claude-opus-5-5`, Claude Code 2.1.311)

Two sessions per scenario. Costs are Claude Code's list-price estimate (`total_cost_usd`).

| Scenario | Run 1 | Run 2 | Cost per session |
|---|---|---|---|
| `review-with-verify` | 6/12 | 5/12 | $0.45, $0.56 |
| `failing-check` | 10/11 | 8/11 | $0.61, $0.63 |
| `verify-tool` | 8/8 | 8/8 | $0.26, $0.26 |
| `explain-korean` | 4/5 | 5/5 | $0.12, $0.13 |

Files: `results/2026-10-27-run1-*.json` and `results/2026-10-27-run2-*.json`, renamed from the runner's default names (`<date>-<model>-<label>.json`) to keep the two runs apart. All runs together, with one smoke run and one probe session, cost $3.27.

After the fixes in #114 (unattended reviews fix findings and carry deferred ones), one more session of each review scenario, in `results/2026-10-27-claude-opus-5-5-fix-114-final.json`:

| Scenario | Before #114 (runs 1 and 2) | After #114 | Cost |
|---|---|---|---|
| `review-with-verify` | 6/12, 5/12 | 11/12 | $0.73 |
| `failing-check` | 10/11, 8/11 | 11/11 | $0.64 |

In `review-with-verify` the session now reproduced the finding with verify, fixed it, proved it with a regression test that caught the bug on the old code, reran the verify check (pass), and the second review resolved it as measured. The one miss is a tool call before the round report. The `resolved-measured` check in that file was corrected after the run: it had read a `reproduced.status` field the script never writes.

Six more `review-with-verify` sessions measured #123, in `results/2026-10-27-claude-opus-5-5-report-123*.json`, scored without the round-report check (11 expectations). The first three ran with the skill that only lets unattended runs skip round reports; the last three also had the rule to run each `loop` and verify command alone. The files cannot tell the two groups apart (same commit and uncommitted file list; the runner now also records each uncommitted plugin file's hash), so the grouping comes from the order they were started in.

| Skill text | Sessions | Scores | Cost |
|---|---|---|---|
| Round reports optional when unattended | `report-123`, `-a`, `-b` | 6/11, 11/11, 10/11 | $0.65, $0.57, $0.64 |
| Plus: each command alone in its own Bash call | `-c`, `-d`, `-e` | 11/11, 11/11, 11/11 | $0.71, $0.69, $0.62 |

In `report-123` the session appended `; echo "exit=$?"` to the verify command, the permission rule refused it, and nothing was reproduced. In `-b` a task update ran between `loop summary` and its report. In `-c` a `loop note` whose text had `$0.5` in double quotes was refused and retried; the skill now says to keep `$` out of free text.

### What the sessions showed

- **verify works end to end.** Both sessions read the README and `references/feature-map.md`, wrote a map of 7 or 8 checks that covers two decimals, `--symbol`, and both documented errors, ran it, showed the report first, and left the code alone.
- **An unattended review fixes nothing the reviewer flags.** In all four review sessions the reviewer set `touchesTests`, `multipleFixes`, or `behaviorChange` on every P1 and P2 it found, so `loop record` routed them to `ask`, and unattended mode defers `ask`. In `review-with-verify` the P1 was reproduced (`two-decimal-places` failed, `$0.5`) and still left unfixed, so the fix, regression test, rerun, and second review never happened. The session followed the skill; the skill and the reviewer's flags together make the expected flow unreachable.
- **A checks finding and the reviewer's finding on the same line split.** In `failing-check` the failing test is F-1 (fix list) and the reviewer's P1 on the same line is F-2 (deferred for `behaviorChange`). Run 1 fixed F-1, which also fixed F-2, but F-2 stayed "waiting for you" because deferred findings are not sent to the round 2 reviewer. Run 2 refused to fix F-1 because the fix would decide F-2, ran `loop next` with no change, and the script then deferred F-1 with "the first fix did not resolve it".
- **The record report is not shown first.** In 4 of 4 review sessions the next step after `loop record` was a tool call (a verify skill call, a task update, or a read of the diff) before the report. `loop summary`'s report was shown first in 3 of 4. These are unattended runs, where nobody reads a round report as it comes, so the skill now says an unattended run need not show each one, and the scenario no longer checks it; the results above were scored with that check (12 for `review-with-verify`), and the summary is still checked.
- **clear-explain mirrors the user's word.** When the question says 클로저, the answer wrote 클로저 in 2 of 3 sessions (one was a smoke run), against the skill's "do not transliterate". With closure in the question, one probe session wrote closure 7 times and 클로저 never.

Three more sessions of each review scenario on review-loop 0.11.2 (commit `d0c0e38`), in `results/2026-10-27-claude-opus-5-5-sample-1.json` to `-3.json`, then three `failing-check` sessions with the fix from #134, in `results/2026-10-27-claude-opus-5-5-fix-134-1.json` to `-3.json`:

| Scenario | Skill | Scores | Cost |
|---|---|---|---|
| `review-with-verify` | 0.11.2 | 11/11, 11/11, 11/11 | $0.59, $0.59, $0.68 |
| `failing-check` | 0.11.2 | 11/11, 10/11, 9/11 | $0.54, $0.53, $0.48 |
| `failing-check` | with #134 | 11/11, 11/11, 10/11 | $0.51, $0.49, $0.46 |

On 0.11.2, two `failing-check` sessions missed `regression-or-reason`: the reviewer deferred a P1 (`behaviorChange`) that was the same bug as the failing test, the fix resolved it, and `loop rule` refused it because it was not in `open`, so it ended with neither a regression test nor a no-test reason. With #134 all three sessions gave it one. The other misses, one in each group, are `second-review-clean`: the reviewer also marked the `maxLength` finding `behaviorChange`, so the unattended run correctly left it waiting for you and stopped as `waiting`, not `clean`. That depends on the reviewer's call, not on the skill.

After the audit fixes (#143 to #161), three more sessions of each review scenario on review-loop 0.11.6 (commit `045da63`), in `results/2026-10-28-claude-opus-5-5-v0116-1.json` to `-3.json`:

| Scenario | Scores | Cost |
|---|---|---|
| `review-with-verify` | 11/11, 11/11, 11/11 | $0.69, $0.60, $0.59 |
| `failing-check` | 11/11, 11/11, 11/11 | $0.61, $0.54, $0.62 |

No session regressed. In all three `failing-check` sessions the reviewer deferred nothing, so the `second-review-clean` miss seen earlier, which came from a second finding marked `behaviorChange`, did not come up; these runs do not show that miss is gone. Each session gave both other fixed findings a regression test.

Three more sessions of each review scenario on review-loop 0.11.8 and verify 0.6.0 (commit `d02f136`), after the fixes from an outside review (#176 to #181), in `results/2026-10-28-claude-opus-5-5-v0118-1.json` to `-3.json`:

| Scenario | Scores | Cost |
|---|---|---|
| `review-with-verify` | 11/11, 11/11, 11/11 | $0.70, $0.69, $0.63 |
| `failing-check` | 10/11, 11/11, 11/11 | $0.53, $0.64, $0.65 |

The miss is `regression-or-reason` again: the reviewer deferred F-2 (`behaviorChange`), the fix for F-1 and F-3 also resolved it, and the session's own `loop note` said so, but it gave F-2 neither a regression test nor a no-test reason. Since #134 the loop accepts one and SKILL.md asks for it, so this is the session skipping a step, not the loop refusing it; it happened in 1 of the 6 `failing-check` sessions run since #134.

Three more sessions of each review scenario on review-loop 0.11.9 (commit `87fc591`), which holds the stop in a `proof` state until every resolved P1 or P2 has a regression test or a no-test reason (#184), in `results/2026-10-29-claude-opus-5-5-v0119-1.json` to `-3.json`:

| Scenario | Scores | Cost |
|---|---|---|
| `review-with-verify` | 11/11, 11/11, 11/11 | $0.71, $0.60, $0.73 |
| `failing-check` | 9/11, 10/11, 11/11 | $0.56, $0.49, $0.54 |

The `regression-or-reason` miss came back in run 1, and it shows a gap in #184 rather than a skipped step. The fix for F-1 also resolved the deferred P1 F-2, and F-3 (P2) stayed waiting for the user. Round 2 then stopped as `waiting`, because the loop checks for waiting findings before it checks for unproven ones, so it never asked for F-2's proof. The same session also misses `second-review-clean` for that `waiting` stop. #198 holds the proof state in this case too. In run 2 a task update ran between `loop summary` and its report.

### Harness limits

- Claude Code runs read-only shell commands such as `git diff` and `cat` even under `dontAsk` with an allow list that does not name them, so sessions could read the diff with Bash. A chained command such as `L=...; node $L checks; node $L status` was denied.
- Steps that need a person to answer AskUserQuestion (B05, B31) are out of scope; the review scenarios ask for unattended runs so that no question is needed.
