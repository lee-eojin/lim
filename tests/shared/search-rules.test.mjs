
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import * as gapMap from '../../plugins/gap-map/skills/gap-map/scripts/gapmap.mjs';
import * as ledger from '../../plugins/ledger/skills/ledger/scripts/ledger.mjs';

const plugins = [['gap-map', gapMap], ['ledger', ledger]];

function tree(t, files) {
  const root = mkdtempSync(path.join(tmpdir(), 'search-rules-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

const withEvidence = {
  'a.txt': 'needle\n',
  'ledger-evidence/1.json': 'needle\n',
  'src/ledger-evidence/2.json': 'needle\n',
  'ledger-evidence-old/3.json': 'needle\n',
};

test('gap-map searches a folder named ledger-evidence', (t) => {
  const root = tree(t, withEvidence);
  assert.equal(gapMap.countHits(root, '.', 'needle').hits, 4);
  assert.deepEqual(gapMap.checkBasis(root, [{ search: 'needle', scope: '.', hits: 4 }]), []);
});

test('ledger skips a folder named ledger-evidence at any depth', (t) => {
  const root = tree(t, withEvidence);
  assert.deepEqual(ledger.countHits(root, '.', 'needle'), { hits: 2, files: 2 });
  assert.equal(ledger.checkEvidence(root, root, { search: 'needle', scope: '.', hits: 2 }).ok, true);
});

test('ledger searches a ledger-evidence folder or file named as the scope', (t) => {
  const root = tree(t, withEvidence);
  assert.deepEqual(ledger.countHits(root, 'ledger-evidence', 'needle'), { hits: 1, files: 1 });
  assert.deepEqual(ledger.countHits(root, 'ledger-evidence/1.json', 'needle'), { hits: 1, files: 1 });
});

for (const [name, plugin] of plugins) {
  test(`${name} skips .git and node_modules by name at any depth`, (t) => {
    const root = tree(t, {
      'a.txt': 'needle\n',
      '.git/config': 'needle\n',
      'sub/.git': 'needle\n',
      'node_modules/m.js': 'needle\n',
      'src/node_modules/m.js': 'needle\n',
      'node_modules-old/m.js': 'needle\n',
    });
    assert.equal(plugin.countHits(root, '.', 'needle').hits, 2);
  });

  test(`${name} searches a skipped folder named as the scope but not one nested in it`, (t) => {
    const root = tree(t, { 'node_modules/a/m.js': 'needle\n', 'node_modules/a/node_modules/b.js': 'needle\n' });
    assert.equal(plugin.countHits(root, 'node_modules', 'needle').hits, 1);
  });

  test(`${name} counts matches that do not overlap`, (t) => {
    const root = tree(t, { 'a.txt': 'aaaaa\n' });
    assert.equal(plugin.countHits(root, 'a.txt', 'aa').hits, 2);
  });

  test(`${name} leaves out the files and folders it is told to ignore`, (t) => {
    const root = tree(t, { 'a.txt': 'needle\n', 'out/b.txt': 'needle\n', 'c.txt': 'needle\n' });
    const ignored = [path.join(root, 'a.txt'), path.join(root, 'out')];
    assert.equal(plugin.countHits(root, '.', 'needle', ignored).hits, 1);
    assert.equal(plugin.countHits(root, 'out', 'needle', ignored).hits, 0);
  });

  test(`${name} does not follow links and does not crash on a dangling one`, { skip: process.platform === 'win32' && 'symbolic links need extra rights on Windows' }, (t) => {
    const root = tree(t, { 'outside/a.txt': 'needle\n', 'src/b.txt': 'needle\n' });
    symlinkSync(path.join(root, 'outside'), path.join(root, 'src', 'folder'));
    symlinkSync(path.join(root, 'outside', 'a.txt'), path.join(root, 'src', 'file'));
    symlinkSync(path.join(root, 'gone'), path.join(root, 'src', 'dangling'));
    assert.equal(plugin.countHits(root, 'src', 'needle').hits, 1);
    assert.equal(plugin.countHits(root, 'src/folder', 'needle').hits, 0);
    assert.match(plugin.countHits(root, 'src/dangling', 'needle').error, /scope src\/dangling does not exist/);
  });
}

test('gap-map and ledger search 20000 files and refuse one more', (t) => {
  const root = tree(t, {});
  mkdirSync(path.join(root, 'big'));
  for (let index = 0; index < 20000; index += 1) writeFileSync(path.join(root, 'big', `${index}.txt`), '');
  for (const [, plugin] of plugins) assert.equal(plugin.countHits(root, 'big', 'needle').hits, 0);
  writeFileSync(path.join(root, 'big', 'one-more.txt'), '');
  for (const [, plugin] of plugins) assert.deepEqual(plugin.countHits(root, 'big', 'needle'), { error: 'scope big has more than 20000 files; narrow it' });
});
