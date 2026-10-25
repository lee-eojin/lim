# Changelog

All notable changes to verify. Versions follow [Semantic Versioning](https://semver.org); see "Releases" in [CONTRIBUTING.md](../../CONTRIBUTING.md) for what each number means here.

## Unreleased

Nothing yet.

## 0.1.0 (2026-10-25)

- Added: First version. `/verify:verify` has Claude write a feature map (`verify.features.json`) of each feature, the command that exercises it, and what the result must show, from the project's docs. Each check's `run` is `node` with a script file in the repository, or a script file in the repository whose first line is `#!/usr/bin/env node` or an absolute path to node with no option, then plain arguments; any other program, including a binary or a shell placed in the repository, is refused. Every path in an entry except those arguments is relative to the repository root, whatever `cwd` is, and a path that leaves the repository is refused. `verify.mjs run` refuses common ways a check cannot fail, runs only node on the project's own scripts, without a shell and with a time limit, decides pass, fail, or not verified with fixed rules, records the command, exit code, output excerpt, and duration as evidence in `.git/lim/verify/`, and flags a check whose definition or named helper files in `verify-checks/` changed after it failed. A helper script is code Claude writes and could still be written to always pass, so the feature map and `verify-checks/` are part of what a person reviews. `verify.mjs last` shows the last run. For Node.js command-line tools and libraries. (#65)
