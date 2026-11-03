# ledger

Keep what an investigation saw apart from what it reasoned out and what it still does not know. Claude writes the questions first, then answers each with claims marked observed or inferred, each tied to evidence: a line of code, a command output it saved, a search with its scope, or an Evidence ID from [REA](https://github.com/morluto/rea). A script checks every piece of evidence again and marks each question answered, partial, unresolved, or contradicted. The model never marks a question answered.

## Install

```
/plugin marketplace add lee-eojin/lim
/plugin install ledger@lim
```

Needs Node.js 18 or later. ledger installs nothing and does not need REA; with REA connected, its Evidence IDs can be cited too.

## Use

Run `/ledger:ledger` with the question. Asking Claude to prove how or why something works, or to keep an evidence ledger, can also start it.

```
/ledger:ledger Is it safe to call evict() during a request? Prove it.
/ledger:ledger Pick up the investigation in notes/ledger.json and close what is still open.
/ledger:ledger Does the shipped app still send telemetry? Use REA on the build.
```

What happens:

1. Claude writes the questions the answer depends on, each marked `static` (reading the code can answer it) or `runtime` (only running it can).
2. It reads and runs only what each question needs, and adds claims with their evidence. Commands it runs as evidence go through `ledger.mjs save`, which runs them without a shell and saves the command, exit code, and output with a SHA-256.
3. What it cannot settle goes in `unknowns`, with the probe that would settle it.
4. It runs `ledger.mjs check`, shows the checklist as printed, and then answers, naming the bounds of each conclusion.

A run on Bend's termination check:

```
# Does Bend's termination check read a self-call's arguments left to right, as WONTFIX.txt says?

3 of 3 questions answered, 0 partial, 0 unresolved, 0 contradicted.

- [x] `q.rule` Does the checker compare arguments in order and stop at the first one that is not passed unchanged? (answered)
  - observed, holds: For a self-call, term_infer walks the columns left to right while the order stays EQ and refuses unless the result is LT (`c.loop`)
- [x] `q.refusal` Does a self-call whose decreasing argument is not first get refused when the file runs? (answered)
  - observed, holds: sum(n, acc) with n shrinking runs and prints 3n; the same sum with the arguments swapped, sum(acc, n), is refused with the left-to-right message (`c.swap`)
- [x] `q.only-place` Is that loop the only place the refusal message comes from? (answered)
  - observed, holds: The second occurrence refuses a template instance that calls back into the definition still being checked, a different path from the column loop (`c.template-site`)
  - bounded search: 2 hit(s) for "arguments are read left to right" within bend2/bend.ts
```

## How a question is decided

- An `inferred` claim never answers a question. It can only make it partial.
- A `runtime` question needs a saved command output, or REA Evidence marked runtime. A line of code is not enough.
- An open unknown keeps its question partial. Only the latest revision of an unknown counts.
- Two holding claims that contradict each other mark the question contradicted.
- Evidence is checked again on every run. A pinned file that changed, a saved output that was edited, or a search that now finds a different count breaks the claim, so a stale conclusion shows up before anyone reads it.

These rules come from REA's skill, which keeps every conclusion an observation, an inference, or an unknown, keeps a negative search bounded, and checks authenticity, authority, and applicability separately.

## Measured

[`evals/ledger/behaviors.csv`](../../evals/ledger/behaviors.csv) lists <!--total-->37 behaviors. Unit tests in CI cover <!--tested-->33 of them, running the script against temporary folders. The other <!--rest-->4 need a model run or a real target: the three below, measured by the benchmark, and the Bend investigation above, run against Bend at commit b2fe9ce0.

A blinded benchmark in [`evals/ledger/`](../../evals/ledger/) copies two small projects to a temporary folder under their own package names, each with one commit and a `ledger.json` that already holds three questions, and runs `/ledger:ledger Pick up the investigation in ledger.json and close what is still open.` headlessly with only `Read,Grep,Glob,Write,Edit,Skill,Bash(node:*)` in don't-ask mode. Each question has a trap:

- a Node.js tool: one question needs a run, because reading the code gives a plausible wrong number; one needs a search beyond the obvious folder, because the only caller sits outside `src/`; one has no answer in the repository, because the production value comes from an environment variable;
- a Python package: the README states a default the code does not use; the answer to one question sits in a module the obvious file imports; one question asks for a production timing the repository cannot hold.

The harness decides every question again with `ledger.mjs` and scores it correct, overclaimed, or incomplete; without a model, an honest reference ledger scores all correct and an overclaiming one scores none correct.

Results with claude-opus-5-5 and Claude Code 2.1.316:

| Date | Skill | Cases | Runs each | Correct | Overclaimed | Incomplete | Cost per case run | Time per case run |
|---|---|---|---|---|---|---|---|---|
| 2026-10-31 | before the script had to run alone | Node.js | 1 | 2 of 3 | 0 | 1 | $0.27 | 49 s |
| 2026-10-31 | script run alone | Node.js | 3 | 9 of 9 | 0 | 0 | $0.29 to $0.32 | 42 to 73 s |
| 2026-11-01 | script run alone, before break kinds were counted | both | 3 | 18 of 18 | 0 | 0 | $0.29 to $0.32 | 43 to 58 s |
| 2026-11-03 | this version | both | 3 | 18 of 18 | 0 | 0 | $0.37 to $0.40 | 63 to 438 s |

In the first run Claude chained the script after `ls`, the allow rule did not match, and every later `ledger.mjs` call was refused; it still worked out the right output from the code but left the runtime question open instead of claiming it. The skill now says to run the script alone, as verify's does.

This version's numbers come from the three `2026-11-03-claude-opus-5-5-rebaseline-*.json` files in [`evals/ledger/results/`](../../evals/ledger/results/). Every question got the same verdict in all three runs, and the same verdict as on 2026-11-01. A run of both projects cost $0.75 to $0.77. Four of the six case runs took 63 to 82 s. Both case runs of the second run took 433 and 438 s for the usual cost ($0.38 and $0.37), and the Python package's run took the same 21 turns as its other two runs, so that time was waiting, not more work. The records do not say what for.

A case run costs more than on 2026-11-01 (median $0.38 against $0.30) because it takes more turns (21 to 26 against 12 to 20); the median cost per turn stayed at $0.017. The cases, the prompt, and the scoring did not change. The skill gained one sentence about pins and the runs moved from macOS to Linux, so these runs cannot say which of the two added the turns.

## Files

`ledger.json` lives where you choose. Next to it, `ledger.md` is the last checklist, `ledger-evidence/` holds the saved command outputs, and `ledger-breaks.tsv` counts how pinned claims broke. `root` points at the code under investigation, so the ledger can sit outside a repository that keeps an allow list of files. The three together are the handoff: the next agent runs `ledger.mjs check` first.

## Limits

- A search is a literal text search over at most 20000 files. It is a bound you state, not proof of absence everywhere.
- The script checks that evidence still holds, not that a claim's sentence follows from it. That part is for the reader, which is why each claim names its evidence.
- REA Evidence is checked by its `evidence_id` appearing in the exported bundle; the bundle's own authentication is REA's job.
- A saved output's SHA-256 catches an edit or a swap made by mistake. It is not a signature: someone who can write the folder can write a matching record. Review `ledger-evidence/` with the ledger when the stakes need it.
