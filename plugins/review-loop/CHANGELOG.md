# Changelog

All notable changes to review-loop. Versions follow [Semantic Versioning](https://semver.org); see "Releases" in [CONTRIBUTING.md](../../CONTRIBUTING.md) for what each number means here.

## 0.9.0 (2026-10-26)

- Added: Gradle and Maven projects run their test task (`./gradlew test` or `./mvnw -B -q test` with the wrapper, otherwise `gradle` or `mvn`), at the root or in a subfolder project, after the project's own scripts and Makefile targets. A Maven module or Gradle subproject runs no build of its own, a wrapper without the executable bit runs through `sh`, and a missing Java is not verified. (#91)

## 0.8.0 (2026-10-26)

- Added: A change in a subfolder project, such as `web/package.json` or `services/api/go.mod`, runs that project's checks in its folder, up to 4 projects per round, and the report names the folder of each check and the projects left out. (#88)

## 0.7.1 (2026-10-26)

- Fixed: With the commit gate on, a commit or push made through a git alias such as `git ci` is checked like `git commit` or `git push`, and a shell alias that commits is asked about before it runs. Before, an alias went around the gate. (#80)

## 0.7.0 (2026-10-26)

- Added: Checks are detected in Go, Rust, Python, and Makefile projects, not only from `package.json` scripts: Makefile `typecheck`, `lint`, and `test` targets, `go vet` and `go test` for `go.mod`, `cargo check` and `cargo test` for `Cargo.toml`, and pytest, ruff, and mypy when the project configures them (through `uv run --frozen --no-sync` with `uv.lock`). The report names each check's command, and a check whose program is not installed is reported as not verified instead of failing. (#77)

## 0.6.1 (2026-10-26)

- Fixed: Asking in plain words to turn the commit gate on or off, stop asking before commits, skip the review once, pick the reviewer's model, see what an unattended review did, and similar settings now starts review-loop. On requests written after the new description, it started for 8 of 8 such requests, where the previous description started for 1. (#74)

## 0.6.0 (2026-10-26)

- Added: With a verify feature map (`verify.features.json`) in the repository, `loop start` and `loop next` return its path, the round report names it with its number of entries, and the reviewer can name the map entry a P1 or P2 breaks in `check`. (#32)
- Added: `loop reproduce --id <id>` reads verify's saved run of that check on the reviewed code. A failed check marks the finding reproduced, the strongest evidence it can have, so a guessed P1 or P2 is no longer unverified; a passed check marks it not reproduced. The report and the cards show it, and reproduced findings come first within each severity. (#32)
- Added: After fixing a reproduced finding, Claude runs its verify check again. `loop next` records that run, and the finding stays open until the check passes on the fixed code, even if the re-review resolves it. (#32)

## 0.5.0 (2026-10-25)

- Added: An unattended mode for runs nobody is watching, such as overnight. Ask for an unattended run, or turn it on for the repository with `loop unattended --on`. Claude then asks nothing: findings that need your call are not fixed and wait for you with the reason, P3 to P5 stay pending, each choice Claude makes is written to the decision ledger with `loop note`, commits follow the delegation and gate rules, and nothing is pushed. `loop summary` lists what happened since the run started and everything waiting for you. (#40)
- Fixed: Claude writes each review to a file under `.lim-review/` and records it with `loop record --file`, so Claude Code's permission check no longer refuses the step as a heredoc with JSON. The file write needs the same file-edit permission as Claude's fixes, so a headless run needs `acceptEdits` or an allow rule for Write. `loop start` and `loop next` add `.lim-review/` to `.git/info/exclude` once, so git ignores the file, and review-loop deletes it after reading it. (#55)
- Added: The reviewer can run on a different model than your session, so a review is less likely to share the author's blind spots. Ask Claude to change it, or run `loop reviewer --model opus|sonnet|haiku|fable` (`inherit`, the session's model, is the default). The round report's first line names the reviewer model, and the decision ledger records it for each round. On the harder benchmark set Sonnet found every seeded bug at about 43% of Opus's cost but drew 1 false P1 or P2 in 12 clean runs, and Haiku missed one bug and drew 3. (#39)
- Fixed: A one-time review skip now lasts until a commit lands. Declining the commit prompt, or a chained command that fails before `git commit`, keeps the skip, so the next attempt still skips the review instead of being blocked. A second commit in the same command is still checked as usual. (#61)
- Changed: Asking Claude to turn the commit gate on or off, or to stop asking before commits in a repository, now runs that setting directly instead of starting a review first. (#41)

## 0.4.0 (2026-10-25)

- Added: "Make it a rule" now drafts a lint rule or a test next to the fix. `loop rule` runs your checks on the code from before the fix, with and without the draft, and reports `caught`, `missed`, or `unproven`. The reviewer can mark findings as rule candidates. Without a typecheck, lint, or test script, the choice is recorded as "fix this time only". (#28)
- Added: The reviewer reports code that agents add when they do not know the cause: guards for states nothing shows can happen, comments about history or instructions to agents, TODO or "for now" comments without an issue link, and a second way to do a job the codebase already does. It judges whether the change achieves your stated intent, not whether the intent is right. (#36)
- Added: Claude puts every review-loop step in its todo list when a loop starts, and a step that does not apply stays in the list as `skip: <reason>` instead of being dropped quietly. `loop status` returns `doneSteps`, the steps the script saw done, so Claude can compare the list before committing. (#35)
- Added: A finding you chose to keep as is is not asked about again in a later review. The report says how many kept findings were raised again and still lists a kept P1 or P2 with its severity. Once the quoted line changes, the finding is asked about again, as it is when it comes back at a higher severity or when its quoted line now appears more than once in the file. Failing checks are never skipped this way. (#30)
- Added: When Claude fixes a P1 or P2 that has a failure scenario and your project has a test script, it writes a regression test from the scenario. `loop rule` shows the test fails on the code from before the fix, the round's checks show it passes after, and the report lists each fixed P1 or P2 with its test and proof, or why it has none (no test script, or a reason Claude records with `--no-test`). (#37)
- Added: Each finding says how it is known: measured (a search or check output shows it), inferred (read from the code), or guessed. The report shows the basis next to each finding and says whether a resolved finding's fix was measured by a check that no longer fails or inferred from the re-review. A P1 or P2 that is guessed is shown as unverified and is not fixed. Claude says how it knows a fix works, and checks a finding again before agreeing when you push back. (#34)
- Added: When a new finding is of one of the reviewer's named kinds (such as `speculative-guard`) that earlier reviews in this repository raised 3 times or more, its card says so with the count, and Claude recommends "Make it a rule" at the strongest layer that fits: a type or architecture change, then a lint rule, then a test, never a rules-file line. A repeated P1 or P2 that the loop fixed keeps its mark in the report. Reviews in every worktree of the repository count, and removing a worktree keeps them. `loop status` lists the most repeated kinds and the repeats fixed in the current review. Counting starts with reviews recorded by this version. (#33)

## 0.3.0 (2026-10-23)

- Fixed: Snapshots start from a copy of git's index, so files that did not change are not hashed or run through clean filters such as Git LFS again. On a 3,000-file repository, five `loop status` runs took 325 ms instead of 1,232 ms. The real index is never written. Files marked assume-unchanged or skip-worktree stay out of the snapshot, as they would with `git add -A`. (#7)
- Added: The test-weakening check also stops the loop when a fix removes running test cases from a test file, adds `skip`, `only`, `skipIf`, `runIf`, `todo`, or `fails` anywhere in a test call chain, or disables a lint rule at the end of a code line. Line checks now apply only to JavaScript and TypeScript files, and strings such as test fixtures still do not trigger them. (#6)
- Added: You can ask Claude to confirm every P2, or every P1 and P2, before anything is fixed. The setting is per repository (`loop confirm --severity P2|all`, `--off` to turn it off). (#4)
- Fixed: The README now says that a P1 or P2 about a file outside the reviewed diff is not fixed in the loop. It comes to you at the end, marked as outside the reviewed diff, with its severity kept. (#15)

## 0.2.1 (2026-10-19)

- Fixed: With the commit gate on and commits delegated, a commit message from a quoted heredoc (`-m "$(cat <<'EOF' ... EOF)"`) or backticks inside single quotes no longer make the gate ask. A heredoc body that contains `)` still asks, because macOS `/bin/bash` 3.2 can end the substitution there. Option values such as `-unormal` are no longer read as skipping git hooks. (#17)
- Fixed: The commit gate expands `~` and `$HOME` in `cd` and `git -C`. When it cannot tell which repository a commit runs in, for example after `cd "$(...)"` or with a path that does not exist, it asks instead of letting the commit through, if the gate is on in the current folder's repository or in the one where Claude Code started. Commits through `--git-dir`, `--work-tree`, or `GIT_DIR` are asked about too, and a `cd` in a command with parentheses is checked in every folder the commit may run in, and asks when those folders belong to more than one repository. The gate setting and commit delegation now apply to linked worktrees too, including a gate turned on inside a worktree with 0.2.0 while the main checkout has no gate setting of its own. Each worktree keeps its own review and its own one-time skip, and turning the gate off cancels a pending skip everywhere. (#17)

## 0.2.0 (2026-10-19)

- Added: An opt-in commit gate. After you turn it on in a repository, Claude's commits are blocked until a review passes, asked about when it passes, and allowed without asking only if commits are delegated. Push, force push, and `--no-verify` always ask. You can skip the review once when you need to. (#5)
- Fixed: The README no longer says that nothing leaves your machine. review-loop makes no network calls of its own, but the diff, findings, and check output go to the model provider like the rest of your Claude Code session. (#14)

## 0.1.1 (2026-10-19)

- Fixed: Claude shows the round report before asking how to fix anything. The report now comes first in the script output, and the skill says so explicitly. (#9)
- Fixed: The README names the installed command, `/review-loop:review-loop`. (#10)
- Added: Running the skill again after a session ends mid-loop offers to continue from the round and step where it stopped, including pending decisions. `loop start --fresh` starts over, and a saved state that cannot be read is treated as no review in progress. (#11)

## 0.1.0 (2026-10-19)

- Added: Review before you commit. Your typecheck, lint, and test scripts run first, then a fresh reviewer labels findings P1 to P5, with evidence required for P1 and P2. (#8)
- Added: P1 and P2 are fixed after Claude says what it will fix, then re-reviewed for up to 3 rounds. A script, not the model, decides when to stop. (#8)
- Added: Fixes that need a design choice ask you first. P3 to P5 are decided once at the end: keep as is, fix this time only, or make it a rule. (#8)
- Added: Claude asks before committing unless you choose "stop asking in this repo", and never pushes. (#8)
- Added: 27 measured behaviors in `evals/review-loop/behaviors.csv`, 25 of them checked by unit tests in CI. (#8)
