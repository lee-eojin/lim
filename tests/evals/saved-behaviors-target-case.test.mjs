import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { temporaryFolder } from '../temp-folders.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

const plugins = [
  {
    plugin: 'gap-map',
    targetCase: 'quill',
    titles: [
      'Claude does not mark a promise proven when its test fails or no test exists',
      'Claude records two sources that disagree as a contradiction',
      'Claude writes an obligation for every promise and closes the ones real tests prove',
    ],
  },
  {
    plugin: 'ledger',
    targetCase: 'relaybox',
    titles: [
      'Claude answers a runtime question only from a saved run and not from reading the code',
      'Claude does not claim something is absent beyond the scope it searched',
      'Claude leaves a question open when the repository holds no answer',
    ],
  },
];

const copyInto = (tree, relative) => {
  const target = path.join(tree, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.join(root, relative), target);
  return target;
};

const copiedTree = (plugin, baselines) => {
  const tree = temporaryFolder(`saved-behaviors-${plugin}-`);
  const testFile = copyInto(tree, path.join('tests', plugin, 'saved-behaviors.test.mjs'));
  copyInto(tree, path.join('evals', plugin, 'baseline-files.json'));
  copyInto(tree, path.join('plugins', plugin, 'README.md'));
  for (const name of baselines) copyInto(tree, path.join('evals', plugin, 'results', name));
  return { tree, testFile };
};

const runCopy = (testFile) => {
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  return spawnSync(process.execPath, ['--test', '--test-reporter=tap', testFile], { encoding: 'utf8', env });
};

for (const { plugin, targetCase, titles } of plugins) {
  const baselines = JSON.parse(readFileSync(path.join(root, 'evals', plugin, 'baseline-files.json'), 'utf8'));

  test(`an unchanged copy of the ${plugin} saved-behavior tests passes`, () => {
    const run = runCopy(copiedTree(plugin, baselines).testFile);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /^# fail 0$/m);
  });

  for (const name of baselines) {
    test(`the ${plugin} saved-behavior tests fail when ${name} has no ${targetCase} run`, () => {
      const { tree, testFile } = copiedTree(plugin, baselines);
      const resultsFile = path.join(tree, 'evals', plugin, 'results', name);
      const saved = JSON.parse(readFileSync(resultsFile, 'utf8'));
      const kept = saved.runs.filter((entry) => entry.case !== targetCase);
      assert.ok(kept.length < saved.runs.length, name);
      writeFileSync(resultsFile, JSON.stringify({ ...saved, runs: kept }, null, 2));
      const run = runCopy(testFile);
      const lines = run.stdout.split(/\r?\n/);
      assert.notEqual(run.status, 0, run.stdout + run.stderr);
      assert.match(run.stdout, /^# fail 3$/m);
      for (const title of titles) {
        assert.ok(lines.some((line) => /^\s*not ok \d+ - /.test(line) && line.endsWith(title)), `${title}\n${run.stdout}`);
      }
      assert.ok(run.stdout.includes(name), run.stdout);
    });
  }
}
