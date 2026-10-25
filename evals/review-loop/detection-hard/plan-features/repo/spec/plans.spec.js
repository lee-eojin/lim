import assert from 'node:assert/strict';
import { test } from 'node:test';
import { featuresFor } from '../src/plans.js';

const sorted = (list) => [...list].sort();

test('free has notes and search', () => {
  assert.deepEqual(sorted(featuresFor('free')), ['notes', 'search']);
});

test('team adds shared folders and the admin console', () => {
  assert.deepEqual(sorted(featuresFor('team')), ['admin-console', 'notes', 'search', 'shared-folders']);
});

test('an unknown plan throws', () => {
  assert.throws(() => featuresFor('gold'), /unknown plan/);
});
