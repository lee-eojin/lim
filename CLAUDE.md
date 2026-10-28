# CLAUDE.md

Guidance for AI agents working in this repository. Humans are welcome to read it; the full guide is [CONTRIBUTING.md](CONTRIBUTING.md).

## Workflow

1. Every change starts from an issue.
2. Work on a branch named `<type>/<issue>-<slug>`, for example `feat/2-review-loop`.
3. Before opening a pull request, run `claude plugin validate --strict .`, `node --test`, `scripts/check.sh`, and `node scripts/check-i18n.mjs`.
4. Open the pull request with `Closes #<issue>` in the description. Start the description by restating the issue's intent in one to three lines, and say what is out of scope.
5. A maintainer squash-merges. The pull request title becomes the commit message on `main`.
6. Do not change version numbers in feature pull requests. If users will notice the change, add one line under `## Unreleased` in the plugin's `CHANGELOG.md`. Releases follow "Releases" in CONTRIBUTING.md.

## Agents may

- Create issues, branches, and pull requests.
- Commit to their own branch and push that branch.

## Agents must not

- Merge pull requests, push to `main`, force push, or rewrite pushed history.
- Change repository settings, rulesets, labels, or secrets.
- Install anything without first explaining what it is, what it improves, where it lives, and how to remove it, then getting a yes.

## Writing

- English for code, docs, and skills. Skills reply in the user's language. The only exception is README translations in `docs/i18n/`.
- Commit messages and pull request titles use `<type>: <summary>` with `feat`, `fix`, `refactor`, `test`, `docs`, or `chore`.
- Keep it small. Follow the plugin rules in CONTRIBUTING.md.

## Rules and what enforces them

| Rule | Enforced by |
|---|---|
| A plugin's version is the same in its `plugin.json`, `.claude-plugin/marketplace.json`, and every README table | `node scripts/release.mjs <plugin> <version>` makes the edit; `tests/docs/versions.test.mjs` fails on a mismatch |
| Behavior counts in the READMEs match `evals/*/behaviors.csv` | `node scripts/sync-counts.mjs` writes them; `--check` and `tests/docs/measured.test.mjs` fail on a mismatch or a broken `<!--total-->` marker |
| Every tested row in a `behaviors.csv` names a real test | `tests/docs/measured.test.mjs` |
| Plugin scripts compare real paths with `realpathSync.native` | `tests/scripts/realpath-native.test.mjs` |
| No blocked words, no invalid JSON | `scripts/check.sh` (blocked words only with `LIM_DENYLIST` or `LIM_DENYLIST_FILE`) |
| Translations keep the English README's headings, numbers, and links | `node scripts/check-i18n.mjs` |
| A pull request merges only after both CI jobs (`check`, `windows`) pass | Not enforced by the repository yet: check each job with `gh pr checks <number>` before merging |
