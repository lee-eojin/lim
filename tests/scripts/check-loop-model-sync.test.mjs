import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/check-loop-model-sync.mjs', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
const loopPath = 'plugins/review-loop/skills/review-loop/scripts/loop.mjs';
const skillPath = '.claude/skills/check-loop-model/SKILL.md';
const loop = `const UNFINISHED = ['review'];

function helper() {
  return 1;
}

export function decideNext() {
  const first = 1;
  const second = 2;
  const third = 3;
  const fourth = 4;
  return first + second + third + fourth;
}

function reportNotice() {
  return 'old';
}
`;
const coverage = `- \`${loopPath}\`: \`decideNext\` (generated table), \`UNFINISHED\`.`;
const skill = (sync, bullet = coverage) => `# Model\n\n${bullet}\n\nSync commit: \`${sync}\`. Confirmed here.\n`;
const run = (cwd, options) => spawnSync(process.execPath, [script, cwd], { encoding: 'utf8', ...options });

function fixture(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'loop-sync-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();
  const write = (file, content) => {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    writeFileSync(path.join(cwd, file), content);
  };
  const commitLoop = (content) => {
    write(loopPath, content);
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', 'change');
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q');
  const sync = commitLoop(loop);
  write(skillPath, skill(sync.slice(0, 7)));
  return { cwd, git, write, commitLoop, sync };
}

for (const [label, from, to, name] of [
  ['the middle of decideNext', '  return first + second', '  return second + first', 'decideNext'],
  ['the first line of decideNext, which git heads with the function before it by default', '  const first = 1;', '  const first = 2;', 'decideNext'],
  ['the signature of decideNext', 'export function decideNext() {', 'export function decideNext(input) {', 'decideNext'],
  ['the covered constant', "const UNFINISHED = ['review'];", "const UNFINISHED = ['review', 'fix'];", 'UNFINISHED'],
]) {
  test(`an edit to ${label} fails`, (t) => {
    const { cwd, commitLoop } = fixture(t);
    assert.ok(loop.includes(from));
    commitLoop(loop.replace(from, to));
    const result = run(cwd);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, new RegExp(`changed since [0-9a-f]+: ${name}\\.`));
    assert.match(result.stderr, /node scripts\/check-loop-model\.mjs/);
  });
}

const commented = loop.replace('  return first + second', '  // why\n  return first + second');

test('a whole-line comment added inside a covered function is drift', (t) => {
  const { cwd, commitLoop } = fixture(t);
  commitLoop(commented);
  const result = run(cwd);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /decideNext/);
});

test('deleting a covered function fails', (t) => {
  const { cwd, commitLoop } = fixture(t);
  commitLoop(loop.replace(/export function decideNext[\s\S]*?\n}\n\n/, ''));
  const result = run(cwd);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /decideNext/);
});

test('an edit to uncovered reportNotice passes and names it', (t) => {
  const { cwd, commitLoop } = fixture(t);
  commitLoop(loop.replace("return 'old';", "return 'new';"));
  const result = run(cwd);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no covered name touched/);
  assert.match(result.stdout, /reportNotice/);
});

test('a sync commit at HEAD passes with no drift', (t) => {
  const { cwd, sync } = fixture(t);
  const result = run(cwd);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `Loop-model sync OK (no covered loop.mjs drift since ${sync.slice(0, 7)}).\n`);
});

test('a covered edit passes once the sync commit moves past it', (t) => {
  const { cwd, commitLoop, write } = fixture(t);
  const moved = commitLoop(loop.replace('  return first + second', '  return second + first'));
  write(skillPath, skill(moved));
  const result = run(cwd);
  assert.equal(result.status, 0, result.stderr);
});

test('a full sha that is not in the clone exits 2', (t) => {
  const { cwd, write } = fixture(t);
  write(skillPath, skill('0123456789abcdef0123456789abcdef01234567'));
  const result = run(cwd);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not in this clone/);
  assert.match(result.stderr, /unshallow/);
});

for (const [label, content, message] of [
  ['no sync line', '# Model\n', /Sync commit/],
  ['no coverage bullet', skill('abcdef0', '- something else'), /coverage bullet/],
  ['an empty coverage bullet', skill('abcdef0', `- \`${loopPath}\`: nothing.`), /names nothing/],
]) {
  test(`a skill with ${label} exits 2`, (t) => {
    const { cwd, write } = fixture(t);
    write(skillPath, content);
    const result = run(cwd);
    assert.equal(result.status, 2);
    assert.match(result.stderr, message);
  });
}

test('a repository with no skill exits 2', (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'loop-sync-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  assert.equal(run(cwd).status, 2);
});

test('missing git exits 2', { skip: process.platform === 'win32' }, (t) => {
  const { cwd } = fixture(t);
  const result = run(cwd, { env: { ...process.env, PATH: '' } });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Cannot run git/);
});

// The Windows CI job clones one commit, so the sync commit is only there with full history.
test('this repository has no covered drift past its sync commit', (t) => {
  if (execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: root, encoding: 'utf8' }).trim() === 'true') {
    t.skip('shallow clone');
    return;
  }
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
});
