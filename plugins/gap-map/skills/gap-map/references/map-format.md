# gap-map.json

Every field the script reads. The script refuses unknown references (a stage, group, region, or verifier that is not declared), duplicate ids, a fixture path that leaves `root`, and a case kind or authority outside the lists below.

```json
{
  "target": "Bend",
  "root": "../main-2",
  "goal": "Every promise in README.md and guide/GUIDE.md holds on every lane.",
  "groups": [
    { "id": "check", "label": "Check", "tone": "teal" },
    { "id": "refused", "label": "Refused or stopped", "tone": "pink" }
  ],
  "regions": [{ "id": "checker", "label": "In the checker, bend2/bend.ts" }],
  "stages": [
    { "id": "check", "label": "Checking every type as written", "group": "check", "region": "checker" },
    { "id": "refused", "label": "Refused, printed SOME PROOFS FAIL, exit 1", "group": "refused", "kind": "end" }
  ],
  "edges": [{ "from": "check", "to": "refused", "label": "a type does not match" }],
  "verifiers": {
    "interp": {
      "run": ["/usr/bin/env", "BEND_NO_TELEMETRY=1", "bun", "bend2/main.ts", "{fixture}"],
      "authority": "run",
      "pass": { "fixtureLines": { "prefix": "#|", "streams": "stdout+stderr", "exitLine": "exit {code}" } },
      "timeoutMs": 60000
    }
  },
  "obligations": [
    {
      "id": "check.types",
      "stage": "check",
      "claim": "A well-typed term checks and an ill-kinded application is refused",
      "source": "guide/GUIDE.md:33",
      "owner": "bend2/bend.ts:3534",
      "cases": ["positive", "negative"],
      "authority": "run",
      "fixtures": [
        { "case": "positive", "path": "tests/check/beta_ann_match.bend", "verifier": "interp" },
        { "case": "negative", "path": "tests/check/error_window_stuck_app_kind.bend", "verifier": "interp" }
      ]
    }
  ]
}
```

## Top level

- `target`, `goal`: non-empty strings. `goal` is one falsifiable sentence.
- `root`: the target repository, relative to the map file. Defaults to the map's folder. Fixture paths, `source`, and `owner` are relative to it, and verifiers start in it.
- `groups`: the legend, in order. `tone` is one of `cyan`, `teal`, `violet`, `yellow`, `orange`, `pink`, `green`, `gray`; without it, groups take the colors in that order.
- `regions` (optional): dashed boxes, each titled with the file or process that owns its stages.

## Stages and edges

- A stage has `id`, `label`, `group`, and optionally `region` and `kind` (`state`, the default; `end`, drawn with a double border; `stopped`, drawn dashed).
- An edge has `from`, `to`, and `label`. An edge back to an earlier stage is drawn dashed on the right. A start dot is drawn above every stage with no incoming edge.

## Verifiers

- `run`: the command as a list, with the literal `{fixture}` as one argument. No shell runs it, so there are no pipes or variables; use a wrapper script for more than one command.
- `authority`: `run` executes the claim; `read` only inspects. A `read` verifier cannot close an obligation whose `authority` is `run`.
- `pass.exitCode`: the exit code a pass needs. Optional when `fixtureLines.exitLine` is set.
- `pass.fixtureLines`: compare the output with the fixture's lines that start with `prefix`, the prefix removed. Both sides drop trailing spaces on each line and the whitespace around the whole text, as Bend's gate does, so spaces at the start of the first line are not compared. A fixture with CRLF line endings compares like one with LF. `streams` is `stdout` (the default) or `stdout+stderr`, which keeps the order the program wrote them in. `exitLine`, such as `exit {code}`, is appended to the output when the exit code is not 0, the way a harness that records the exit does.
- `timeoutMs`: from 1 to 600000; the default is 60000. The whole process group is killed at the limit.

## Obligations

- `id`: lowercase letters, digits, `.`, `_`, `-`.
- `stage`, `claim`, `source`, `owner`: `source` and `owner` are `file`, `file:line`, or `file:first-last`. A pointer that does not resolve keeps the obligation open.
- `cases`: one or more of `positive`, `negative`, `malformed`, `boundary`, `parity`, `teardown`.
- `authority`: `run` or `read`.
- `fixtures`: `{ case, path, verifier }`, with `case` from this obligation's `cases`.
- `disposition` (optional): `active` (the default), `blocked`, or `wontfix`.
- `unknowns`, `contradictions` (optional): lists of sentences. Any unknown keeps the obligation open; any contradiction makes it `contradicted`.
- `question` (optional): the design decision the project has to make. Listed first in `gaps.md`.
- `basis` (required with `question`): what the question rests on, with the same file and search rules as ledger's `evidence`. Each entry is `{ "file": "path:line" }` or `{ "search": "literal text", "scope": "folder or file", "hits": 0 }`. The script checks each line and reruns each search (links are not followed, `.git` and `node_modules` are skipped, at most 20000 files). A basis that no longer holds keeps the obligation open and marks the question stale.

## Output

All next to the map, in `gap-map/`:

- `results.json`: each fixture's last run (command, exit code, duration, pass or fail and why, output excerpts, time), with the SHA-256 of the fixture and of the owner file, and a digest of the verifier and every file its command names.
- `status.json`: the counts and each obligation's status and reasons.
- `gaps.md`: the design decisions, then one table per stage.
- `map.svg`: the statechart, with each stage's count of proven obligations.
