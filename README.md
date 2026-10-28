# LIM

**Less is more.** Small Claude Code plugins. Each plugin does one job and shows the measurements behind it.

[![CI](https://github.com/lee-eojin/lim/actions/workflows/ci.yml/badge.svg)](https://github.com/lee-eojin/lim/actions/workflows/ci.yml)
[![review-loop](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=review-loop--*&sort=semver&label=review-loop)](plugins/review-loop/CHANGELOG.md)
[![verify](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=verify--*&sort=semver&label=verify)](plugins/verify/CHANGELOG.md)
[![clear-explain](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=clear-explain--*&sort=semver&label=clear-explain)](plugins/clear-explain/CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

English | [한국어](docs/i18n/README.ko.md) | [日本語](docs/i18n/README.ja.md) | [简体中文](docs/i18n/README.zh-CN.md) | [繁體中文](docs/i18n/README.zh-TW.md) | [Español](docs/i18n/README.es.md) | [Português (Brasil)](docs/i18n/README.pt-BR.md) | [Français](docs/i18n/README.fr.md) | [Deutsch](docs/i18n/README.de.md) | [Русский](docs/i18n/README.ru.md) | [Tiếng Việt](docs/i18n/README.vi.md) | [Bahasa Indonesia](docs/i18n/README.id.md)

Coding agents write code fast. They are much worse at noticing what they got wrong. The agent that wrote a change is its weakest reviewer, because it reads the change through its own reasoning and agrees with itself. So work gets committed with no review, or with a review from the same context that wrote it.

**LIM is my answer: small plugins that each do one job, with the numbers to back them.** review-loop is the center, and verify and clear-explain work next to it.

![A review-loop run: the reviewer flags a doubled price as P2, the fix lands, the second review stops clean, and the summary table follows](docs/demo/review-loop.gif)

<sub>The loop, the checks, and the review reports are real. The findings and code edits are scripted, and the lines after start, next, and rule summarize their JSON. Regenerate it with `vhs docs/demo/review-loop.tape`.</sub>

**review-loop makes "ready to commit" mean reviewed.** Your own tests, types, and lint run first, in Node.js, Python, Go, Rust, Java (Gradle or Maven), .NET, Ruby, and Makefile projects, including up to 4 subfolder projects a change touches per round. Then a reviewer with a fresh context, which never sees Claude's reasoning, labels findings P1 to P5 and has to show evidence for the serious ones. Claude fixes P1 and P2, a new reviewer checks the fixes, and a script, not the model, decides when to stop. You decide the rest once, at the end.

**Proof by running the feature.** With [verify](plugins/verify), a finding is reproduced when a check that runs the feature fails on the reviewed code, and its fix counts only when the same check passes again.

**Comments you keep repeating become rules.** When you mark a finding "make it a rule", Claude drafts a lint rule or a test, and review-loop runs it against the code from before the fix to prove that it catches the mistake. A bug fix gets a regression test the same way.

**Small on purpose.** review-loop adds about 275 tokens to a session. Its hook does nothing until you turn it on in a repository. Nothing is installed without telling you what it is and how to remove it.

Fork it, change it, make it yours. Issues and pull requests are welcome.

## Plugins

| Plugin | Status | One job |
|---|---|---|
| [review-loop](plugins/review-loop) | 0.11.7 | Reviews your changes before you commit, fixes P1 and P2 findings, re-reviews, and hands the rest to you. |
| [clear-explain](plugins/clear-explain) | 0.1.4 | Explains concepts, code, and errors with the answer first, one meaning per word, and technical terms in their official English names. |
| [verify](plugins/verify) | 0.5.0 | Proves your features work by running them, and saves the commands and output as evidence. |

## Install

You need Claude Code, git, and Node.js 18 or later.

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

Restart Claude Code if it asks. Adding the marketplace only registers the catalog. Each plugin is installed on its own, so you get only what you pick.

## Get started

Two steps:

1. Install review-loop as above.
2. In a git repository with uncommitted changes, type:

```
/review-loop:review-loop
```

That is all. review-loop runs your checks, reviews the change, fixes what must be fixed, and asks you about the rest. At the end it asks once whether to turn on the commit gate for this repository, and then whether to commit.

New here? The [guide](docs/guide/README.md) walks through a first review, deciding, the commit gate, cost, and pitfalls, with real output.

## Usage

### Just use `/review-loop:review-loop`

Type it whenever you are about to commit. You can add what you want in plain words after the command:

```
/review-loop:review-loop I changed the coupon math. Check it before I commit.
```

```
/review-loop:review-loop confirm every P2 with me before you fix anything.
```

Claude can also start review-loop on its own when you ask it to review or commit, but only when it decides the skill fits. The command always starts it.

### What a round looks like

Every round ends with a report. Claude shows it before anything else:

```
Review round 2 of 3 (reviewer: session model)
Checks: test (npm run test) passed

Resolved since last round:
- F-1 [P1] Coupon total adds the discounted sum on top of the full subtotal (fixed, inferred: the re-review read the fix)
  test: src/coupon.test.js (before the fix: caught, after: passed)

Trend (P1 + P2): 1 -> 0
Stopped: no P1 or P2 left in this change
Left for you: P3 1, P4 0, P5 0
```

Here round 1 found a P1. Claude fixed it and wrote a regression test, and review-loop showed that the test fails on the code from before the fix. Round 2 confirmed the fix, so the loop stopped. One P3 is left for you.

### Examples

<details>
<summary>All the prompts</summary>

```
review before commit:   /review-loop:review-loop
with intent:            /review-loop:review-loop I moved the retry logic into the client. Check it
                        before I commit.
confirm P2 first:       /review-loop:review-loop confirm every P2 with me before you fix anything.
confirm P1 and P2:      /review-loop:review-loop confirm every P1 and P2 with me before you fix anything.
stop confirming:        /review-loop:review-loop stop confirming findings with me before fixes.
continue a loop:        /review-loop:review-loop
                        (in a new session it offers to continue where the last loop stopped)
turn on the gate:       /review-loop:review-loop turn on the commit gate in this repo.
turn off the gate:      /review-loop:review-loop turn off the commit gate in this repo.
skip once:              /review-loop:review-loop commit this without a review, just this once.
delegate commits:       /review-loop:review-loop stop asking before commits in this repo.
take it back:           /review-loop:review-loop turn off commit delegation.
run unattended:         /review-loop:review-loop run unattended. I will read the summary in the morning.
reviewer model:         /review-loop:review-loop run the reviewer on sonnet in this repo.
```

</details>

## How a review runs

Before you commit, review-loop runs a short loop and stops on its own.

1. **Checks.** It runs the `typecheck`, `lint`, and `test` checks your project declares: `package.json` scripts, Makefile targets, or the defaults for Go (`go.mod`), Rust (`Cargo.toml`), the Python tools you configure, Gradle, Maven, .NET, and the Ruby tools you use. A failing check, or a `package.json` that is not valid JSON, becomes a P1 finding. A check that runs past its time limit, or whose program is not installed, is reported as "not verified" instead of failing.
2. **Fresh review.** A separate reviewer agent gets the diff and a one-line summary of what you wanted, but not Claude's reasoning about the change. It can read surrounding code for context. It labels findings P1 to P5. P1 and P2 need evidence: the exact line, a failure scenario, and why nothing already prevents it. Each finding is labeled measured, inferred, or guessed. A P1 or P2 without evidence, or a guessed one, is shown to you as unverified instead of being fixed.
3. **Fix.** Claude says what it will fix, then fixes P1 and P2. If a fix needs a design choice (more than one way to fix it, a visible behavior change, removing a feature, changing tests), you choose first. If your project has a test script, Claude writes a regression test from the failure scenario of each P1 or P2 it fixes, and review-loop shows that the test fails on the code from before the fix.
4. **Re-review.** A new reviewer checks only the fixes and the findings still open. Up to 3 rounds.
5. **Stop.** A script, not the model, decides when to stop: no P1 or P2 left, the round limit, a finding that survives two fixes, a resolved finding that comes back, P1 + P2 that stops decreasing, or a fix that weakens tests or checks.
6. **Decide.** You decide the rest once: every P3 to P5, plus any P1 or P2 that is still open, could not be verified, or is about a file outside the reviewed diff. For each one you choose: keep as is, fix this time only, or make it a rule. A finding you keep as is is not asked about again in a later review until its quoted line changes, and the report counts it instead. When earlier reviews in this repository raised one of the four kinds the reviewer looks for (such as a speculative guard) 3 times or more, Claude says so and recommends making it a rule at the strongest layer that fits: a type or architecture change, then a lint rule, then a test.
7. **Commit.** Claude asks before committing unless you chose "stop asking in this repo". It never pushes. If you turn on the commit gate, a hook makes this a rule: Claude's commits are blocked until a review passes.

When Claude says something is fixed, it says how it knows: a check that now passes is measured, and its reading of the new code is inferred. When you push back on a finding, Claude checks the claim again before it agrees, and tells you what it checked.

### What the reviewer looks for

The reviewer looks for bugs, missing requirements, broken project rules, and anything else that would make the change fail at what you said you wanted. It does not argue with what you wanted. It also looks for four kinds of code that agents add when they do not know the cause of a problem, because the next agent copies them:

<details>
<summary>The four kinds</summary>

| Kind | What it is | Severity |
|---|---|---|
| Speculative guard | A check, try/catch, fallback, or default for a state that nothing shows can happen | P2 when it hides a failure, otherwise P3 |
| History comment | A comment about who asked for what, why an earlier version changed, or an instruction to agents | P4 |
| Shortcut marker | A TODO, HACK, "temporary", or "for now" comment without an issue link | P3 |
| Second way | A helper, pattern, or dependency for a job the codebase already does another way | P3 |

A guard is correct where a legitimate state enters the code: user input, a network or file read, or a value an API documents as possibly missing. A second check further in, for a state already handled, is still speculative. A fixture in [`evals/review-loop/fixtures/reviewer-rubric/`](evals/review-loop/fixtures/reviewer-rubric/) contains one of each kind and checks that the reviewer flags them.

</details>

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

### Rules and regression tests

A comment that a reviewer has to repeat is a missing rule. review-loop keeps count: each review records the kind of every finding in a file shared by all worktrees of the repository, and a finding of one of the four kinds above whose kind earlier reviews raised 3 times or more is marked as a repeat. Broad labels such as correctness are recorded but never count as a repeat. When you choose "make it a rule" for a finding, Claude first looks for an existing rule in your lint config or tests that should have caught it. Then it picks the first form that works: turn on an existing lint rule, write a custom rule for the linter you already use, or write a test. The draft never goes in the file the finding is about.

review-loop then proves the draft. It writes the code from before the fix to a temporary folder and runs your checks there, with and without the draft:

| Result | Meaning |
|---|---|
| `caught` | A check fails only with the draft. The rule catches the mistake. |
| `missed` | Every check passes with the draft. Claude revises it once. |
| `unproven` | A check timed out, or it also fails without the draft. Claude tells you which. |

A rule needs a check that would run it. Without a `typecheck`, `lint`, or `test` script, the choice is recorded as "fix this time only" and Claude tells you why. A proven draft goes into the same commit as the fix, and the commit message names it.

Each P1 or P2 that Claude fixes gets a regression test the same way, without asking, when your project has a test script. For a regression test, only the test check counts as proof: if only lint fails with it, the test did not catch the bug. A fix without a test says why in the report.

### Commit gate

The commit gate is a hook that is off until you turn it on in a repository. At the end of a review, Claude asks once whether to turn it on. With the gate on, every `git commit` that Claude runs is checked first.

<details>
<summary>What the gate does</summary>

| Situation | What the gate does |
|---|---|
| No review, or files changed that the review did not cover | Blocks the commit and tells Claude to run the review |
| A review loop is in progress, or decisions are still pending | Blocks the commit |
| The review passed | Asks you before committing, or allows it if you delegated commits in this repository |
| Only reviewed files, or rule drafts and regression tests that `loop rule` checked, changed after the review | Asks you |
| `git push` or a force push | Always asks, even with delegation |
| A commit with `--no-verify` | Asks, even with delegation, and still blocks a commit without a passing review |
| A commit in a folder the gate cannot read, such as `cd "$(...)"` or a path that does not exist | Asks you, even with delegation, if the gate is on in the repository where you started Claude Code |

To commit once without a review, ask Claude to skip the review this time. The gate setting and commit delegation apply to the whole repository, including its linked worktrees. Each worktree keeps its own review.

</details>

### Settings

The first five settings apply to one repository. Change one by typing the request after `/review-loop:review-loop`, so Claude has the skill's commands loaded. The check time limit is an environment variable, so it applies wherever you set it, and the 9-minute total is fixed.

| Setting | Default | Type |
|---|---|---|
| Confirm before fixing | Off | "confirm every P2 with me" or "confirm every P1 and P2 with me" |
| Commit gate | Asked once at the end of the first review | "turn on (or off) the commit gate" |
| Commit delegation | Asks before every commit | "stop asking before commits in this repo" |
| Unattended | Off | "run unattended" for one run, or "turn on (or off) unattended mode in this repo". Claude asks nothing, leaves what needs you for later, and ends with a summary of what it did and what waits for you |
| Reviewer model | The session's model | "run the reviewer on sonnet in this repo" (or opus, haiku, fable), or "run the reviewer on the session's model". Measured below shows what each model found and cost |
| Check time limit | 5 minutes per check, 9 minutes in total | Set `LIM_CHECK_TIMEOUT_MS` to change the per-check limit |

## Measured

[`evals/review-loop/behaviors.csv`](evals/review-loop/behaviors.csv) lists 258 behaviors across six axes: do, tell, ask, silence, stop, and evidence. Unit tests in CI cover 247 of them, including runs against real temporary git repositories and the commit gate hook. The other 11 need a model run: asking about P3 to P5 once, showing the report before any question, keeping every step in the todo list with a reason for each skip, writing a regression test for each fixed P1 or P2, labeling each finding measured, inferred, or guessed, saying how a fix is known, checking a finding again when you push back, recommending a rule for a kind of finding that keeps coming back, asking nothing in an unattended run, starting the reviewer on the model you chose, and reporting code added without a known cause. The last one has a fixture in [`evals/review-loop/fixtures/reviewer-rubric/`](evals/review-loop/fixtures/reviewer-rubric/), and the first two have a manual run in [`evals/review-loop/manual-behaviors.md`](evals/review-loop/manual-behaviors.md).

A detection benchmark gives the reviewer changes in temporary repositories whose names do not say they are a test. [`evals/review-loop/detection/`](evals/review-loop/detection/) has 12 changes with one seeded bug each and 6 clean changes. [`evals/review-loop/detection-hard/`](evals/review-loop/detection-hard/) has 10 harder bugs, such as one you only see in a file the diff does not touch, one you see only by following four files, one inside a 183-line diff, a race between two searches, a buffer emptied before an async write reads it, and a lock left held on an error path, and 6 clean changes that look suspicious. Results with 3 runs per case, from 2026-10-25 for the regular set and 2026-10-26 for the harder set:

| Reviewer model | Regular set: bugs found as P1 or P2 | Regular set: false P1 or P2 on clean changes | Harder set: bugs found as P1 or P2 | Harder set: false P1 or P2 on clean changes | Cost of the harder set (48 runs) |
|---|---|---|---|---|---|
| claude-opus-5-5 | 36 of 36 | 0 of 18 | 30 of 30 | 0 of 18 | $3.11 |
| claude-sonnet-5-5 | not run | not run | 29 of 30 | 0 of 18 | $1.14 |
| claude-haiku-5-5 | not run | not run | 30 of 30 | 3 of 18 | $0.09, as reported by Claude Code |

By default the reviewer runs on your session's model. Opus found every seeded bug in both sets, so the benchmark cannot yet show a drop in bugs found for it. To see whether it shows a worse `reviewer.md` at all, Opus also ran the harder set with a `reviewer.md` cut down to its output format: it still found 30 of 30, drew 1 false P2 in 18 clean runs, and raised 83 P3 to P5 findings where the full reviewer raised 55. For Opus, finding these bugs depends on the model more than on the instructions, and a worse `reviewer.md` shows up as false alarms and noise. Sonnet's one miss returned no finding for the buffer emptied before an async write. Haiku's 3 false alarms were all on one clean case, which also drew 1 false P2 in 9 Opus runs of the full reviewer over two days. A finding counts when it names the seeded bug at a changed line, or, for a bug you only see in another file, at a marked line in that file. After the first runs, keywords were added in four cases where a reviewer named the seeded bug in words the scoring did not accept, and every saved run was scored again with them. Run it again with `node evals/review-loop/run-detection.mjs --runs 3`, and add `--cases evals/review-loop/detection-hard` for the harder set.

The table above is the basis for the reviewer's default model. On the harder set, Opus found 30 of 30 with no false P1 or P2, Sonnet found 29 of 30 with none at about 37% of Opus's cost, and Haiku found 30 of 30 with 3 false P1 or P2 in 18 clean runs. So the default stays the session's model, and Sonnet is the cheaper choice when you want the reviewer on a different model than the one that wrote the change.

[`evals/review-loop/detection-languages/`](evals/review-loop/detection-languages/) has 6 seeded bugs in Python, Rust, and Go and 2 clean changes. With 3 runs per case, Opus and Sonnet found 18 of 18 and Haiku 16 of 18, with no false P1 or P2 in 6 clean runs for any of them; the [review-loop README](plugins/review-loop/README.md#measured-behavior) has the details.

<details>
<summary>Cost</summary>

`claude plugin details` estimates review-loop's cost as:

| Part | Always on, every session | Each time it runs |
|---|---|---|
| review-loop skill | about 210 tokens | about 6,000 tokens |
| reviewer agent | about 60 tokens | about 1,800 tokens, plus the diff and the code it reads |

The skill's cost is paid once per run. The reviewer's cost is paid once per round, and a loop runs at most 3 rounds. The reviewer model changes that cost; the benchmark table above shows it for each model. Your checks run on your machine and cost no tokens.

</details>

review-loop reviews LIM's own pull requests. [#8](https://github.com/lee-eojin/lim/pull/8) shows two loops on its first version, including a stop caused by a false positive in its own test-weakening check, which was then fixed. Recent pull requests, such as [#46](https://github.com/lee-eojin/lim/pull/46), show the review-loop report and the decision for each finding.

## Why it works this way

<details>
<summary>Why a fresh reviewer?</summary>

The agent that wrote a change knows why every line is there, so it reads the change as correct. A reviewer that gets only the diff and one line of intent has to find the reason in the code. If the reason is not there, that is a finding. Each round starts a new reviewer, so a reviewer never grades its own earlier verdict.

</details>

<details>
<summary>Why does a script decide when to stop?</summary>

A model asked "is this done?" tends to say yes. review-loop's script counts instead: it stops when no P1 or P2 is left, after 3 rounds, when a finding survives two fixes, when a resolved finding comes back, when P1 + P2 stops going down, or when a fix weakens a test. Stopping with open findings is a normal outcome, and Claude says so.

</details>

<details>
<summary>Why do P1 and P2 need evidence?</summary>

A confident claim and a proven one look the same in a report. A P1 or P2 must quote the exact line, give an input that produces a wrong result, and say why nothing already prevents it. Without all three, or when the reviewer labels it guessed, it is shown as unverified and Claude does not change code for it.

</details>

<details>
<summary>Why is the commit gate opt-in?</summary>

A hook that blocks commits changes how you work, so it should be your choice per repository. Without the gate, "ask before committing" is an instruction Claude follows. With it, the hook blocks a `git commit` that Claude runs without a passing review. It cannot see everything: [Limits](#limits) lists what it misses, such as commits you type in your own terminal.

</details>

<details>
<summary>Why does it never push?</summary>

A commit is local and easy to undo. A push is not. review-loop stops at the commit, and the gate asks before every push even when you delegated commits.

</details>

## Data

State, diffs, check logs, and a decision ledger live in `.git/lim/review-loop/` inside your repository. Claude writes each review to `.lim-review/` in your working tree for a moment; git ignores that folder through `.git/info/exclude`, and review-loop deletes the file after reading it. To check a rule, review-loop writes the code from before the fix to a temporary folder outside your repository and deletes it afterwards. Delete `.git/lim/review-loop/` to reset.

review-loop makes no network calls of its own. Claude and the reviewer read the diff, the findings, and the check output like any other file in your session, so that content goes to the model provider in the same way as the rest of your Claude Code session.

## Limits

- Checks are detected from `package.json` scripts, then Makefile targets, then Go, Rust, configured Python tools (pytest, ruff, mypy), Gradle, Maven, .NET, and Ruby tools the project uses (rspec, rake test, rubocop), at the repository root and in the subfolder projects a change touches, up to 4 per round.
- Each check gets up to 5 minutes, and all checks together up to 9 minutes.
- Without the commit gate, asking before a commit is an instruction to Claude, not a guarantee.
- The commit gate checks only commands that Claude runs through its Bash tool. Commits you type in your own terminal are not checked. A commit through a git alias such as `git ci` is checked like `git commit`, a shell alias (`!...`) that commits is asked about because the gate cannot see inside it, and an alias set inline with `git -c alias.ci=commit` is not recognized.
- If you start Claude Code in a folder that is not a repository, the gate cannot check a commit whose repository it cannot tell, for example after `cd "$(...)"`.
- It reviews everything `git add -A` would include, not a hand-picked set of staged changes.
- A rule or a regression test is checked in a temporary copy that has your tracked files and links to the `node_modules` of the root and of the projects that hold the finding and the drafts. Other ignored files, such as `.env`, are not there, so a check that needs them reports it as unproven or caught for the wrong reason. Claude reads the failure to tell which.

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

Then delete `.git/lim/review-loop/` in each repository where you ran it, and the `.lim-review/` line in its `.git/info/exclude`.

## Make it yours

review-loop works with the checks you already have. The better your `typecheck`, `lint`, and `test` scripts, the more of the review is measured instead of read.

- Want to see the serious findings before anything changes? Ask Claude to confirm every P2, or every P1 and P2.
- Tired of approving commits in a repository you trust? Delegate commits there. With the commit gate on, pushes still ask.
- Keep getting the same comment? Choose "make it a rule", and the next review starts with that mistake already caught by your own linter or tests.
- Want a different flow? Fork the plugin. The skill is one `SKILL.md` under 250 lines, and the loop logic is one script, `plugins/review-loop/skills/review-loop/scripts/loop.mjs`.

## How LIM is built

- **Issues first.** Every change starts from an issue and lands through a pull request that a maintainer squash-merges.
- **Reviewed by itself.** Every pull request runs review-loop on its own diff, and the description shows the report and a decision for each finding.
- **Versions per plugin.** Each plugin follows Semantic Versioning, keeps its own `CHANGELOG.md`, and is tagged `<plugin>--v<version>`. Minor and major releases get a GitHub Release.
- **Small on purpose.** A plugin has one entry skill, a `SKILL.md` under 250 lines, and opt-in hooks only.

## Roadmap

- Model-level evals with `claude plugin eval` for the behaviors unit tests cannot cover, and a blind comparison of review quality and cost

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
