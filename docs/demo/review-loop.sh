#!/usr/bin/env bash
# Drives one review-loop run on a throwaway repository. review-loop.tape records it into review-loop.gif.
# The reviewer's findings and the code edits are scripted. The loop, the checks, and the review reports are real.
# After start, next, and rule, show() prints a summary of the JSON the loop returns.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
loop="$repo_root/plugins/review-loop/skills/review-loop/scripts/loop.mjs"
read_pause="${DEMO_PAUSE:-0}"
prompt_pause="${DEMO_PROMPT_PAUSE:-0}"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
cd "$workdir"

step() {
  printf '\n\033[1;36m$ %s\033[0m\n' "$1"
  sleep "$prompt_pause"
}

show() {
  node -e '
    const result = JSON.parse(require("fs").readFileSync(0, "utf8"));
    if (result.report || result.markdown) {
      console.log(result.report ?? result.markdown);
    } else if (result.kind === "regression") {
      const reason = result.proof !== "caught" && result.reason ? ` (${result.reason})` : "";
      console.log(`Regression test for ${result.id}: ${result.proof} on the code before the fix${reason}`);
    } else {
      const checks = result.checks.map((check) => `${check.name} (${check.command}) ${check.exitCode === 0 ? "passed" : "failed"}`);
      console.log(`Round ${result.round} of ${result.maxRounds} is ready for a reviewer with a fresh context`);
      console.log(`Checks: ${checks.join(", ") || "none"}`);
    }'
  sleep "$read_pause"
}

loop() {
  local output
  output="$(node "$loop" "$@")"
  printf '%s' "$output" | show
}

git init -q
git config user.email demo@example.com
git config user.name demo
mkdir src
cat > src/cart.js <<'JS'
function total(items) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

module.exports = { total };
JS
cat > package.json <<'JSON'
{
  "name": "cart",
  "private": true,
  "scripts": {
    "test": "node --test"
  }
}
JSON
mkdir test
cat > test/cart.test.cjs <<'JS'
const assert = require('node:assert');
const { total } = require('../src/cart');
require('node:test')('an empty cart totals 0', () => assert.strictEqual(total([]), 0));
JS
git add -A
git -c commit.gpgsign=false -c core.hooksPath=/dev/null commit -q -m 'feat: cart total'

step 'git diff   # the change: shipping added, price doubled'
cat > src/cart.js <<'JS'
function total(items, shipping = 0) {
  return items.reduce((sum, item) => sum + item.price * 2 * item.quantity, 0) + shipping;
}

module.exports = { total };
JS
git --no-pager diff --color=always
sleep "$read_pause"

step 'loop start'
loop start

step 'loop record < review-1.json   # reviewer with a fresh context'
loop record <<'JSON'
{
  "findings": [
    {
      "severity": "P2",
      "file": "src/cart.js",
      "line": 2,
      "category": "correctness",
      "title": "Price is doubled",
      "quote": "return items.reduce((sum, item) => sum + item.price * 2 * item.quantity, 0) + shipping;",
      "scenario": "One item at price 3, quantity 2 totals 12 instead of 6.",
      "whyNotPrevented": "The test only totals an empty cart, so no price is ever multiplied.",
      "basis": "inferred"
    }
  ]
}
JSON

step 'git diff   # the fix'
sed -i.bak 's/item.price \* 2 \* item.quantity/item.price * item.quantity/' src/cart.js
rm src/cart.js.bak
git --no-pager diff --color=always
sleep "$read_pause"

step 'loop rule --id F-1 --draft test/price.test.cjs   # a regression test for F-1'
cat > test/price.test.cjs <<'JS'
const assert = require('node:assert');
const { total } = require('../src/cart');
require('node:test')('one item at price 3, quantity 2 totals 6', () => assert.strictEqual(total([{ price: 3, quantity: 2 }]), 6));
JS
loop rule --id F-1 --draft test/price.test.cjs

step 'loop next'
loop next

step 'loop record < review-2.json   # a new reviewer checks the fix'
loop record <<'JSON'
{ "resolved": ["F-1"], "findings": [] }
JSON

step 'loop summary --markdown'
loop summary --markdown
