import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import * as gapMap from '../../plugins/gap-map/skills/gap-map/scripts/gapmap.mjs';
import * as ledger from '../../plugins/ledger/skills/ledger/scripts/ledger.mjs';

function tree() {
  const root = mkdtempSync(path.join(tmpdir(), 'shared-rules-'));
  for (const [file, text] of Object.entries({ 'a.md': 'one\ntwo\nthree\n', 'src/x.js': 'needle needle\n', 'src/y.js': 'needle\n', 'empty.txt': '' })) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

const pointers = [
  ['a.md', true], ['a.md:1', true], ['a.md:3', true], ['a.md:4', false], ['a.md:0', false],
  ['a.md:1-3', true], ['a.md:2-4', false], ['a.md:3-2', false], ['empty.txt:1', false],
  ['src', false], ['missing.md:1', false], ['../a.md', false], ['', false],
];

function pointerRules(copy) {
  const root = tree();
  for (const [pointer, expected] of pointers) assert.equal(copy.resolvePointer(root, pointer), expected, pointer);
}

function countingRules(copy) {
  const root = tree();
  assert.deepEqual(['', 'x', 'x\n', 'x\ny', 'x\ny\n'].map(copy.lineCount), [0, 1, 1, 2, 2]);
  assert.equal(copy.countHits(root, 'src', 'needle').hits, 3);
  assert.equal(copy.countHits(root, 'src/y.js', 'needle').hits, 1);
  assert.match(copy.countHits(root, 'nope', 'needle').error, /scope nope does not exist/);
  const top = path.parse(root).root;
  assert.equal(copy.within(top, path.join(top, 'src')), true);
  assert.equal(copy.within(path.join(root, 'a'), path.join(root, 'ab')), false);
}

test('gap-map resolves file and line pointers by the shared rules', () => pointerRules(gapMap));
test('ledger resolves file and line pointers by the shared rules', () => pointerRules(ledger));
test('gap-map counts lines and searches and folders by the shared rules', () => countingRules(gapMap));
test('ledger counts lines and searches and folders by the shared rules', () => countingRules(ledger));
