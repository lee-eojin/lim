import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatCents } from '../src/format.js';

test('formats dollars and cents', () => {
  assert.equal(formatCents(1999), '$19.99');
  assert.equal(formatCents(1050), '$10.50');
});
