# Reproducing a finding with verify

A reviewer that read the code and says "this is wrong" is inferring. A command that runs the feature and shows the wrong output is measuring. If your repository has a feature map from LIM's [verify](../../plugins/verify/README.md) plugin, review-loop uses verify's runs as evidence: a finding is reproduced before the fix, and it is resolved only when the same check passes after the fix.

## The example

`/tmp/cart` has `src/cart.js` and no test script. Its `verify.features.json` has two entries: `cart-total` runs `node verify-checks/total.mjs` and expects `30` for one item priced 10 with quantity 3, and `cart-empty` expects `0` for an empty cart. The uncommitted change drops the quantity from the total.

`loop start` sees the map and returns its path (excerpt):

```
$ node "$LOOP" start
{
  ...
  "checks": [],
  "featureMapPath": "/tmp/cart/verify.features.json"
}
```

Claude passes `featureMapPath` to the reviewer, and a reviewer that finds a P1 or P2 breaking a mapped feature puts the entry's id in `check`. Here the review has F-1 with `"check": "cart-total"`. The report names the map with its number of entries:

```
Review round 1 of 3 (reviewer: session model)
Checks: none detected, reviewing the diff only
Feature map: verify.features.json (2 entries)

Fixing next:
- F-1 [P2] src/cart.js:1 Quantity is ignored in the total
  was: sum + item.price, 0
  why: one item priced 10 with quantity 3 totals 10 instead of 30
  basis: inferred

Trend (P1 + P2): 1
Next: fix, then re-review in round 2 of 3
```

`loop record` also returns `"reproducible": ["F-1"]`, the open P1 and P2 findings that name a check.

## Reproduce before the fix

Before changing any file, Claude runs that verify check on the reviewed code. With `VERIFY` pointing at `skills/verify/scripts/verify.mjs` in the verify plugin (the `report` field):

```
$ node "$VERIFY" run --id cart-total
verify: 0 passed, 1 failed, 0 not verified (1 checks, 0.1 s)

FAIL cart-total: Totals price times quantity for each item
  $ node verify-checks/total.mjs
  - stdout does not equal "30"
  stdout: 10

Ran on uncommitted changes to 1 file besides the feature map.

Evidence: /tmp/cart/.git/lim/verify/runs/2026-10-27T05-57-45-878Z.json
```

Then `loop reproduce` reads that saved run. It does not run anything itself:

```
$ node "$LOOP" reproduce --id F-1
{
  "report": "F-1 [P2] src/cart.js:1 Quantity is ignored in the total\n  reproduced: verify check cart-total failed (.git/lim/verify/runs/2026-10-27T05-57-45-878Z.json)\n  - stdout does not equal \"30\"",
  "id": "F-1",
  "check": "cart-total",
  "status": "fail",
  "reasons": [
    "stdout does not equal \"30\""
  ],
  "evidencePath": ".git/lim/verify/runs/2026-10-27T05-57-45-878Z.json"
}
```

`fail` marks the finding reproduced, the strongest evidence it can have. Reproduced findings come first within their severity, and a guessed P1 or P2 that a check reproduces is no longer unverified. `pass` marks it not reproduced and changes nothing else, because the check may not cover the scenario.

The run must be of the code that was reviewed. review-loop matches it by the tree of what `git add -A` would commit. Without such a run, it refuses:

```
$ node "$LOOP" reproduce --id F-1
{"error":"no verify run of cart-total on the reviewed code: run the verify skill's `run --id cart-total` before changing any file, then run reproduce again"}
```

## Run it again after the fix

Claude fixes the total, then runs the same check again as the last change before `loop next`:

```
$ node "$VERIFY" run --id cart-total
verify: 1 passed, 0 failed, 0 not verified (1 checks, 0.1 s)

Passed: cart-total

Evidence: /tmp/cart/.git/lim/verify/runs/2026-10-27T05-57-46-087Z.json
```

`loop next` reads that run. The re-review resolves F-1, and the report says how the fix is known:

```
Review round 2 of 3 (reviewer: session model)
Checks: none detected, reviewing the diff only
Feature map: verify.features.json (2 entries)

Resolved since last round:
- F-1 [P2] Quantity is ignored in the total (fixed, measured: verify check cart-total passed on the fixed code, .git/lim/verify/runs/2026-10-27T05-57-46-087Z.json)
  no test: the project has no test script

Trend (P1 + P2): 1 -> 0
Stopped: no P1 or P2 left in this change
Left for you: P3 0, P4 0, P5 0
```

## When the rerun is skipped

In a copy of the same repository, the same fix went to `loop next` without the second verify run. The re-review said `"resolved": ["F-1"]`, and the script kept it open:

```
Review round 2 of 3 (reviewer: session model)
Checks: none detected, reviewing the diff only
Feature map: verify.features.json (2 entries)

Needs your call on how to fix:
- F-1 [P2] src/cart.js:1 Quantity is ignored in the total
  was: sum + item.price, 0
  why: one item priced 10 with quantity 3 totals 10 instead of 30
  basis: inferred
  reproduced: verify check cart-total failed (.git/lim/verify/runs/2026-10-27T05-57-46-429Z.json)
  rerun on the fix: verify check cart-total was not run on the fixed code
  note: the re-review marked it resolved, but verify check cart-total was not run on the fixed code

Trend (P1 + P2): 1 -> 1
Next: fix, then re-review in round 3 of 3
```

A reproduced finding is resolved only when its check passes on the fixed code, whatever the re-review says. If the check fails on the fixed code, the finding stays open the same way.

> **Pitfall:** review-loop never runs verify. Claude runs it through the verify skill. Without verify installed, Claude marks the reproduce step `skip: verify is not installed` and the findings keep the basis the reviewer gave them.

**If you remember one thing:** a reproduced finding is closed by the check that reproduced it, not by a reviewer's opinion.

That is the guide. Run one review on a change you care about, and read the report before anything else.

Back to the [guide index](README.md).
