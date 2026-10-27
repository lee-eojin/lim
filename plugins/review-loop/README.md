# review-loop

Review before you commit. Checks run first, a fresh reviewer labels findings P1 to P5, P1 and P2 are fixed and re-reviewed, and the rest is your call. Loop, I am.

## Install

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

Needs Node.js 18 or later and git.

## Use

Run `/review-loop:review-loop`. Asking Claude to review or commit your changes can also start it, but that depends on the model noticing, so the command is the reliable way.

Asking for a setting in plain words also starts it, without a review: turning the commit gate on or off, not asking before commits, skipping the review once, the reviewer's model, unattended reviews, being asked before P2 or P1 fixes, and what an unattended review did. With claude-opus-5-5, one run per request, and the tools of a normal session, it started for 8 of 8 setting and commit requests and 0 of 6 other requests written after the skill's description and never used to tune it; with the previous description, it started for 1 of those 8. Run it again with `node evals/review-loop/run-triggers.mjs --set evals/review-loop/triggers/held-out.json`.

If a session ends in the middle of a loop, running it again offers to continue where it stopped.

To run it with nobody watching, for example overnight, add "run unattended" after the command, or ask Claude to turn on unattended mode in the repository. Claude then asks nothing: it leaves design choices and P3 to P5 for you, records each choice it makes in the decision ledger, and ends with a summary of what it did and what waits for you.

The reviewer runs on your session's model unless you ask Claude to run it on another one in the repository, for example "run the reviewer on sonnet in this repo" for a cheaper review (`loop reviewer --model opus|sonnet|haiku|fable|inherit`); the report's first line names it.

## How it works

1. Runs the typecheck, lint, and test checks your project declares: `package.json` scripts, Makefile targets, `go vet` and `go test` for a `go.mod`, `cargo check` and `cargo test` for a `Cargo.toml`, pytest, ruff, or mypy when the project configures them, the test task of a Gradle or Maven project, `dotnet test` for a .NET solution or project, and rspec, `rake test`, or rubocop when a Ruby project uses them. The root's checks always run; a project in a subfolder, such as `web/package.json` or `services/api/go.mod`, runs its own checks in its folder when the change touches it, and the report names the folder (`web: test (npm run test) failed`). A project without them is reviewed from the diff alone.
2. A fresh reviewer subagent reads the diff and labels findings P1 to P5. It also reports code that agents add when they do not know the cause: guards for states nothing shows can happen, comments about history, TODOs without an issue link, and a second way to do a job the codebase already does. P1 and P2 need evidence: the exact line, a failure scenario, and why nothing already prevents it. Each finding is labeled measured, inferred, or guessed, and a guessed P1 or P2 counts as unverified.
3. Claude says what it will fix, then fixes P1 and P2. If a fix needs a design choice (more than one fix, a visible behavior change, removing a feature, changing tests), you choose first. To see every P2 (or every P1 and P2) before anything changes, ask Claude to confirm them with you first. If your project has a test script, Claude also writes a regression test from the failure scenario of each P1 or P2 it fixes, and review-loop shows that the test fails on the code from before the fix.
4. A new reviewer checks only the fixes and the open findings. Up to 3 rounds.
5. A script, not the model, stops the loop: no P1 or P2 left, the round limit, a finding that survives two fixes, a resolved finding that comes back, P1 + P2 that stops decreasing, or a fix that weakens tests or checks.
6. You decide the rest once (P3 to P5, plus any P1 or P2 that is still open, could not be verified, or is about a file outside the reviewed diff): keep as is, fix this time only, or make it a rule. A rule is a lint rule or a test that Claude writes next to the fix, and `loop rule` runs your checks on the code from before the fix to show that the rule catches it. A finding you keep as is is not asked about again in a later review until its quoted line changes, and the report counts it instead. When earlier reviews in this repository raised one of the four kinds the reviewer looks for (such as a speculative guard) 3 times or more, Claude says so and recommends making it a rule at the strongest layer that fits: a type or architecture change, then a lint rule, then a test.
7. Claude asks before committing unless you chose "stop asking in this repo". It never pushes.

Every round ends with a report like this:

```
Review round 2 of 3 (reviewer: session model)
Checks: typecheck (npm run typecheck) passed, lint (npm run lint) passed, test (npm run test) passed

Resolved since last round:
- F-1 [P2] Coupon branch adds the item twice (fixed, inferred: the re-review read the fix)
  test: src/coupon.test.ts (before the fix: caught, after: passed)

Trend (P1 + P2): 2 -> 0
Stopped: no P1 or P2 left in this change
Left for you: P3 1, P4 0, P5 2
```

## Evidence from verify

If the repository has a feature map from LIM's [verify](../verify/README.md) plugin (`verify.features.json` at the root), the round report names it and the reviewer gets its path. A P1 or P2 that breaks a mapped feature names that entry's id. Before fixing anything, Claude runs that verify check on the reviewed code: a check that fails marks the finding reproduced, the strongest evidence a finding can have, and the report lists it first within its severity. A check that passes marks it not reproduced and changes nothing else, because the check may not cover the scenario. After the fix, Claude runs the same check again, and a reproduced finding is resolved only when that run passes on the fixed code, whatever the re-review says. review-loop never runs verify itself; it reads verify's saved evidence. Without verify installed, Claude skips this step and says so.

## Commit gate

The commit gate is a hook that is off until you turn it on in a repository. At the end of a review, Claude asks once whether to turn it on. With the gate on, every `git commit` that Claude runs is checked first:

| Situation | What the gate does |
|---|---|
| No review, or files changed that the review did not cover | Blocks the commit and tells Claude to run the review |
| A review loop is in progress, or decisions are still pending | Blocks the commit |
| The review passed | Asks you before committing, or allows it if you delegated commits in this repository |
| Only reviewed files, or rule drafts and regression tests that `loop rule` checked, changed after the review (for example fixes and rules from the decision step) | Asks you |
| `git push` or a force push | Always asks, even with delegation |
| A commit with `--no-verify` | Asks, even with delegation, and still blocks a commit without a passing review |
| A commit in a folder the gate cannot read, such as `cd "$(...)"` or a path that does not exist | Asks you, even with delegation, if the gate is on in the repository where you started Claude Code |

To commit once without a review, ask Claude to skip the review this time. The gate checks only commands that Claude runs through its Bash tool. Commits you type in your own terminal are not checked. The gate setting and commit delegation apply to the whole repository, including its linked worktrees. Each worktree keeps its own review.

## Severity

Based on Banksalad's public Pn rule: P1 must fix, P2 should fix, P3 worth fixing, P4 optional, P5 trivial. A P1 or P2 about a file that is not in the diff the round reviewed is not fixed in the loop. It comes to you at the end, marked as outside the reviewed diff, and keeps its severity.

## Measured behavior

[`evals/review-loop/behaviors.csv`](../../evals/review-loop/behaviors.csv) lists 217 behaviors across do, tell, ask, silence, stop, and evidence. Unit tests in CI cover 206 of them. The other 11 (asking about P3 to P5 once, showing the report before any question, keeping every step in the todo list with a reason for each skip, writing a regression test for each fixed P1 or P2, labeling each finding measured, inferred, or guessed, saying how a fix is known, checking a finding again when you push back, recommending a rule for a kind of finding that keeps coming back, asking nothing in an unattended run, starting the reviewer on the model you chose, and reporting code added without a known cause) need a model run. The first two have a manual run in [`evals/review-loop/manual-behaviors.md`](../../evals/review-loop/manual-behaviors.md), and the reviewer has a detection benchmark in [`evals/review-loop/detection/`](../../evals/review-loop/detection/). With the narrower `touchesTests` definition from #114, the reviewer set `touchesTests` on 0 of 100 P1 or P2 findings in the regular and harder sets, against 29 of 50 in the regular set before, and still found every seeded bug (36 of 36, 30 of 30). The runs are in [`2026-10-27-claude-opus-5-5-detection-3runs-before.json`](../../evals/review-loop/results/2026-10-27-claude-opus-5-5-detection-3runs-before.json), [`2026-10-27-claude-opus-5-5-detection-3runs.json`](../../evals/review-loop/results/2026-10-27-claude-opus-5-5-detection-3runs.json), and [`2026-10-27-claude-opus-5-5-detection-hard-3runs.json`](../../evals/review-loop/results/2026-10-27-claude-opus-5-5-detection-hard-3runs.json).

Those two sets are JavaScript. [`evals/review-loop/detection-languages/`](../../evals/review-loop/detection-languages/) has 6 seeded bugs in Python, Rust, and Go (a mutable default argument, a closure that reads its loop variable late, a length cast to `u16` that wraps, a slice range that leaves out the newest reading, a write to a nil map, and an `err` shadowed inside an `if`) and 2 clean changes that look suspicious, in Python and Rust. Each Python and Rust bug was shown by running the changed code, and each Go bug is behavior the Go specification states. With 3 runs per case on 2026-10-27, Opus and Sonnet found every bug. Haiku missed the slice range in 2 of 3 runs: those runs flagged that fewer than five readings give no average, which is the window the author asked for. That finding first counted as the bug because one keyword also fit it; the keyword was removed and all three files were scored again.

| Reviewer model | Bugs found as P1 or P2 | False P1 or P2 on clean changes | Cost (24 runs) |
|---|---|---|---|
| claude-opus-5-5 | 18 of 18 | 0 of 6 | $1.35 |
| claude-sonnet-5-5 | 18 of 18 | 0 of 6 | $0.49 |
| claude-haiku-5-5 | 16 of 18 | 0 of 6 | $0.04, as reported by Claude Code |

The runs are in [`2026-10-27-claude-opus-5-5-detection-languages.json`](../../evals/review-loop/results/2026-10-27-claude-opus-5-5-detection-languages.json), [`2026-10-27-sonnet-detection-languages.json`](../../evals/review-loop/results/2026-10-27-sonnet-detection-languages.json), and [`2026-10-27-haiku-detection-languages.json`](../../evals/review-loop/results/2026-10-27-haiku-detection-languages.json).

## Data

State, diffs, check logs, and a decision ledger are stored in `.git/lim/review-loop/` inside your repository. Delete that folder to reset. Claude writes each review to `.lim-review/` in your working tree for a moment; git ignores that folder through `.git/info/exclude`, and review-loop deletes the file after reading it. To check a rule, review-loop writes the code from before the fix to a temporary folder outside your repository, links the `node_modules` of the root and of the checked projects there, and deletes the folder afterwards. review-loop makes no network calls of its own; Claude and the reviewer read the diff, findings, and check output like any other file, so that content goes to the model provider like the rest of your session. review-loop matches verify's evidence in `.git/lim/verify/runs/` to the reviewed code by the run's `tree` or `treeAfter`, which verify computes the same way review-loop snapshots what `git add -A` would commit. Snapshots add blob objects to git's object store; `git gc` removes the unreferenced ones.

## Limits

- Checks are detected at the repository root and in the subfolder projects a change touches. A changed file belongs to the nearest folder above it, up to but not including the root, that declares at least one check; folders inside `node_modules`, `.git`, `.venv`, `venv`, `vendor`, `target`, `dist`, `build`, and the test fixture folders `testdata`, `fixtures`, and `__fixtures__` are skipped, by name alone: a real project in a folder with one of these names runs no checks of its own, and the report does not say so. Round 1 runs the projects of the whole change. Later rounds run the projects the fixes touched first, then the projects of failing checks that are still open, deferred, or kept. Each round runs at most 4 subfolder projects, in name order within each group; the report names the ones left out. In each folder, for each of typecheck, lint, and test the first source that declares one wins: `package.json` scripts (run with the package manager of the nearest lockfile in that folder or above it), then Makefile targets `typecheck` (or `check-types`, `types`), `lint`, and `test` (run as `make <target>`), then `go.mod` (`go vet ./...`, `go test ./...`), then `Cargo.toml` (`cargo check`, `cargo test`), then Python tools the project configures: pytest from `[tool.pytest.ini_options]`, `pytest.ini`, or `[tool:pytest]` in `setup.cfg`, ruff from `[tool.ruff]` or `ruff.toml`, and mypy from `[tool.mypy]` or `mypy.ini`, run through `uv run --frozen --no-sync` when `uv.lock` exists in that folder (a uv workspace member without its own `uv.lock` runs without `uv run`), then Gradle (`build.gradle`, `build.gradle.kts`, `settings.gradle`, or `settings.gradle.kts`: `./gradlew test` with the wrapper, otherwise `gradle test`), then Maven (`pom.xml`: `./mvnw -B -q test` with the wrapper, otherwise `mvn -B -q test`), then .NET (a `*.sln`, `*.csproj`, or `*.fsproj` file: `dotnet test`; with more than one solution or project file in a folder, the first solution, or the first project by name when there is no solution, is passed to it; `.slnx` counts as a solution), then Ruby tools the project uses: rspec when `.rspec` or a `spec/` folder next to a `Gemfile` or `Rakefile` exists, otherwise `rake test` when a `Rakefile` and a `test/` folder exist, and rubocop when `.rubocop.yml` exists, each through `bundle exec` when a `Gemfile` exists in that folder or above it. A wrapper without the executable bit runs through `sh`, a Maven module listed in a parent `pom.xml`, or a Gradle subproject without its own settings file under a folder that has one, runs no build of its own because the parent's build runs its tests, and a wrapper that cannot find Java is reported as not verified. A .NET project without a solution file of its own under a folder that has one runs no build of its own because the solution's build runs its tests, and a command or gem that bundler cannot find is reported as not verified. A check whose program is not installed is reported as "not run because <program> is not installed (not verified)" instead of failing.
- The script that stops a fix for weakening tests or checks reads only JavaScript and TypeScript files (skips, focused tests, todos, removed or deleted test cases, `eslint-disable`, `@ts-ignore`), changes under `__snapshots__/`, and changes under `.github/workflows/`. In other languages, a skipped test such as `@pytest.mark.skip` or `t.Skip()`, or a lint rule turned off, does not stop the loop.
- Each check gets up to 5 minutes, and all checks together, in every folder, up to 9 minutes. A check past its limit is reported as "timed out (not verified)" instead of failing, and Claude tells you before committing. Set `LIM_CHECK_TIMEOUT_MS` to change the per-check limit.
- Without the commit gate, asking before a commit is an instruction to Claude, not a guarantee. Turn the gate on to make it a hook.
- The commit gate reads git aliases in the repository: a commit or push through an alias such as `git ci` is checked like the command it stands for, and a shell alias (`!...`) that runs `git commit` or `git push` is asked about, because the gate cannot see inside it. An alias set inline with `git -c alias.ci=commit` is not recognized.
- If you start Claude Code in a folder that is not a repository, the gate cannot check a commit whose repository it cannot tell, for example after `cd "$(...)"`.
- It reviews everything `git add -A` would include, not a hand-picked set of staged changes.
- A rule or a regression test is checked in a temporary copy with your tracked files and the `node_modules` of the root and of the projects that hold the finding and the drafts, with those projects' checks. A check that needs other ignored files, such as `.env`, can report it as unproven or as caught for the wrong reason. Claude reads the failure to tell which.
- In Go, Rust, and Python projects, rules and regression tests run in that copy without untracked build caches or virtual environments, so they can be slow or report unproven.
- On Windows, a check finds its program through `PATH` and `PATHEXT`, never in the project folder, which Windows would search first; review-loop starts `git` the same way. A PATH folder that cannot be read is skipped, and a `.cmd` or `.bat` program such as `npm.cmd` runs through `cmd.exe`. Gradle and Maven run `gradlew.bat` and `mvnw.cmd` when the project has them; a project with only the `gradlew` or `mvnw` shell script runs it through `sh`, which is reported as not installed unless Git Bash's `sh` is on PATH. A check past its time limit is stopped, but a program it started through `cmd.exe`, such as the test runner `npm` starts, can keep running until it ends. The commit gate reads `~` as `HOME` and `/c/...` as drive `C:`, as Git Bash does. The Windows CI job runs the same tests as macOS and Linux.
