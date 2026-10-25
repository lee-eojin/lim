# Feature map format

`verify.features.json` at the repository root. `verify run --map <file>` reads another path.

```json
{
  "features": [
    {
      "id": "fahrenheit-to-celsius",
      "feature": "Converts Fahrenheit to Celsius",
      "run": ["node", "cli/temp.mjs", "212", "--from", "F", "--to", "C"],
      "expect": {
        "exitCode": 0,
        "stdout": { "equals": "100 C" }
      }
    }
  ]
}
```

## Paths

Every path in an entry is relative to the repository root, whatever `cwd` is: the script or executable in `run`, `stdin.file`, and each path in `expect.files`. `cwd` only sets the folder the program starts in. The arguments after the script or executable are passed to the program as they are, so the program reads a path among them from `cwd`. A path that leaves the repository is refused, and messages show each path as it resolves from the root.

## Entry fields

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Lowercase letters, digits, and hyphens. Unique. Used with `--id`. |
| `feature` | yes | One sentence a user would recognize: what the feature does. |
| `run` | yes | A list of strings in one of the two forms below: `node` and a script file in the repository, or a node script in the repository started as a program, then the arguments. The script starts it in `cwd`, without a shell. |
| `stdin` | no | What the program reads on stdin: a string, or `{ "file": "<path>" }`. Default: empty. |
| `env` | no | Extra environment variables, such as `{ "TZ": "UTC" }`. Names are letters, digits, and `_`, not starting with a digit; values are strings. `PATH` and names that change how a program loads or runs code cannot be set: every name starting with `NODE_` except `NODE_ENV`, `LD_` and `DYLD_` names, `HOME` and `USERPROFILE` (node looks for modules there), `OPENSSL_CONF` (loaded at startup), `BASH_ENV`, `ENV`, `BASHOPTS`, `SHELLOPTS`, `PS4`, `ZDOTDIR`, `PYTHONSTARTUP`, `PYTHONPATH`, `PYTHONHOME`, `PERL5OPT`, `PERL5LIB`, `PERLLIB`, `RUBYOPT`, and `RUBYLIB`. |
| `cwd` | no | The folder inside the repository that the program starts in. Default: the root. |
| `timeoutMs` | no | Time limit for this check. Default 30000 (or `LIM_VERIFY_TIMEOUT_MS`), at most 600000. |
| `expect` | yes | What the result must show. |

## What a check can run

| Form | Example |
|---|---|
| `node`, a script file in the repository, then arguments | `["node", "cli/temp.mjs", "25", "--to", "K"]`, `["node", "verify-checks/expand-ports.mjs"]` |
| A script file in the repository whose first line is `#!/usr/bin/env node` or `#!/<path>/node`, then arguments | `["./bin/temp", "25"]`, `["bin/temp", "--help"]` |

The path must stay inside the repository, also after following a symbolic link, and outside `node_modules/` and `.git/`. Nothing goes between `node` and the script. A script started as a program must name node in its first line with nothing after it but blanks; the path in `#!/<path>/node` must be absolute and outside the repository. Both forms mean that node runs a script in the repository. Arguments after the script or executable are passed to it as they are, even ones that start with `-`. Everything else is refused:

| Refused | Example | Instead |
|---|---|---|
| `run` is a string | `"run": "node cli/temp.mjs 25"` | `["node", "cli/temp.mjs", "25"]` |
| A program found on `PATH` | `["npx", "tsc"]`, `["npm", "run", "check"]`, `["pnpm", "exec", ...]`, `["bunx", ...]`, `["timeout", "20", ...]`, `["env", ...]`, `["sh", "-c", "..."]`, `["python3", ...]` | Run the project's file with `node`, or the project's own node script |
| A node option before the script | `["node", "-e", "..."]`, `["node", "--import", "...", "cli/temp.mjs"]`, `["node", "-r", "./setup.js", ...]` | Write a script file and run it with `node` |
| A file outside the repository, in `node_modules/`, or in `.git/` | `["/bin/sh", ...]`, `["./node_modules/.bin/eslint"]`, `["node", "../cli/temp.mjs"]` | Run the project's own file, named from the repository root |
| A program in the repository that is not a node script | a copy of the node binary or of a shell, a file without a `#!` line, `#!/bin/sh`, `#!/usr/bin/env -S node --require ./hook.js`, `#!/usr/local/bin/node -r ./hook.js` | Run the script with `node`, or give it the first line `#!/usr/bin/env node` |

There is no shell, so a pipe, `&&`, `;`, a redirect, a glob, or `$NAME` in `run` is passed to the program as plain text. Use `stdin` for input that a pipe used to feed, `env` for variables, and a file you write with the Write tool for anything that needs setup.

A script you write in `verify-checks/` is code like any other: it could be written to print the expected text whatever the feature does. Keep it to calling the feature and printing the result, so a person reviewing the map and `verify-checks/` can see that it can fail.

## expect

| Field | Required | Meaning |
|---|---|---|
| `exitCode` | yes | The exit code the program must end with. |
| `stdout`, `stderr` | one of these or `files` | One rule, or a list of rules that must all hold. |
| `files` | one of these or `stdout`/`stderr` | A list of `{ "path": ..., <rule> }`. Each file must exist after the run, must have been created by this run or have different content than before it, and must satisfy its rule. A file that already satisfies its rule before the run makes the check not verified, and the check is not run. For `includes` and `equals`, that is also checked with all whitespace removed from the rule and the file, so a command that only reformats the file cannot pass. |

A rule has exactly one of:

| Rule | Passes when |
|---|---|
| `includes` | the text contains the string |
| `equals` | the text equals the string, ignoring trailing whitespace at the end |
| `matches` | the JavaScript regular expression matches; `^` and `$` match at each line |

Before matching, the script removes color codes and turns `\r\n` into `\n`. Unknown keys are refused, so a typo such as `stdOut` cannot turn a rule off.

## Refused

Because the check cannot fail:

| Problem | Example | Instead |
|---|---|---|
| A rule that empty output satisfies | `"matches": ".*"`, `"matches": "^"` | Expect the specific value |
| A rule that a crash satisfies | `"includes": "Error"`, `"includes": "e"` | Expect the documented message |
| A rule that the command text, the stdin text, or the text of a file named in `run` satisfies | `"run": ["node", "cli/echo.mjs", "ok"]` with `"includes": "ok"` | Print the real result |
| Only an exit code | `"expect": { "exitCode": 0 }` | Add `stdout`, `stderr`, or `files` |
| A file with only a path | `"files": [{ "path": "out.txt" }]` | Add `includes`, `matches`, or `equals` |

`includes` and `equals` texts that also appear in the command are refused for the same reason. Pick an input whose output text is not in the command, or match the output more fully.

`stdin` from a file is checked the same way when the file exists as the map is read, and again just before the check runs: a rule that its text satisfies makes the check not verified. So is each argument after the script or executable that names a file in the repository, read from `cwd`, because the program could print or copy that file. A file a check both names and expects is checked against its own rule only just before the run, as `files` above describes.

## Examples

A command-line option:

```json
{
  "id": "kelvin-output",
  "feature": "Converts Celsius to Kelvin with --to K",
  "run": ["node", "cli/temp.mjs", "25", "--from", "C", "--to", "K"],
  "expect": { "exitCode": 0, "stdout": { "matches": "^298\\.15 K$" } }
}
```

A library function, through a script written with the Write tool. `verify-checks/expand-ports.mjs`:

```js
import { expandPorts } from '../lib/ports.mjs';

console.log(JSON.stringify(expandPorts('9000,8080-8082')));
```

```json
{
  "id": "expand-port-ranges",
  "feature": "Expands port ranges into a sorted list",
  "run": ["node", "verify-checks/expand-ports.mjs"],
  "expect": { "exitCode": 0, "stdout": { "equals": "[8080,8081,8082,9000]" } }
}
```

The script prints the real value and does not catch errors, so a throw ends with a non-zero exit code and fails the check.

A documented error:

```json
{
  "id": "below-absolute-zero",
  "feature": "Rejects a temperature below absolute zero",
  "run": ["node", "cli/temp.mjs", "-500", "--from", "C", "--to", "K"],
  "expect": { "exitCode": 3, "stderr": { "includes": "below absolute zero: -500 C" } }
}
```

`-500` and `C` appear in the command, but the whole text `below absolute zero: -500 C` does not, so the rule is accepted.

Input on stdin, and a variable:

```json
{
  "id": "convert-lines",
  "feature": "Converts one temperature per line read from stdin",
  "run": ["node", "cli/temp.mjs", "--from", "F", "--to", "C"],
  "stdin": "212\n32\n",
  "env": { "LANG": "C" },
  "expect": { "exitCode": 0, "stdout": { "equals": "100 C\n0 C" } }
}
```

`"stdin": { "file": "verify-checks/readings.txt" }` reads the input from a file instead.

A written file:

```json
{
  "id": "sitemap-file",
  "feature": "Writes a sitemap with one entry per page",
  "run": ["node", "cli/sitemap.mjs", "pages", "--out", "verify-checks/sitemap.xml"],
  "expect": {
    "exitCode": 0,
    "files": [{ "path": "verify-checks/sitemap.xml", "includes": "<loc>/about</loc>" }]
  }
}
```

A feature that needs earlier state. Write the starting file `verify-checks/drafts.xml` with the Write tool, then run one command against it:

```json
{
  "id": "sitemap-skips-drafts",
  "feature": "Leaves draft pages out of the sitemap",
  "run": ["node", "cli/sitemap.mjs", "--count", "verify-checks/drafts.xml"],
  "expect": { "exitCode": 0, "stdout": { "equals": "3 entries" } }
}
```

A program that works on the folder it starts in. `cli/sitemap.mjs` and the expected file are named from the repository root; `pages` is an argument, so the program reads `verify-checks/site/pages`:

```json
{
  "id": "sitemap-in-current-folder",
  "feature": "Writes sitemap.xml into the folder it runs in when --out is not given",
  "cwd": "verify-checks/site",
  "run": ["node", "cli/sitemap.mjs", "pages"],
  "expect": {
    "exitCode": 0,
    "files": [{ "path": "verify-checks/site/sitemap.xml", "includes": "<loc>/contact</loc>" }]
  }
}
```

If a check changes its starting file, write the starting content again before you run that check again. The same goes for a file a check writes and expects: a file left by the last run already has the expected content, so write it again empty before the next run.

## Evidence

Each run writes `.git/lim/verify/runs/<time>.json` with, for every check: the command, stdin and env when set, folder, status, reasons, exit code, signal, whether it timed out, the duration, stdout and stderr excerpts (first 1,000 and last 3,000 characters), the files it checked, and a hash of the check's definition. The run also records the map's hash, the commit, the number of uncommitted files, and the Node.js version.
