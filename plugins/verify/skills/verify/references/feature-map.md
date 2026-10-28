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

Every path in an entry is relative to the repository root, whatever `cwd` is: the script or executable in `run`, `stdin.file`, and each path in `expect.files`. `cwd` only sets the folder the program starts in. The arguments after the script or executable are passed to the program as they are, so the program reads a path among them from `cwd`. A path that leaves the repository, also through a symbolic link, is refused, and messages show each path as it resolves from the root.

## Entry fields

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Lowercase letters, digits, and hyphens. Unique. Used with `--id`. |
| `feature` | yes | One sentence a user would recognize: what the feature does. |
| `run` | yes | A list of strings in one of the two forms below: `node` or `python3` and a script file in the repository, or a node or python3 script in the repository started as a program, then the arguments. The script starts it in `cwd`, without a shell. |
| `stdin` | no | What the program reads on stdin: a string, or `{ "file": "<path>" }`. Default: empty. |
| `env` | no | Extra environment variables, such as `{ "TZ": "UTC" }`. Names are letters, digits, and `_`, not starting with a digit; values are strings. `PATH` and names that change how a program loads or runs code cannot be set: every name starting with `NODE_` except `NODE_ENV`, every name starting with `PYTHON`, `LD_` and `DYLD_` names, `HOME` and `USERPROFILE` (node looks for modules there), `OPENSSL_CONF` (loaded at startup), `BASH_ENV`, `ENV`, `BASHOPTS`, `SHELLOPTS`, `PS4`, `ZDOTDIR`, `PERL5OPT`, `PERL5LIB`, `PERLLIB`, `RUBYOPT`, and `RUBYLIB`. |
| `cwd` | no | The folder inside the repository that the program starts in. Default: the root. |
| `timeoutMs` | no | Time limit for this check's command. Matching `matches` rules before the run and on its output gets at most 2000 ms each time, or this limit if shorter, apart from the command's time. Default 30000 (or `LIM_VERIFY_TIMEOUT_MS`), at most 600000. |
| `expect` | yes | What the result must show. |

## What a check can run

| Form | Example |
|---|---|
| `node`, a script file in the repository, then arguments | `["node", "cli/temp.mjs", "25", "--to", "K"]`, `["node", "verify-checks/expand-ports.mjs"]` |
| `python3`, a script file in the repository, then arguments | `["python3", "tools/rename.py", "--dry-run", "photos"]`, `["python3", "verify-checks/split_hours.py"]` |
| A script file in the repository whose first line is `#!/usr/bin/env node`, `#!/usr/bin/env python3`, `#!/<path>/node`, or `#!/<path>/python3`, then arguments | `["./bin/temp", "25"]`, `["bin/temp", "--help"]` |

The path must stay inside the repository, also after following a symbolic link, and outside `node_modules/`, `.git/`, `.venv/`, `venv/`, and `__pycache__/`, which hold installed, kept, or generated files. Nothing goes between the interpreter and the script. A script started as a program must name node or python3 in its first line with nothing after it but blanks; the path in `#!/<path>/node` or `#!/<path>/python3` must be absolute and outside the repository. Both forms mean that node or python3 runs a script in the repository. A python3 script must be source text: compiled bytecode and zip archives are refused, including a text file with a zip archive appended, which python3 runs as the archive. Arguments after the script or executable are passed to it as they are, even ones that start with `-`. Everything else is refused:

| Refused | Example | Instead |
|---|---|---|
| `run` is a string | `"run": "node cli/temp.mjs 25"` | `["node", "cli/temp.mjs", "25"]` |
| A program found on `PATH` | `["npx", "tsc"]`, `["npm", "run", "check"]`, `["pnpm", "exec", ...]`, `["bunx", ...]`, `["uv", "run", ...]`, `["timeout", "20", ...]`, `["env", ...]`, `["sh", "-c", "..."]`, `["python", ...]`, `["python3.12", ...]` | Run the project's file with `node` or `python3`, or the project's own node or python3 script |
| An option before the script | `["node", "-e", "..."]`, `["node", "--import", "...", "cli/temp.mjs"]`, `["node", "-r", "./setup.js", ...]`, `["python3", "-c", "..."]`, `["python3", "-m", "rename"]`, `["python3", "-I", "tools/rename.py"]` | Write a script file and run it with `node` or `python3` |
| A file outside the repository, in `node_modules/`, `.git/`, `.venv/`, `venv/`, or `__pycache__/` | `["/bin/sh", ...]`, `["./node_modules/.bin/eslint"]`, `["node", "../cli/temp.mjs"]`, `["python3", ".venv/bin/rename"]` | Run the project's own file, named from the repository root |
| A program in the repository that is not a node or python3 script | a copy of the node binary or of a shell, a compiled addon such as `["node", "verify-checks/convert.node"]`, compiled Python, a file without a `#!` line, `#!/bin/sh`, `#!/usr/bin/env -S node --require ./hook.js`, `#!/usr/local/bin/node -r ./hook.js`, `#!/usr/bin/env python3 -I`, `#!/usr/bin/env python` | Run the script with `node` or `python3`, or give it the first line `#!/usr/bin/env node` or `#!/usr/bin/env python3` |

For a python3 run, from either form, the script sets `PYTHONDONTWRITEBYTECODE=1`, so the run leaves no `__pycache__` folders behind. It removes `PYTHONPATH`, `PYTHONSTARTUP`, `PYTHONHOME`, `PYTHONINSPECT`, and `PYTHONSAFEPATH` if your session has them: python3 runs a `sitecustomize.py` from any `PYTHONPATH` folder before the script, so a file there could print the expected text in its place. A node run gets none of these changes. python3 puts only the script's own folder on the import path, so a helper in `verify-checks/` adds the repository root itself before it imports the project, as in the Python example below.

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
| A rule that the command text, one of its arguments, the stdin text, or the text of a file named in `run` satisfies | `"run": ["node", "cli/echo.mjs", "ok"]` with `"includes": "ok"` or `"equals": "ok"` | Print the real result |
| Only an exit code | `"expect": { "exitCode": 0 }` | Add `stdout`, `stderr`, or `files` |
| A file with only a path | `"files": [{ "path": "out.txt" }]` | Add `includes`, `matches`, or `equals` |

`includes` texts that also appear in the command, and `equals` and `matches` rules that one argument in `run` satisfies on its own, are refused for the same reason: a program that prints its arguments would pass. Pick an input whose output text is not in the command, or match the output more fully.

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

A Python library function, the same way. `verify-checks/split_hours.py`:

```python
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from timesheet.shifts import split_hours

print(json.dumps(split_hours(sys.argv[1])))
```

```json
{
  "id": "split-overnight-shift",
  "feature": "Splits an overnight shift into hours per day",
  "run": ["python3", "verify-checks/split_hours.py", "22:00-06:30"],
  "expect": { "exitCode": 0, "stdout": { "equals": "[2.0, 6.5]" } }
}
```

The `sys.path.insert` line puts the repository root first on the import path, so the helper imports the project's package as the project's own code does. An uncaught exception prints a traceback and exits with code 1, so the check fails. For a package under `src/`, insert `str(Path(__file__).resolve().parent.parent / "src")` instead. A command in `[project.scripts]`, such as `rename = "photos.cli:main"`, is a function too: a helper that adds the root the same way, then runs `from photos.cli import main` and `sys.exit(main())`, runs it with the arguments after the helper in `run`.

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
