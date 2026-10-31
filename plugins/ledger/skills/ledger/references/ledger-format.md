# ledger.json

```json
{
  "subject": "Is it safe to call evict() during a request?",
  "root": ".",
  "questions": [
    { "id": "q.dead-only", "question": "Does evict drop only dead entries?", "needs": "static" },
    { "id": "q.during-request", "question": "Does a request still see its entry while evict runs?", "needs": "runtime" }
  ],
  "claims": [
    {
      "id": "c.guard",
      "question": "q.dead-only",
      "statement": "evict returns true only when entry.dead is set",
      "kind": "observed",
      "evidence": [{ "file": "src/cache.js:2", "sha256": "..." }]
    },
    {
      "id": "c.callers",
      "question": "q.dead-only",
      "statement": "server.js is the only caller of evict in src",
      "kind": "observed",
      "evidence": [{ "search": "evict(", "scope": "src", "hits": 2 }]
    },
    {
      "id": "c.lock",
      "question": "q.during-request",
      "statement": "the request holds the entry, so evict skips it",
      "kind": "inferred",
      "evidence": [{ "file": "src/server.js:14-18" }]
    }
  ],
  "unknowns": [
    {
      "id": "u.ttl",
      "question": "q.during-request",
      "revision": 1,
      "state": "open",
      "text": "whether the TTL timer marks an entry dead while a request holds it",
      "probe": "run the TTL test with a held entry and save the output"
    }
  ]
}
```

## Fields

- `subject`: what the investigation is for, in one sentence.
- `root` (optional): the folder that `file` and `scope` paths are relative to, relative to the ledger file. Defaults to the ledger's folder. No path may leave it. `output` and `bundle` paths are relative to the ledger's folder, where `ledger save` writes.
- `questions[]`: `id`, `question`, and `needs` (`static` or `runtime`).
- `claims[]`: `id`, `question` (the question it answers), `statement`, `kind` (`observed` or `inferred`), and `evidence` (one or more). Optional `supersedes` (a claim id or a list) hides the older claim from the checklist without deleting it. Optional `contradicts` (a claim id or a list) marks the question contradicted while both claims hold.
- `unknowns[]`: `id`, `question`, `revision` (1, 2, ...), `state` (`open` or `resolved`), `text`, and for an open unknown `probe` (what would resolve it), for a resolved one `resolvedBy` (the claim that resolves it). Only the highest revision of each id counts.

## Evidence

Each piece has exactly one of these keys:

| Key | Holds when | Counts as |
|---|---|---|
| `file` (`path`, `path:line`, or `path:first-last`) | the file exists, the lines are inside it, and, after `ledger pin`, its SHA-256 is unchanged | static |
| `output` (a `ledger-evidence/<n>.json` written by `ledger save`), with the `sha256` that `save` printed | the record has the fields `save` writes, its SHA-256 still matches its content, and it is the record the claim cited | runtime |
| `search` with `scope` and `hits` | searching `scope` for the literal text again finds exactly `hits` (`.git`, `node_modules`, and `ledger-evidence` are skipped, links are not followed, at most 20000 files) | static, reported with its scope |
| `rea` (`ev_` and 64 hex digits) with `bundle` | the exported REA Evidence bundle is JSON and has a record whose `evidence_id` is that id; `runtime: true` for runtime Evidence | static, or runtime with `runtime: true` |

gap-map's `basis` uses the same `file` and `search` rules; ledger adds `output`, `rea`, and `pin`. A test runs both plugins' copies of these rules against the same cases, so they cannot drift apart.

## Output

- `ledger.md`: the checklist with each claim's kind and state, the bounded searches, and why each unanswered question is not answered.
- `ledger-evidence/<n>.json`: one saved command each: `command`, `cwd`, `exitCode`, `signal`, `error`, `ms`, `at`, `stdout`, `stderr` (each stream keeps its first and last 100000 characters), and `sha256` over the rest.
