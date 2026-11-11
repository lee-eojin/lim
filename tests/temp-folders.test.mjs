import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { temporaryFolder } from './temp-folders.mjs';

const testsFolder = fileURLToPath(new URL('.', import.meta.url));
const helper = pathToFileURL(path.join(testsFolder, 'temp-folders.mjs')).href;
const cannotLockFolders = { skip: (process.platform === 'win32' || process.getuid?.() === 0) && 'needs POSIX permissions and a user that is not root' };

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

test('a folder that cannot be removed does not stop the removal of the folders after it, and the file fails', cannotLockFolders, () => {
  const temporary = temporaryFolder('temp-folders-');
  const locked = path.join(temporary, 'locked');
  const testFile = path.join(temporary, 'locks.test.mjs');
  writeFileSync(testFile, [
    "import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';",
    "import path from 'node:path';",
    "import { test } from 'node:test';",
    `import { removeAfterTests, temporaryFolder } from ${JSON.stringify(helper)};`,
    `const locked = removeAfterTests(${JSON.stringify(locked)});`,
    "test('makes a locked folder, then another folder', () => {",
    "  mkdirSync(path.join(locked, 'inner'), { recursive: true });",
    "  writeFileSync(path.join(locked, 'inner', 'file.txt'), 'x');",
    "  chmodSync(path.join(locked, 'inner'), 0o555);",
    "  temporaryFolder('later-');",
    '});',
    '',
  ].join('\n'));
  const { NODE_TEST_CONTEXT, ...base } = process.env;
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', testFile], {
    encoding: 'utf8', env: { ...base, TMPDIR: temporary, TMP: temporary, TEMP: temporary },
  });
  chmodSync(path.join(locked, 'inner'), 0o755);
  assert.notEqual(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout + run.stderr, /could not remove 1 temporary folder/);
  assert.deepEqual(readdirSync(temporary).filter((name) => name !== 'node-compile-cache').sort(), ['locked', 'locks.test.mjs']);
});
