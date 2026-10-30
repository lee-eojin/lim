---
name: check-loop-model
description: Model-check review-loop's stop decision and commit gate with TLA+ after any change to plugins/review-loop/skills/review-loop/scripts/loop.mjs that touches the loop's states, its stop rules, proof, deferral, unattended mode, decisions, or the commit gate verdict. Use it also when a change edits scripts/loop-model/ or scripts/check-loop-model.mjs.
---

# Check the review-loop model

**What it verifies.** In a project with a test check, the loop never stops clean or waiting, and the commit gate never lets a commit through, while a resolved P1 or P2 that is not from a failing check has neither a regression test nor a no-test reason.

**The harm.** A user commits a fix that review-loop reported as done when no test or recorded reason shows the bug stays fixed.

## Run it

```bash
node scripts/check-loop-model.mjs
```

It needs Java 11 or later. It downloads `.tools/tla2tools.jar` (TLA+ tools v1.7.4, sha256 checked, ignored by git) when missing. Then it builds `DecideNextTable.tla` from the exported `decideNext` in `loop.mjs`, so an edit to `decideNext` reaches the check with no model change. It runs TLC once per invariant in `scripts/loop-model/ReviewLoop.cfg` in a temp folder and prints `PASS`, `FAIL` with a numbered list of loop commands, or `ERROR`. Exit 0 is all pass, 1 is a violation, 2 is a tool or modeling error. A full run takes about 10 s.

- `--invariant <name>` runs one invariant.
- `--loop <file>` takes `decideNext` from another copy of `loop.mjs`, for example `git show <commit>:plugins/review-loop/skills/review-loop/scripts/loop.mjs > /tmp/loop.mjs`.

## Expected result at the sync commit

| Invariant | Stop path it checks | Result |
| --- | --- | --- |
| `DecideNextStopHasProof` | `recordReview` stops clean or waiting through `decideNext` | PASS, 657321 distinct states |
| `StopIfProvenStopHasProof` | `stopIfProven` stops after the final checks | PASS, 657321 distinct states |
| `StopWaitingStopHasProof` | `makeUnattended` finishes the fix round through `finishFixing` and `decideNext` | PASS, 657321 distinct states |
| `GateNeedsProof` | `reviewVerdict` after any stop | PASS, 657321 distinct states |

Two findings this check reported were fixed by #213 (issues #210 and #211), and the model's `MakeUnattended`, `BeingFixed`, and `GateAllows` actions were updated to match. Finding 1: an unattended resume that deferred the last open finding stopped as waiting with F-1 unproven; `tests/scripts/check-loop-model.trace.txt` is its 5-step counterexample from before the fix. Finding 2: after a stop with findings still open (`integrity`, `max-rounds`, `stalled`, `stuck`, `regression`), the gate asked "Commit now?" once every finding was decided, with F-1 unproven. Reverting either action's fix in the model makes its invariant fail again, which is how the check shows it can still fail on these paths.

Only `decideNext` is read from `loop.mjs`. The other actions are written by hand, so a change to `makeUnattended`, `isBeingFixed`, or `reviewVerdict` reaches the check only after its action is updated.

Any other result is new. When a known finding is fixed, its invariant passes. Update this table in the same pull request.

## Read a result

- `ERROR` is a modeling or tool problem, not a bug in the loop. Typical causes are a TLA+ parse error, a failed `ASSUME` (the cfg bounds and the generated table disagree), a violation of `RoundMatchesCounts`, or `decideNext` returning a shape other than `{ decision: 'stop' | 'continue', reason }`.
- `FAIL` lists one shortest sequence of commands. F-ids follow `assignIds`: failing checks first, then findings to fix, then findings that ask. To decide whether the failure is real, replay the steps on the real CLI in a temp repo, the way the `fixing` helper in `tests/review-loop/loop.test.mjs` does. Check the end state with `loop status` and `gateDecision`. If the CLI reaches the same state, the bug is real. Report it with the numbered steps and do not weaken the invariant. If a step throws or ends in a different state, the action modeling that command is wrong. Fix that action.

## Update the model when a change is intended

- A change to `decideNext` alone needs no model edit. If `decideNext` gains an input, add it to `decideNextModule` in `scripts/check-loop-model.mjs` and to the `DecideNext(...)` call in `AfterRecord`. If it gains a `continue` reason other than `fix` or `proof`, `AfterRecord` treats that reason as `fix`. Change `AfterRecord` if the new reason means something else.
- For any other function, edit the action or operator whose comment names it. Keep one action per CLI command, because each command saves the state once.
- If the property changes on purpose, change the invariant in `ReviewLoop.tla` and the table above, and say so in the pull request.
- After an edit, show the check failing on a broken copy of the code you changed, then passing on the real code. Run `node --test tests/scripts/check-loop-model.test.mjs`. It skips the TLC run when Java or the jar is missing.

## Bounds and assumptions

- 2 findings, `MaxRounds = 3`, rounds up to 4. These are the constants in `ReviewLoop.cfg`. With 3 findings TLC passed 27 million distinct states in 150 s without finishing.
- Every finding's file has a test check, as `needsProof` requires.
- At gate time HEAD, the working tree, and the staged tree match the review, and no skip-once is pending. The gate's "allow" and "ask" both count as letting the commit through.
- The model leaves out cards (P3 to P5, and P1 or P2 without evidence), because they never block a stop.
- The reviewer's resolved list, the final checks' outcome, and a rule draft's outcome (caught or missed) are free choices. A repeat of a resolved finding is one yes-or-no choice per record.
- Each command runs alone. Two processes writing `state.json` at once are out of scope.

## Not covered

`confirm`, `checks`, `reproduce`, `note`, `status`, `summary`, `gate`, `delegate`, and `reviewer` commands. `start --fresh` and a new run after a finished one. Decisions on kept findings. The gate's command parser and its HEAD, tree, and staging checks. Report text. Liveness: the model does not check that the loop can always finish.

## Coverage record

- `plugins/review-loop/skills/review-loop/scripts/loop.mjs`: `decideNext` (generated table), `recordReview`, `next`, `stopIfProven`, `needsProof`, `hasRegressionProof`, `isBeingFixed`, `rule`, `recordNoTest`, `decide`, `start`, `isInProgress`, `pendingDecisionIds`, `decidableFindings`, `setUnattended`, `makeUnattended`, `makeAttended`, `stopWaiting`, `unattendedFixable`, `defer`, `reviewVerdict`, `UNFINISHED`.
- `scripts/loop-model/ReviewLoop.tla`, `scripts/loop-model/ReviewLoop.cfg`, `scripts/check-loop-model.mjs`, `tests/scripts/check-loop-model.test.mjs`.

Sync commit: `ff6611b`. The model was last confirmed against `loop.mjs` at this commit.

To see what changed in covered code since then, run `git diff ff6611b -- plugins/review-loop/skills/review-loop/scripts/loop.mjs | grep '^@@'`. Git names the enclosing function in each hunk header. Move the sync commit forward only after you have read every changed covered function against its action and the check gives the expected result. Use `git rev-parse --short refs/remotes/origin/main` for the new value.
