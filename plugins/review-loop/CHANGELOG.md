# Changelog

All notable changes to review-loop. Versions follow [Semantic Versioning](https://semver.org); see "Releases" in [CONTRIBUTING.md](../../CONTRIBUTING.md) for what each number means here.

## Unreleased

Nothing yet.

## 0.1.0 (2026-10-19)

- Added: Review before you commit. Your typecheck, lint, and test scripts run first, then a fresh reviewer labels findings P1 to P5, with evidence required for P1 and P2. (#8)
- Added: P1 and P2 are fixed after Claude says what it will fix, then re-reviewed for up to 3 rounds. A script, not the model, decides when to stop. (#8)
- Added: Fixes that need a design choice ask you first. P3 to P5 are decided once at the end: keep as is, fix this time only, or make it a rule. (#8)
- Added: Claude asks before committing unless you choose "stop asking in this repo", and never pushes. (#8)
- Added: 27 measured behaviors in `evals/review-loop/behaviors.csv`, 25 of them checked by unit tests in CI. (#8)
