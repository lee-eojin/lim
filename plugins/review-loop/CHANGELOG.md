# Changelog

All notable changes to review-loop. Versions follow [Semantic Versioning](https://semver.org); see "Releases" in [CONTRIBUTING.md](../../CONTRIBUTING.md) for what each number means here.

## Unreleased

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
