# Changelog

All notable changes to verify. Versions follow [Semantic Versioning](https://semver.org); see "Releases" in [CONTRIBUTING.md](../../CONTRIBUTING.md) for what each number means here.

## 0.5.0 (2026-10-28)

- Fixed: verify refuses an `equals` or `matches` rule that one argument in `run` satisfies, and a compiled `.node` addon or binary file run with `node`; keeps a check marked as changed after it failed on every later run, also after removing and adding it back or running another map; makes a check not verified, instead of stopping the run, when its script or a file it names cannot be read, and says in the report when git could not record the working tree; and on macOS and Linux starts `node`, `python3`, and `git` only from absolute PATH folders and removes relative entries from the program's PATH. (#140)

## 0.4.0 (2026-10-27)

- Internal: The benchmark has two Python projects; on them claude-opus-5-5 caught 2 of 2 broken features with no working feature reported as failing. (#86)
- Added: Windows support. A script whose first line runs node or python3 runs through that interpreter from PATH, because Windows does not read #! lines, and paths in reports and evidence use `/` on every system. `node`, `python3`, and `git` start from PATH only, never the project folder, and `env` names are refused in any case, such as `Path` or `node_options`. (#112)
- Internal: The benchmark ran 3 times per case: the broken feature was caught in all 18 broken-case runs, and no working feature was reported as failing in the 9 working-case runs. (#99)

## 0.3.0 (2026-10-26)

- Added: Checks can run Python command-line tools and libraries: `["python3", "<script>", ...arguments]` with no option before the script, or a script whose first line is `#!/usr/bin/env python3` or an absolute path to python3 with no option. A python3 run gets no `PYTHONPATH` (a library helper adds the repository root to `sys.path` itself) and no `__pycache__` folders, a python3 script with a zip archive anywhere in it is refused, `env` refuses every `PYTHON` name, and an expectation that a Python traceback or `None` satisfies is refused. (#83)

## 0.2.0 (2026-10-26)

- Added: Each run's evidence records `tree` and `treeAfter`, the git tree that `git add -A` would commit before and after the checks, so review-loop can match a run to the code it reviewed. (#32)

## 0.1.0 (2026-10-25)

- Added: First version. `/verify:verify` has Claude write a feature map (`verify.features.json`) of each feature, the command that exercises it, and what the result must show, from the project's docs. Each check's `run` is `node` with a script file in the repository, or a script file in the repository whose first line is `#!/usr/bin/env node` or an absolute path to node with no option, then plain arguments; any other program, including a binary or a shell placed in the repository, is refused. Every path in an entry except those arguments is relative to the repository root, whatever `cwd` is, and a path that leaves the repository is refused. `verify.mjs run` refuses common ways a check cannot fail, runs only node on the project's own scripts, without a shell and with a time limit, decides pass, fail, or not verified with fixed rules, records the command, exit code, output excerpt, and duration as evidence in `.git/lim/verify/`, and flags a check whose definition or named helper files in `verify-checks/` changed after it failed. A helper script is code Claude writes and could still be written to always pass, so the feature map and `verify-checks/` are part of what a person reviews. `verify.mjs last` shows the last run. For Node.js command-line tools and libraries. (#65)
