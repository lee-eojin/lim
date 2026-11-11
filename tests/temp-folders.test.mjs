import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { temporaryFolder } from './temp-folders.mjs';

const testsFolder = fileURLToPath(new URL('.', import.meta.url));

const removeOwnFolders = [
  'evals/run-detection.test.mjs',
  'evals/run-sessions.test.mjs',
  'scripts/check-comments.test.mjs',
  'scripts/check-evidence-report.test.mjs',
  'scripts/check-i18n.test.mjs',
  'scripts/check-loop-model-sync.test.mjs',
  'scripts/check-loop-model.test.mjs',
  'scripts/check-skills.test.mjs',
  'scripts/check.test.mjs',
  'scripts/hook-rule.test.mjs',
  'scripts/release.test.mjs',
  'scripts/sync-counts.test.mjs',
  'scripts/sync-shared.test.mjs',
  'shared/count-hits.test.mjs',
  'shared/entry-point.test.mjs',
  'shared/kill-rules.test.mjs',
  'shared/search-rules.test.mjs',
];

test('test files make temporary folders with temporaryFolder, which removes them after the file, unless they remove their own', () => {
  const callers = readdirSync(testsFolder, { recursive: true })
    .map((file) => file.split(path.sep).join('/'))
    .filter((file) => file.endsWith('.test.mjs'))
    .filter((file) => /\bmkdtemp(?:Sync)?\s*\(/.test(readFileSync(path.join(testsFolder, file), 'utf8')))
    .sort();
  assert.deepEqual(callers, removeOwnFolders);
});

const runsLeavingNothing = [
  ['running the verify test that copies the node binary into a repository', 'verify/verify.test.mjs', 'a copy of the node binary in the repository is refused as a program'],
  ['running the review-loop tests that add a git worktree next to the repository', 'review-loop/loop.test.mjs', 'worktree'],
];

for (const [title, file, pattern] of runsLeavingNothing) {
  test(`${title} leaves no folder in the temporary folder`, () => {
    const temporary = temporaryFolder('temp-folders-');
    const { NODE_TEST_CONTEXT, ...base } = process.env;
    const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', `--test-name-pattern=${pattern}`, path.join(testsFolder, file)], {
      encoding: 'utf8', env: { ...base, TMPDIR: temporary, TMP: temporary, TEMP: temporary },
    });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.ok(run.stdout.split('\n').some((line) => /^\s+ok \d+ - /.test(line) && line.includes(pattern)), run.stdout);
    assert.match(run.stdout, /^# fail 0$/m);
    assert.deepEqual(readdirSync(temporary).filter((name) => name !== 'node-compile-cache'), []);
  });
}
