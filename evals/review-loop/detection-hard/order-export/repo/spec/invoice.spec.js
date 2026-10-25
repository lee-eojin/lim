import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatMoney } from '../src/invoice.js';

test('formatMoney shows dollars with two decimals', () => {
  assert.equal(formatMoney(1999), '$19.99');
  assert.equal(formatMoney(5), '$0.05');
});
