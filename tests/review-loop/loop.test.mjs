import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  classify,
  decideNext,
  findWeakening,
  gateDecision,
  gitInvocations,
  isStalled,
  parseReview,
  renderReport,
} from '../../plugins/review-loop/skills/review-loop/scripts/loop.mjs';

const script = fileURLToPath(new URL('../../plugins/review-loop/skills/review-loop/scripts/loop.mjs', import.meta.url));
const correctCart = 'export const total = (items) => items.reduce((sum, item) => sum + item.price, 0);\n';
const brokenCart = 'export const total = (items) => items.reduce((sum, item) => sum + item.price * 2, 0);\n';
const doubledPrice = {
  severity: 'P2',
  file: 'src/cart.js',
  line: 1,
  category: 'correctness',
  title: 'Price is doubled',
  quote: 'sum + item.price * 2',
  scenario: 'one item priced 10 totals 20',
  whyNotPrevented: 'no test covers total',
};
const brokenCartSource = () => [brokenCart];

function writeFiles(root, files) {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
}

function createRepository(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'review-loop-'));
  const runGit = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  runGit('init', '-q');
  writeFiles(root, files);
  runGit('add', '-A');
  runGit(
    '-c', 'user.name=test', '-c', 'user.email=test@example.com',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null',
    'commit', '-qm', 'base',
  );
  return root;
}

function commitAll(root) {
  const runGit = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  runGit('add', '-A');
  runGit(
    '-c', 'user.name=test', '-c', 'user.email=test@example.com',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null',
    'commit', '-qm', 'reviewed',
  );
}

function loop(root, args, review, env = {}) {
  const input = review === undefined ? '' : JSON.stringify(review);
  return JSON.parse(execFileSync('node', [script, ...args], {
    cwd: root, input, encoding: 'utf8', env: { ...process.env, ...env },
  }));
}

describe('classify', () => {
  test('classify routes evidenced P2 to fix', () => {
    const { fix, ask, cards } = classify([doubledPrice], brokenCartSource);
    assert.equal(fix.length, 1);
    assert.equal(ask.length, 0);
    assert.equal(cards.length, 0);
  });

  test('classify routes flagged P1 to ask', () => {
    const { fix, ask } = classify([{ ...doubledPrice, severity: 'P1', multipleFixes: true }], brokenCartSource);
    assert.equal(fix.length, 0);
    assert.equal(ask.length, 1);
  });

  test('classify demotes missing evidence', () => {
    const { fix, cards } = classify([{ ...doubledPrice, scenario: '' }], brokenCartSource);
    assert.equal(fix.length, 0);
    assert.equal(cards[0].unproven, true);
  });

  test('classify demotes a quote that is not in the file or diff', () => {
    const { cards } = classify([{ ...doubledPrice, quote: 'items.map(double)' }], brokenCartSource);
    assert.equal(cards[0].unproven, true);
  });

  test('classify keeps P3 to P5 as cards without asking for evidence', () => {
    const findings = ['P3', 'P4', 'P5'].map((severity) => ({ severity, file: 'a.js', title: severity }));
    const { fix, ask, cards } = classify(findings);
    assert.deepEqual([fix.length, ask.length, cards.length], [0, 0, 3]);
    assert.ok(cards.every((card) => !card.unproven));
  });
});

describe('stop rules', () => {
  test('decideNext stops at max rounds', () => {
    const result = decideNext({ round: 3, maxRounds: 3, counts: [3, 2, 1], open: 1 });
    assert.deepEqual(result, { decision: 'stop', reason: 'max-rounds' });
  });

  test('decideNext reports stalled instead of the round limit', () => {
    const result = decideNext({ round: 3, maxRounds: 3, counts: [2, 2, 2], open: 2 });
    assert.deepEqual(result, { decision: 'stop', reason: 'stalled' });
  });

  test('decideNext continues while open findings remain under the limit', () => {
    assert.equal(decideNext({ round: 1, maxRounds: 3, counts: [2], open: 2 }).decision, 'continue');
  });

  test('decideNext puts regressions and stuck findings before the round limit', () => {
    const regression = decideNext({ round: 3, maxRounds: 3, counts: [1], open: 1, regressions: [{}] });
    const stuck = decideNext({ round: 3, maxRounds: 3, counts: [1], open: 1, stuck: [{}] });
    assert.equal(regression.reason, 'regression');
    assert.equal(stuck.reason, 'stuck');
  });

  test('isStalled needs two rounds without a decrease', () => {
    assert.equal(isStalled([2, 2]), false);
    assert.equal(isStalled([2, 2, 2]), true);
    assert.equal(isStalled([3, 2, 2]), false);
    assert.equal(isStalled([1, 3, 3]), true);
  });
});

describe('findWeakening', () => {
  test('flags skipped tests, disabled lint, and suppressed types on added lines', () => {
    const diff = [
      '--- a/src/cart.test.js',
      '+++ b/src/cart.test.js',
      "-it('totals', () => {});",
      "+it.skip('totals', () => {});",
      '+// eslint-disable-next-line no-console',
      '+// @ts-ignore',
    ].join('\n');
    const reasons = findWeakening(diff).map((issue) => issue.reason);
    assert.deepEqual(reasons, ['test skipped or focused', 'lint rule disabled', 'type check suppressed']);
  });

  test('ignores skip calls inside strings such as test fixtures', () => {
    const diff = [
      '--- a/tests/loop.test.js',
      '+++ b/tests/loop.test.js',
      `+    writeFiles(root, { 'a.test.js': "it.skip('totals', () => {});" });`,
      "+      '+// eslint-disable-next-line no-console',",
    ].join('\n');
    assert.equal(findWeakening(diff).length, 0);
  });

  test('ignores removed lines', () => {
    assert.equal(findWeakening("--- a/x.test.js\n+++ b/x.test.js\n-it.skip('old', () => {});").length, 0);
  });

  test('flags deleted test files, snapshots, and CI config', () => {
    const nameStatus = 'D\tsrc/old.test.js\nM\tsrc/__snapshots__/cart.snap\nM\t.github/workflows/ci.yml';
    const reasons = findWeakening('', nameStatus).map((issue) => issue.reason);
    assert.deepEqual(reasons, ['test file deleted', 'snapshot changed', 'CI config changed']);
  });
});

describe('gitInvocations', () => {
  test('finds commit and push in common command shapes', () => {
    assert.deepEqual(
      gitInvocations('git add -A && git commit -m "fix: a && b"', '/repo').map((invocation) => invocation.subcommand),
      ['add', 'commit'],
    );
    assert.deepEqual(gitInvocations('git -C ../other commit -m x', '/repo/app')[0].directory, '/repo/other');
    assert.equal(gitInvocations('git -c user.name=x commit -m y', '/repo')[0].subcommand, 'commit');
    assert.equal(gitInvocations('cd packages/web && git commit -m x', '/repo')[0].directory, '/repo/packages/web');
    assert.equal(gitInvocations('GIT_EDITOR=true git commit', '/repo')[0].subcommand, 'commit');
  });

  test('ignores git words inside other commands', () => {
    assert.deepEqual(gitInvocations('echo "git commit"', '/repo'), []);
    assert.deepEqual(gitInvocations("grep -r 'git push' .", '/repo'), []);
  });
});

describe('parseReview', () => {
  test('accepts JSON inside a code fence', () => {
    assert.deepEqual(parseReview('```json\n{"findings":[]}\n```').findings, []);
  });

  test('rejects output without a findings array', () => {
    assert.throws(() => parseReview('{"issues":[]}'), /findings/);
  });
});

describe('renderReport', () => {
  test('report shows checks trend and stop reason', () => {
    const report = renderReport({
      round: 1, maxRounds: 3, checks: [{ name: 'test', exitCode: 0 }],
      counts: [0], decision: 'stop', reason: 'clean', cards: [{ severity: 'P3' }],
    });
    assert.match(report, /Checks: test passed/);
    assert.match(report, /Trend \(P1 \+ P2\): 0/);
    assert.match(report, /Stopped: no P1 or P2 left/);
    assert.match(report, /Left for you: P3 1, P4 0, P5 0/);
  });

  test('max rounds report lists still open', () => {
    const stillOpen = [{ id: 'F-2', severity: 'P2', file: 'a.js', line: 3, title: 'Off by one', quote: 'i <= n', scenario: 'n = 0 reads past the end' }];
    const report = renderReport({
      round: 3, maxRounds: 3, stillOpen, counts: [2, 1, 1], decision: 'stop', reason: 'max-rounds',
    });
    assert.match(report, /Still open \(P1 or P2\):\n- F-2 \[P2\] a\.js:3 Off by one/);
    assert.match(report, /Stopped: round limit reached/);
  });
});

describe('loop.mjs in a git repository', () => {
  test('fix then re-review ends clean', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    assert.equal(loop(root, ['start']).status, 'review');

    const first = loop(root, ['record'], { findings: [doubledPrice] });
    assert.equal(first.decision, 'continue');
    assert.equal(first.fix[0].id, 'F-1');

    writeFiles(root, { 'src/cart.js': correctCart });
    assert.equal(loop(root, ['next']).round, 2);

    const second = loop(root, ['record'], { resolved: ['F-1'], findings: [] });
    assert.equal(second.reason, 'clean');
    assert.match(second.report, /Resolved since last round:\n- F-1/);
  });

  test('empty review stops clean', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    const result = loop(root, ['record'], { findings: [] });
    assert.deepEqual([result.decision, result.reason], ['stop', 'clean']);
  });

  test('nothing to review when the tree matches HEAD', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    assert.equal(loop(root, ['start']).status, 'nothing-to-review');
  });

  test('still open finding moves to ask then stops as stuck', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    loop(root, ['record'], { findings: [doubledPrice] });
    loop(root, ['next']);

    const second = loop(root, ['record'], { stillOpen: ['F-1'], findings: [] });
    assert.equal(second.decision, 'continue');
    assert.equal(second.ask[0].id, 'F-1');
    assert.match(second.ask[0].note, /first fix did not resolve/);

    loop(root, ['next']);
    const third = loop(root, ['record'], { stillOpen: ['F-1'], findings: [] });
    assert.deepEqual([third.decision, third.reason], ['stop', 'stuck']);
    assert.equal(third.stillOpen[0].id, 'F-1');
  });

  test('out of scope findings are not looped', () => {
    const root = createRepository({ 'src/cart.js': correctCart, 'src/other.js': 'export const flag = true;\n' });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    const outside = { ...doubledPrice, file: 'src/other.js', quote: 'export const flag = true;' };
    const result = loop(root, ['record'], { findings: [outside] });
    assert.deepEqual([result.decision, result.reason], ['stop', 'clean']);
    assert.match(result.report, /Noticed outside this round's diff \(not looped, decided at the end\):\n- F-1 \[P2\]/);
    assert.match(result.report, /Left for you: P3 0, P4 0, P5 0, outside the round's diff 1 \(P1\/P2 1\)/);
    assert.deepEqual([result.cards[0].id, result.cards[0].outOfScope], ['F-1', true]);
    assert.deepEqual(loop(root, ['status']).review.pendingDecisions, ['F-1']);
  });

  test('file names with spaces and Korean characters stay in scope', () => {
    const fileName = 'src/장바구니 cart.js';
    const root = createRepository({ [fileName]: correctCart });
    execFileSync('git', ['config', 'diff.noprefix', 'true'], { cwd: root });
    writeFiles(root, { [fileName]: brokenCart });
    loop(root, ['start']);
    const result = loop(root, ['record'], { findings: [{ ...doubledPrice, file: fileName }] });
    assert.equal(result.decision, 'continue');
    assert.equal(result.fix[0].file, fileName);
  });

  test('record refuses when checks did not finish', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    const statePath = path.join(root, '.git', 'lim', 'review-loop', 'state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    writeFileSync(statePath, JSON.stringify({ ...state, checks: null }));
    assert.throws(() => loop(root, ['record'], { findings: [] }), /checks did not finish/);
    assert.equal(loop(root, ['checks']).passed, true);
    assert.equal(loop(root, ['record'], { findings: [] }).reason, 'clean');
  });

  test('fix that skips a test stops the loop', () => {
    const testFile = "it('totals', () => {});\n";
    const root = createRepository({ 'src/cart.js': correctCart, 'src/cart.test.js': testFile });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    loop(root, ['record'], { findings: [doubledPrice] });
    writeFiles(root, { 'src/cart.js': correctCart, 'src/cart.test.js': "it.skip('totals', () => {});\n" });
    const result = loop(root, ['next']);
    assert.deepEqual([result.status, result.reason], ['stopped', 'integrity']);
    assert.equal(result.integrity[0].reason, 'test skipped or focused');
  });

  test('integrity stop leaves the tree unreviewed', () => {
    const root = createRepository({ 'src/cart.js': correctCart, 'src/cart.test.js': "it('totals', () => {});\n" });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    loop(root, ['record'], { findings: [doubledPrice] });
    writeFiles(root, { 'src/cart.test.js': "it.skip('totals', () => {});\n" });
    loop(root, ['next']);
    assert.equal(loop(root, ['status']).treeMatchesReview, false);
  });

  test('failing checks become P1 findings', () => {
    const manifest = JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } });
    const root = createRepository({ 'package.json': manifest, 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    const started = loop(root, ['start']);
    assert.equal(started.checks[0].exitCode, 1);
    const result = loop(root, ['record'], { findings: [] });
    assert.equal(result.decision, 'continue');
    assert.equal(result.fix[0].severity, 'P1');
    assert.equal(result.fix[0].fromChecks, true);
  });

  test('invalid package.json becomes a P1 check failure', () => {
    const root = createRepository({ 'package.json': '{"scripts":{}}\n', 'src/cart.js': correctCart });
    writeFiles(root, { 'package.json': '{"scripts":{},}\n' });
    const started = loop(root, ['start']);
    assert.deepEqual([started.checks[0].name, started.checks[0].exitCode], ['package.json', 1]);
    const result = loop(root, ['record'], { findings: [] });
    assert.equal(result.fix[0].severity, 'P1');
    assert.equal(result.fix[0].fromChecks, true);
  });

  test('timed out check is reported as not verified instead of failing', () => {
    const manifest = JSON.stringify({ scripts: { test: 'node -e "setTimeout(() => {}, 5000)"' } });
    const root = createRepository({ 'package.json': manifest, 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    const fastTimeout = { LIM_CHECK_TIMEOUT_MS: '1500' };
    const started = loop(root, ['start'], undefined, fastTimeout);
    assert.equal(started.checks[0].timedOut, true);
    const result = loop(root, ['record'], { findings: [] }, fastTimeout);
    assert.deepEqual([result.decision, result.reason], ['stop', 'clean']);
    assert.match(result.report, /test timed out \(not verified\)/);
    assert.deepEqual(loop(root, ['status']).review.notVerifiedChecks, ['test']);
  });

  test('a failing check that later times out stays open', () => {
    const failing = JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } });
    const slow = JSON.stringify({ scripts: { test: 'node -e "setTimeout(() => {}, 5000)"' } });
    const root = createRepository({ 'package.json': failing, 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    const fastTimeout = { LIM_CHECK_TIMEOUT_MS: '1500' };
    loop(root, ['start'], undefined, fastTimeout);
    assert.equal(loop(root, ['record'], { findings: [] }).fix[0].fromChecks, true);
    writeFiles(root, { 'package.json': slow });
    loop(root, ['next'], undefined, fastTimeout);
    const result = loop(root, ['record'], { findings: [] }, fastTimeout);
    assert.equal(result.decision, 'continue');
    assert.match(result.ask[0].note, /timed out/);
  });

  test('status reports timeouts from the latest checks run', () => {
    const passing = JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } });
    const slow = JSON.stringify({ scripts: { test: 'node -e "setTimeout(() => {}, 5000)"' } });
    const root = createRepository({ 'package.json': passing, 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    const fastTimeout = { LIM_CHECK_TIMEOUT_MS: '1500' };
    loop(root, ['start'], undefined, fastTimeout);
    assert.equal(loop(root, ['record'], { findings: [] }).reason, 'clean');
    writeFiles(root, { 'package.json': slow });
    assert.deepEqual(loop(root, ['checks'], undefined, fastTimeout).notVerified, ['test']);
    assert.deepEqual(loop(root, ['status']).review.notVerifiedChecks, ['test']);
  });

  test('reviewer cannot set internal fields', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    const forged = { ...doubledPrice, scenario: '', fromChecks: true, decision: 'keep' };
    const result = loop(root, ['record'], { findings: [forged] });
    assert.equal(result.fix.length, 0);
    assert.equal(result.cards[0].unproven, true);
    assert.equal(result.cards[0].fromChecks, undefined);
    assert.deepEqual(loop(root, ['status']).review.pendingDecisions, ['F-1']);
  });

  test('duplicate reviewer findings are counted once', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    loop(root, ['record'], { findings: [doubledPrice, doubledPrice] });
    loop(root, ['next']);
    const second = loop(root, ['record'], { stillOpen: ['F-1'], findings: [doubledPrice] });
    assert.deepEqual(second.ask.map((item) => item.id), ['F-1']);
    assert.match(second.report, /Trend \(P1 \+ P2\): 1 -> 1/);
  });

  test('runs when called through a symlink', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    const linkDirectory = mkdtempSync(path.join(tmpdir(), 'review-loop-link-'));
    const linkedScript = path.join(linkDirectory, 'loop.mjs');
    symlinkSync(script, linkedScript);
    const output = execFileSync('node', [linkedScript, 'status'], { cwd: root, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(output).review, null);
  });

  test('record puts the report first', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    const result = loop(root, ['record'], { findings: [doubledPrice] });
    assert.equal(Object.keys(result)[0], 'report');
  });

  test('start resumes a review in progress', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    loop(root, ['record'], { findings: [doubledPrice, { ...doubledPrice, severity: 'P1', multipleFixes: true, quote: 'items.reduce', title: 'Second' }] });
    const resumed = loop(root, ['start']);
    assert.deepEqual([resumed.status, resumed.awaiting], ['in-progress', 'fix']);
    assert.deepEqual([resumed.fix.map((item) => item.id), resumed.ask.map((item) => item.id)], [['F-1'], ['F-2']]);
    assert.match(resumed.report, /Fixing next:/);
    const fresh = loop(root, ['start', '--fresh']);
    assert.deepEqual([fresh.status, fresh.round], ['review', 1]);
  });

  test('start resumes pending decisions after a stop', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    loop(root, ['record'], { findings: [{ severity: 'P3', file: 'src/cart.js', title: 'Name total as sumPrices' }] });
    const resumed = loop(root, ['start']);
    assert.deepEqual([resumed.awaiting, resumed.cards.map((card) => card.id)], ['decisions', ['F-1']]);
    loop(root, ['decide', '--id', 'F-1', '--choice', 'keep']);
    assert.equal(loop(root, ['start']).status, 'review');
  });

  test('start resumes while waiting for review and flags a stale diff', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    const statePath = path.join(root, '.git', 'lim', 'review-loop', 'state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    writeFileSync(statePath, JSON.stringify({ ...state, checks: null }));
    const waiting = loop(root, ['start']);
    assert.deepEqual([waiting.awaiting, waiting.checksFinished, waiting.treeMatchesReview], ['review', false, true]);
    writeFiles(root, { 'src/other.js': 'export const flag = true;\n' });
    assert.equal(loop(root, ['start']).treeMatchesReview, false);
  });

  test('start resumes after an integrity stop with the report first', () => {
    const root = createRepository({ 'src/cart.js': correctCart, 'src/cart.test.js': "it('totals', () => {});\n" });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    loop(root, ['record'], { findings: [doubledPrice] });
    writeFiles(root, { 'src/cart.test.js': "it.skip('totals', () => {});\n" });
    assert.equal(Object.keys(loop(root, ['next']))[0], 'report');
    const resumed = loop(root, ['start']);
    assert.equal(Object.keys(resumed)[0], 'report');
    assert.deepEqual([resumed.awaiting, resumed.stillOpen.map((item) => item.id)], ['decisions', ['F-1']]);
    assert.match(resumed.report, /weakened tests or checks/);
  });

  test('start treats an unreadable state file as no review', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    const statePath = path.join(root, '.git', 'lim', 'review-loop', 'state.json');
    writeFileSync(statePath, '{"round": 1, "open": [');
    assert.equal(loop(root, ['start']).status, 'review');
    writeFileSync(statePath, '{"round": 1, "open": [');
    assert.equal(loop(root, ['start', '--fresh']).status, 'review');
  });

  test('resume asks about findings saved without a route', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    loop(root, ['record'], { findings: [{ ...doubledPrice, severity: 'P1', multipleFixes: true }] });
    const statePath = path.join(root, '.git', 'lim', 'review-loop', 'state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    const withoutRoute = state.open.map(({ route, ...item }) => item);
    writeFileSync(statePath, JSON.stringify({ ...state, open: withoutRoute }));
    const resumed = loop(root, ['start']);
    assert.deepEqual([resumed.fix.length, resumed.ask.map((item) => item.id)], [0, ['F-1']]);
  });

  test('decisions are recorded against finding ids', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    loop(root, ['record'], { findings: [{ severity: 'P3', file: 'src/cart.js', title: 'Name total as sumPrices' }] });
    const decision = loop(root, ['decide', '--id', 'F-1', '--choice', 'keep']);
    assert.deepEqual([decision.recorded, decision.pending], [true, []]);
  });
});

describe('commit gate', () => {
  const commit = (root, command = 'git commit -m "feat: coupon"') => gateDecision({ cwd: root, command });

  function reviewedRepository() {
    const root = createRepository({ 'src/cart.js': correctCart });
    loop(root, ['gate', '--on']);
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    loop(root, ['record'], { findings: [] });
    return root;
  }

  test('gate off leaves commits alone', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    assert.equal(commit(root), null);
  });

  test('gate blocks an unreviewed commit', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    loop(root, ['gate', '--on']);
    writeFiles(root, { 'src/cart.js': brokenCart });
    const result = commit(root, 'git add -A && git commit -m "feat: coupon"');
    assert.equal(result.decision, 'deny');
    assert.match(result.reason, /\/review-loop:review-loop/);
  });

  test('gate asks after a clean review and allows with delegation', () => {
    const root = reviewedRepository();
    assert.equal(commit(root).decision, 'ask');
    loop(root, ['delegate', '--scope', 'repo']);
    assert.equal(commit(root).decision, 'allow');
  });

  test('gate blocks while a loop is in progress or decisions are pending', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    loop(root, ['gate', '--on']);
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    loop(root, ['record'], { findings: [doubledPrice] });
    assert.match(commit(root).reason, /in progress/);
    loop(root, ['start', '--fresh']);
    loop(root, ['record'], { findings: [{ severity: 'P3', file: 'src/cart.js', title: 'Name total as sumPrices' }] });
    assert.match(commit(root).reason, /decide F-1/);
  });

  test('gate asks for later edits to reviewed files and blocks unreviewed files', () => {
    const root = reviewedRepository();
    writeFiles(root, { 'src/cart.js': `${brokenCart}// reviewed file edited\n` });
    assert.equal(commit(root).decision, 'ask');
    writeFiles(root, { 'src/other.js': 'export const flag = true;\n' });
    const result = commit(root);
    assert.equal(result.decision, 'deny');
    assert.match(result.reason, /src\/other\.js/);
  });

  test('gate blocks reusing a review that is already committed', () => {
    const root = reviewedRepository();
    commitAll(root);
    writeFiles(root, { 'src/cart.js': correctCart });
    assert.match(commit(root).reason, /already committed/);
  });

  test('skip once allows one commit without a review', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    loop(root, ['gate', '--on']);
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['gate', '--skip-once']);
    assert.equal(commit(root).decision, 'ask');
    assert.equal(commit(root).decision, 'deny');
  });

  test('push and --no-verify always ask even with delegation', () => {
    const root = reviewedRepository();
    loop(root, ['delegate', '--scope', 'repo']);
    assert.match(commit(root, 'git push --force origin main').reason, /force push/);
    assert.equal(commit(root, 'git push').decision, 'ask');
    assert.equal(commit(root, 'git commit --no-verify -m x').decision, 'ask');
  });

  test('allow is lowered to ask when other commands run with the commit', () => {
    const root = reviewedRepository();
    loop(root, ['delegate', '--scope', 'repo']);
    assert.equal(commit(root, 'git add -A && git commit -m x').decision, 'allow');
    assert.equal(commit(root, 'git commit -m x && rm -rf dist').decision, 'ask');
  });

  test('command substitution in a delegated commit is asked about', () => {
    const root = reviewedRepository();
    loop(root, ['delegate', '--scope', 'repo']);
    assert.equal(commit(root, 'git commit -m "$(rm -rf dist)"').decision, 'ask');
    assert.equal(commit(root, 'git commit -m `rm -rf dist`').decision, 'ask');
  });

  test('a commit message from a quoted heredoc is allowed with delegation', () => {
    const root = reviewedRepository();
    loop(root, ['delegate', '--scope', 'repo']);
    const body = 'feat: coupon\n\nSays "hi"; it\'s literal, so $HOME and `pwd` stay text.';
    assert.equal(commit(root, `git add -A && git commit -m "$(cat <<'EOF'\n${body}\nEOF\n)"`).decision, 'allow');
    assert.equal(commit(root, `git commit -m "$(cat <<-"MSG"\n\t${body}\n\tMSG\n)"`).decision, 'allow');
  });

  test('a heredoc that can run commands is still asked about', () => {
    const root = reviewedRepository();
    loop(root, ['delegate', '--scope', 'repo']);
    assert.equal(commit(root, 'git commit -m "$(cat <<EOF\nfix $(rm -rf dist)\nEOF\n)"').decision, 'ask');
    assert.equal(commit(root, `git commit -m "$(cat <<'EOF'\nfix\nEOF\nrm -rf dist\nEOF\n)"`).decision, 'ask');
    assert.equal(commit(root, `git commit -m "$(cat <<'EOF'; rm -rf dist\nfix\nEOF\n)"`).decision, 'ask');
    assert.equal(commit(root, `git commit -m '$(cat <<'EOF'\nx'; rm -rf dist; echo '\nEOF\n)'`).decision, 'ask');
    assert.equal(commit(root, `git commit -m "\\$(cat <<'EOF'\nx"; rm -rf dist; echo "\nEOF\n)"`).decision, 'ask');
    assert.equal(commit(root, `git commit -m $(cat <<'EOF'\nx --no-verify\nEOF\n)`).decision, 'ask');
    assert.equal(commit(root, `git commit -m "$(cat <<'EOF'\nx)"; rm -rf dist; echo "(\nEOF\n)"`).decision, 'ask');
    assert.equal(commit(root, `git commit -m "$(cat <<'EOF'\nfix: coupon (#17)\nEOF\n)"`).decision, 'ask');
  });

  test('a heredoc passed as its own argument is read as that argument', () => {
    const root = reviewedRepository();
    loop(root, ['delegate', '--scope', 'repo']);
    assert.equal(commit(root, `git commit -m fix "$(cat <<'EOF'\n--no-verify\nEOF\n)"`).decision, 'ask');
    assert.equal(commit(root, `git commit -m fix "$(cat <<'EOF'\n-n\nEOF\n)"`).decision, 'ask');
    assert.equal(commit(root, `git commit -m "$(cat <<'EOF'\n--no-verify\nEOF\n)"`).decision, 'allow');
  });

  test('ANSI-C quoted strings do not hide command substitution', () => {
    const root = reviewedRepository();
    loop(root, ['delegate', '--scope', 'repo']);
    assert.equal(commit(root, "git commit -m $'a\\'' \"$(rm -rf dist)\"").decision, 'ask');
    assert.equal(commit(root, "git commit -m $'fix: it\\'s done'").decision, 'allow');
  });

  test('backticks inside single quotes are not command substitution', () => {
    const root = reviewedRepository();
    loop(root, ['delegate', '--scope', 'repo']);
    assert.equal(commit(root, "git commit -m 'fix: round `total` and $(price)'").decision, 'allow');
    assert.equal(commit(root, 'git commit -m "fix: round `total`"').decision, 'ask');
  });

  test('option values are not read as skipping hooks', () => {
    const root = reviewedRepository();
    loop(root, ['delegate', '--scope', 'repo']);
    assert.equal(commit(root, 'git commit -unormal -m x').decision, 'allow');
    assert.equal(commit(root, 'git commit -Sn -m x').decision, 'allow');
    assert.equal(commit(root, 'git commit -am -n').decision, 'allow');
    assert.equal(commit(root, 'git commit -m x -- -n').decision, 'allow');
    assert.equal(commit(root, 'git commit -m x -n').decision, 'ask');
  });

  test('a short flag cluster that starts with n is read as skipping hooks', () => {
    const root = reviewedRepository();
    loop(root, ['delegate', '--scope', 'repo']);
    assert.equal(commit(root, 'git commit -nm fix').decision, 'ask');
    assert.equal(commit(root, 'git commit -mn').decision, 'allow');
  });

  test('an unreviewed commit that skips hooks is still blocked', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    loop(root, ['gate', '--on']);
    writeFiles(root, { 'src/cart.js': brokenCart });
    assert.equal(commit(root, 'git commit --no-verify -m x').decision, 'deny');
    assert.equal(commit(root, 'git commit -n -m x').decision, 'deny');
    const reviewed = reviewedRepository();
    loop(reviewed, ['delegate', '--scope', 'repo']);
    assert.equal(commit(reviewed, 'git commit -mcleanup').decision, 'allow');
  });

  test('a review is used up once HEAD moves', () => {
    const root = reviewedRepository();
    writeFiles(root, { 'src/cart.js': `${brokenCart}// fix from the decision step\n` });
    commitAll(root);
    writeFiles(root, { 'src/cart.js': `${brokenCart}// new unreviewed code\n` });
    assert.match(commit(root).reason, /already committed/);
  });

  test('gate checks the repository named with git -C', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    loop(root, ['gate', '--on']);
    writeFiles(root, { 'src/cart.js': brokenCart });
    const elsewhere = mkdtempSync(path.join(tmpdir(), 'review-loop-cwd-'));
    assert.equal(gateDecision({ cwd: elsewhere, command: `git -C ${root} commit -m x` }).decision, 'deny');
  });
});

describe('commit gate hook script', () => {
  const hook = fileURLToPath(new URL('../../plugins/review-loop/hooks/commit-gate.mjs', import.meta.url));

  test('hook prints a permission decision', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    loop(root, ['gate', '--on']);
    writeFiles(root, { 'src/cart.js': brokenCart });
    const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: root });
    const output = JSON.parse(execFileSync('node', [hook], { input: payload, encoding: 'utf8' }));
    assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
  });

  test('hook stays silent on other commands and bad input', () => {
    const quiet = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls -la' }, cwd: tmpdir() });
    assert.equal(execFileSync('node', [hook], { input: quiet, encoding: 'utf8' }), '');
    assert.equal(execFileSync('node', [hook], { input: 'not json', encoding: 'utf8' }), '');
  });
});

describe('loop.mjs decisions', () => {
  test('decide rejects an unknown choice', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    loop(root, ['record'], { findings: [{ severity: 'P3', file: 'src/cart.js', title: 'Name total as sumPrices' }] });
    assert.throws(() => loop(root, ['decide', '--id', 'F-1', '--choice', 'ignore']), /choice must be one of/);
  });
});
