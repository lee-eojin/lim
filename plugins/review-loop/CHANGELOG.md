# Changelog

All notable changes to review-loop. Versions follow [Semantic Versioning](https://semver.org); see "Releases" in [CONTRIBUTING.md](../../CONTRIBUTING.md) for what each number means here.

## Unreleased

- Added: "Make it a rule" now drafts a lint rule or a test next to the fix. `loop rule` runs your checks on the code from before the fix, with and without the draft, and reports `caught`, `missed`, or `unproven`. The reviewer can mark findings as rule candidates. Without a typecheck, lint, or test script, the choice is recorded as "fix this time only". (#28)
- Added: The reviewer reports code that agents add when they do not know the cause: guards for states nothing shows can happen, comments about history or instructions to agents, TODO or "for now" comments without an issue link, and a second way to do a job the codebase already does. It judges whether the change achieves your stated intent, not whether the intent is right. (#36)
- Added: Claude puts every review-loop step in its todo list when a loop starts, and a step that does not apply stays in the list as `skip: <reason>` instead of being dropped quietly. `loop status` returns `doneSteps`, the steps the script saw done, so Claude can compare the list before committing. (#35)
- Added: A finding you chose to keep as is is not asked about again in a later review. The report says how many kept findings were raised again and still lists a kept P1 or P2 with its severity. Once the quoted line changes, the finding is asked about again, as it is when it comes back at a higher severity or when its quoted line now appears more than once in the file. Failing checks are never skipped this way. (#30)

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
