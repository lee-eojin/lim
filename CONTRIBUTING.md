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

## Review

A maintainer reviews every pull request. Expect questions before change requests. The goal is to understand why you chose your approach.
