# CLAUDE.md

Guidance for AI agents working in this repository. Humans are welcome to read it; the full guide is [CONTRIBUTING.md](CONTRIBUTING.md).

## Workflow

1. Every change starts from an issue.
2. Work on a branch named `<type>/<issue>-<slug>`, for example `feat/2-review-loop`.
3. Before opening a pull request, run `claude plugin validate --strict .`, `node --test`, and `scripts/check.sh`.
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
