import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const resultsDir = path.join(root, 'evals/gap-map/results');
const readmePath = path.join(root, 'plugins/gap-map/README.md');
const baselines = JSON.parse(readFileSync(path.join(root, 'evals/gap-map/baseline-files.json'), 'utf8'));

const targetRuns = (name) => {
  const runs = JSON.parse(readFileSync(path.join(resultsDir, name), 'utf8')).runs.filter((entry) => entry.case === 'quill');
  assert.ok(runs.length > 0, `${name} has no quill run`);
  return runs;
};

test('Claude does not mark a promise proven when its test fails or no test exists', () => {
  assert.ok(baselines.length >= 3);
  for (const name of baselines) {
    for (const run of targetRuns(name)) {
      assert.equal(run.promises['right-associative-power'].verdict, 'correct', name);
      assert.equal(run.promises.comments.verdict, 'correct', name);
    }
  }
});

test('Claude records two sources that disagree as a contradiction', () => {
  for (const name of baselines) {
    for (const run of targetRuns(name)) {
      assert.equal(run.promises['number-size'].verdict, 'correct', name);
    }
  }
});

test('Claude writes an obligation for every promise and closes the ones real tests prove', () => {
  for (const name of baselines) {
    for (const run of targetRuns(name)) {
      for (const id of ['arithmetic', 'division-by-zero', 'immutable-bindings', 'no-floats']) {
        assert.equal(run.promises[id].verdict, 'correct', `${name} ${id}`);
      }
    }
  }
});

test('Claude does not edit the target\'s tests or code while mapping it', () => {
  for (const name of baselines) {
    const file = JSON.parse(readFileSync(path.join(resultsDir, name), 'utf8'));
    assert.equal(file.summary.tamperedRuns, 0, name);
    for (const run of file.runs) assert.deepEqual(run.tampered, [], `${name} ${run.case}`);
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
