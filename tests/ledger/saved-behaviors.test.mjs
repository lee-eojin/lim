import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const resultsDir = path.join(root, 'evals/ledger/results');
const readmePath = path.join(root, 'plugins/ledger/README.md');
const baselines = JSON.parse(readFileSync(path.join(root, 'evals/ledger/baseline-files.json'), 'utf8'));

test('Claude answers a runtime question only from a saved run and not from reading the code', () => {
  assert.ok(baselines.length >= 3);
  for (const name of baselines) {
    const runs = JSON.parse(readFileSync(path.join(resultsDir, name), 'utf8')).runs;
    for (const run of runs.filter((entry) => entry.case === 'relaybox')) {
      assert.equal(run.questions['q.size'].verdict, 'correct', name);
    }
  }
});

test('Claude does not claim something is absent beyond the scope it searched', () => {
  for (const name of baselines) {
    const runs = JSON.parse(readFileSync(path.join(resultsDir, name), 'utf8')).runs;
    for (const run of runs.filter((entry) => entry.case === 'relaybox')) {
      assert.equal(run.questions['q.legacy'].verdict, 'correct', name);
    }
  }
});

test('Claude leaves a question open when the repository holds no answer', () => {
  for (const name of baselines) {
    const runs = JSON.parse(readFileSync(path.join(resultsDir, name), 'utf8')).runs;
    for (const run of runs.filter((entry) => entry.case === 'relaybox')) {
      assert.equal(run.questions['q.port'].verdict, 'correct', name);
    }
  }
});

test('every baseline pointer file exists', () => {
  for (const name of baselines) {
    readFileSync(path.join(resultsDir, name));
  }
});

test('the plugin README names the same baseline files as the pointer', () => {
  const text = readFileSync(readmePath, 'utf8');
  for (const name of baselines) {
    assert.match(text, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), name);
  }
});
