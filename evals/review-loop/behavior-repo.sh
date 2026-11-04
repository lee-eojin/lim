#!/usr/bin/env bash
# Creates a small repository whose uncommitted change has only P3 to P5 problems, for the manual
# B05 and B31 run in evals/review-loop/manual-behaviors.md. Prints the folder.
set -euo pipefail

folder="$(mktemp -d "${TMPDIR:-/tmp}/receipts-XXXXXX")"
cd "$folder"
git init -q
mkdir -p src
cat > src/format.js <<'JS'
export function formatPrice(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}
JS
git add -A
git -c user.name=dev -c user.email=dev@localhost -c commit.gpgsign=false commit -qm "Initial commit"
cat > src/receipt.js <<'JS'
import { formatPrice } from './format.js';

// Moved out of checkout.js after the last review asked for a separate file.
export function receiptLine(item) {
  // TODO: show the unit price as well, for now only the line total
  return `${item.name} x${item.qty}: ${formatPrice(item.unitCents * item.qty)}`;
}
JS
echo "$folder"
