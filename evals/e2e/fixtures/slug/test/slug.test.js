import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slugify } from '../src/slug.js';

test('joins words with single hyphens', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
});

test('trims hyphens at both ends', () => {
  assert.equal(slugify('  Release notes  '), 'release-notes');
});
