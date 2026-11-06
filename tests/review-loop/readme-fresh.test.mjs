import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const readme = readFileSync(fileURLToPath(new URL('../../plugins/review-loop/README.md', import.meta.url)), 'utf8');

test('the review-loop README says start --fresh keeps the decision ledger', () => {
  assert.match(readme, /`loop start --fresh` starts a new run with the same ledger/);
  assert.match(readme, /Delete that folder to reset the review, the decisions, the gate, and delegation/);
});

test('the review-loop README says a kept check is by folder and command and ends when it passes', () => {
  assert.match(readme, /failing check you keep is identified by its folder and command/);
  assert.match(readme, /keep ends once the check passes once/);
});
