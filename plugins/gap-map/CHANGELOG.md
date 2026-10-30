# Changelog

All notable changes to gap-map. Versions follow [Semantic Versioning](https://semver.org); see "Releases" in [CONTRIBUTING.md](../../CONTRIBUTING.md) for what each number means here.

## Unreleased

- Fixed: A `file:line` pointer one line past the end of a file that ends in a newline no longer resolves, and a map whose `root` is a drive root such as `C:\` or `/` no longer refuses every fixture path. (#216)

## 0.1.0 (2026-10-31)

- Added: First version. `/gap-map:gap-map` has Claude write `gap-map.json` for a language implementation: the stages a program passes through, and one obligation per promised behavior with its source line, owner line, the case kinds it needs, and existing tests as fixtures. `gapmap.mjs run` runs each fixture's verifier without a shell and with a time limit, and decides each obligation with fixed rules: proven only when its pointers resolve, every case has a fixture, and every fixture passed a run that can observe the claim on the current bytes of the fixture, the owner file, and the verifier's scripts; a contradiction, an unknown, or a stale result keeps it open, and a won't-fix item is shown but never counted. It writes `gaps.md`, `status.json`, and `map.svg`, a statechart in a dark blueprint style with a legend, dashed regions, and labeled transitions. Ships with a Bend reference and verifiers that match Bend's test gate. (#207)
