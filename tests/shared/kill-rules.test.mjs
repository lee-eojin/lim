
import assert from 'node:assert/strict';
import childProcess, { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runOnce } from '../../plugins/gap-map/skills/gap-map/scripts/run.mjs';

const verifyScript = fileURLToPath(new URL('../../plugins/verify/skills/verify/scripts/verify.mjs', import.meta.url));
const folder = tmpdir();
const GRACE_MS = 2000;
const LEAVE_LIMIT_MS = 1500;
const HOLDER = 'setTimeout(() => {}, 30000);';
const posixOnly = process.platform === 'win32' && 'process groups exist only off Windows';

const STARTER = `const { spawn } = require('node:child_process');
const windows = process.platform === 'win32';
const started = spawn(process.execPath, ['-e', ${JSON.stringify(HOLDER)}], { detached: windows, stdio: windows ? 'ignore' : 'inherit' });
console.log(started.pid);
${HOLDER}`;

const LEAVER = `const { spawn } = require('node:child_process');
const started = spawn(process.execPath, ['-e', ${JSON.stringify(HOLDER)}], { detached: true, stdio: 'inherit' });
started.unref();
console.log(started.pid);`;

const verifier = (script, timeoutMs) => ({ run: [process.execPath, '-e', script], timeoutMs, pass: { exitCode: 0 } });

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stop(pid) {
  if (pid > 0 && isRunning(pid)) process.kill(pid, 'SIGKILL');
}

async function isGone(pid) {
  const deadline = Date.now() + 3000;
  while (isRunning(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  return !isRunning(pid);
}

function swap(t, name, replacement) {
  const original = childProcess[name];
  childProcess[name] = replacement;
  syncBuiltinESMExports();
  t.after(() => {
    childProcess[name] = original;
    syncBuiltinESMExports();
  });
}

function watchSpawn(t) {
  const started = [];
  const { spawn } = childProcess;
  swap(t, 'spawn', (program, args, options) => {
    const child = spawn(program, args, options);
    started.push({ child, options });
    return child;
  });
  return started;
}

function watchGroupKills(t) {
  const results = [];
  const kill = process.kill.bind(process);
  t.mock.method(process, 'kill', (pid, signal) => {
    if (pid >= 0) return kill(pid, signal);
    try {
      const result = kill(pid, signal);
      results.push('ok');
      return result;
    } catch (error) {
      results.push(error.code);
      throw error;
    }
  });
  return results;
}

function onPlatform(t, platform) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...original, value: platform });
  t.after(() => Object.defineProperty(process, 'platform', original));
}

test('gap-map kills the verifier and what it started at the limit', async (t) => {
  const outcome = await runOnce(folder, verifier(STARTER, 2000), 'unused');
  const pid = Number(outcome.stdout.trim());
  t.after(() => stop(pid));
  assert.ok(pid > 0, outcome.stdout);
  assert.equal(outcome.timedOut, true);
  assert.equal(await isGone(pid), true, `process ${pid} is still running`);
});

test('gap-map waits out the grace when the verifier is gone and something holds its pipes', { skip: posixOnly }, async (t) => {
  const groupKills = watchGroupKills(t);
  const started = watchSpawn(t);
  const outcome = await runOnce(folder, verifier(LEAVER, LEAVE_LIMIT_MS), 'unused');
  const pid = Number(outcome.stdout.trim());
  t.after(() => stop(pid));
  assert.ok(pid > 0, outcome.stdout);
  assert.deepEqual(groupKills, ['ESRCH']);
  assert.equal(outcome.timedOut, true);
  assert.equal(outcome.exitCode, null);
  assert.equal(outcome.stderr, '');
  assert.ok(outcome.ms >= LEAVE_LIMIT_MS + GRACE_MS - 100, `${outcome.ms} ms`);
  assert.equal(started[0].child.stdout.destroyed, false);
  assert.equal(started[0].child.stderr.destroyed, false);
  assert.equal(isRunning(pid), true);
});

test('on Windows gap-map asks taskkill for the whole tree and signals no group', async (t) => {
  onPlatform(t, 'win32');
  const groupKills = watchGroupKills(t);
  const started = watchSpawn(t);
  const calls = [];
  swap(t, 'spawnSync', (file, args, options) => {
    calls.push([file, args, options]);
    process.kill(Number(args[1]), 'SIGKILL');
    return { status: 0 };
  });
  const outcome = await runOnce(folder, verifier(HOLDER, 300), 'unused');
  assert.deepEqual(calls, [['taskkill', ['/pid', String(started[0].child.pid), '/T', '/F'], { windowsHide: true }]]);
  assert.deepEqual(groupKills, []);
  assert.equal(outcome.timedOut, true);
});

test('a taskkill that fails on Windows still ends the run at the grace', async (t) => {
  onPlatform(t, 'win32');
  const started = watchSpawn(t);
  swap(t, 'spawnSync', () => ({ error: new Error('spawnSync taskkill ENOENT') }));
  const outcome = await runOnce(folder, verifier(HOLDER, 300), 'unused');
  t.after(() => stop(started[0].child.pid));
  assert.equal(outcome.timedOut, true);
  assert.equal(outcome.exitCode, null);
  assert.equal(outcome.stderr, '');
  assert.ok(outcome.ms >= 300 + GRACE_MS - 100, `${outcome.ms} ms`);
});

for (const [platform, detached] of [['linux', true], ['darwin', true], ['win32', false]]) {
  test(`gap-map starts a verifier with detached ${detached} on ${platform}`, async (t) => {
    onPlatform(t, platform);
    const started = watchSpawn(t);
    await runOnce(folder, verifier('', 5000), 'unused');
    assert.equal(started[0].options.detached, detached);
    assert.equal(started[0].options.windowsHide, true);
  });
}

test('verify stops waiting for a check that left a process holding its pipes', { skip: posixOnly }, (t) => {
  const root = mkdtempSync(path.join(folder, 'kill-rules-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  writeFileSync(path.join(root, 'left.js'), LEAVER);
  writeFileSync(path.join(root, 'verify.features.json'), JSON.stringify({
    features: [{ id: 'left', feature: 'Leaves a process behind', run: ['node', 'left.js'], timeoutMs: LEAVE_LIMIT_MS, expect: { exitCode: 0, stdout: { includes: 'never printed' } } }],
  }));
  const before = Date.now();
  const result = spawnSync(process.execPath, [verifyScript, 'run'], { cwd: root, encoding: 'utf8' });
  const elapsed = Date.now() - before;
  const report = JSON.parse(result.stdout);
  const [check] = JSON.parse(readFileSync(report.evidencePath, 'utf8')).checks;
  const pid = Number(check.stdout.trim());
  t.after(() => stop(pid));
  assert.ok(pid > 0, check.stdout);
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(check.reasons, [`timed out after ${LEAVE_LIMIT_MS} ms`]);
  assert.deepEqual([check.status, check.exitCode, check.signal, check.timedOut], ['not-verified', null, 'SIGKILL', true]);
  assert.ok(elapsed < 15000, `verify took ${elapsed} ms`);
  assert.equal(isRunning(pid), true);
});
