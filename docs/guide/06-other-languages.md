# Checks in other languages and subfolders

The checks run before any reviewer reads the change, and a failing one is already a P1. That only helps if review-loop finds your checks. It reads more than `package.json`: Makefile targets, Go, Rust, Python, Gradle, Maven, .NET, and Ruby projects, at the repository root and in the subfolder projects a change touches. This page shows what it detects and what it does when a tool is missing.

## What it looks for

In each folder it checks, review-loop looks for a `typecheck`, a `lint`, and a `test` check. For each of the three, the first source in this order that declares one wins:

| Order | Source | What it runs |
|---|---|---|
| 1 | `package.json` scripts | `typecheck`, `lint`, `test`, with the package manager of the nearest lockfile |
| 2 | Makefile targets | `make typecheck` (or `check-types`, `types`), `make lint`, `make test` |
| 3 | `go.mod` | `go vet ./...` as lint, `go test ./...` |
| 4 | `Cargo.toml` | `cargo check` as typecheck, `cargo test` |
| 5 | Python tools the project configures | mypy, `ruff check .`, and pytest, through `uv run --frozen --no-sync` when `uv.lock` exists |
| 6 | Gradle | `./gradlew test`, or `gradle test` without the wrapper |
| 7 | Maven | `./mvnw -B -q test`, or `mvn -B -q test` without the wrapper |
| 8 | .NET (`*.sln`, `*.csproj`, `*.fsproj`) | `dotnet test` |
| 9 | Ruby tools the project uses | rubocop as lint, rspec or `rake test`, through `bundle exec` when a `Gemfile` exists |

So a Go service with a Makefile `lint` target runs `make lint`, not `go vet`, and still runs `go test ./...`, because the Makefile has no `test` target. The [README limits](../../plugins/review-loop/README.md#limits) list the exact files each source reads.

## A Go service with a web app in a subfolder

`/tmp/apps` has `go.mod` and a Makefile with a `lint` target at the root, and a web app in `web/` with its own `package.json` and a `test` script. The change edits `main.go` and breaks the price format in `web/src/price.js`. To show a missing tool, `go` was left off `PATH` for this run, the way the unit tests do it (excerpt):

```
$ node "$LOOP" start
{
  ...
  "checks": [
    { "name": "lint", "command": "make lint", "exitCode": 0, "timedOut": false, ... },
    {
      "name": "test",
      "command": "go test ./...",
      "exitCode": null,
      "timedOut": false,
      "notInstalled": true,
      "missingProgram": "go",
      "tail": "not run: go is not installed"
    },
    { "name": "test", "folder": "web", "command": "npm run test", "exitCode": 1, "timedOut": false, ... }
  ]
}
```

The report after the review (the `report` field of `loop record`):

```
Review round 1 of 3 (reviewer: session model)
Checks: lint (make lint) passed, test (go test ./...) not run because go is not installed (not verified), web: test (npm run test) failed

Fixing next:
- F-1 [P1] web: npm run test web: test fails
  was: web: npm run test
  why: exit code 1: ) at startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17) { generatedMessage: true, code: 'ERR_ASSERTION', actual: '$13', expected: '$12.50', operator: 'strictEqual', diff: 'simple' }
  basis: measured

Trend (P1 + P2): 1
Next: fix, then re-review in round 2 of 3
```

How to read it:

- A check from a subfolder project is named with its folder (`web: test`), and so is the P1 it raised. The root's checks have no folder.
- `go test ./...` did not fail. It did not run, so it is "not verified", and it is not a finding. Before the commit, `loop status` returns `"notVerifiedChecks": ["test"]`, and Claude asks whether you want to run it.
- A changed file belongs to the nearest folder above it that declares a check, up to but not including the root. `main.go` is at the root, so it is covered by the root's checks, which always run.

## More than 4 projects

Each round runs the root's checks and at most 4 subfolder projects, in name order. Round 1 runs the projects of the whole change, and later rounds only the projects the fixes touched. In `/tmp/sites`, the change bumps a version in five projects, `admin`, `api`, `docs`, `shop`, and `web`, each with a `test` script (the report):

```
Review round 1 of 3 (reviewer: session model)
Checks: admin: test (npm run test) passed, api: test (npm run test) passed, docs: test (npm run test) passed, shop: test (npm run test) passed; not run: more than 4 projects changed (web)

Trend (P1 + P2): 0
Stopped: no P1 or P2 left in this change
Left for you: P3 0, P4 0, P5 0
```

`loop start` and `loop checks` also return `"checksLeftOut": ["web"]`. Nothing in `web` was checked. If that matters, split the change, or add a root script that runs every project, as [Pitfalls](05-pitfalls.md#monorepos-a-project-the-change-does-not-touch-is-not-checked) shows.

> **Pitfall:** a check whose program is missing is reported, not failed, so a review can stop clean with none of its checks run. Read the `Checks:` line, and install the tool where Claude Code runs before you trust the result.

**If you remember one thing:** the `Checks:` line names every command and folder, so you can see what was checked and what was not.

Next: [Reproducing a finding with verify](07-reproduce-with-verify.md).
