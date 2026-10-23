# LIM

**Less is more.** Small Claude Code plugins. Each plugin does one job and shows the measurements behind it.

[![CI](https://github.com/lee-eojin/lim/actions/workflows/ci.yml/badge.svg)](https://github.com/lee-eojin/lim/actions/workflows/ci.yml)
[![review-loop](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=review-loop--*&sort=semver&label=review-loop)](plugins/review-loop/CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

English | [한국어](docs/i18n/README.ko.md) | [日本語](docs/i18n/README.ja.md) | [简体中文](docs/i18n/README.zh-CN.md) | [繁體中文](docs/i18n/README.zh-TW.md) | [Español](docs/i18n/README.es.md) | [Português (Brasil)](docs/i18n/README.pt-BR.md) | [Français](docs/i18n/README.fr.md) | [Deutsch](docs/i18n/README.de.md) | [Русский](docs/i18n/README.ru.md) | [Tiếng Việt](docs/i18n/README.vi.md) | [Bahasa Indonesia](docs/i18n/README.id.md)

## Why LIM

Large agent harnesses load many instructions into every session and run hooks on many commands. LIM keeps each plugin small, optional, and measured.

- **One plugin, one job.** Install only what you need. review-loop adds about 188 tokens to a session, as reported by `claude plugin details`.
- **Checks before opinions.** Your tests, types, and lint run before any model review.
- **Hooks are opt-in.** A hook does nothing until you turn it on for a repository.
- **Ask before installing.** Anything a plugin needs is explained first: what it is, what it improves, where it lives, and how to remove it.
- **Show the numbers.** Every plugin ships with what was measured and what that measurement does not cover.

## Plugins

| Plugin | Status | One job |
|---|---|---|
| [review-loop](plugins/review-loop) | 0.3.0 | Reviews your changes before you commit, fixes P1 and P2 findings, re-reviews, and hands the rest to you. |

## Quick start

You need Claude Code, git, and Node.js 18 or later.

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

Restart Claude Code if it asks. Then, in a git repository with uncommitted changes:

```
/review-loop:review-loop
```

Adding the marketplace only registers the catalog. Each plugin is installed on its own, so you get only what you pick.

## review-loop

Before you commit, review-loop runs a short loop and stops on its own.

1. **Checks.** It runs the `typecheck`, `lint`, and `test` scripts from your `package.json`. A failing check, or a `package.json` that is not valid JSON, becomes a P1 finding. A check that runs past its time limit is reported as "not verified" instead of failing.
2. **Fresh review.** A separate reviewer agent gets the diff and a one-line summary of what you wanted, but not Claude's reasoning about the change. It can read surrounding code for context. It labels findings P1 to P5. It also reports code that agents add when they do not know the cause: guards for states nothing shows can happen, comments about history, TODOs without an issue link, and a second way to do a job the codebase already does. P1 and P2 need evidence: the exact line, a failure scenario, and why nothing already prevents it. Claims without evidence are shown to you as unverified.
3. **Fix.** Claude says what it will fix, then fixes P1 and P2. If a fix needs a design choice (more than one way to fix it, a visible behavior change, removing a feature, changing tests), you choose first. To see every P2 (or every P1 and P2) before anything changes, ask Claude to confirm them with you first.
4. **Re-review.** A new reviewer checks only the fixes and the findings still open. Up to 3 rounds.
5. **Stop.** A script, not the model, decides when to stop: no P1 or P2 left, the round limit, a finding that survives two fixes, a resolved finding that comes back, P1 + P2 that stops decreasing, or a fix that weakens tests or checks.
6. **Decide.** You decide the rest once: every P3 to P5, plus any P1 or P2 that is still open, could not be verified, or is about a file outside the reviewed diff. For each one you choose: keep as is, fix this time only, or make it a rule. A rule is a lint rule or a test that Claude writes next to the fix. review-loop runs your checks on the code from before the fix to show that the rule catches it.
7. **Commit.** Claude asks before committing unless you chose "stop asking in this repo". It never pushes. If you turn on the commit gate, a hook makes this a rule: Claude's commits are blocked until a review passes.

### Commit gate

The commit gate is a hook that is off until you turn it on in a repository. At the end of a review, Claude asks once whether to turn it on. With the gate on, every `git commit` that Claude runs is checked first:

| Situation | What the gate does |
|---|---|
| No review, or files changed that the review did not cover | Blocks the commit and tells Claude to run the review |
| A review loop is in progress, or decisions are still pending | Blocks the commit |
| The review passed | Asks you before committing, or allows it if you delegated commits in this repository |
| Only reviewed files, or rule drafts that `loop rule` checked, changed after the review | Asks you |
| `git push` or a force push | Always asks, even with delegation |
| A commit with `--no-verify` | Asks, even with delegation, and still blocks a commit without a passing review |
| A commit in a folder the gate cannot read, such as `cd "$(...)"` or a path that does not exist | Asks you, even with delegation, if the gate is on in the repository where you started Claude Code |

To commit once without a review, ask Claude to skip the review this time. The gate setting and commit delegation apply to the whole repository, including its linked worktrees. Each worktree keeps its own review.

Every round ends with a report:

```
Review round 2 of 3
Checks: test passed

Resolved since last round:
- F-1 [P1] Coupon total adds the discounted sum on top of the full subtotal

Trend (P1 + P2): 1 -> 0
Stopped: no P1 or P2 left in this change
Left for you: P3 1, P4 0, P5 0
```

### Severity

Based on Banksalad's public Pn rule.

| Level | Meaning | Loop behavior |
|---|---|---|
| P1 | Must fix: a failing check, data loss, a security hole, a crash, or the requested feature does not work | Fixed if it has evidence |
| P2 | Should fix: a bug a specific input reproduces, a missing requirement, a broken project rule | Fixed if it has evidence |
| P3 | Worth fixing: maintainability, a misleading name, a missing test on a minor path | You decide |
| P4 | Optional: a structural preference people disagree on | You decide |
| P5 | Trivial: a typo or formatting | You decide |

A P1 or P2 about a file that is not in the diff the round reviewed is not fixed in the loop. It comes to you at the end, marked as outside the reviewed diff, and keeps its severity.

### Measured

[`evals/review-loop/behaviors.csv`](evals/review-loop/behaviors.csv) lists 90 behaviors across six axes: do, tell, ask, silence, stop, and evidence. Unit tests in CI cover 87 of them, including runs against real temporary git repositories and the commit gate hook. The other 3 need a model run and are planned for `claude plugin eval`: asking about P3 to P5 once, showing the report before any question, and reporting code added without a known cause. The last one has a fixture in [`evals/review-loop/fixtures/reviewer-rubric/`](evals/review-loop/fixtures/reviewer-rubric/).

review-loop reviews LIM's own pull requests. [#8](https://github.com/lee-eojin/lim/pull/8) shows two loops on its first version, including a stop caused by a false positive in its own test-weakening check, which was then fixed.

### Data

State, diffs, check logs, and a decision ledger live in `.git/lim/review-loop/` inside your repository. Nothing is written to your working tree. To check a rule, review-loop writes the code from before the fix to a temporary folder outside your repository and deletes it afterwards. Delete `.git/lim/review-loop/` to reset.

review-loop makes no network calls of its own. Claude and the reviewer read the diff, the findings, and the check output like any other file in your session, so that content goes to the model provider in the same way as the rest of your Claude Code session.

### Limits

- Checks are detected from `package.json` scripts only.
- Each check gets up to 5 minutes, and all checks together up to 9 minutes. Set `LIM_CHECK_TIMEOUT_MS` to change the per-check limit.
- Without the commit gate, asking before a commit is an instruction to Claude, not a guarantee.
- The commit gate checks only commands that Claude runs through its Bash tool. Commits you type in your own terminal are not checked, and git aliases such as `git ci` are not recognized.
- If you start Claude Code in a folder that is not a repository, the gate cannot check a commit whose repository it cannot tell, for example after `cd "$(...)"`.
- It reviews everything `git add -A` would include, not a hand-picked set of staged changes.
- A rule is checked in a temporary copy that has your tracked files and a link to the root `node_modules`. Other ignored files, such as `.env` or a nested `node_modules`, are not there, so a check that needs them reports the rule as unproven or caught for the wrong reason. Claude reads the failure to tell which.

## FAQ

**Does review-loop start on its own?**
Not always. Claude starts a skill only when it decides that the skill's description fits the conversation. If you ask Claude to review or commit, Claude can start review-loop, but this is not guaranteed. The command `/review-loop:review-loop` always starts it. If you turn on the commit gate, a commit without a review is blocked and Claude is told to run review-loop first.

**Will it push or merge?**
Never. It asks before every commit unless you choose "stop asking in this repo". You can turn that off again by asking Claude to turn off review-loop's commit delegation.

**Will it conflict with my other plugins?**
review-loop adds one skill, one agent, and one hook. The hook reads Bash commands, acts only on `git commit` and `git push`, and does nothing unless you turned the commit gate on in that repository. Its names start with `review-loop:`, so they cannot collide with names from other plugins. If you ask in plain words, Claude can pick a different review skill instead. The command always starts review-loop.

**What happens if a session ends in the middle of a loop?**
Run the command again. It offers to continue from the round and step where it stopped, or to start over.

**How do I uninstall it?**

```
claude plugin uninstall review-loop@lim
claude plugin marketplace remove lim
```

Then delete `.git/lim/review-loop/` in each repository where you ran it.

## How LIM is built

- **Issues first.** Every change starts from an issue and lands through a pull request that a maintainer squash-merges.
- **Versions per plugin.** Each plugin follows Semantic Versioning, keeps its own `CHANGELOG.md`, and is tagged `<plugin>--v<version>`. Minor and major releases get a GitHub Release.
- **Small on purpose.** A plugin has one entry skill, a `SKILL.md` under 250 lines, and opt-in hooks only.

## Roadmap

- review-loop: draft rules from findings you marked "make it a rule" in earlier reviews
- Model-level evals with `claude plugin eval` for the behaviors unit tests cannot cover

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
