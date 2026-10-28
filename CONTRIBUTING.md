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
4. Hooks are opt-in, documented in the plugin README, and exit 0 on their own errors so they never block the user by accident.
5. No network calls unless the plugin README says where data goes and how to turn it off.
6. Anything a plugin needs to install is explained to the user first: what, why, where, and how to remove it.
7. Skills, docs, and code are written in English. Skills reply in the user's language. The only exception is README translations in `docs/i18n/` (see Translations).

## Before you open a pull request

```bash
claude plugin validate --strict .
node --test
scripts/check.sh
node scripts/check-i18n.mjs
```

All four must pass. CI runs `node --test`, `scripts/check.sh`, and `node scripts/check-i18n.mjs` on every pull request.

After you add or change rows in an `evals/*/behaviors.csv`, run `node scripts/sync-counts.mjs`. It writes the behavior counts into `README.md`, its translations, and the plugin READMEs, and `--check` lists the files that are out of date without writing. It finds each count by the HTML comment right before it, `<!--total-->`, `<!--tested-->`, or `<!--rest-->`, which GitHub does not render; a new translation needs these markers, and the script and `--check` stop with an error until every file has all three. `node --test` fails while any of them is out of date. If the number of behaviors that need a model run changes, also update the list of them in each file by hand.

`npm test` runs `node --test`, and `npm run lint` runs `node scripts/check-i18n.mjs`. review-loop finds these scripts in the root `package.json`, so it runs them when it reviews a change here. `scripts/check.sh` is left out of `npm run lint` because it needs bash and python3, which Windows may not have.

### Changing review-loop's SKILL.md or reviewer.md

These files are instructions to a model, so unit tests cannot tell whether a change made reviews better or worse. Before and after the change, run the detection benchmark and put both sets of numbers in the pull request:

```bash
node evals/review-loop/run-detection.mjs --runs 3 -j 4 --label detection
node evals/review-loop/run-detection.mjs --cases evals/review-loop/detection-hard --runs 3 -j 4 --label detection-hard
```

There are two sets of seeded bugs and clean changes. `evals/review-loop/detection/` has bugs the diff shows on its own. `evals/review-loop/detection-hard/` has bugs that need a second file to see, a bug hidden in a long diff, async ordering, a leaked lock, and clean changes that look suspicious. Comparisons use 3 runs per case, because one run cannot separate a real change from noise; report each set's totals and the cases whose result differs between runs. Each run saves found, missed, false P1 or P2, tokens, and time to `evals/review-loop/results/`, with the cases folder it used. To test removing an instruction, copy `reviewer.md`, remove it, and run again with `--reviewer <copy> --label without-<name>`. It uses your Claude account and costs real tokens; the results file shows how many. After changing a case's `expected.json`, score saved results again with `--rescore <results file>`, which calls no model and uses the cases folder stored in the file; `--note <text>` records what changed.

Compare the two results files with `--compare <before> <after>`, which calls no model, and put its output in the pull request. It names each file's cases folder and reviewer file with its sha256, and compares only the cases both ran. With Opus, a worse `reviewer.md` showed up in P3 to P5 findings, not in missed bugs: cutting `reviewer.md` to its output format kept 30 of 30 bugs found on the harder set and raised P3 to P5 findings from 1.15 to 1.73 per run. Two runs of the same `reviewer.md` on 10 cases (one case's fixture changed between them) gave 1.17 and 1.13, so treat a change of a few percent as noise. The cut-down reviewer also drew 1 false P1 or P2 in 18 clean runs, but the full `reviewer.md` drew the same one on the same case in 1 of 12, so a single false alarm is not a signal on its own.

For a change to `SKILL.md`, also do the manual B05 and B31 run in [`evals/review-loop/manual-behaviors.md`](evals/review-loop/manual-behaviors.md) and report the result.

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
