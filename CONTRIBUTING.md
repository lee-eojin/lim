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
7. Skills, docs, and code are written in English. Skills reply in the user's language.

## Before you open a pull request

```bash
claude plugin validate --strict .
node --test
scripts/check.sh
```

All three must pass. CI runs `node --test` and `scripts/check.sh` on every pull request.

## Commit messages

Use `<type>: <summary>` with one of `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.

```
feat: add round report to review-loop
```

## Review

A maintainer reviews every pull request. Expect questions before change requests. The goal is to understand why you chose your approach.
