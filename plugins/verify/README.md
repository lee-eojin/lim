# verify

Prove that features work by running them. Claude writes a feature map of what your project does, the command that exercises each feature, and what the result must show. A script runs every command, decides pass, fail, or not verified with fixed rules, and saves the output as evidence. The model never marks a check as passed.

## Install

```
/plugin marketplace add lee-eojin/lim
/plugin install verify@lim
```

Needs Node.js 18 or later and git. verify installs nothing.

## Use

Run `/verify:verify`. Asking Claude to verify or prove that features work can also start it, but that depends on the model noticing, so the command is the reliable way.

Prompts you can copy:

```
/verify:verify Check that this project's features work.
/verify:verify Add a check for the new --dry-run option and run it.
/verify:verify Run only the export checks again.
/verify:verify Show me the evidence from the last run.
```

What happens:

1. Claude reads the project: `package.json`, the README, help text, and what a library exports. It lists the features, including documented errors.
2. It writes `verify.features.json` at the repository root. Each entry names a feature, the program to run with its arguments, the exit code, and what stdout, stderr, or a written file must show. Expected results come from the docs and from what you asked for, not from running the code first, so a broken feature fails instead of becoming the expectation.
3. It runs `verify.mjs run`. The script refuses a map with a check that cannot fail in a way it knows, then starts each check's program without a shell, with a time limit, and decides the result.
4. Claude shows the report as printed, then says which features failed, what was expected and where that comes from, and what came out.

Claude runs the script as a plain command on its own, `node <absolute path>/skills/verify/scripts/verify.mjs run`, and reads files with the Read tool. A headless run (`claude -p`) cannot ask for permission, so allow what verify uses, for example `--allowedTools "Read,Grep,Glob,Write,Edit,Skill,Bash(node:*)"` or the same entries under `permissions.allow` in your settings. `Bash(node:*)` matches the script; the programs in your feature map are started by the script, without a shell, so they need no rule of their own. `Bash(node:*)` also allows any other `node` command; to allow only verify, use `Bash(node <absolute path>/skills/verify/scripts/verify.mjs:*)`.

A failing check is reported, not fixed. Claude does not edit a failing check to make it pass, and does not change your code unless you ask. If you ask for a fix, Claude fixes the code and runs that check again.

A report looks like this:

```
verify: 9 passed, 1 failed, 0 not verified (10 checks, 0.4 s)

FAIL fahrenheit-to-celsius: Converts Fahrenheit to Celsius
  $ node cli/temp.mjs 212 --from F --to C
  - stdout does not equal "100 C"
  stdout: 117.77777777777777 C

Passed: celsius-to-fahrenheit, kelvin-output, below-absolute-zero, ...

Evidence: /path/to/repo/.git/lim/verify/runs/2026-10-25T14-32-11-200Z.json
```

## Rules the script applies

| Result | When |
|---|---|
| pass | The command finished within its time limit, the exit code matched, and every expected output and file matched |
| fail | The command finished, but the exit code, an output, or a file did not match. Each reason is listed |
| not verified | The command timed out, or the program could not start, for example because it was not found, or its `stdin` file does not exist, or a file it expects or reads already satisfied a rule before the run |

A check's `run` is a list in one of two forms, and the script refuses everything else:

- `node`, then a script file in the repository, then its arguments, for example `["node", "cli/temp.mjs", "--to", "c", "100"]`, with no node option before the script
- a path to a script file in the repository whose first line is `#!/usr/bin/env node`, or `#!` and an absolute path outside the repository ending in `/node`, with nothing after `node`, then its arguments, for example `["./bin/temp", "--help"]`

Both forms mean that node runs a script in the repository. Other programs are refused: `npx`, `npm run` and other package runners, wrappers such as `timeout`, `nice`, `xargs`, or `env`, shells, other interpreters, files outside the repository or in `node_modules/` or `.git/`, a binary such as a copy of node placed in the repository, and a script whose `#!` line runs a shell, another interpreter, or node with an option, such as `#!/usr/bin/env -S node --require ./hook.js`. The script starts the program without a shell. Input that a pipe used to feed goes in `stdin` (text, or `{ "file": "<path>" }`), extra variables go in `env`, and the folder the program starts in goes in `cwd`. `env` cannot set `PATH` or a name that changes how a program loads or runs code: `NODE_OPTIONS` and every other `NODE_` name except `NODE_ENV`, `HOME` and `USERPROFILE` (node looks for modules there), `OPENSSL_CONF` (loaded at startup), `LD_` and `DYLD_` names, `BASH_ENV`, `ENV`, and the Python, Perl, and Ruby startup and library path variables.

Every path in a check is relative to the repository root, whatever `cwd` is: the script or executable in `run`, the `stdin` file, and each expected file. `cwd` only sets the folder the program starts in; the arguments after the script are passed as they are, so the program reads them from there. A path that leaves the repository is refused, and refusals and reports show each path as it resolves from the root.

A file expectation needs a content rule (`includes`, `matches`, or `equals`) and passes only if this run created the file or changed its content; a new modification time alone does not count. If the file already satisfies the rule before the run, for example because an earlier run left it, the check is not run and is reported as not verified. For `includes` and `equals` this is also checked with all whitespace removed from the rule and the text, for the expected file itself and for the stdin file and every file named in `run`, so a command that only copies or reformats one of those, such as compact JSON written out again indented, cannot pass.

The script refuses a feature map, and runs nothing, when a check cannot fail in one of these ways:

- an expected pattern that empty output, `undefined`, a Node.js crash, the command text, the `stdin` text, or the text of a file named as an argument in `run` would satisfy, such as `.*` or `Error`; a `stdin` file and each file named in `run` are read for this when the map is read, and again just before the check runs
- a `run` written as a string, or not in one of the two forms above
- a path that leaves the repository
- an `env` name listed above
- an entry that expects only an exit code, or a file expectation with only a path
- unknown keys, so a typo such as `stdOut` cannot turn a rule off, and `env` names that are not variable names

### What this does not prove

verify refuses common ways a check cannot fail, runs only node on the project's own scripts without a shell, records what ran, and flags a check whose definition or named helper files in `verify-checks/` changed after it failed. It cannot prove that a check is honest. A helper script in `verify-checks/` is code Claude writes, and it could still be written to always print the expected text and exit 0; so can any script the project runs. A `#!` line with an absolute path outside the repository that ends in `/node` is taken to be node; verify does not check what is installed there. That is why the feature map and the files in `verify-checks/` are part of what a person reviews, like any other code.

If a check changes after it failed, or is removed from the map after it failed, the next report says so, whichever checks that run selects with `--id`, and the evidence records it. A change to the check includes an edit to a file in `verify-checks/` that it names: its program, an argument, or its `stdin` file. A check that rewrites its own starting file, or a starting file written back to its content from before the failed run, does not count as a change, and neither does fixing your project's code.

The map format is in [`skills/verify/references/feature-map.md`](skills/verify/references/feature-map.md). You can run the script without Claude, for example in CI: `node <plugin>/skills/verify/scripts/verify.mjs run` exits 0 when every check passes, 1 when one fails or is not verified, and 2 when the map has problems.

## Measured

[`evals/verify/behaviors.csv`](../../evals/verify/behaviors.csv) lists 80 behaviors. Unit tests in CI cover 74 of them, running the script against real temporary git repositories. The other 6 need a model run: writing expectations from the docs, not reporting working features as failing, showing the report and the source of each expectation, not editing a failing check, not changing code unless asked, and asking before changing a check or installing anything. The benchmark below measures the first five; the last is not measured yet.

A blinded benchmark in [`evals/verify/`](../../evals/verify/) copies small Node.js projects to a temporary folder under their own package name, with one commit, and runs `/verify:verify` headlessly with only the allow list above (`Read,Grep,Glob,Write,Edit,Skill,Bash(node:*)`) in don't-ask mode. Four projects (a title-to-URL tool and library, a CSV statistics tool, a to-do tool that writes a JSON file, and a duration parsing library) each have a broken variant where one documented feature is wrong; two of them also run unbroken. A broken feature counts as caught when a check Claude wrote fails on the broken copy and passes on a fresh working copy. The skill's examples use invented projects, and a test fails if any file in this plugin shares a project name, check id, feature sentence, command, or expected text with the benchmark, or any word of five or more characters from a reference argument or expected output, apart from a short list of common words with a reason for each. Results from 2026-10-26, one run per case, claude-opus-5-5, Claude Code 2.1.310, in the order of [`cases.json`](../../evals/verify/cases.json):

| Case | Broken feature | Checks written | Result | Tokens | Cost | Time |
|---|---|---|---|---|---|---|
| title-to-URL tool, broken | accented letters | 12 | caught (1 check) | 152,939 | $0.29 | 40 s |
| CSV statistics tool, broken | mean with skipped cells | 10 | caught (2 checks) | 187,684 | $0.31 | 42 s |
| to-do tool, broken | `done` marks the wrong item | 8 | caught (1 check) | 190,538 | $0.33 | 57 s |
| duration library, broken | parsing `ms` | 10 | caught (1 check) | 282,847 | $0.31 | 44 s |
| CSV statistics tool, working | none | 10 | no failures | 221,905 | $0.31 | 43 s |
| to-do tool, working | none | 9 | no failures | 190,670 | $0.33 | 57 s |

Broken features caught: 4 of 4: the CSV case by two checks, the others by one each. Working features reported as failing: 0. Misses: 0. Error runs: 0; a run in which no check ran would count as an error, not as a miss. One map was refused: in the working CSV case, Claude's first call to the script was refused because one check expected stdout to equal an empty string, which empty output also satisfies, so that check could not fail; Claude removed that rule and the second call ran every check. Every other run called the script once. No permission was denied, no check was edited or removed after failing, no project code was changed, and no check was left not verified. Every check used the `node` form: the project's own file in `bin/`, or, for the library checks, a script Claude wrote in `verify-checks/`. No check started an executable, so the narrowed second form is covered by the unit tests only. Claude wrote 20 files in `verify-checks/` across the six runs: 11 to-do lists and 4 CSV files that checks read or change, 4 helper scripts that call a library function, and 1 placeholder that creates the folder one check starts in. Both to-do runs again wrote a check that starts in a folder under `verify-checks/` and names the file it expects from the repository root; it passed in both. Total: 1,226,583 tokens, $1.87 as reported by Claude Code, 283 s.

Note on earlier runs: the table is a full re-run after the final review: a program in `run` other than `node` must be a script whose first line runs node with no option, `env` cannot set `HOME`, `USERPROFILE`, or `OPENSSL_CONF`, a file rule is also probed against the content from before the run with whitespace removed, a file named in `run` is probed like a `stdin` file, and the results file now keeps every field of each check, including `cwd`. The six runs before it caught 4 of 4, each by one check, with no false failures and no refused map (1,072,118 tokens, $1.76), but they ran with the previous SKILL.md and script, so they are superseded. Before those, every path in a map entry other than the arguments in `run` became relative to the repository root, whatever `cwd` is. The six runs before that change caught 4 of 4 but had 2 false failures, one in each to-do case, both from that same check: the script then read the expected file's path from `cwd`, so it looked for `verify-checks/default/verify-checks/default/todo.json` and reported it as not created. In both runs Claude's final message said the check was wrong, not the tool, and asked before changing it. Before those, what a check may run changed to the two forms above, and file and stdin rules started being probed against content from before the run. The six runs before that allowed any program as the first item of `run`; they caught 4 of 4 with no false failures, but they ran with the previous SKILL.md and script, so they are superseded. Before them, the map format changed from a shell command string to a list of the program and its arguments. The six runs before that used the string format with bash and pipefail and also caught 4 of 4 with no false failures. With that change the runner started copying each fixture to the fresh working copy as Claude last wrote it, because a check can change its own starting file. Before that, the first full set of runs also caught 4 of 4 with no false failures, but it does not count, because it was primed. The skill's reference file, which SKILL.md tells Claude to read, used three of the benchmark projects as its examples, including the exact checks that catch two of the breaks, and this README's sample report showed one of those checks failing. Every example in the plugin was rewritten around invented projects, and all six cases were run again. Before that, with an earlier SKILL.md, two runs of the broken CSV case ran no check: Claude's only Bash call chained `git ls-files`, `cat`, and a `cat` of the skill's reference file outside the repository, Claude Code refused it, and Claude took the refusal as Bash being blocked. SKILL.md now says to read files with the Read tool and to run the script alone as a plain `node` command. The very first broken CSV run was miscounted because the runner did not copy a fixture file Claude created into the fresh working copy; the runner now copies the untracked files Claude wrote with its file tools, and never files the checks wrote. The results file keeps every earlier run under `supersededRuns` with the reason. One later change, which also refuses a rule that a file named in `run` already satisfies once whitespace is ignored, came after this run and was not re-run; it only refuses more maps.

Costs are list-price estimates reported by Claude Code. Run it yourself with `node evals/verify/run-benchmark.mjs`; `--dry-run` checks every project's reference map without a model.

Token cost from `claude plugin details`: about 100 tokens in every session, about 3,500 each time the skill runs.

## Data

The feature map, `verify.features.json`, and the scripts and starting files Claude writes for it in `verify-checks/` live in your repository so they can be reviewed like code. Each run's evidence goes to `.git/lim/verify/runs/` as JSON: per check, the command, folder, status, reasons, exit code, duration, the first 1,000 and last 3,000 characters of stdout and stderr, and the files it checked; per run, the map's hash, the commit, and the number of uncommitted files besides the map. The last 20 runs are kept. `.git/lim/verify/checks.json` holds each check's last status and a hash of each file in `verify-checks/` it names, from before and after that run. Delete `.git/lim/verify/` to reset.

verify makes no network calls of its own. The commands in your feature map run on your machine with your permissions, like any command Claude runs, so review the map before running it in a project you do not trust. Command output goes to the model provider like the rest of your session.

## Limits

- Node.js command-line tools and libraries that a command can exercise. No browser, mobile, or GUI apps, and nothing that needs an install or the network.
- No shell features: a check cannot use pipes, `&&`, redirects, globs, or `$NAME` in `run`. Use `stdin` instead of a pipe, `env` for variables, and a script or starting file written with the Write tool for setup. A library function is called from a small script, not with `node -e`.
- Only `node` with a project script, or a project script whose first line runs node. A tool that only runs through `npx`, `npm run`, or another package runner cannot be checked unless the project has a file that `node` can run.
- A file check expects a file that does not already match: before running a file check again, delete the file the last run wrote, or write it empty, or write the starting file again.
- Tested on macOS and Linux. Windows is not supported yet.
- Each check gets 30 seconds unless its entry sets `timeoutMs` (up to 10 minutes); set `LIM_VERIFY_TIMEOUT_MS` to change the default (a whole number from 1 to 600000; any other value is refused). One run stops starting checks after 9 minutes and reports the rest as not verified.
- Checks run one at a time. A check that writes files can affect the next; use separate paths.
- "Changed after it failed" covers the feature map entry and only the files a check names inside `verify-checks/`, each as the whole argument. A file elsewhere, a file that a named script imports, or a path inside a longer argument such as `--out=verify-checks/a.txt` is not covered.
- The script refuses checks that cannot fail in the ways listed above, and only those. It cannot tell whether an expectation is what your project promises, or whether a helper script Claude wrote can fail; that is what the review of `verify.features.json` and `verify-checks/` is for.

## Uninstall

```
/plugin uninstall verify@lim
```

Then delete `verify.features.json` and `.git/lim/verify/` from any repository where you used it.
