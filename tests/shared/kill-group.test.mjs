
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runOnce } from '../../plugins/gap-map/skills/gap-map/scripts/run.mjs';
import { killGroup } from '../../shared/kill-group.mjs';

const GRACE_MS = 2000;
const LIMIT_MS = 300;
const HOLDER = 'setTimeout(() => {}, 30000);';
const posixOnly = process.platform === 'win32' && 'process groups exist only off Windows';
const unixKillPath = process.platform === 'win32' && 'on Windows killGroup uses taskkill, not a process group';
const textOf = (file) => readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), 'utf8');
const verifier = { run: [process.execPath, '-e', HOLDER], timeoutMs: LIMIT_MS, pass: { exitCode: 0 } };

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

function refuseGroupKill(t) {
  const kill = process.kill.bind(process);
  t.mock.method(process, 'kill', (pid, signal) => {
    if (pid < 0) throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
    return kill(pid, signal);
  });
}

function watchSpawn(t, change = () => {}) {
  const started = [];
  const { spawn } = childProcess;
  childProcess.spawn = (program, args, options) => {
    const child = spawn(program, args, options);
    change(child);
    started.push(child);
    return child;
  };
  syncBuiltinESMExports();
  t.after(() => {
    childProcess.spawn = spawn;
    syncBuiltinESMExports();
  });
  return started;
}

test('killGroup signals the group and does not touch the child when that works', { skip: unixKillPath }, (t) => {
  const signal = t.mock.method(process, 'kill', () => true);
  const child = { pid: 4242, kill: t.mock.fn() };
  killGroup(child);
  assert.deepEqual(signal.mock.calls.map((call) => call.arguments), [[-4242, 'SIGKILL']]);
  assert.equal(child.kill.mock.callCount(), 0);
});

test('killGroup kills the child when the group cannot be signaled', { skip: unixKillPath }, (t) => {
  t.mock.method(process, 'kill', () => {
    throw new Error('kill ESRCH');
  });
  const child = { pid: 4242, kill: t.mock.fn(() => false) };
  killGroup(child);
  assert.deepEqual(child.kill.mock.calls.map((call) => call.arguments), [['SIGKILL']]);
});

test('killGroup does not hide an error from the fallback', { skip: unixKillPath }, (t) => {
  t.mock.method(process, 'kill', () => {
    throw new Error('kill ESRCH');
  });
  const child = {
    pid: 4242,
    kill: () => {
      throw new Error('kill ENOSYS');
    },
  };
  assert.throws(() => killGroup(child), /kill ENOSYS/);
});

test('gap-map kills the verifier itself when its group cannot be signaled', { skip: posixOnly }, async (t) => {
  refuseGroupKill(t);
  const started = watchSpawn(t);
  const outcome = await runOnce(tmpdir(), verifier, 'unused');
  const { pid } = started[0];
  t.after(() => stop(pid));
  assert.equal(await isGone(pid), true, `verifier ${pid} is still running`);
  assert.equal(outcome.timedOut, true);
  assert.equal(outcome.exitCode, null);
  assert.ok(outcome.ms < LIMIT_MS + GRACE_MS, `${outcome.ms} ms: the run waited out the grace`);
});

test('gap-map records a verifier it cannot kill and does not wait out the grace', { skip: posixOnly }, async (t) => {
  refuseGroupKill(t);
  const started = watchSpawn(t, (child) => {
    child.kill = () => {
      child.emit('error', Object.assign(new Error('kill EPERM'), { code: 'EPERM' }));
      return false;
    };
  });
  const outcome = await runOnce(tmpdir(), verifier, 'unused');
  t.after(() => stop(started[0].pid));
  assert.equal(outcome.timedOut, true);
  assert.equal(outcome.exitCode, null);
  assert.equal(outcome.stderr, 'kill EPERM');
  assert.ok(outcome.ms < LIMIT_MS + GRACE_MS, `${outcome.ms} ms: the run waited out the grace`);
});

test('verify does not call taskkill itself', () => {
  assert.doesNotMatch(textOf('plugins/verify/skills/verify/scripts/verify.mjs'), /taskkill/);
});

test('the shared helper holds the Windows tree kill that gap-map used to inline', () => {
  assert.match(textOf('shared/kill-group.mjs'), /taskkill/);
  assert.doesNotMatch(textOf('plugins/gap-map/skills/gap-map/scripts/run.mjs'), /taskkill/);
});
