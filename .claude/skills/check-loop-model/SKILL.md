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

It needs Java 11 or later. It downloads `.tools/tla2tools.jar` (TLA+ tools v1.7.4, sha256 checked, ignored by git) when missing. Then it builds `DecideNextTable.tla` from the exported `decideNext` in `loop.mjs`, so an edit to `decideNext` reaches the check with no model change. It runs TLC once per invariant in `scripts/loop-model/ReviewLoop.cfg` in a temp folder and prints `PASS`, `FAIL` with a numbered list of loop commands, or `ERROR`. Exit 0 is all pass, 1 is a violation, 2 is a tool or modeling error. A full run takes about 130 s.

- `--invariant <name>` runs one invariant.
- `--loop <file>` takes `decideNext` from another copy of `loop.mjs`, for example `git show <commit>:plugins/review-loop/skills/review-loop/scripts/loop.mjs > /tmp/loop.mjs`.

## Expected result at the sync blob

| Invariant | Stop path it checks | Result |
| --- | --- | --- |
| `DecideNextStopHasProof` | `recordReview` stops clean or waiting through `decideNext` | PASS, 3079531 distinct states |
| `StopIfProvenStopHasProof` | `stopIfProven` stops after the final checks | PASS, 3079531 distinct states |
| `StopWaitingStopHasProof` | `makeUnattended` finishes the fix round through `finishFixing` and `decideNext` | PASS, 3079531 distinct states |
| `GateNeedsProof` | `reviewVerdict` after any stop | PASS, 3079531 distinct states |
| `KeptNeverReoffered` | keep settlement through `decide`, the `keptInLoop` move in `recordReview`, and the ledger keep check (reviewer `isKept` and failing-check fingerprint) in a later run | PASS, 3079531 distinct states |

`KeptNeverReoffered` (#249): once `decide` records `keep` on a finding, that finding is never pending again (open or deferred with no decision). `loop.everKept` is the sticky set. Sending `keptInLoop` through the retry path with its decision cleared makes it fail in 5 steps while the four proof invariants still pass.

Cross-run keeps (#267, #292): `ledger` models `ledger.jsonl` as the set of `<<slot, kind>>` pairs whose last `decision` event is `keep` (`keptSeverities`: the last choice wins). It outlives `StartNewRun`, which models `start` when the saved state is not in progress. A slot is one fingerprint, so a slot keeps its kind across runs. In a later run `NewFinding` moves a finding in the ledger to `kept` for both reviewer findings (`isKept`) and failing checks (fingerprint in `keptSeverities`). `Record` drops a `<<s, "check">>` pair from `ledger` when that slot is not among the new failing checks, matching a kept check that now passes (`passedCheckPrints` plus a non-keep `decision` event). The model may also drop the pair when a record simply does not introduce that slot. `AfterRecord` still reads the pre-record ledger, so a re-reported failing check stays kept. `KeptNeverReoffered` covers every slot in the ledger. Dropping the reviewer ledger check (Mutant B) makes it fail in 5 steps: start, record F-1, keep F-1, start a new run, record F-1 again. Dropping the check ledger arm (Mutant C: `kept /\ shape # "checkFix"` again) fails in 6 steps on a failing check keep across runs. The four proof invariants still pass on Mutant B (3496584 distinct states).

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

- 2 findings, `MaxRounds = 3`, rounds up to 4, up to 2 runs (`MaxRuns = 2`). These are the constants in `ReviewLoop.cfg`. The second run roughly doubled the distinct states from 1527245; with check ledger keeps the count is 3079531. With 3 findings TLC passed 27 million distinct states in 150 s without finishing.
- Every finding's file has a test check, as `needsProof` requires.
- At gate time HEAD, the working tree, and the staged tree match the review, and no skip-once is pending. The gate's "allow" and "ask" both count as letting the commit through.
- The model leaves out cards (P3 to P5, and P1 or P2 without evidence), because they never block a stop.
- The reviewer's resolved list, the final checks' outcome, and a rule draft's outcome (caught or missed) are free choices. A repeat of a resolved finding is one yes-or-no choice per record.
- Each command runs alone. Two processes writing `state.json` at once are out of scope.

## Not covered

`confirm`, `checks`, `reproduce`, `note`, `status`, `summary`, `gate`, `delegate`, and `reviewer` commands. `start --fresh`. In the ledger path, `isKept` always matches for reviewer findings: a re-report with higher severity, or a quote that now appears twice, is not modeled. Cards, so the closing-message offer from #248 is not checked. Re-deciding a kept finding as `once` or `rule`. A `Record` that does not re-introduce a ledger-kept check slot drops it even when the live loop would not have written a pass event for that slot. The report hook and `reportNotice`. The gate's command parser and its HEAD, tree, and staging checks. Report text. Liveness: the model does not check that the loop can always finish.

## Coverage record

- `plugins/review-loop/skills/review-loop/scripts/loop.mjs`: `decideNext` (generated table), `recordReview`, `next`, `stopIfProven`, `needsProof`, `hasRegressionProof`, `isBeingFixed`, `rule`, `recordNoTest`, `decide`, `start`, `isKept`, `keptSeverities`, `isInProgress`, `pendingDecisionIds`, `decidableFindings`, `setUnattended`, `makeUnattended`, `makeAttended`, `unattendedFixable`, `defer`, `reviewVerdict`, `UNFINISHED`.
- `scripts/loop-model/ReviewLoop.tla`, `scripts/loop-model/ReviewLoop.cfg`, `scripts/check-loop-model.mjs`, `tests/scripts/check-loop-model.test.mjs`.

Sync blob: `a4a30a1`. The model was last confirmed against this `loop.mjs` blob, the file as of commit `debcaa7`. A blob is the file's content, so it survives a squash merge that drops the branch commits. `recordReview` ends a ledger-kept check that now passes by writing a non-keep `decision` event. TLA `Record` drops a `<<s, "check">>` pair that the record does not re-introduce.

To see what changed in covered code since then, run `git diff a4a30a1 HEAD:plugins/review-loop/skills/review-loop/scripts/loop.mjs | grep '^@@'`. Git names the enclosing function in each hunk header. Move the sync blob forward only after you have read every changed covered function against its action and the check gives the expected result. Use `git rev-parse --short HEAD:plugins/review-loop/skills/review-loop/scripts/loop.mjs` for the new value, in the same pull request as the `loop.mjs` change. `node scripts/check-loop-model-sync.mjs` fails when a function in the coverage record changed after the sync blob.
