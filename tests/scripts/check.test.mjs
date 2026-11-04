import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/check.sh', import.meta.url));

const needsBash = { skip: process.platform === 'win32' && 'needs bash and python3' };

function runCheck(files, env) {
  const root = mkdtempSync(path.join(tmpdir(), 'check-sh-'));
  try {
    mkdirSync(path.join(root, 'scripts'));
    copyFileSync(script, path.join(root, 'scripts/check.sh'));
    for (const [name, content] of Object.entries(files)) writeFileSync(path.join(root, name), content);
    const { LIM_DENYLIST, LIM_DENYLIST_FILE, LIM_FORK_PR, CI, ...base } = process.env;
    return spawnSync('bash', [path.join(root, 'scripts/check.sh')], { encoding: 'utf8', env: { ...base, ...env } });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const validJson = { 'valid.json': '{"version": "1.0.0"}\n' };

test('check.sh rejects JSON with NaN or Infinity, which JSON.parse refuses', needsBash, () => {
  const run = runCheck({
    'valid.json': '{"version": "1.0.0", "count": 1.5}\n',
    'nan.json': '{"count": NaN}\n',
    'infinity.json': '{"count": -Infinity}\n',
  }, {});
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.deepEqual(run.stdout.match(/^invalid JSON: .*$/gm).sort(), ['invalid JSON: infinity.json', 'invalid JSON: nan.json']);
});

test('check.sh skips the word check outside CI when no word list is set', needsBash, () => {
  const run = runCheck(validJson, {});
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /^word list check skipped: set LIM_DENYLIST or LIM_DENYLIST_FILE$/m);
});

for (const [name, env] of [
  ['a push to main or a pull request from this repository', { CI: 'true', LIM_FORK_PR: 'false' }],
  ['a run that does not say whether it is a fork', { CI: 'true' }],
]) {
  test(`check.sh fails in CI without a word list on ${name}`, needsBash, () => {
    const run = runCheck(validJson, env);
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stdout, /^word list missing in CI: set the LIM_DENYLIST secret$/m);
    assert.doesNotMatch(run.stdout, /::warning::/);
  });
}

test('check.sh only warns about the missing word list on a fork pull request and still checks JSON', needsBash, () => {
  const env = { CI: 'true', LIM_FORK_PR: 'true' };
  const warning = /^::warning::word list check skipped: pull requests from forks do not receive the LIM_DENYLIST secret$/m;
  const clean = runCheck(validJson, env);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, warning);
  const broken = runCheck({ 'nan.json': '{"count": NaN}\n' }, env);
  assert.equal(broken.status, 1, broken.stdout + broken.stderr);
  assert.match(broken.stdout, warning);
  assert.match(broken.stdout, /^invalid JSON: nan.json$/m);
});

const listFolder = mkdtempSync(path.join(tmpdir(), 'check-sh-list-'));
const listFile = path.join(listFolder, 'words.txt');
writeFileSync(listFile, 'forbiddenword\n');
after(() => rmSync(listFolder, { recursive: true, force: true }));

for (const [source, env] of [
  ['LIM_DENYLIST', { CI: 'true', LIM_DENYLIST: 'forbiddenword\n' }],
  ['LIM_DENYLIST_FILE', { CI: 'true', LIM_DENYLIST_FILE: listFile }],
]) {
  test(`check.sh reads the word list from ${source} and reports each hit by file and line`, needsBash, () => {
    const clean = runCheck({ ...validJson, 'notes.md': 'nothing here\n' }, env);
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    assert.doesNotMatch(clean.stdout, /skipped|missing/);
    const hit = runCheck({ ...validJson, 'notes.md': 'first line\nhas ForbiddenWord in it\n' }, env);
    assert.equal(hit.status, 1, hit.stdout + hit.stderr);
    assert.match(hit.stdout, /^blocked words found at:$/m);
    assert.match(hit.stdout, /^notes\.md:2$/m);
  });
}
