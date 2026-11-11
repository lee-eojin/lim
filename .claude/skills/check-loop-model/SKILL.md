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

It needs Java 11 or later. It downloads `.tools/tla2tools.jar` (TLA+ tools v1.7.4, sha256 checked, ignored by git) when missing. Then it builds `DecideNextTable.tla` from the exported `decideNext` in `loop.mjs`, so an edit to `decideNext` reaches the check with no model change. It runs TLC once per invariant in `scripts/loop-model/ReviewLoop.cfg` in a temp folder and prints `PASS`, `FAIL` with a numbered list of loop commands, or `ERROR`. Exit 0 is all pass, 1 is a violation, 2 is a tool or modeling error. A full run takes about 160 s.

- `--invariant <name>` runs one invariant.
- `--loop <file>` takes `decideNext` from another copy of `loop.mjs`, for example `git show <commit>:plugins/review-loop/skills/review-loop/scripts/loop.mjs > /tmp/loop.mjs`.

## Expected result at the sync blob

| Invariant | Stop path it checks | Result |
| --- | --- | --- |
| `DecideNextStopHasProof` | `recordReview` stops clean or waiting through `decideNext` | PASS, 4080248 distinct states |
| `StopIfProvenStopHasProof` | `stopIfProven` stops after the final checks | PASS, 4080248 distinct states |
| `StopWaitingStopHasProof` | `makeUnattended` finishes the fix round through `finishFixing` and `decideNext` | PASS, 4080248 distinct states |
| `GateNeedsProof` | `reviewVerdict` after any stop | PASS, 4080248 distinct states |
| `KeptNeverReoffered` | keep settlement through `decide` (also on a kept finding that has an id), the `keptInLoop` move in `recordReview`, and the ledger keep check (reviewer `isKept`, which can also not match, and failing-check fingerprint) in a later run | PASS, 4080248 distinct states |

`KeptNeverReoffered` (#249): once `decide` records `keep` on a finding, that finding is never pending again (open or deferred with no decision). `loop.everKept` is the sticky set. Sending `keptInLoop` through the retry path with its decision cleared makes it fail in 5 steps while the four proof invariants still pass.

Cross-run keeps (#267, #292, #293): `ledger` models `ledger.jsonl` as the set of `<<slot, kind>>` pairs whose last `decision` event is `keep` (`keptSeverities`: the last choice wins). It outlives `StartNewRun`, which models `start` when the saved state is not in progress. A slot is one fingerprint, so a slot keeps its kind across runs. In a later run `NewFinding` moves a finding in the ledger to `kept` for both reviewer findings (`isKept`) and failing checks (fingerprint in `keptSeverities`). `Record` drops a `<<s, "check">>` pair from `ledger` when that slot is not among the new failing checks, matching a kept check that now passes (`passedCheckPrints` plus a non-keep `decision` event). The model may also drop the pair when a record simply does not introduce that slot. The final checks do the same (#376): when `StopIfProven` acts, `StartResume`, `NextCommand`, and `RuleCommand` drop any subset of the `<<s, "check">>` pairs (`LedgerAfterFinalChecks`), whether the loop then stops, goes back to fix, or blames a draft, matching `endKeepsThatPassed` in `stopIfProven`. The finding itself does not change in this run, because `stopIfProven` leaves `state.kept` alone, and a later run offers it again. In the model only `RuleCommand` reaches this, because a proof state always has an unproven finding. Mutant G (the ended keep also reopens the finding with no decision) fails `KeptNeverReoffered` in 6 steps: start unattended, record a failing check F-1 and F-2, next, record F-2 resolved, keep F-1, rule F-2 with a draft that the final checks blame. Mutant H (the drop also takes reviewer pairs) passes all five (5251816 distinct states). `AfterRecord` still reads the pre-record ledger, so a re-reported failing check stays kept. `isKept` can also not match a reviewer keep (#293): the re-report has a higher severity, its quote appears twice or more in the file, the quote is empty, or the file is missing. `Record` picks those findings as a free choice (`missed`) and reports them as new findings. Their pairs stay in `ledger`, because the last `decision` event is still `keep`, and `loop.notKept` holds them until `decide` settles them or a new run starts. A failing check has no such case. `KeptNeverReoffered` covers every check slot in the ledger and every reviewer slot in the ledger outside `loop.notKept`. The in-run clause (`loop.everKept`) is unchanged, so a finding offered again this way and then decided `keep` is covered again. Dropping the reviewer ledger check (Mutant B) makes it fail in 5 steps: start, record F-1, keep F-1, start a new run, record F-1 again. Dropping the check ledger arm (Mutant C: `kept /\ shape # "checkFix"` again) fails in 6 steps on a failing check keep across runs. The four proof invariants still pass on Mutant B (4549387 distinct states). With the clause from before #293 (every reviewer slot in the ledger) it fails in 5 steps on a re-report that `isKept` does not match, which shows the model reaches that case; the real CLI offers that finding again the same way. Letting `missed` also take a kept failing check (Mutant D) fails in 6 steps.

Re-deciding a kept finding (#294): `decidableFindings` also returns the kept findings that have an id. Those are the findings `recordReview` moved to `kept` in this run (`keptInLoop`). A finding kept from the ledger has no id, so `decide` and `rule` cannot name it. `Decidable` tells the two apart by `route # "none"`: `assignIds` gives every finding in the model its id and its route in one step, and `NewFinding` leaves the route of a ledger-kept finding at `none`. `decide` on a kept finding changes only its decision and the ledger. `once` or `rule` removes the `<<slot, kind>>` pair, `keep` adds it again, and the finding stays `kept`, because `recordReview` never moves a kept finding back to open. `KeptNeverReoffered` is unchanged and still passes: the finding stays in `loop.everKept` and is never pending in this run, and a later run offers it again once the pair has left the ledger, or, for a reviewer finding whose pair is still in the ledger, when `isKept` does not match it (`missed`, above). `BeingFixed` is unchanged: `decision = "once"` already counts wherever the finding is, as in `isBeingFixed`, so `rule --draft` and `rule --no-test` work on a kept reviewer finding decided `once`. That proof sits on a finding that is not resolved, so no stop rule and no gate rule reads it. Mutant E (`once` or `rule` on a kept finding moves it to open with no decision) fails `KeptNeverReoffered` in 6 steps. Mutant F (`AfterRecord` reports a kept finding as new once its decision is not `keep`) fails it in 8 steps. Each failure shows only that the model reaches the path. No invariant reads the id guard: when `Decidable` takes every kept finding, the five invariants still pass with 4216616 distinct states.

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

- 2 findings, `MaxRounds = 3`, rounds up to 4, up to 2 runs (`MaxRuns = 2`). These are the constants in `ReviewLoop.cfg`. The second run roughly doubled the distinct states from 1527245; with check ledger keeps the count is 3079531; with `isKept` misses it is 3477482; with decisions on kept findings it is 4073588; with keeps that the final checks end it is 4080248. With 3 findings TLC passed 27 million distinct states in 150 s without finishing.
- Every finding's file has a test check, as `needsProof` requires.
- At gate time HEAD, the working tree, and the staged tree match the review, and no skip-once is pending. The gate's "allow" and "ask" both count as letting the commit through.
- The model leaves out cards (P3 to P5, and P1 or P2 without evidence), because they never block a stop.
- The reviewer's resolved list, the final checks' outcome, a rule draft's outcome (caught or missed), and whether `isKept` matches a reviewer keep in the ledger are free choices. A repeat of a resolved finding is one yes-or-no choice per record.
- Each command runs alone. Two processes writing `state.json` at once are out of scope.

## Not covered

`confirm`, `checks`, `reproduce`, `note`, `status`, `summary`, `gate`, `delegate`, and `reviewer` commands. `start --fresh`. The model does not tell apart why `isKept` does not match (higher severity, a quote that appears twice or more, an empty quote, a missing file), and it does not model the severity that a new `keep` writes to the ledger. With `MaxRuns = 2` a finding that `isKept` did not match is never seen in a third run. Cards, so the closing-message offer from #248 is not checked. A `Record` that does not re-introduce a ledger-kept check slot drops it even when the live loop would not have written a pass event for that slot. A kept failing check with an id that passes in a later record while the ledger still records its keep: `recordReview` removes it from `state.kept`, but the model leaves the slot kept, so the model's `decide` can still name it. `loop checks` ends a kept check that passes the same way, in any state, and no action models it. No invariant reads why a pair left `ledger`: an action that also drops a reviewer pair passes all five (Mutant H). The report hook and `reportNotice`. The gate's command parser and its HEAD, tree, and staging checks. Report text. Liveness: the model does not check that the loop can always finish.

## Coverage record

- `plugins/review-loop/skills/review-loop/scripts/loop.mjs`: `decideNext` (generated table), `recordReview`, `next`, `stopIfProven`, `needsProof`, `hasRegressionProof`, `isBeingFixed`, `rule`, `recordNoTest`, `decide`, `start`, `isKept`, `keptSeverities`, `isInProgress`, `pendingDecisionIds`, `decidableFindings`, `setUnattended`, `makeUnattended`, `makeAttended`, `unattendedFixable`, `defer`, `reviewVerdict`, `UNFINISHED`.
- `scripts/loop-model/ReviewLoop.tla`, `scripts/loop-model/ReviewLoop.cfg`, `scripts/check-loop-model.mjs`, `tests/scripts/check-loop-model.test.mjs`.

Sync blob: `51ba383`. The model was last confirmed against this `loop.mjs` blob, the file after the renames and small helper extracts outside covered functions that carry the removed comment intent. Covered code is unchanged since the change that ends a kept check once `loop checks` or the final checks see it pass. A blob is the file's content, so it survives a squash merge that drops the branch commits. `recordReview` ends a ledger-kept check that now passes by writing a non-keep `decision` event. `stopIfProven` and `loop checks` do the same for a kept check that passes in their checks. TLA `Record` drops a `<<s, "check">>` pair that the record does not re-introduce, and the actions that call `StopIfProven` drop any such pair when it acts; `loop checks` is not modeled.

To see what changed in covered code since then, run `git diff 51ba383 HEAD:plugins/review-loop/skills/review-loop/scripts/loop.mjs | grep '^@@'`. Git names the enclosing function in each hunk header. Move the sync blob forward only after you have read every changed covered function against its action and the check gives the expected result. Use `git rev-parse --short HEAD:plugins/review-loop/skills/review-loop/scripts/loop.mjs` for the new value, in the same pull request as the `loop.mjs` change. `node scripts/check-loop-model-sync.mjs` fails when a function in the coverage record changed after the sync blob.
