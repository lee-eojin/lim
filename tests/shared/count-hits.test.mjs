
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { countHits as gapMapCountHits } from '../../plugins/gap-map/skills/gap-map/scripts/gapmap.mjs';
import { countHits as ledgerCountHits } from '../../plugins/ledger/skills/ledger/scripts/ledger.mjs';
import { countHitsSkipping } from '../../shared/count-hits.mjs';

function tree(t, files) {
  const root = mkdtempSync(path.join(tmpdir(), 'count-hits-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

test('a search skips only the names its caller gives', (t) => {
  const root = tree(t, { 'a.txt': 'needle\n', '.git/b.txt': 'needle\n', 'node_modules/c.txt': 'needle\n', 'ledger-evidence/d.txt': 'needle\n' });
  assert.deepEqual(countHitsSkipping(new Set())(root, '.', 'needle'), { hits: 4, files: 4 });
  assert.deepEqual(countHitsSkipping(new Set(['node_modules']))(root, '.', 'needle'), { hits: 3, files: 3 });
});

test('a search reports every file it read, with a match or not', (t) => {
  const root = tree(t, { 'a.txt': 'needle needle\n', 'b.txt': 'other\n', 'empty.txt': '' });
  assert.deepEqual(countHitsSkipping(new Set())(root, '.', 'needle'), { hits: 2, files: 3 });
});

test('a search of a missing scope returns only the error', (t) => {
  assert.deepEqual(countHitsSkipping(new Set())(tree(t, {}), 'nope', 'needle'), { error: 'scope nope does not exist' });
});

test('gap-map and ledger both return hits and files', (t) => {
  const root = tree(t, { 'a.txt': 'needle\n', 'b.txt': 'needle\n' });
  for (const countHits of [gapMapCountHits, ledgerCountHits]) assert.deepEqual(countHits(root, '.', 'needle'), { hits: 2, files: 2 });
});
