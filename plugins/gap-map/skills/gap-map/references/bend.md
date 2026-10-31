# Bend

Bend2 is a dependently typed, affine language that checks in one pass and compiles to C (CPU, Metal, CUDA from one source) and JavaScript. Facts below were read from the repository at commit `b2fe9ce0` (version 2.0.39). Check them again when the repository has moved.

## Owners

`AGENTS.md` names them. `bend2/bend.ts` is the parser, theory, and checker, human-written; do not edit it. `bend2/comp.ts` is the compiler and every runtime. `bend2/main.ts` is the CLI. `bend2/safe.ts` elaborates a checked book to BendTT for `--verdict`. `bend2/bendtt.lean` is the kernel and its proofs. `bend2/base.bend` is the prelude.

## Truth sources, most binding first

1. `bend2/bendtt.lean`: the proven claims (no checked definition has type Empty, live code halts, the kernel is adequate).
2. `guide/GUIDE.md`: the language guide, also printed by `bend guide`.
3. `README.md`: a target and a status per claim, and a Limitations list of stated gaps.
4. `WONTFIX.txt`: what Bend will not fix, under DESIGN, CAPACITY, OPEN, RUNTIME, and SOON. A SOON entry is planned work, so it is an open obligation with a `question`, not `wontfix`. The other headings are `wontfix`.
5. `CHANGELOG.md`: one entry per release.
6. `guide/EFFECTS.md` and `guide/SHADERS.md`: their first lines say an AI wrote them and a human will revise them. Cite them as unknowns, not as promises.

## Fixtures and lanes

Every test in `tests/<namespace>/` is a `.bend` file that ends in the lines its run must print, each starting with `#|`. A test does not name its lanes; `gates/test.ts` infers them:

- A test whose header has `import Base` also runs on the C and JS lanes. A foreign `import "./x.c"` or `"./x.js"` limits it to the twins that exist.
- A first `#|` line of `SOME PROOFS FAIL` or `Error:` marks an expected failure, checked only.
- A test with `!(` gets one GPU warm-up run before it is judged.
- The gate merges stderr into stdout, trims trailing spaces, and appends `exit N` when a lane exits non-zero (`gates/test.ts:136-186`).

`gates/test.ts`, `perf.ts`, and `safe.ts` run on a cluster of Mac minis over ssh. `test.ts` and `perf.ts` cannot be the verifier on a laptop. One test runs locally in about 0.05 seconds. The `--verdict` gate is different: its node side runs locally (see below).

## Verifiers that match the gate

The interpreter lane, with telemetry off:

```json
"interp": {
  "run": ["/usr/bin/env", "BEND_NO_TELEMETRY=1", "bun", "bend2/main.ts", "{fixture}"],
  "authority": "run",
  "pass": { "fixtureLines": { "prefix": "#|", "streams": "stdout+stderr", "exitLine": "exit {code}" } }
}
```

The C and JS lanes need a build and a run, so they go through a wrapper kept next to the map, outside the repository:

```bash
#!/bin/bash
lane="$1"
fixture="$2"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
export BEND_NO_TELEMETRY=1
if [ "$lane" = js ]; then target="$out/t.js"; else target="$out/t"; fi
if ! bun bend2/main.ts "$fixture" -o "$target" > "$out/build" 2>&1; then
  cat "$out/build"
  exit 1
fi
if [ "$lane" = js ]; then perl -e 'alarm 5; exec @ARGV' bun "$target" 2>&1; else perl -e 'alarm 5; exec @ARGV' "$target" 2>&1; fi
code=$?
if [ "$lane" = c ] && { [ "$code" = 138 ] || [ "$code" = 139 ]; }; then code=1; fi
exit "$code"
```

Use it as `"run": ["/abs/path/lane.sh", "c", "{fixture}"]` with the same `pass` as the interpreter lane. The C lane needs clang 14 or later; a program with `!` builds for Metal on macOS. `--verdict` builds the Lean kernel once into `~/.bend/bendtt/` and needs `lean`.

## The --verdict gate, locally

`gates/safe_node.ts` is the part of `gates/safe.ts` that runs on each mini. It reads file names on stdin, runs `bun bend2/main.ts <f> --verdict` on each, and prints a JSON array that `judge` in the same file classifies: agree, bend2 rejects, `u` unsafe, `-` out of scope, `!` false reject (bend2 checks, the kernel rejects), `t` timeout, `e` infrastructure. The gate fails on any `!`, `t`, or `e`. It needs `BENDTT` set to a built kernel; `--verdict` builds one into `~/.bend/bendtt/<hash>/bendtt`, and the right one is the folder whose `bendtt.lean` equals `bend2/bendtt.lean`.

```bash
cd <bend repository>
find tests -name '*.bend' | sort \
  | BEND_NO_TELEMETRY=1 BENDTT=<kernel> PAR=10 CAP=30 bun gates/safe_node.ts > got.json
```

Classify `got.json` with `judge` and exit 1 on any `!`, `t`, or `e`, and the run is a verifier. On 2026-10-31 at `b2fe9ce0` it checked all 1785 test files in 27.5 s on one Mac: 1143 agree, 507 bend2 rejects, 132 unsafe, 3 out of scope, and no `!`, `t`, or `e`. With `BENDTT=/usr/bin/false`, the 1143 became `e` and the run exited 1, so the agreement depends on the real kernel.

## Gaps the repository already states

- No gate runs CUDA or Linux, and `gates/safe.ts` (the `--verdict` agreement check) is not one of the four gates in `gates/_run.ts`, so nothing runs it on every change. Run it locally as above.
- README Limitations: no U64, I64, or F64; the JS lane runs on one core with no graphics or audio; parallelism needs balanced calls; the checker has no proof; the parser and the translation into the kernel are not proven.
- Refusal call sites are the real gap markers, not `TODO` (every `TODO` in the sources is the `?TODO` hole feature): `die(` in `bend2/comp.ts` and `oos(` (out of scope for BendTT) in `bend2/safe.ts`.

## A negative claim, written as a search

The first map asked whether a future checker may search for the decreasing argument "since GUIDE.md:87 teaches recursion without naming the order". That was wrong: `guide/GUIDE.md:105-109` names the order, and `tests/halt/threaded_state_before.bend`, `threaded_state_after.bend`, `column_order_search.bend`, and `size_change_accept.bend` pin that bend3's column search is gone on purpose. Written with its basis, the question fails at once:

```json
"question": "Should a future checker search for the decreasing argument?",
"basis": [{ "search": "left to right", "scope": "guide/GUIDE.md", "hits": 0 }]
```

`gapmap check` reports `searching guide/GUIDE.md for "left to right" now finds 1, the question says 0` and marks the question stale.

## The map built from this file

The first map, built on 2026-10-31 against `b2fe9ce0`, lives outside the repository in `~/orca/workspaces/bend/gap-map/`: `build_map.py` writes `gap-map.json`, `lane.sh` is the wrapper above, and `gapmap run` gave 11 of 24 obligations proven from 39 fixtures, 10 open, 2 contradicted, 1 blocked, and 4 won't fix. Start from it rather than from nothing, and rerun it after the repository moves.
