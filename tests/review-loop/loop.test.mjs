import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
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
  test('classify asks about evidenced findings at a confirmed severity', () => {
    assert.equal(classify([doubledPrice], brokenCartSource, ['P2']).ask.length, 1);
    assert.equal(classify([doubledPrice], brokenCartSource, ['P2']).fix.length, 0);
    assert.equal(classify([{ ...doubledPrice, severity: 'P1' }], brokenCartSource, ['P2']).fix.length, 1);
    assert.equal(classify([{ ...doubledPrice, quote: 'not in the file' }], brokenCartSource, ['P2']).cards[0].unproven, true);
  });

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

  test('flags conditional todo and expected-failure test forms', () => {
    const diff = [
      '--- a/src/cart.test.js',
      '+++ b/src/cart.test.js',
      "+it.skipIf(process.env.CI)('totals', () => {});",
      "+  test.runIf(fast)('rounds', () => {});",
      "+it.todo('applies coupons');",
      "+test.fails('rejects negatives', () => {});",
    ].join('\n');
    assert.equal(findWeakening(diff).length, 4);
  });

  test('flags a lint disable at the end of a code line but not inside a string', () => {
    const diff = [
      '--- a/src/cart.js',
      '+++ b/src/cart.js',
      '+console.log(total); // eslint-disable-line no-console',
      "+report('a'); /* eslint-disable-line */",
      '+const note = "keep // eslint-disable-line out of code";',
      "+const hint = 'use /* eslint-disable-line */ sparingly';",
    ].join('\n');
    const issues = findWeakening(diff);
    assert.equal(issues.length, 2);
    assert.ok(issues.every((issue) => issue.reason === 'lint rule disabled'));
    const prose = [
      '--- a/docs/lint.md',
      '+++ b/docs/lint.md',
      '+Add // eslint-disable-line to silence one line.',
      '+it.skip and test.only now stop the loop.',
      '+// eslint-disable at the start of a line in a document',
    ].join('\n');
    assert.equal(findWeakening(prose).length, 0);
  });

  test('reads file names with spaces or quotes from diff headers', () => {
    const spaced = "--- a/src/my cart.test.ts\t\n+++ b/src/my cart.test.ts\t\n-it('totals', () => {});";
    assert.deepEqual(findWeakening(spaced).map((issue) => [issue.file, issue.reason]), [['src/my cart.test.ts', 'test case removed']]);
    const quoted = '--- "a/src/say \\"hi\\".ts"\n+++ "b/src/say \\"hi\\".ts"\n+run(); // eslint-disable-line';
    assert.deepEqual(findWeakening(quoted).map((issue) => issue.file), ['src/say "hi".ts']);
  });

  test('flags skip anywhere in a chained test call', () => {
    const diff = [
      '--- a/src/cart.test.js',
      '+++ b/src/cart.test.js',
      "-it.concurrent('totals', () => {});",
      "+it.concurrent.skip('totals', () => {});",
      "-it.each([1])('rounds %i', () => {});",
      "+it.skip.each([1])('rounds %i', () => {});",
      "+describe.concurrent.only('cart', () => {});",
    ].join('\n');
    assert.equal(findWeakening(diff).filter((issue) => issue.reason === 'test skipped or focused').length, 3);
  });

  test('flags a test file that loses test cases', () => {
    const removed = [
      '--- a/src/cart.test.js',
      '+++ b/src/cart.test.js',
      "-it('totals', () => {});",
      "-  test('rounds', () => {});",
      "+it('totals all items', () => {});",
    ].join('\n');
    assert.deepEqual(findWeakening(removed).map((issue) => issue.reason), ['test case removed']);
    const renamed = "--- a/src/cart.test.js\n+++ b/src/cart.test.js\n-it('totals', () => {});\n+it('totals all items', () => {});";
    assert.equal(findWeakening(renamed).length, 0);
    const notTest = "--- a/src/cart.js\n+++ b/src/cart.js\n-it('totals', () => {});";
    assert.equal(findWeakening(notTest).length, 0);
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
    assert.deepEqual(gitInvocations('git -C ../other commit -m x', '/repo/app')[0].directories, ['/repo/other']);
    assert.equal(gitInvocations('git -c user.name=x commit -m y', '/repo')[0].subcommand, 'commit');
    assert.deepEqual(gitInvocations('cd packages/web && git commit -m x', '/repo')[0].directories, ['/repo/packages/web']);
    assert.equal(gitInvocations('GIT_EDITOR=true git commit', '/repo')[0].subcommand, 'commit');
  });

  test('expands home paths and gives up on paths it cannot read', () => {
    assert.deepEqual(gitInvocations('cd ~/work && git commit -m x', '/repo')[0].directories, [path.join(homedir(), 'work')]);
    assert.deepEqual(gitInvocations('git -C $HOME/work commit -m x', '/repo')[0].directories, [path.join(homedir(), 'work')]);
    assert.deepEqual(gitInvocations('git -C "${HOME}" commit -m x', '/repo')[0].directories, [homedir()]);
    assert.deepEqual(gitInvocations('cd && git commit -m x', '/repo')[0].directories, [homedir()]);
    assert.deepEqual(gitInvocations('cd "$(git rev-parse --show-toplevel)" && git commit -m x', '/repo')[0].directories, [null]);
    assert.deepEqual(gitInvocations('cd $WORK && git -C app commit -m x', '/repo')[0].directories, [null]);
    assert.deepEqual(gitInvocations('cd - && git commit -m x', '/repo')[0].directories, [null]);
    assert.deepEqual(gitInvocations('git -C ../other \\\n  commit -m x', '/repo/app')[0].directories, ['/repo/other']);
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

  test('snapshot matches what git add -A would commit when the index has staged changes', () => {
    const root = createRepository({ 'src/cart.js': correctCart, 'src/old.js': 'old\n', 'src/twice.js': 'one\n' });
    const runGit = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    writeFiles(root, { 'src/cart.js': brokenCart, 'src/twice.js': 'two\n', 'src/staged.js': 'staged\n' });
    runGit('add', 'src/twice.js', 'src/staged.js');
    writeFiles(root, { 'src/twice.js': 'three\n', 'src/untracked.js': 'new\n' });
    rmSync(path.join(root, 'src/old.js'));
    loop(root, ['start']);
    const state = JSON.parse(readFileSync(path.join(root, '.git/lim/review-loop/state.json'), 'utf8'));
    const expectedIndex = path.join(root, '.git/expected.index');
    const env = { ...process.env, GIT_INDEX_FILE: expectedIndex };
    execFileSync('git', ['read-tree', 'HEAD'], { cwd: root, env });
    execFileSync('git', ['add', '-A'], { cwd: root, env });
    const expected = execFileSync('git', ['write-tree'], { cwd: root, env, encoding: 'utf8' }).trim();
    assert.equal(state.reviewedTree, expected);
    assert.equal(runGit('diff', '--cached', '--name-only').trim().split('\n').sort().join(','), 'src/staged.js,src/twice.js');
  });

  test('snapshot starts from the real index and falls back when there is none', () => {
    const root = createRepository({ 'src/cart.js': correctCart, 'src/config.js': 'local = false\n' });
    execFileSync('git', ['update-index', '--assume-unchanged', 'src/config.js'], { cwd: root });
    writeFiles(root, { 'src/cart.js': brokenCart, 'src/config.js': 'local = true\n' });
    loop(root, ['start']);
    const state = JSON.parse(readFileSync(path.join(root, '.git/lim/review-loop/state.json'), 'utf8'));
    const config = execFileSync('git', ['cat-file', 'blob', `${state.reviewedTree}:src/config.js`], { cwd: root, encoding: 'utf8' });
    assert.equal(config, 'local = false\n');

    const fresh = mkdtempSync(path.join(tmpdir(), 'review-loop-'));
    execFileSync('git', ['init', '-q'], { cwd: fresh });
    writeFiles(fresh, { 'src/cart.js': correctCart });
    assert.equal(loop(fresh, ['start']).status, 'review');
    const freshState = JSON.parse(readFileSync(path.join(fresh, '.git/lim/review-loop/state.json'), 'utf8'));
    const cart = execFileSync('git', ['cat-file', 'blob', `${freshState.reviewedTree}:src/cart.js`], { cwd: fresh, encoding: 'utf8' });
    assert.equal(cart, correctCart);
  });

  test('snapshot keeps a same-size edit made right after git add', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/flag.js': 'aaaa' });
    execFileSync('git', ['add', 'src/flag.js'], { cwd: root });
    writeFiles(root, { 'src/flag.js': 'bbbb' });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
    loop(root, ['start']);
    const state = JSON.parse(readFileSync(path.join(root, '.git/lim/review-loop/state.json'), 'utf8'));
    const content = execFileSync('git', ['cat-file', 'blob', `${state.reviewedTree}:src/flag.js`], { cwd: root, encoding: 'utf8' });
    assert.equal(content, 'bbbb');
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

  test('the confirm setting asks before fixing P2 or every P1 and P2', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    assert.equal(loop(root, ['confirm']).severity, 'off');
    loop(root, ['confirm', '--severity', 'P2']);
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    const confirmed = loop(root, ['record'], { findings: [doubledPrice] });
    assert.equal(confirmed.fix.length, 0);
    assert.equal(confirmed.ask[0].title, 'Price is doubled');

    const manifest = JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } });
    const failing = createRepository({ 'package.json': manifest, 'src/cart.js': correctCart });
    loop(failing, ['confirm', '--severity', 'all']);
    writeFiles(failing, { 'src/cart.js': brokenCart });
    loop(failing, ['start']);
    const all = loop(failing, ['record'], { findings: [] });
    assert.equal(all.fix.length, 0);
    assert.equal(all.ask[0].fromChecks, true);

    const midRound = createRepository({ 'src/cart.js': correctCart });
    writeFiles(midRound, { 'src/cart.js': brokenCart });
    loop(midRound, ['start']);
    assert.equal(loop(midRound, ['record'], { findings: [doubledPrice] }).fix[0].id, 'F-1');
    assert.deepEqual(loop(midRound, ['confirm', '--severity', 'P2']).rerouted, ['F-1']);
    const resumed = loop(midRound, ['start']);
    assert.equal(resumed.fix.length, 0);
    assert.equal(resumed.ask[0].id, 'F-1');

    assert.equal(loop(failing, ['confirm', '--off']).severity, 'off');
    assert.equal(loop(failing, ['status']).confirm.severity, 'off');
    assert.throws(() => loop(failing, ['confirm', '--severity', 'P3']));
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

describe('rule drafts', () => {
  const runEveryCheck = 'node -e "for (const file of require(\'fs\').readdirSync(\'checks\')) require(\'./checks/\' + file)"';
  const doubledPriceCheck = [
    "const source = require('fs').readFileSync('src/cart.js', 'utf8');",
    "if (source.includes('* 2')) { console.error('cart: do not scale item.price'); process.exit(1); }",
    '',
  ].join('\n');
  const doubledPriceCard = { ...doubledPrice, severity: 'P3', ruleCandidate: true };
  const stateFile = (root) => JSON.parse(readFileSync(path.join(root, '.git/lim/review-loop/state.json'), 'utf8'));
  const ledger = (root) => readFileSync(path.join(root, '.git/lim/review-loop/ledger.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));

  function decidedRule(files = {}) {
    const root = createRepository({
      'package.json': JSON.stringify({ scripts: { test: runEveryCheck } }),
      'checks/existing.cjs': '',
      'src/cart.js': correctCart,
      ...files,
    });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    loop(root, ['record'], { findings: [doubledPriceCard] });
    const { id } = stateFile(root).cards[0];
    const decision = loop(root, ['decide', '--id', id, '--choice', 'rule']);
    writeFiles(root, { 'src/cart.js': correctCart });
    return { root, id, decision };
  }

  test('a rule draft that fails on the code before the fix is caught', () => {
    const { root, id, decision } = decidedRule();
    assert.equal(decision.choice, 'rule');
    writeFiles(root, { 'checks/cart.cjs': doubledPriceCheck, 'checks/notes.cjs': '' });
    const result = loop(root, ['rule', '--id', id, '--draft', 'checks/cart.cjs', '--draft', 'checks/notes.cjs']);
    assert.deepEqual([result.proof, result.caughtBy], ['caught', ['test']]);
    assert.match(result.withDrafts[0].tail, /do not scale item.price/);
    assert.deepEqual(loop(root, ['status']).review.rules, [{ id, drafts: ['checks/cart.cjs', 'checks/notes.cjs'], proof: 'caught' }]);
    const entry = ledger(root).find((line) => line.event === 'rule');
    assert.deepEqual([entry.quote, entry.scenario, entry.category, entry.proof], [doubledPrice.quote, doubledPrice.scenario, 'correctness', 'caught']);
  });

  test('a rule draft that passes on the code before the fix is missed', () => {
    const { root, id } = decidedRule();
    writeFiles(root, { 'checks/cart.cjs': "require('fs').readFileSync('src/cart.js', 'utf8');\n" });
    assert.equal(loop(root, ['rule', '--id', id, '--draft', 'checks/cart.cjs']).proof, 'missed');
  });

  test('a rule draft is unproven when the same check already failed without it', () => {
    const { root, id } = decidedRule({ 'checks/existing.cjs': doubledPriceCheck });
    writeFiles(root, { 'checks/cart.cjs': doubledPriceCheck });
    const result = loop(root, ['rule', '--id', id, '--draft', 'checks/cart.cjs']);
    assert.deepEqual([result.proof, result.caughtBy], ['unproven', []]);
  });

  test('checking a rule links node_modules and leaves the original in place', () => {
    const moduleCheck = "require(require('path').resolve('node_modules/marker/index.cjs'));\n";
    const { root, id } = decidedRule();
    writeFiles(root, {
      '.gitignore': 'node_modules\n',
      'node_modules/marker/index.cjs': '',
      'checks/cart.cjs': moduleCheck + doubledPriceCheck,
    });
    assert.equal(loop(root, ['rule', '--id', id, '--draft', 'checks/cart.cjs']).proof, 'caught');
    assert.equal(readFileSync(path.join(root, 'node_modules/marker/index.cjs'), 'utf8'), '');
  });

  test('the commit gate asks for checked rule drafts and still blocks other new files', () => {
    const { root, id } = decidedRule();
    const commit = () => gateDecision({ cwd: root, command: 'git commit -m "fix: cart"' });
    loop(root, ['gate', '--on']);
    writeFiles(root, { 'checks/cart.cjs': doubledPriceCheck });
    assert.match(commit().reason, /checks\/cart\.cjs changed after the last review/);
    loop(root, ['rule', '--id', id, '--draft', 'checks/cart.cjs']);
    assert.equal(commit().decision, 'ask');
    writeFiles(root, { 'src/other.js': 'export const flag = true;\n' });
    assert.match(commit().reason, /src\/other\.js changed after the last review/);
  });

  test('the commit gate blocks a rule draft edited after loop rule checked it', () => {
    const { root, id } = decidedRule();
    const commit = () => gateDecision({ cwd: root, command: 'git commit -m "fix: cart"' });
    loop(root, ['gate', '--on']);
    writeFiles(root, { 'checks/cart.cjs': doubledPriceCheck });
    loop(root, ['rule', '--id', id, '--draft', 'checks/cart.cjs']);
    writeFiles(root, { 'checks/cart.cjs': `${doubledPriceCheck}// edited after the check\n` });
    assert.match(commit().reason, /checks\/cart\.cjs changed after the last review/);
    loop(root, ['rule', '--id', id, '--draft', 'checks/cart.cjs']);
    assert.equal(commit().decision, 'ask');
  });

  test('a rule draft that adds a new check script is caught when that check fails', () => {
    const { root, id } = decidedRule();
    const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    writeFiles(root, {
      'package.json': JSON.stringify({ scripts: { ...manifest.scripts, lint: 'node lint/cart.cjs' } }),
      'lint/cart.cjs': doubledPriceCheck,
    });
    const result = loop(root, ['rule', '--id', id, '--draft', 'package.json', '--draft', 'lint/cart.cjs']);
    assert.deepEqual([result.proof, result.caughtBy, result.withoutDrafts], ['caught', ['lint'], []]);
  });

  test('a rule draft cannot be a file git ignores', () => {
    const { root, id } = decidedRule();
    writeFiles(root, { '.gitignore': 'node_modules\nlocal/\n', 'node_modules/plugin/index.cjs': '', 'local/rule.cjs': '' });
    assert.throws(() => loop(root, ['rule', '--id', id, '--draft', 'node_modules/plugin/index.cjs']), /ignored by git/);
    assert.throws(() => loop(root, ['rule', '--id', id, '--draft', 'local/rule.cjs']), /ignored by git/);
    assert.equal(readFileSync(path.join(root, 'node_modules/plugin/index.cjs'), 'utf8'), '');
  });

  test('a rule draft must be a separate file that exists', () => {
    const { root, id } = decidedRule();
    assert.throws(() => loop(root, ['rule', '--id', id, '--draft', 'src/cart.js']), /the file the finding is in/);
    assert.throws(() => loop(root, ['rule', '--id', id, '--draft', 'checks/missing.cjs']), /does not exist/);
    assert.throws(() => loop(root, ['rule', '--id', id]), /--draft/);
  });

  test('make it a rule falls back to fix once when no check script would run it', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    loop(root, ['record'], { findings: [doubledPriceCard] });
    const decision = loop(root, ['decide', '--id', 'F-1', '--choice', 'rule']);
    assert.equal(decision.choice, 'once');
    assert.match(decision.ruleSkipped, /no typecheck, lint, or test script/);
    assert.throws(() => loop(root, ['rule', '--id', 'F-1', '--draft', 'src/cart.js']), /not marked as a rule/);
  });

  test('rule candidates are kept from the reviewer and counted in the report', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    const result = loop(root, ['record'], { findings: [doubledPriceCard] });
    assert.equal(result.cards[0].ruleCandidate, true);
    assert.match(result.report, /rule candidates 1/);
  });
});

describe('loop status steps', () => {
  const namingCard = { severity: 'P3', file: 'src/cart.js', title: 'Name total as sumPrices' };
  const doneSteps = (root) => loop(root, ['status']).review.doneSteps;

  test('status lists the steps the script saw done', () => {
    const root = createRepository({
      'package.json': JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }),
      'src/cart.js': correctCart,
    });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    assert.deepEqual(doneSteps(root), ['start']);
    loop(root, ['record'], { findings: [doubledPrice, namingCard] });
    writeFiles(root, { 'src/cart.js': correctCart });
    loop(root, ['next']);
    loop(root, ['record'], { resolved: ['F-1'], findings: [] });
    loop(root, ['decide', '--id', 'F-2', '--choice', 'rule']);
    writeFiles(root, { 'checks/cart.cjs': '' });
    loop(root, ['rule', '--id', 'F-2', '--draft', 'checks/cart.cjs']);
    loop(root, ['checks']);
    assert.deepEqual(doneSteps(root), ['start', 'review', 'record', 'fix', 're-review', 'decide', 'rules', 'checks']);
  });

  test('status leaves out unfinished decisions and stale checks and earlier runs', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    loop(root, ['record'], { findings: [namingCard] });
    assert.deepEqual(doneSteps(root), ['start', 'review', 'record']);
    loop(root, ['decide', '--id', 'F-1', '--choice', 'once']);
    assert.deepEqual(doneSteps(root), ['start', 'review', 'record', 'decide']);
    loop(root, ['checks']);
    assert.deepEqual(doneSteps(root), ['start', 'review', 'record', 'decide', 'checks']);
    writeFiles(root, { 'src/cart.js': brokenCart.replace('total', 'sumPrices') });
    assert.deepEqual(doneSteps(root), ['start', 'review', 'record', 'decide']);
    loop(root, ['checks']);
    assert.deepEqual(doneSteps(root), ['start', 'review', 'record', 'decide', 'checks']);
    loop(root, ['start', '--fresh']);
    assert.deepEqual(doneSteps(root), ['start']);
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

  test('gate finds the repository through a home path', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    loop(root, ['gate', '--on']);
    writeFiles(root, { 'src/cart.js': brokenCart });
    const elsewhere = mkdtempSync(path.join(tmpdir(), 'review-loop-elsewhere-'));
    const savedHome = process.env.HOME;
    process.env.HOME = path.dirname(root);
    try {
      assert.equal(commit(elsewhere, `cd ~/${path.basename(root)} && git commit -m x`).decision, 'deny');
    } finally {
      process.env.HOME = savedHome;
    }
  });

  test('gate asks when it cannot tell which repository a commit runs in', () => {
    const root = reviewedRepository();
    loop(root, ['delegate', '--scope', 'repo']);
    assert.equal(commit(root, 'cd "$(git rev-parse --show-toplevel)" && git commit -m x').decision, 'ask');
    assert.equal(commit(root, 'git -C missing commit -m x').decision, 'ask');
    const plainDirectory = mkdtempSync(path.join(tmpdir(), 'review-loop-plain-'));
    assert.equal(commit(root, `git -C ${plainDirectory} commit -m x`), null);
    const gateOff = createRepository({ 'src/cart.js': correctCart });
    assert.equal(commit(gateOff, 'cd $WORK && git commit -m x'), null);
  });

  test('a linked worktree shares the gate and delegation but keeps its own review', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    loop(root, ['gate', '--on']);
    const worktree = `${root}-worktree`;
    execFileSync('git', ['worktree', 'add', '-q', worktree, '-b', 'side'], { cwd: root, stdio: 'ignore' });
    assert.equal(loop(worktree, ['status']).gate.enabled, true);
    writeFiles(worktree, { 'src/cart.js': brokenCart });
    assert.equal(commit(worktree).decision, 'deny');
    loop(worktree, ['start']);
    loop(worktree, ['record'], { findings: [] });
    loop(root, ['delegate', '--scope', 'repo']);
    assert.equal(commit(worktree).decision, 'allow');
    writeFiles(root, { 'src/cart.js': brokenCart });
    assert.equal(commit(root).decision, 'deny');
  });

  test('a gate turned on inside a worktree by 0.2.0 still applies', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    const worktree = `${root}-worktree`;
    execFileSync('git', ['worktree', 'add', '-q', worktree, '-b', 'side'], { cwd: root, stdio: 'ignore' });
    const worktreeGitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: worktree, encoding: 'utf8' }).trim();
    writeFiles(worktreeGitDir, { 'lim/review-loop/gate.json': JSON.stringify({ enabled: true, configured: true }) });
    writeFiles(worktree, { 'src/cart.js': brokenCart });
    assert.equal(commit(worktree).decision, 'deny');
  });

  test('skip once applies only to the worktree that asked for it', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    loop(root, ['gate', '--on']);
    loop(root, ['delegate', '--scope', 'repo']);
    const worktree = `${root}-worktree`;
    execFileSync('git', ['worktree', 'add', '-q', worktree, '-b', 'side'], { cwd: root, stdio: 'ignore' });
    loop(worktree, ['gate', '--skip-once']);
    writeFiles(root, { 'src/cart.js': brokenCart });
    writeFiles(worktree, { 'src/cart.js': brokenCart });
    assert.equal(commit(root).decision, 'deny');
    assert.equal(commit(worktree).decision, 'allow');
  });

  test('gate asks when git is pointed at another repository', () => {
    const root = reviewedRepository();
    loop(root, ['delegate', '--scope', 'repo']);
    assert.equal(commit(root, `git --git-dir=${root}/.git --work-tree=${root} commit -m x`).decision, 'ask');
    assert.equal(commit(root, 'git --git-dir .git commit -m x').decision, 'ask');
    assert.equal(commit(root, `GIT_DIR=${root}/.git git commit -m x`).decision, 'ask');
  });

  test('a cd in a command with parentheses is checked in every folder it may run in', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    loop(root, ['gate', '--on']);
    writeFiles(root, { 'src/cart.js': brokenCart });
    const plainDirectory = mkdtempSync(path.join(tmpdir(), 'review-loop-plain-'));
    assert.equal(commit(root, `(cd ${plainDirectory}) && git commit -m x`).decision, 'deny');
    assert.equal(commit(plainDirectory, `(cd ${root} && git commit -m x)`).decision, 'deny');
    assert.equal(commit(plainDirectory, `cd ${root} && git commit -m x || (echo failed)`).decision, 'deny');
    assert.equal(commit(plainDirectory, `cd ${root} && git commit -m x && echo $(git rev-parse HEAD)`).decision, 'deny');
  });

  test('many cds in parentheses stay bounded and still block', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    loop(root, ['gate', '--on']);
    writeFiles(root, { 'src/cart.js': brokenCart });
    const steps = Array.from({ length: 24 }, (_, index) => `(cd pkg${index} && npm test)`);
    const invocation = gitInvocations(`${steps.join(' && ')} && git commit -m x`, root)[0];
    assert.ok(invocation.directories.length <= 16);
    assert.ok(invocation.directories.includes(null));
    assert.equal(commit(root, `${steps.join(' && ')} && git commit -m x`).decision, 'deny');
  });

  test('a commit that may run in more than one folder is not approved on its own', () => {
    const root = reviewedRepository();
    loop(root, ['delegate', '--scope', 'repo']);
    const other = createRepository({ 'src/cart.js': correctCart });
    assert.equal(commit(root, `(cd ${other} && git commit -m x)`).decision, 'ask');
    const skipping = createRepository({ 'src/cart.js': correctCart });
    loop(skipping, ['gate', '--on']);
    loop(skipping, ['delegate', '--scope', 'repo']);
    loop(skipping, ['gate', '--skip-once']);
    const unusedSkip = commit(skipping, `(cd ${other} && git commit -m x)`);
    assert.equal(unusedSkip.decision, 'deny');
    assert.match(unusedSkip.reason, /one-time skip does not apply/);
    assert.equal(loop(skipping, ['status']).gate.skipOnce, true);
  });

  test('gate also checks the folder where Claude Code started', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    loop(root, ['gate', '--on']);
    writeFiles(root, { 'src/cart.js': brokenCart });
    const elsewhere = mkdtempSync(path.join(tmpdir(), 'review-loop-elsewhere-'));
    const command = 'cd "$(git -C ../repo rev-parse --show-toplevel)" && git commit -m x';
    assert.equal(gateDecision({ cwd: elsewhere, command }), null);
    assert.equal(gateDecision({ cwd: elsewhere, command, projectDir: root }).decision, 'ask');
  });

  test('a one-time skip is used once when every folder is in the same repository', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    loop(root, ['gate', '--on']);
    loop(root, ['delegate', '--scope', 'repo']);
    loop(root, ['gate', '--skip-once']);
    writeFiles(root, { 'src/cart.js': brokenCart });
    assert.equal(commit(root, '(cd src && ls) && git commit -am one').decision, 'ask');
    assert.equal(commit(root, 'git commit -am two').decision, 'deny');
  });

  test('turning the gate off and on cancels a pending skip in every worktree', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    loop(root, ['gate', '--on']);
    const worktree = `${root}-worktree`;
    execFileSync('git', ['worktree', 'add', '-q', worktree, '-b', 'side'], { cwd: root, stdio: 'ignore' });
    loop(worktree, ['gate', '--skip-once']);
    loop(root, ['gate', '--off']);
    loop(root, ['gate', '--on']);
    writeFiles(worktree, { 'src/cart.js': brokenCart });
    assert.equal(commit(worktree).decision, 'deny');
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

describe('kept findings', () => {
  const longName = { severity: 'P3', file: 'src/cart.js', line: 1, category: 'naming', title: 'Name total as sumPrices', quote: 'export const total' };
  const scaledPrice = { severity: 'P3', file: 'src/cart.js', line: 1, category: 'readability', title: 'Explain the factor', quote: 'item.price * 2' };
  const stateFile = (root) => JSON.parse(readFileSync(path.join(root, '.git/lim/review-loop/state.json'), 'utf8'));

  function keepInFirstReview(root, findings, startArgs = []) {
    loop(root, ['start', ...startArgs]);
    loop(root, ['record'], { findings });
    for (const id of loop(root, ['status']).review.pendingDecisions) loop(root, ['decide', '--id', id, '--choice', 'keep']);
    assert.equal(loop(root, ['start']).status, 'review');
  }

  test('a finding kept in an earlier review is not a card in the next review', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    keepInFirstReview(root, [longName]);
    const result = loop(root, ['record'], { findings: [longName, scaledPrice] });
    assert.deepEqual(result.cards.map((card) => card.title), ['Explain the factor']);
    assert.deepEqual(loop(root, ['status']).review.pendingDecisions, [result.cards[0].id]);
    assert.deepEqual(stateFile(root).kept.map((item) => item.title), ['Name total as sumPrices']);
  });

  test('the report counts findings kept before that were raised again', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    keepInFirstReview(root, [longName, scaledPrice]);
    const result = loop(root, ['record'], { findings: [longName, scaledPrice] });
    assert.match(result.report, /\n2 findings you kept before were raised again\n/);
    assert.match(result.report, /Left for you: P3 0, P4 0, P5 0/);
    assert.deepEqual(result.cards, []);
  });

  test('a kept P1 or P2 raised again is listed with its severity and not fixed', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    keepInFirstReview(root, [doubledPrice], ['--max-rounds', '1']);
    const result = loop(root, ['record'], { findings: [doubledPrice] });
    assert.deepEqual([result.decision, result.reason, result.fix.length], ['stop', 'clean', 0]);
    assert.match(result.report, /1 finding you kept before was raised again, including:\n- \[P2\] src\/cart\.js:1 Price is doubled/);
    assert.match(result.report, /\nStopped: no P1 or P2 left to fix; the kept ones are listed above\n/);
  });

  test('a kept finding raised again at a higher severity is a card again', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    keepInFirstReview(root, [{ ...scaledPrice, severity: 'P4' }]);
    const result = loop(root, ['record'], { findings: [scaledPrice] });
    assert.deepEqual(result.cards.map((card) => [card.severity, card.title]), [['P3', 'Explain the factor']]);
    assert.doesNotMatch(result.report, /kept before/);
  });

  test('a kept finding is a card again when its quoted line appears twice in the file', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    keepInFirstReview(root, [scaledPrice]);
    writeFiles(root, { 'src/cart.js': `${brokenCart}export const doubled = (items) => items.map((item) => item.price * 2);\n` });
    loop(root, ['start', '--fresh']);
    const result = loop(root, ['record'], { findings: [scaledPrice] });
    assert.deepEqual(result.cards.map((card) => card.title), ['Explain the factor']);
    assert.doesNotMatch(result.report, /kept before/);
  });

  test('a kept finding whose quoted line the diff removed stays kept', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    keepInFirstReview(root, [scaledPrice]);
    writeFiles(root, { 'src/cart.js': correctCart });
    loop(root, ['start', '--fresh']);
    const result = loop(root, ['record'], { findings: [scaledPrice] });
    assert.deepEqual(result.cards, []);
    assert.match(result.report, /\n1 finding you kept before was raised again\n/);
  });

  test('a kept finding is asked about again once its quoted line changes', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    keepInFirstReview(root, [scaledPrice]);
    writeFiles(root, { 'src/cart.js': brokenCart.replace('* 2', '* 3') });
    loop(root, ['start', '--fresh']);
    const result = loop(root, ['record'], { findings: [{ ...scaledPrice, quote: 'item.price * 3' }] });
    assert.deepEqual(result.cards.map((card) => card.title), ['Explain the factor']);
    assert.doesNotMatch(result.report, /kept before/);
  });

  test('a failing check is still a P1 finding after the user kept it', () => {
    const manifest = JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } });
    const root = createRepository({ 'package.json': manifest, 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    keepInFirstReview(root, [], ['--max-rounds', '1']);
    const result = loop(root, ['record'], { findings: [] });
    assert.deepEqual([result.decision, result.fix[0].severity, result.fix[0].fromChecks], ['continue', 'P1', true]);
  });
});
