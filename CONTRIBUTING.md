# Contributing to LIM

Thanks for helping. LIM stays small on purpose, so the best contributions make something simpler, faster, or better measured.

## Ways to help

- **Report a bug.** Use the bug report template. Include your Claude Code version (`claude --version`) and the plugin version.
- **Suggest an idea.** Use the idea template. Describe the problem before the feature.
- **Fix something.** Small pull requests are the easiest to review. Link the issue they close.
- **Propose a new plugin.** Open an idea issue first and wait for a maintainer reply before writing code.

## Plugin rules

Every plugin under `plugins/` follows these rules.

1. One entry skill. Sub-features become arguments or sub-commands, not extra skills.
2. `SKILL.md` stays under 250 lines. Details go in `references/`, data in `data/`, and deterministic logic in `scripts/`.
3. The skill `description` says what the skill does and when to use it, in two sentences or fewer.
4. Hooks are opt-in: a hook has no effect until the user turns it on. The one exception is a hook that only shows the user what the plugin's own commands returned: it outputs nothing but a `systemMessage`, and nothing at all for other commands. Every hook is documented in the plugin README, exits 0 on its own errors so it never blocks the user by accident, and is listed in `tests/scripts/hook-rule.test.mjs`.
5. No network calls unless the plugin README says where data goes and how to turn it off.
6. Anything a plugin needs to install is explained to the user first: what, why, where, and how to remove it.
7. Skills, docs, and code are written in English. Skills reply in the user's language. The only exception is README translations in `docs/i18n/` (see Translations).
8. A plugin imports only files inside its own folder, because installing a plugin copies only that folder. Code that plugins share lives in `shared/`, and a plugin imports its copy from `skills/<plugin>/scripts/_shared/`. Never edit a copy by hand.

## Before you open a pull request

```bash
claude plugin validate --strict .
node --test
scripts/check.sh
node scripts/check-i18n.mjs
```

All four must pass. CI runs `node scripts/check-loop-model.mjs` (Linux), `node --test`, `scripts/check.sh`, `node scripts/check-i18n.mjs`, and `npm run lint` on every pull request. `node --test` also runs `scripts/check-skills.mjs`: a static structure check of every plugin entry skill and its manifest, not proof of Claude runtime loading. It checks the flat string-mapping frontmatter used by these skills and rejects unsupported YAML syntax.

When you record a claim that something works, write it as an evidence report and run `node scripts/check-evidence-report.mjs <file>`; `.claude/skills/prove-it/SKILL.md` describes the fields. `node --test` covers this script's tests.

`node --test` also runs `scripts/check-loop-model-sync.mjs` on this repository, except in a shallow clone such as the Windows CI job. It fails when a function the review-loop model covers changed after the sync blob in `.claude/skills/check-loop-model/SKILL.md`.

`node --test` also runs `scripts/check-comments.mjs`. It fails when a `.mjs` file under `plugins/`, `scripts/`, `evals/`, `shared/`, or `tests/` has a comment. Its `EXCLUDED` constant skips only fixture paths: `repo/` folders under `evals/`, `fixtures/` folders, and `node_modules/`.

After you add or change rows in an `evals/*/behaviors.csv`, run `node scripts/sync-counts.mjs`. It writes the behavior counts into `README.md`, its translations, and the plugin READMEs, and `--check` lists the files that are out of date without writing. It finds each count by the HTML comment right before it, `<!--total-->`, `<!--tested-->`, or `<!--rest-->`, which GitHub does not render; a new translation needs these markers, and the script and `--check` stop with an error until every file has all three. `node --test` fails while any of them is out of date. If the number of behaviors that need a model run changes, also update the list of them in each file by hand.

After you change a file in `shared/`, run `node scripts/sync-shared.mjs`. It copies each helper to the plugins named for it in `COPIES` in that script, as `plugins/<plugin>/skills/<plugin>/scripts/_shared/<helper>.mjs`, and `--check` lists what is out of date without writing. `node --test` fails while a copy is missing, differs by one byte, is a link, or is not in `COPIES`. A plugin gets a copy only when one of its files imports it. A change to a helper reaches users when each plugin with a copy is released.


`npm test` runs `node --test`. `npm run lint` runs `node scripts/check-i18n.mjs`. `node --test` already runs `scripts/check-comments.mjs`, `scripts/sync-counts.mjs`, `scripts/sync-shared.mjs`, `scripts/check-skills.mjs`, and `scripts/check-loop-model-sync.mjs` on this repository, so they are left out of `npm run lint`: review-loop runs both scripts, and a gate in both would report one problem as two P1 findings. `node scripts/check-loop-model.mjs` is left out too, because it needs Java, downloads the TLA+ tools, and takes about 130 s; CI runs it in its own step. review-loop finds the `test` and `lint` scripts in the root `package.json`, so it runs them when it reviews a change here. `scripts/check.sh` is left out of `npm run lint` because it needs bash and python3, which Windows may not have.

### Tests that run on only some systems

A few tests check behavior that exists only on Windows or only on a file system that ignores letter case. On Linux, `node --test` reports them as skipped, with the reason after `# SKIP`. A skipped test is not a pass, so these tests are proven by a run on a system that has the behavior.

| Test | File | Runs on | Why it skips on Linux |
| --- | --- | --- | --- |
| a git.exe in the repository does not run in place of the installed one | `tests/review-loop/loop.test.mjs` | Windows | Only Windows looks for a bare program name in the working folder before `PATH`. |
| a node.exe or git.exe in the repository does not run in place of the installed one | `tests/verify/verify.test.mjs` | Windows | The same Windows lookup. |
| a path into node_modules in other letter case is refused as the file it resolves to, not a link | `tests/verify/verify.test.mjs` | A file system that ignores letter case, such as NTFS on Windows or APFS on macOS by default | The test runs only when `NODE_MODULES` finds the repository's `node_modules`. On Linux, ext4 tells letter case apart, so the test skips. |

How they are proven:

- The `windows` CI job runs `node --test` on `windows-latest` for every pull request. It runs all three tests above, because NTFS ignores letter case. Open the job log and find each test name in an `ok` line with no `# SKIP`.
- To check the letter-case test on macOS, run `node --test tests/verify/verify.test.mjs` on an APFS volume that ignores letter case, which is the default. The test must show `ok` with no `# SKIP`. No CI job runs on macOS.

When you add a test that skips on some systems, give the skip a reason, add the test to this table, and say in the pull request which run showed it pass.

The other skips work the other way. They run on Linux and skip on Windows or as root: tests that need bash and python3, symbolic links, process groups, or a file with mode 000 that the user cannot read. The `check` CI job on Linux runs them.

### Changing review-loop's SKILL.md or reviewer.md

These files are instructions to a model, so unit tests cannot tell whether a change made reviews better or worse. Before and after the change, run the detection benchmark and put both sets of numbers in the pull request:

```bash
node evals/review-loop/run-detection.mjs --runs 3 -j 4 --label detection
node evals/review-loop/run-detection.mjs --cases evals/review-loop/detection-hard --runs 3 -j 4 --label detection-hard
```

There are two sets of seeded bugs and clean changes. `evals/review-loop/detection/` has bugs the diff shows on its own. `evals/review-loop/detection-hard/` has bugs that need a second file to see, a bug hidden in a long diff, async ordering, a leaked lock, and clean changes that look suspicious. Comparisons use 3 runs per case, because one run cannot separate a real change from noise; report each set's totals and the cases whose result differs between runs. Each run saves found, missed, false P1 or P2, tokens, and time to `evals/review-loop/results/`, with the cases folder it used. To test removing an instruction, copy `reviewer.md`, remove it, and run again with `--reviewer <copy> --label without-<name>`. It uses your Claude account and costs real tokens; the results file shows how many. After changing a case's `expected.json`, score saved results again with `--rescore <results file>`, which calls no model and uses the cases folder stored in the file; `--note <text>` records what changed.

Compare the two results files with `--compare <before> <after>`, which calls no model, and put its output in the pull request. It names each file's cases folder and reviewer file with its sha256, and compares only the cases both ran. With Opus, a worse `reviewer.md` showed up in P3 to P5 findings, not in missed bugs: cutting `reviewer.md` to its output format kept 30 of 30 bugs found on the harder set and raised P3 to P5 findings from 1.15 to 1.73 per run. Two runs of the same `reviewer.md` on 10 cases (one case's fixture changed between them) gave 1.17 and 1.13, so treat a change of a few percent as noise. The cut-down reviewer also drew 1 false P1 or P2 in 18 clean runs, but the full `reviewer.md` drew the same one on the same case in 1 of 12, so a single false alarm is not a signal on its own.

For a change to `SKILL.md`, also do the manual B05 and B31 run in [`evals/review-loop/manual-behaviors.md`](evals/review-loop/manual-behaviors.md) and report the result.

### When a benchmark result moves and nothing here changed

A benchmark result can move when no file here changed, because the model or the Claude Code behind the same name changed. The results file cannot show this: its `model` field was `claude-opus-5-5` before and after the shift of 2026-11-05. There is no `--baseline` option. Compare with an old commit by hand, in three steps. The runs use your Claude account and cost real tokens, so keep the set small.

1. Make a temporary clone at the old commit, a commit on `main` from when the saved numbers were made.

```bash
old=$(mktemp -d)
out=$(mktemp -d)
git clone --quiet . "$old"
git -C "$old" checkout --quiet --detach <commit>
git diff --stat <commit> HEAD -- evals/review-loop/detection evals/review-loop/detection-hard evals/verify/projects evals/verify/cases.json
```

2. Run the same small set of cases from the clone and from your checkout of `main`, one right after the other, on the same day and with the same Claude Code. Pick the cases that moved and a few that did not. Leave out a case the `git diff` above lists, because its fixture differs between the two commits. Give both runs the same options. Write the results outside the repository with `--out`, because `node --test` reads every file in `evals/review-loop/results/`.

```bash
(cd "$old" && node evals/review-loop/run-detection.mjs --case duration-format --case page-range --runs 3 -j 4 --out "$out/detection-old.json")
node evals/review-loop/run-detection.mjs --case duration-format --case page-range --runs 3 -j 4 --out "$out/detection-new.json"
(cd "$old" && node evals/verify/run-benchmark.mjs --case jot-working --case jot-broken -j 2 --out "$out/verify-old.json")
node evals/verify/run-benchmark.mjs --case jot-working --case jot-broken -j 2 --out "$out/verify-new.json"
```

3. Compare. For the detection benchmark, use the runner on `main`, which calls no model. The verify runner has no `--compare`, so compare the table and the summary lines the two runs print; each results file keeps them under `summary` and `runs`.

```bash
node evals/review-loop/run-detection.mjs --compare "$out/detection-old.json" "$out/detection-new.json"
```

The clone runs its own runner, reviewer, skill, and cases, so an old runner may lack an option that `main` has. Run the old runner with `--help` first. If it lacks an option, leave that option out of both runs. The verify runner runs each case once, so run both commands again with new `--out` files to repeat it.

How to read the result:

- The old commit and `main` both differ from the saved numbers in the same way: the cause is outside this repository. Record the runs as dated records and keep the baselines.
- Only `main` differs: a change between the two commits is the cause. Repeat the steps with a commit in between.
- A few cases cannot show a small change, so treat a difference in one run as noise.

Check that both results files have the same `claudeVersion` and `model`. Put the commit, the commands, and the output in the issue or pull request, then remove the two folders with `rm -rf "$old" "$out"`.

## Commit messages

Use `<type>: <summary>` with one of `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.

```
feat: add round report to review-loop
```

## Releases

Each plugin has its own version, `CHANGELOG.md`, and tags.

**Feature pull requests do not change versions.** If users will notice the change, add one line under `## Unreleased` in the plugin's `CHANGELOG.md`:

```
- Fixed: what the user sees now, in one line (#123)
```

Use `Added`, `Changed`, `Fixed`, or `Removed`. Group changes users will not notice into one `Internal:` line.

**Version numbers.** Check these in order and stop at the first that applies:

1. **Major**: users can no longer do something the way they did before. A skill, command, or agent is renamed or removed, saved state can no longer be read, an option is renamed, something that used to ask no longer asks by default, or the minimum Node.js or Claude Code version goes up.
2. **Minor**: users can do something new, and the old way still works. New opt-in options, opt-in hooks, and checks that catch more fall here.
3. **Patch**: everything else. Bug fixes, false positive fixes, wording, docs, tests, and internal changes.

While a plugin is below 1.0.0, a breaking change raises the minor number and everything else raises the patch number.

**Release pull request.** A maintainer runs `node scripts/release.mjs <plugin> <version>` (add `--date YYYY-MM-DD` to use a date other than today) and opens `release: <plugin> <version>` with its edits. The script turns `## Unreleased` into `## <version> (YYYY-MM-DD)` in the plugin's `CHANGELOG.md` and updates the version in the plugin's `plugin.json`, `.claude-plugin/marketplace.json`, and the plugin table of `README.md` and each translation. It refuses an unknown plugin, a version that is not higher than the current one, or a CHANGELOG with no `## Unreleased`, and it changes nothing when any of those spots is missing. After the squash merge, the maintainer tags the merge commit with `claude plugin tag plugins/<plugin> --push`, which creates `<plugin>--v<version>`. Major and minor releases also get a GitHub Release whose notes are copied from the changelog. Patch releases get the tag and the changelog entry only. Tags are never moved; a mistake gets a new version.

## Translations

`README.md` is the source. Translations live in `docs/i18n/README.<language>.md`, and each one has a note near the top with the date of the English README it was translated from. After the English README changes, a translation can lag behind the English README. `scripts/check-i18n.mjs` keeps the facts in step: the count and levels of headings, the plugin table versions, the numbers in the measured paragraph, and links to files that exist. A pull request that changes one of these in `README.md` updates the translations too. If the two differ, the English README is correct. Pull requests that update a translation are welcome. Keep commands, file paths, code blocks, and plugin names unchanged.

## Review

A maintainer reviews every pull request. Expect questions before change requests. The goal is to understand why you chose your approach.
