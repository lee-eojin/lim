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

### Changing review-loop's SKILL.md or reviewer.md

These files are instructions to a model, so unit tests cannot tell whether a change made reviews better or worse. Before and after the change, run the detection benchmark and put both sets of numbers in the pull request:

```bash
node evals/review-loop/run-detection.mjs -j 4
```

It runs the reviewer once on each case in `evals/review-loop/detection/` (seeded bugs and clean changes) and saves found, missed, false P1 or P2, tokens, and time to `evals/review-loop/results/`. To test removing an instruction, copy `reviewer.md`, remove it, and run again with `--reviewer <copy> --label without-<name>`. It uses your Claude account and costs real tokens; the results file shows how many. After changing a case's `expected.json`, score saved results again with `--rescore <results file>`, which calls no model; `--note <text>` records what changed.

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

**Release pull request.** A maintainer opens `release: <plugin> <version>`, which turns `## Unreleased` into `## <version> (YYYY-MM-DD)` and updates `version` in both the plugin's `plugin.json` and `.claude-plugin/marketplace.json`. After the squash merge, the maintainer tags the merge commit with `claude plugin tag plugins/<plugin> --push`, which creates `<plugin>--v<version>`. Major and minor releases also get a GitHub Release whose notes are copied from the changelog. Patch releases get the tag and the changelog entry only. Tags are never moved; a mistake gets a new version.

## Translations

`README.md` is the source. Translations live in `docs/i18n/README.<language>.md`, and each one has a note near the top with the date of the English README it was translated from. After the English README changes, a translation can lag behind the English README. `scripts/check-i18n.mjs` keeps the facts in step: the count and levels of headings, the plugin table versions, the numbers in the measured paragraph, and links to files that exist. A pull request that changes one of these in `README.md` updates the translations too. If the two differ, the English README is correct. Pull requests that update a translation are welcome. Keep commands, file paths, code blocks, and plugin names unchanged.

## Review

A maintainer reviews every pull request. Expect questions before change requests. The goal is to understand why you chose your approach.
