# Changelog

All notable changes to review-loop. Versions follow [Semantic Versioning](https://semver.org); see "Releases" in [CONTRIBUTING.md](../../CONTRIBUTING.md) for what each number means here.

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
