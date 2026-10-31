# Changelog

All notable changes to ledger. Versions follow [Semantic Versioning](https://semver.org); see "Releases" in [CONTRIBUTING.md](../../CONTRIBUTING.md) for what each number means here.

## Unreleased

- Internal: The file, line, and search rules are tested against gap-map's copy on the same cases. (#224)

## 0.1.0 (2026-10-31)

- Added: First version. `/ledger:ledger` has Claude write `ledger.json` for an investigation: the questions, each marked as needing static or runtime evidence, the claims that answer them marked observed or inferred, and the unknowns still open with the probe that would settle them. `ledger.mjs check` checks every piece of evidence again (a file line that must exist and, once pinned, keep its SHA-256; a command output saved by `ledger.mjs save` that must keep its SHA-256; a literal-text search that is rerun and must find the same count within its stated scope; an REA Evidence ID that must be in the exported bundle) and decides each question: an inference never answers one, static evidence never answers a runtime question, an open unknown keeps it partial, and two holding claims that contradict each other mark it contradicted. It writes `ledger.md` and exits 0 only when every question is answered. (#208)
