import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  decideNextModule, describeTrace, parseTrace, parseValue, readConfig, TLA_TOOLS,
} from '../../scripts/check-loop-model.mjs';
import { decideNext } from '../../plugins/review-loop/skills/review-loop/scripts/loop.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = path.join(root, 'scripts', 'check-loop-model.mjs');
const bounds = { slots: 2, maxRounds: 3, roundLimit: 4 };

function lookup(moduleText) {
  const definition = (name) => parseValue(moduleText.match(new RegExp(`^${name} == (<<[\\s\\S]*?>>)\\n(?=\\w)`, 'm'))[1]);
  const outcomes = definition('Outcomes');
  const rows = definition('Rows');
  // CountsCode in the generated module reads the first count as the lowest digit.
  return ({ counts, waiting, unproven, stuck, regressions }) => {
    const code = counts.reduceRight((sum, count) => sum * (bounds.slots + 1) + count, 0);
    return outcomes[rows[counts.length - 1][code][waiting][unproven][stuck][regressions] - 1];
  };
}

test('the generated table gives each model input the outcome decideNext returns for it', () => {
  const seen = (input) => ({
    decision: 'stop',
    reason: [input.round, input.counts.join('.'), input.open, input.waiting, input.unproven, input.stuck.length, input.regressions.length].join('/'),
  });
  const table = lookup(decideNextModule(seen, bounds));
  assert.equal(table({ counts: [2, 0], waiting: 1, unproven: 2, stuck: 0, regressions: 1 }).reason, '2/2.0/0/1/2/0/1');
  assert.equal(table({ counts: [0, 2], waiting: 0, unproven: 0, stuck: 1, regressions: 0 }).reason, '2/0.2/2/0/0/1/0');
  assert.equal(table({ counts: [1, 0, 2, 1], waiting: 2, unproven: 1, stuck: 2, regressions: 0 }).reason, '4/1.0.2.1/1/2/1/2/0');

  const real = lookup(decideNextModule(decideNext, bounds));
  assert.deepEqual(real({ counts: [1, 0], waiting: 1, unproven: 1, stuck: 0, regressions: 0 }), { decision: 'continue', reason: 'proof' });
  assert.deepEqual(real({ counts: [1, 0], waiting: 1, unproven: 0, stuck: 0, regressions: 0 }), { decision: 'stop', reason: 'waiting' });
});

test('the generated table refuses an outcome the model cannot read', () => {
  assert.throws(() => decideNextModule(() => ({ decision: 'pause' }), bounds), /decideNext returned \{"decision":"pause"\}/);
});

test('a TLC counterexample reads as the loop commands that produce it', () => {
  const trace = parseTrace(readFileSync(path.join(root, 'tests', 'scripts', 'check-loop-model.trace.txt'), 'utf8'));
  assert.deepEqual(describeTrace(trace, 'StopWaitingStopHasProof'), [
    '1. start. Now round 1 waits for a review.',
    '2. record round 1 with new F-1 (a P1 or P2 to fix). Now the loop waits for a fix.',
    '3. next. Now round 2 waits for a review.',
    '4. record round 2 with resolved F-1; new F-2 (a P1 or P2 that needs your call). Now the loop waits for a fix.',
    '5. start --unattended (resumes the run). Now the loop is stopped (waiting).',
    'Broken: stopWaiting stopped the loop as waiting while F-1 had no regression test or no-test reason.',
  ]);
});

test('ReviewLoop.cfg names the bounds and the invariants the script checks', () => {
  const config = readConfig(readFileSync(path.join(root, 'scripts', 'loop-model', 'ReviewLoop.cfg'), 'utf8'));
  assert.deepEqual(config.invariants, ['DecideNextStopHasProof', 'StopIfProvenStopHasProof', 'StopWaitingStopHasProof', 'GateNeedsProof']);
});

function beforeFix200() {
  try {
    return execFileSync('git', ['show', 'c73ff1c~1:plugins/review-loop/skills/review-loop/scripts/loop.mjs'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

const javaMissing = spawnSync('java', ['-version']).status !== 0;
const skipModelRun = (javaMissing && 'needs java') || (!existsSync(TLA_TOOLS.path) && 'needs .tools/tla2tools.jar, which node scripts/check-loop-model.mjs downloads')
  || (!beforeFix200() && 'needs commit c73ff1c~1 in the git history');

test('the model check passes the record stop on main and fails it on the decideNext before #200', { skip: skipModelRun }, () => {
  const run = (...args) => spawnSync(process.execPath, [script, '--invariant', 'DecideNextStopHasProof', ...args], { cwd: root, encoding: 'utf8' });
  const onMain = run();
  assert.equal(onMain.status, 0, onMain.stdout + onMain.stderr);
  assert.match(onMain.stdout, /^PASS DecideNextStopHasProof/m);

  const folder = mkdtempSync(path.join(tmpdir(), 'loop-before-200-'));
  try {
    const before = path.join(folder, 'loop.mjs');
    writeFileSync(before, beforeFix200());
    const broken = run('--loop', before);
    assert.equal(broken.status, 1, broken.stdout + broken.stderr);
    assert.match(broken.stdout, /^FAIL DecideNextStopHasProof/m);
    assert.match(broken.stdout, /Now the loop is stopped \(waiting\)\.\n {2}Broken: record stopped the loop as waiting while F-1 had no regression test or no-test reason\./);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
