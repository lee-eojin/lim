import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  changedProjects,
  classify,
  decideNext,
  detectChecks,
  detectFolderChecks,
  findWeakening,
  gateDecision,
  gitInvocations,
  isStalled,
  NAMED_KINDS,
  parseReview,
  renderReport,
  missingProgram,
  expandAlias,
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

  test('decideNext stops as waiting instead of clean when findings wait for you', () => {
    assert.deepEqual(decideNext({ round: 1, maxRounds: 3, counts: [0], open: 0, waiting: 1 }), { decision: 'stop', reason: 'waiting' });
    assert.deepEqual(decideNext({ round: 1, maxRounds: 3, counts: [0], open: 0 }), { decision: 'stop', reason: 'clean' });
    assert.equal(decideNext({ round: 1, maxRounds: 3, counts: [1], open: 1, waiting: 2 }).decision, 'continue');
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
      round: 1, maxRounds: 3, checks: [{ name: 'test', command: 'npm run test', exitCode: 0 }],
      counts: [0], decision: 'stop', reason: 'clean', cards: [{ severity: 'P3' }],
    });
    assert.match(report, /Checks: test \(npm run test\) passed/);
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

  test('report marks repeated fix and ask findings and counts the looped ones in the repeat tally', () => {
    const repeat = { category: 'correctness', seenBefore: 3 };
    const finding = { severity: 'P2', file: 'a.js', line: 3, title: 'Off by one', quote: 'i <= n', scenario: 'n = 0 reads past the end' };
    const continuing = renderReport({
      round: 1, maxRounds: 3, counts: [2], decision: 'continue',
      fix: [{ ...finding, id: 'F-1', repeat }], ask: [{ ...finding, id: 'F-2', title: 'Wrong bound', repeat }],
    });
    assert.match(continuing, /- F-1 \[P2\] a\.js:3 Off by one\n(?: {2}.*\n)*? {2}repeat: correctness, seen 3 times before/);
    assert.match(continuing, /- F-2 \[P2\] a\.js:3 Wrong bound\n(?: {2}.*\n)*? {2}repeat: correctness, seen 3 times before/);
    const stopped = renderReport({
      round: 2, maxRounds: 3, counts: [2, 0], decision: 'stop', reason: 'clean',
      cards: [{ severity: 'P3', repeat }], looped: [{ ...finding, id: 'F-1', repeat }, { ...finding, id: 'F-2' }],
    });
    assert.match(stopped, /Left for you: P3 1, P4 0, P5 0, repeats 2/);
  });

  test('report header names the reviewer model or the session model', () => {
    const firstLine = (reviewerModel) => renderReport({
      round: 1, maxRounds: 3, reviewerModel, counts: [0], decision: 'stop', reason: 'clean',
    }).split('\n')[0];
    assert.equal(firstLine('sonnet'), 'Review round 1 of 3 (reviewer: sonnet)');
    assert.equal(firstLine('inherit'), 'Review round 1 of 3 (reviewer: session model)');
  });
});

describe('check detection', () => {
  const projectFolder = (files) => {
    const root = mkdtempSync(path.join(tmpdir(), 'review-loop-checks-'));
    writeFiles(root, files);
    return root;
  };
  const commands = (root) => detectChecks(root).map(({ name, command }) => [name, command.join(' ')]);

  test('makefile targets are detected as checks and an assignment is not a target', () => {
    const makefile = 'types: deps\n\ttsc\nlint:\n\teslint .\ntest := unit\n.PHONY: test\n';
    assert.deepEqual(commands(projectFolder({ Makefile: makefile })), [['typecheck', 'make types'], ['lint', 'make lint']]);
    assert.deepEqual(commands(projectFolder({ GNUmakefile: 'check-types:\n\ttrue\ntest::\n\ttrue\n' })), [
      ['typecheck', 'make check-types'], ['test', 'make test'],
    ]);
  });

  test('a go module runs go vet and go test', () => {
    assert.deepEqual(commands(projectFolder({ 'go.mod': 'module example.com/cart\n' })), [
      ['lint', 'go vet ./...'], ['test', 'go test ./...'],
    ]);
  });

  test('a cargo project runs cargo check and cargo test', () => {
    assert.deepEqual(commands(projectFolder({ 'Cargo.toml': '[package]\nname = "cart"\n' })), [
      ['typecheck', 'cargo check'], ['test', 'cargo test'],
    ]);
  });

  test('python tools run only when the project configures them', () => {
    assert.deepEqual(commands(projectFolder({ 'pyproject.toml': '[project]\nname = "cart"\n', 'main.py': '' })), []);
    const configured = '[project]\nname = "cart"\n\n[tool.pytest.ini_options]\naddopts = "-q"\n\n[tool.ruff.lint]\nselect = ["E"]\n\n[tool.mypy]\nstrict = true\n';
    assert.deepEqual(commands(projectFolder({ 'pyproject.toml': configured })), [
      ['typecheck', 'mypy .'], ['lint', 'ruff check .'], ['test', 'python3 -m pytest'],
    ]);
    assert.deepEqual(commands(projectFolder({ 'pytest.ini': '[pytest]\n', 'ruff.toml': '', 'mypy.ini': '[mypy]\n' })), [
      ['typecheck', 'mypy .'], ['lint', 'ruff check .'], ['test', 'python3 -m pytest'],
    ]);
    assert.deepEqual(commands(projectFolder({ 'setup.cfg': '[tool:pytest]\n', '.ruff.toml': '' })), [
      ['lint', 'ruff check .'], ['test', 'python3 -m pytest'],
    ]);
  });

  test('python tools run through uv run when uv.lock exists', () => {
    const configured = '[tool.pytest.ini_options]\n[tool.ruff]\n[tool.mypy]\n';
    assert.deepEqual(commands(projectFolder({ 'pyproject.toml': configured, 'uv.lock': '' })), [
      ['typecheck', 'uv run --frozen --no-sync mypy .'], ['lint', 'uv run --frozen --no-sync ruff check .'], ['test', 'uv run --frozen --no-sync pytest'],
    ]);
  });

  test('a tool uv or python cannot find is read as not installed and other failures are not', () => {
    const spawnFailure = 'error: Failed to spawn: `pytest`\n  Caused by: No such file or directory (os error 2)\n';
    assert.equal(missingProgram(['uv', 'run', '--frozen', '--no-sync', 'pytest'], spawnFailure), 'pytest');
    assert.equal(missingProgram(['uv', 'run', '--frozen', '--no-sync', 'pytest'], 'FAILED tests/test_cart.py::test_total\n'), null);
    assert.equal(missingProgram(['python3', '-m', 'pytest'], '/usr/bin/python3: No module named pytest\n'), 'pytest');
    assert.equal(missingProgram(['python3', '-m', 'pytest'], "E   ModuleNotFoundError: No module named 'cart'\n"), null);
    assert.equal(missingProgram(['make', 'test'], spawnFailure), null);
  });

  test('mypy runs without a path when the project configures its files', () => {
    assert.deepEqual(commands(projectFolder({ 'pyproject.toml': '[tool.mypy]\nfiles = ["src"]\n\n[tool.ruff]\n' })), [
      ['typecheck', 'mypy'], ['lint', 'ruff check .'],
    ]);
    assert.deepEqual(commands(projectFolder({ 'mypy.ini': '[mypy]\nfiles = src\n' })), [['typecheck', 'mypy']]);
    assert.deepEqual(commands(projectFolder({ 'pyproject.toml': '[tool.mypy]\nstrict = true\n\n[tool.other]\nfiles = ["x"]\n' })), [['typecheck', 'mypy .']]);
    assert.deepEqual(commands(projectFolder({ 'mypy.ini': '[mypy]\nstrict = True\n', 'pyproject.toml': '[tool.mypy]\nfiles = ["src"]\n' })), [['typecheck', 'mypy .']]);
  });

  test('the first source that declares a check wins', () => {
    const root = projectFolder({
      'package.json': JSON.stringify({ scripts: { test: 'node --test' } }),
      Makefile: 'lint:\n\tgo vet ./...\ntest:\n\tgo test ./...\n',
      'go.mod': 'module example.com/cart\n',
      'Cargo.toml': '[package]\nname = "cart"\n',
    });
    assert.deepEqual(commands(root), [['typecheck', 'cargo check'], ['lint', 'make lint'], ['test', 'npm run test']]);
  });

  test('a check whose program is not installed is reported as not verified instead of failing', () => {
    const bin = mkdtempSync(path.join(tmpdir(), 'review-loop-bin-'));
    symlinkSync(process.execPath, path.join(bin, 'node'));
    const gitFolder = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
    symlinkSync(path.join(gitFolder, 'git'), path.join(bin, 'git'));
    const withoutGo = { PATH: bin };
    const root = createRepository({ 'go.mod': 'module example.com/cart\n', 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    const started = loop(root, ['start'], undefined, withoutGo);
    assert.deepEqual(started.checks.map((check) => [check.name, check.notInstalled, check.exitCode]), [
      ['lint', true, null], ['test', true, null],
    ]);
    assert.match(started.checks[1].tail, /not run: go is not installed/);
    const result = loop(root, ['record'], { findings: [] }, withoutGo);
    assert.deepEqual([result.decision, result.reason], ['stop', 'clean']);
    assert.match(result.report, /test \(go test \.\/\.\.\.\) not run because go is not installed \(not verified\)/);
    assert.deepEqual(loop(root, ['status'], undefined, withoutGo).review.notVerifiedChecks, ['lint', 'test']);
    assert.deepEqual(loop(root, ['checks'], undefined, withoutGo).notVerified, ['lint', 'test']);
  });
});

describe('finding basis', () => {
  test('parseReview rejects a basis that is not measured or inferred or guessed', () => {
    const review = JSON.stringify({ findings: [{ ...doubledPrice, basis: 'certain' }] });
    assert.throws(() => parseReview(review), /finding 1 has basis "certain", use measured, inferred, or guessed/);
  });

  test('parseReview rejects a measured finding without measuredBy', () => {
    const review = JSON.stringify({ findings: [{ ...doubledPrice, basis: 'measured', measuredBy: ' ' }] });
    assert.throws(() => parseReview(review), /finding 1 is measured but has no measuredBy/);
  });

  test('a finding without a basis from an older reviewer is still fixed', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    const result = loop(root, ['record'], { findings: [doubledPrice] });
    assert.deepEqual(result.fix.map((item) => [item.id, item.basis]), [['F-1', undefined]]);
    assert.doesNotMatch(result.report, /basis:/);
  });

  test('record keeps the basis and shows it next to each finding', () => {
    const root = createRepository({ 'src/cart.js': correctCart, 'src/other.js': 'export const flag = true;\n' });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    const measured = { ...doubledPrice, basis: 'measured', measuredBy: 'Grep "total(" in tests: no match' };
    const outside = { ...doubledPrice, file: 'src/other.js', quote: 'export const flag = true;', basis: 'inferred' };
    const result = loop(root, ['record'], { findings: [measured, outside] });
    assert.deepEqual([result.fix[0].basis, result.fix[0].measuredBy], ['measured', 'Grep "total(" in tests: no match']);
    assert.match(result.report, /Fixing next:\n- F-1 .*\n {2}was: .*\n {2}why: .*\n {2}basis: measured \(Grep "total\(" in tests: no match\)/);
    assert.match(result.report, /- F-2 \[P2\] src\/other\.js:1 Price is doubled \(basis: inferred\)/);
  });

  test('a guessed P1 or P2 is unverified and not fixed', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    const guessedNaming = { severity: 'P3', file: 'src/cart.js', title: 'Name total as sumPrices', basis: 'guessed' };
    const result = loop(root, ['record'], { findings: [{ ...doubledPrice, basis: 'guessed' }, guessedNaming] });
    assert.deepEqual([result.decision, result.reason, result.fix.length], ['stop', 'clean', 0]);
    assert.deepEqual(result.cards.map((card) => [card.severity, card.basis, card.unproven]), [
      ['P2', 'guessed', true], ['P3', 'guessed', undefined],
    ]);
    assert.match(result.report, /Left for you: P3 1, P4 0, P5 0, unproven P1\/P2 1/);
  });

  test('a failing check is a measured finding and its fix is reported as measured', () => {
    const failing = JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } });
    const passing = JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } });
    const root = createRepository({ 'package.json': failing, 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    const first = loop(root, ['record'], { findings: [] });
    assert.equal(first.fix[0].basis, 'measured');
    assert.match(first.report, /- F-1 \[P1\] npm run test test fails\n(?: {2}.*\n)*? {2}basis: measured\n/);
    writeFiles(root, { 'package.json': passing });
    loop(root, ['next']);
    const second = loop(root, ['record'], { findings: [] });
    assert.match(second.report, /- F-1 \[P1\] test fails \(fixed, measured: npm run test no longer fails\)/);
  });

  test('a failing check whose script was removed is not reported as a measured fix', () => {
    const failing = JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } });
    const root = createRepository({ 'package.json': failing, 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    loop(root, ['record'], { findings: [] });
    writeFiles(root, { 'package.json': JSON.stringify({ scripts: {} }) });
    assert.deepEqual(loop(root, ['next']).checks, []);
    const second = loop(root, ['record'], { findings: [] });
    assert.doesNotMatch(second.report, /fixed, measured/);
    assert.deepEqual([second.ask[0].id, second.ask[0].note], ['F-1', 'its check did not run, so the fix is not verified']);
  });

  test('a finding the re-review resolved is reported as an inferred fix', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    loop(root, ['record'], { findings: [{ ...doubledPrice, basis: 'inferred' }] });
    writeFiles(root, { 'src/cart.js': correctCart });
    loop(root, ['next']);
    const second = loop(root, ['record'], { resolved: ['F-1'], findings: [] });
    assert.match(second.report, /- F-1 \[P2\] Price is doubled \(fixed, inferred: the re-review read the fix\)/);
  });

  test('record rejects an unknown basis and keeps waiting for the review', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    assert.throws(() => loop(root, ['record'], { findings: [{ ...doubledPrice, basis: 'sure' }] }), /finding 1 has basis \\"sure\\"/);
    assert.equal(loop(root, ['record'], { findings: [{ ...doubledPrice, basis: 'inferred' }] }).fix[0].id, 'F-1');
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
    writeFiles(root, { 'package.json': '{"scripts":{}}\n' });
    loop(root, ['next']);
    const fixed = loop(root, ['record'], { findings: [] });
    assert.match(fixed.report, /- F-1 \[P1\] package\.json fails \(fixed, measured: read package\.json no longer fails\)/);
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
    assert.match(result.report, /test \(npm run test\) timed out \(not verified\)/);
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

describe('regression tests', () => {
  const runEveryCheck = 'node -e "for (const file of require(\'fs\').readdirSync(\'checks\')) require(\'./checks/\' + file)"';
  const totalTest = [
    "const source = require('fs').readFileSync('src/cart.js', 'utf8');",
    "if (source.includes('* 2')) { console.error('one item priced 10 should total 10'); process.exit(1); }",
    '',
  ].join('\n');
  const ledger = (root) => readFileSync(path.join(root, '.git/lim/review-loop/ledger.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));

  function fixing({ files = {}, findings = [doubledPrice], startArgs = [] } = {}) {
    const root = createRepository({
      'package.json': JSON.stringify({ scripts: { test: runEveryCheck } }),
      'checks/existing.cjs': '',
      'src/cart.js': correctCart,
      ...files,
    });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start', ...startArgs]);
    const recorded = loop(root, ['record'], { findings });
    writeFiles(root, { 'src/cart.js': correctCart });
    return { root, recorded };
  }

  test('a regression test that fails on the code before the fix is caught', () => {
    const { root } = fixing();
    writeFiles(root, { 'checks/cart.cjs': totalTest });
    const result = loop(root, ['rule', '--id', 'F-1', '--draft', 'checks/cart.cjs']);
    assert.deepEqual([result.kind, result.proof, result.caughtBy], ['regression', 'caught', ['test']]);
    assert.match(result.withDrafts[0].tail, /one item priced 10 should total 10/);
    const entry = ledger(root).find((line) => line.event === 'regression');
    assert.deepEqual([entry.id, entry.drafts, entry.proof], ['F-1', ['checks/cart.cjs'], 'caught']);
    writeFiles(root, { 'checks/cart.cjs': "require('fs').readFileSync('src/cart.js', 'utf8');\n" });
    assert.equal(loop(root, ['rule', '--id', 'F-1', '--draft', 'checks/cart.cjs']).proof, 'missed');
  });

  test('a regression test that fails only lint on the code before the fix is not caught', () => {
    const lintRejectsVar = 'node -e "const fs = require(\'fs\'); process.exit(fs.existsSync(\'checks/cart.cjs\') && fs.readFileSync(\'checks/cart.cjs\', \'utf8\').includes(\'var \') ? 1 : 0)"';
    const { root } = fixing({ files: { 'package.json': JSON.stringify({ scripts: { lint: lintRejectsVar, test: runEveryCheck } }) } });
    writeFiles(root, { 'checks/cart.cjs': 'var price = 10;\n' });
    const result = loop(root, ['rule', '--id', 'F-1', '--draft', 'checks/cart.cjs']);
    assert.deepEqual([result.kind, result.proof, result.caughtBy], ['regression', 'unproven', ['lint']]);
    assert.match(result.reason, /only lint failed .* the test check did not fail/);
  });

  test('the report lists a fixed P1 or P2 with its regression test and proof', () => {
    const { root } = fixing();
    writeFiles(root, { 'checks/cart.cjs': totalTest });
    loop(root, ['rule', '--id', 'F-1', '--draft', 'checks/cart.cjs']);
    loop(root, ['next']);
    const { report } = loop(root, ['record'], { resolved: ['F-1'], findings: [] });
    assert.match(report, /- F-1 \[P2\] Price is doubled \(fixed, inferred: the re-review read the fix\)\n {2}test: checks\/cart\.cjs \(before the fix: caught, after: passed\)/);
  });

  test('the report says why a fixed P1 or P2 has no regression test', () => {
    const { root } = fixing();
    const skipped = loop(root, ['rule', '--id', 'F-1', '--no-test', 'the total is only visible in the browser']);
    assert.equal(skipped.noTest, 'the total is only visible in the browser');
    loop(root, ['next']);
    assert.match(loop(root, ['record'], { resolved: ['F-1'], findings: [] }).report, /- F-1 .*\n {2}no test: the total is only visible in the browser/);

    const plain = createRepository({ 'src/cart.js': correctCart });
    writeFiles(plain, { 'src/cart.js': brokenCart });
    loop(plain, ['start']);
    loop(plain, ['record'], { findings: [doubledPrice] });
    writeFiles(plain, { 'src/cart.js': correctCart });
    loop(plain, ['next']);
    assert.match(loop(plain, ['record'], { resolved: ['F-1'], findings: [] }).report, /- F-1 .*\n {2}no test: the project has no test script/);
  });

  test('a regression test needs a test script', () => {
    const root = createRepository({ 'package.json': JSON.stringify({ scripts: { lint: 'node -e ""' } }), 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    loop(root, ['record'], { findings: [doubledPrice] });
    writeFiles(root, { 'checks/cart.cjs': totalTest });
    assert.throws(() => loop(root, ['rule', '--id', 'F-1', '--draft', 'checks/cart.cjs']), /no test script/);
    assert.throws(() => loop(root, ['rule', '--id', 'F-1', '--no-test']), /give the reason/);
  });

  test('a regression test is only for a P1 or P2 with a scenario while it is being fixed', () => {
    const minor = { ...doubledPrice, severity: 'P3', quote: 'export const total', title: 'Name total as sumPrices' };
    const { root } = fixing({ findings: [doubledPrice, minor] });
    writeFiles(root, { 'checks/cart.cjs': totalTest });
    assert.throws(() => loop(root, ['rule', '--id', 'F-2', '--draft', 'checks/cart.cjs']), /not marked as a rule/);
    loop(root, ['next']);
    assert.throws(() => loop(root, ['rule', '--id', 'F-1', '--draft', 'checks/cart.cjs']), /not a P1 or P2 with a scenario that is being fixed/);

    const failing = fixing({ files: { 'checks/existing.cjs': 'process.exit(1);\n' }, findings: [] });
    assert.equal(failing.recorded.fix[0].category, 'checks');
    writeFiles(failing.root, { 'checks/cart.cjs': totalTest });
    assert.throws(() => loop(failing.root, ['rule', '--id', 'F-1', '--draft', 'checks/cart.cjs']), /not marked as a rule/);
  });

  test('the commit gate asks for a regression test proven after the loop stopped and blocks it once edited', () => {
    const { root, recorded } = fixing({ startArgs: ['--max-rounds', '1'] });
    assert.equal(recorded.reason, 'max-rounds');
    loop(root, ['decide', '--id', 'F-1', '--choice', 'once']);
    const commit = () => gateDecision({ cwd: root, command: 'git commit -m "fix: cart"' });
    loop(root, ['gate', '--on']);
    writeFiles(root, { 'checks/cart.cjs': totalTest });
    assert.match(commit().reason, /checks\/cart\.cjs changed after the last review/);
    assert.equal(loop(root, ['rule', '--id', 'F-1', '--draft', 'checks/cart.cjs']).proof, 'caught');
    assert.equal(commit().decision, 'ask');
    writeFiles(root, { 'checks/cart.cjs': `${totalTest}// edited after the check\n` });
    assert.match(commit().reason, /checks\/cart\.cjs changed after the last review/);
  });
});

describe('subfolder projects', () => {
  const manifest = (test) => JSON.stringify({ scripts: { test } });
  const passing = manifest('node -e "process.exit(0)"');
  const failing = manifest('node -e "process.exit(1)"');
  const labels = (checks) => checks.map((check) => [check.folder ?? '', check.name, check.exitCode]);

  test('a change in a subfolder project runs its checks in that folder and a failure is a P1 named with the folder', () => {
    const failsInWeb = manifest('node -e "process.exit(require(\'path\').basename(process.cwd()) === \'web\' ? 1 : 0)"');
    const root = createRepository({ 'web/package.json': failsInWeb, 'web/src/cart.js': correctCart });
    writeFiles(root, { 'web/src/cart.js': brokenCart });
    assert.deepEqual(labels(loop(root, ['start']).checks), [['web', 'test', 1]]);
    const result = loop(root, ['record'], { findings: [] });
    assert.deepEqual([result.fix[0].severity, result.fix[0].file, result.fix[0].title], ['P1', 'web: npm run test', 'web: test fails']);
    assert.match(result.report, /Checks: web: test \(npm run test\) failed\n/);
    assert.match(result.report, /- F-1 \[P1\] web: npm run test web: test fails/);
  });

  test('a change only at the root runs only the root checks', () => {
    const root = createRepository({ 'package.json': passing, 'web/package.json': failing, 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    assert.deepEqual(labels(loop(root, ['start']).checks), [['', 'test', 0]]);
    assert.match(loop(root, ['record'], { findings: [] }).report, /Checks: test \(npm run test\) passed\n/);
  });

  test('two subfolder projects with the same check name do not collide', () => {
    const root = createRepository({
      'api/package.json': passing, 'api/index.js': '', 'web/package.json': failing, 'web/index.js': '',
    });
    writeFiles(root, { 'api/index.js': 'export {};\n', 'web/index.js': 'export {};\n' });
    assert.deepEqual(labels(loop(root, ['start']).checks), [['api', 'test', 0], ['web', 'test', 1]]);
    const first = loop(root, ['record'], { findings: [] });
    assert.deepEqual(first.fix.map((item) => item.file), ['web: npm run test']);
    writeFiles(root, { 'web/package.json': passing });
    loop(root, ['next']);
    const second = loop(root, ['record'], { findings: [] });
    assert.equal(second.reason, 'clean');
    assert.match(second.report, /- F-1 \[P1\] web: test fails \(fixed, measured: web: npm run test no longer fails\)/);
  });

  test('later rounds run only the subfolder projects the fixes touched', () => {
    const root = createRepository({
      'api/package.json': failing, 'api/index.js': '', 'web/package.json': failing, 'web/index.js': '',
    });
    writeFiles(root, { 'api/index.js': 'export {};\n', 'web/index.js': 'export {};\n' });
    loop(root, ['start']);
    assert.equal(loop(root, ['record'], { findings: [] }).fix.length, 2);
    writeFiles(root, { 'web/package.json': passing });
    assert.deepEqual(labels(loop(root, ['next']).checks), [['web', 'test', 0]]);
    const second = loop(root, ['record'], { findings: [] });
    assert.deepEqual(second.ask.map((item) => [item.file, item.note]), [['api: npm run test', 'its check did not run, so the fix is not verified']]);
  });

  test('at most four subfolder projects run per round and the report names the ones left out', () => {
    const folders = ['a', 'b', 'c', 'd', 'e', 'f'];
    const root = createRepository(Object.fromEntries(folders.flatMap((folder) => [
      [`${folder}/package.json`, passing], [`${folder}/index.js`, ''],
    ])));
    writeFiles(root, Object.fromEntries(folders.map((folder) => [`${folder}/index.js`, 'export {};\n'])));
    const started = loop(root, ['start']);
    assert.deepEqual(started.checks.map((check) => check.folder), ['a', 'b', 'c', 'd']);
    assert.deepEqual(started.checksLeftOut, ['e', 'f']);
    assert.match(loop(root, ['record'], { findings: [] }).report, /d: test \(npm run test\) passed; not run: more than 4 projects changed \(e, f\)\n/);
    assert.deepEqual(loop(root, ['checks']).checksLeftOut, ['e', 'f']);
  });

  test('folders inside node_modules are not subfolder projects', () => {
    const root = createRepository({
      'node_modules/cart/package.json': failing, 'node_modules/cart/index.js': '',
      'web/node_modules/cart/package.json': failing, 'web/node_modules/cart/index.js': '',
    });
    writeFiles(root, { 'node_modules/cart/index.js': 'export {};\n', 'web/node_modules/cart/index.js': 'export {};\n' });
    assert.deepEqual(changedProjects(root, ['node_modules/cart/index.js', 'web/node_modules/cart/index.js']), []);
    assert.deepEqual(loop(root, ['start']).checks, []);
  });

  test('a subfolder project uses the lockfile at the repository root', () => {
    const root = createRepository({ 'pnpm-lock.yaml': '', 'web/package.json': passing });
    assert.deepEqual(detectFolderChecks(root, 'web'), [{ name: 'test', command: ['pnpm', 'run', 'test'], folder: 'web' }]);
    writeFiles(root, { 'web/yarn.lock': '' });
    assert.deepEqual(detectFolderChecks(root, 'web')[0].command, ['yarn', 'run', 'test']);
  });

  test('a regression test in a subfolder project is checked with that project on the code before the fix', () => {
    const runEveryCheck = 'node -e "for (const file of require(\'fs\').readdirSync(\'checks\')) require(\'./checks/\' + file)"';
    const totalTest = [
      "const source = require('fs').readFileSync('src/cart.js', 'utf8');",
      "if (source.includes('* 2')) { console.error('one item priced 10 should total 10'); process.exit(1); }",
      '',
    ].join('\n');
    const root = createRepository({
      'web/package.json': manifest(runEveryCheck), 'web/checks/existing.cjs': '', 'web/src/cart.js': correctCart,
    });
    writeFiles(root, { 'web/src/cart.js': brokenCart });
    loop(root, ['start']);
    loop(root, ['record'], { findings: [{ ...doubledPrice, file: 'web/src/cart.js' }] });
    writeFiles(root, { 'web/src/cart.js': correctCart, 'web/checks/cart.cjs': totalTest });
    const result = loop(root, ['rule', '--id', 'F-1', '--draft', 'web/checks/cart.cjs']);
    assert.deepEqual([result.kind, result.proof, result.caughtBy], ['regression', 'caught', ['web:test']]);
    assert.match(result.withDrafts[0].tail, /one item priced 10 should total 10/);
    loop(root, ['next']);
    const { report } = loop(root, ['record'], { resolved: ['F-1'], findings: [] });
    assert.match(report, /test: web\/checks\/cart\.cjs \(before the fix: caught, after: passed\)/);
  });

  test('a rule in a subfolder project can use the dependencies in that project folder', () => {
    const runner = [
      '#!/usr/bin/env node',
      "for (const file of require('fs').readdirSync('checks')) require(require('path').resolve('checks', file));",
      '',
    ].join('\n');
    const totalTest = "if (require('fs').readFileSync('src/cart.js', 'utf8').includes('* 2')) { console.error('one item priced 10 should total 10'); process.exit(1); }\n";
    const root = createRepository({
      '.gitignore': 'node_modules/\n', 'web/package.json': manifest('runchecks'), 'web/checks/existing.cjs': '', 'web/src/cart.js': correctCart,
    });
    writeFiles(root, { 'web/node_modules/.bin/runchecks': runner });
    chmodSync(path.join(root, 'web/node_modules/.bin/runchecks'), 0o755);
    writeFiles(root, { 'web/src/cart.js': brokenCart });
    loop(root, ['start']);
    loop(root, ['record'], { findings: [{ ...doubledPrice, file: 'web/src/cart.js' }] });
    writeFiles(root, { 'web/src/cart.js': correctCart, 'web/checks/cart.cjs': totalTest });
    const result = loop(root, ['rule', '--id', 'F-1', '--draft', 'web/checks/cart.cjs']);
    assert.deepEqual([result.proof, result.caughtBy], ['caught', ['web:test']]);
  });

  test('a failing check in a subfolder project can be made a rule when only that project has checks', () => {
    const root = createRepository({ 'web/package.json': manifest('node -e "process.exit(1)"'), 'web/src/cart.js': correctCart });
    writeFiles(root, { 'web/src/cart.js': brokenCart });
    loop(root, ['start']);
    loop(root, ['record'], { findings: [] });
    const stateFile = path.join(root, '.git/lim/review-loop/state.json');
    const checkFinding = (state) => [...state.cards, ...state.open].find((item) => item.fromChecks);
    assert.equal(checkFinding(JSON.parse(readFileSync(stateFile, 'utf8'))).folder, 'web');
    const { id } = checkFinding(JSON.parse(readFileSync(stateFile, 'utf8')));
    loop(root, ['decide', '--id', id, '--choice', 'rule']);
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.equal([...state.cards, ...state.open].find((item) => item.id === id).decision, 'rule');
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

  test('gate checks a commit or push made through a git alias like the command it stands for', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    loop(root, ['gate', '--on']);
    execFileSync('git', ['config', 'alias.ci', 'commit'], { cwd: root });
    execFileSync('git', ['config', 'alias.save', 'ci -a'], { cwd: root });
    execFileSync('git', ['config', 'alias.st', 'status'], { cwd: root });
    writeFiles(root, { 'src/cart.js': brokenCart });
    for (const command of ['git ci -m "feat: coupon"', 'git save -m "feat: coupon"']) {
      const result = commit(root, command);
      assert.equal(result?.decision, 'deny', command);
      assert.match(result.reason, /\/review-loop:review-loop/);
    }
    assert.equal(commit(root, 'git st'), null);
    execFileSync('git', ['config', 'alias.as', '-c user.name=someone commit'], { cwd: root });
    assert.equal(commit(root, 'git as -m "feat: coupon"')?.decision, 'deny');
  });

  test('gate asks before a shell alias that runs a commit and ignores aliases when the gate is off', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    execFileSync('git', ['config', 'alias.ship', '!git add -A && git commit -m wip'], { cwd: root });
    writeFiles(root, { 'src/cart.js': brokenCart });
    assert.equal(commit(root, 'git ship'), null);
    loop(root, ['gate', '--on']);
    const result = commit(root, 'git ship');
    assert.equal(result.decision, 'ask');
    assert.match(result.reason, /git ship is a shell alias that runs git commit/);
    execFileSync('git', ['config', 'alias.ci', 'commit'], { cwd: root });
    execFileSync('git', ['config', 'alias.quick', '!git add -A && git ci -m wip'], { cwd: root });
    assert.match(commit(root, 'git quick')?.reason ?? '', /git quick is a shell alias that runs git commit/);
  });

  test('a delegated commit through an alias is allowed like git commit', () => {
    const root = reviewedRepository();
    loop(root, ['delegate', '--scope', 'repo']);
    execFileSync('git', ['config', 'alias.ci', 'commit'], { cwd: root });
    assert.equal(commit(root, 'git ci -m "feat: coupon"').decision, 'allow');
  });

  test('alias expansion follows an alias of an alias and stops at a loop and an alias that moves to another repository is unknown', () => {
    const aliases = { ci: 'commit', save: 'ci -a', loopy: 'loopy2', loopy2: 'loopy' };
    const lookup = (name) => aliases[name] ?? null;
    assert.deepEqual(expandAlias({ subcommand: 'save', args: ['-m', 'x'], directories: ['.'] }, lookup),
      { subcommand: 'commit', args: ['-a', '-m', 'x'], directories: ['.'], alias: 'save' });
    assert.equal(expandAlias({ subcommand: 'loopy', args: [], directories: ['.'] }, lookup).subcommand, 'loopy');
    const elsewhere = expandAlias({ subcommand: 'oc', args: [], directories: ['/repo'] }, (name) => (name === 'oc' ? '-C ../other commit' : null));
    assert.deepEqual([elsewhere.subcommand, elsewhere.directories], ['commit', [null]]);
  });

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
    commitAll(root);
    writeFiles(root, { 'src/cart.js': correctCart });
    assert.equal(commit(root).decision, 'deny');
  });

  test('a one-time skip is used up once a commit lands', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    loop(root, ['gate', '--on']);
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['gate', '--skip-once']);
    assert.equal(commit(root).decision, 'ask');
    assert.equal(commit(root).decision, 'ask');
    commitAll(root);
    execFileSync('git', ['reset', '-q', '--soft', 'HEAD~1'], { cwd: root });
    const afterReset = commit(root);
    assert.equal(afterReset.decision, 'deny');
    assert.doesNotMatch(afterReset.reason, /skipped once/);
    assert.equal(loop(root, ['status']).gate.skipOnce, false);
  });

  test('a checkout to another branch and back keeps the one-time skip', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    const runGit = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    runGit('checkout', '-q', '-b', 'side');
    writeFiles(root, { 'notes.md': 'side\n' });
    commitAll(root);
    runGit('checkout', '-q', '-');
    loop(root, ['gate', '--on']);
    loop(root, ['gate', '--skip-once']);
    runGit('checkout', '-q', 'side');
    assert.equal(loop(root, ['status']).gate.skipOnce, true);
    runGit('checkout', '-q', '-');
    writeFiles(root, { 'src/cart.js': brokenCart });
    const result = commit(root);
    assert.equal(result.decision, 'ask');
    assert.match(result.reason, /skipped once/);
  });

  test('a chained command that fails before the commit keeps the one-time skip', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    loop(root, ['gate', '--on']);
    loop(root, ['delegate', '--scope', 'repo']);
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['gate', '--skip-once']);
    const chained = 'false && git commit -qam x';
    assert.equal(commit(root, chained).decision, 'ask');
    assert.throws(() => execFileSync('sh', ['-c', chained], { cwd: root, stdio: 'ignore' }));
    assert.equal(commit(root).decision, 'allow');
  });

  test('a one-time skip covers only the first of two commits in one command', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    loop(root, ['gate', '--on']);
    loop(root, ['delegate', '--scope', 'repo']);
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['gate', '--skip-once']);
    assert.equal(commit(root, 'git commit -am one && git commit -am two').decision, 'deny');
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
    commitAll(root);
    writeFiles(root, { 'src/cart.js': correctCart });
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

  test('a declined commit prompt keeps the one-time skip', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    loop(root, ['gate', '--on']);
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['gate', '--skip-once']);
    const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit -am x' }, cwd: root });
    for (const attempt of ['declined', 'asked again']) {
      const output = JSON.parse(execFileSync('node', [hook], { input: payload, encoding: 'utf8' })).hookSpecificOutput;
      assert.equal(output.permissionDecision, 'ask', attempt);
      assert.match(output.permissionDecisionReason, /skipped once/, attempt);
    }
    assert.equal(loop(root, ['status']).gate.skipOnce, true);
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

describe('repeated kinds', () => {
  const guard = (name) => ({
    severity: 'P3', file: 'src/cart.js', line: 1, category: 'speculative-guard', title: `Guard ${name}`, quote: `guard ${name}`,
  });
  const historyComment = (name) => ({
    severity: 'P4', file: 'src/cart.js', line: 1, category: 'history-comment', title: `Comment ${name}`, quote: `comment ${name}`,
  });
  const naming = { severity: 'P3', file: 'src/cart.js', line: 1, category: 'naming', title: 'Name total as sumPrices', quote: 'export const total' };

  function review(root, findings) {
    loop(root, ['start', '--fresh']);
    return loop(root, ['record'], { findings });
  }

  function brokenCartRepository(files = {}) {
    const root = createRepository({ ...files, 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    return root;
  }

  test('a finding whose kind earlier reviews raised three times is marked as a repeat with the count', () => {
    const root = brokenCartRepository();
    review(root, [guard('a')]);
    review(root, [guard('b')]);
    const third = review(root, [guard('c')]);
    assert.equal(third.cards[0].repeat, undefined);
    assert.doesNotMatch(third.report, /repeats/);
    const fourth = review(root, [guard('d'), naming]);
    const byTitle = Object.fromEntries(fourth.cards.map((card) => [card.title, card.repeat]));
    assert.deepEqual(byTitle, { 'Guard d': { category: 'speculative-guard', seenBefore: 3 }, 'Name total as sumPrices': undefined });
    assert.match(fourth.report, /Left for you: .*, repeats 1/);
  });

  test('repeats count different findings from earlier reviews and not the current one', () => {
    const root = brokenCartRepository();
    for (let count = 0; count < 3; count += 1) review(root, [guard('a')]);
    const current = review(root, [guard('b'), guard('c'), guard('d'), guard('e')]);
    assert.deepEqual(current.cards.map((card) => card.repeat), [undefined, undefined, undefined, undefined]);
  });

  test('a review counts kinds recorded in another worktree and keeps them after that worktree is removed', () => {
    const root = brokenCartRepository();
    const worktree = path.join(mkdtempSync(path.join(tmpdir(), 'review-loop-worktree-')), 'other');
    execFileSync('git', ['worktree', 'add', '-q', '--detach', worktree], { cwd: root, stdio: 'ignore' });
    writeFiles(worktree, { 'src/cart.js': brokenCart });
    loop(root, ['start', '--fresh']);
    review(worktree, [guard('a'), guard('b'), guard('c')]);
    const current = loop(root, ['record'], { findings: [guard('d')] });
    assert.deepEqual(current.cards[0].repeat, { category: 'speculative-guard', seenBefore: 3 });

    execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: root, stdio: 'ignore' });
    const later = review(root, [guard('e')]);
    assert.deepEqual(later.cards[0].repeat, { category: 'speculative-guard', seenBefore: 4 });
    assert.deepEqual(loop(root, ['status']).repeatedKinds, [{ category: 'speculative-guard', count: 5 }]);
  });

  test('a repeated P2 fixed in the loop shows its repeat in the stop report and in status', () => {
    const root = brokenCartRepository();
    const doubledGuard = { ...doubledPrice, category: 'speculative-guard' };
    for (const name of ['a', 'b', 'c']) review(root, [{ ...doubledGuard, severity: 'P3', title: `Earlier ${name}`, quote: `earlier ${name}` }]);
    const first = review(root, [doubledGuard]);
    const { id } = first.fix[0];
    assert.deepEqual(first.fix[0].repeat, { category: 'speculative-guard', seenBefore: 3 });
    writeFiles(root, { 'src/cart.js': correctCart });
    loop(root, ['next']);
    const second = loop(root, ['record'], { resolved: [id], findings: [] });
    assert.equal(second.decision, 'stop');
    assert.match(second.report, new RegExp(
      `Resolved since last round:\\n- ${id} \\[P2\\] .* \\(fixed, inferred: the re-review read the fix\\)\\n {2}repeat: speculative-guard, seen 3 times before\\n {2}(no )?test: `,
    ));
    assert.match(second.report, /Left for you: .*, repeats 1/);
    assert.deepEqual(loop(root, ['status']).review.resolvedRepeats, [{ id, severity: 'P2', category: 'speculative-guard', seenBefore: 3 }]);
  });

  test('a broad category such as correctness is never marked as a repeat', () => {
    const root = brokenCartRepository();
    const broad = (name) => ({ ...doubledPrice, severity: 'P3', title: `Broad ${name}`, quote: `broad ${name}` });
    for (const name of ['a', 'b', 'c', 'd']) review(root, [broad(name)]);
    const latest = review(root, [broad('e')]);
    assert.equal(latest.cards[0].repeat, undefined);
    assert.doesNotMatch(latest.report, /repeat/);
    assert.deepEqual(loop(root, ['status']).repeatedKinds, []);
  });

  test('the kinds that can repeat are the categories in the reviewer table', () => {
    const reviewer = readFileSync(fileURLToPath(new URL('../../plugins/review-loop/agents/reviewer.md', import.meta.url)), 'utf8');
    const tableKinds = [...reviewer.matchAll(/^\| `([a-z-]+)` \|/gm)].map((match) => match[1]).filter((kind) => kind !== 'category');
    assert.deepEqual(new Set(tableKinds), NAMED_KINDS);
  });

  test('status lists the most repeated kinds and leaves out failing checks', () => {
    const failing = 'node -e "process.exit(1)"';
    const root = brokenCartRepository({ 'package.json': JSON.stringify({ scripts: { lint: failing, test: failing } }) });
    assert.deepEqual(loop(root, ['status']).repeatedKinds, []);
    review(root, [guard('a'), historyComment('a'), naming]);
    review(root, [guard('b'), historyComment('b')]);
    review(root, [guard('c')]);
    assert.deepEqual(loop(root, ['status']).repeatedKinds, [
      { category: 'speculative-guard', count: 3 },
      { category: 'history-comment', count: 2 },
    ]);
  });
});

describe('unattended runs', () => {
  const namingCard = { severity: 'P3', file: 'src/cart.js', title: 'Name total as sumPrices' };
  const designChoice = { ...doubledPrice, title: 'Pick a rounding rule', quote: 'items.reduce', multipleFixes: true };
  const savedState = (root) => JSON.parse(readFileSync(path.join(root, '.git', 'lim', 'review-loop', 'state.json'), 'utf8'));
  const commit = (root) => gateDecision({ cwd: root, command: 'git commit -m "feat: cart"' });

  function brokenRepository() {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    return root;
  }

  test('the unattended setting makes every run in the repository unattended until it is turned off', () => {
    const root = brokenRepository();
    assert.equal(loop(root, ['unattended']).enabled, false);
    assert.equal(loop(root, ['unattended', '--on']).enabled, true);
    assert.equal(loop(root, ['start']).unattended, true);
    assert.equal(loop(root, ['status']).unattended, true);
    assert.equal(loop(root, ['start', '--fresh']).unattended, true);
    assert.equal(loop(root, ['unattended', '--off']).enabled, false);
    assert.equal(loop(root, ['status']).unattended, false);
    assert.equal(loop(root, ['start', '--fresh']).unattended, false);
  });

  test('start --unattended makes only that run unattended', () => {
    const root = brokenRepository();
    assert.equal(loop(root, ['start', '--unattended']).unattended, true);
    assert.equal(loop(root, ['status']).unattended, true);
    assert.equal(loop(root, ['start', '--unattended']).unattended, true);
    assert.equal(loop(root, ['start']).unattended, false);
    assert.equal(loop(root, ['status']).unattended, false);
    assert.equal(loop(root, ['unattended']).enabled, false);
    assert.equal(loop(root, ['start', '--fresh']).unattended, false);
  });

  test("an attended start resumes an unattended run's pending decisions and asks about the deferred findings", () => {
    const root = brokenRepository();
    loop(root, ['start', '--unattended']);
    const stopped = loop(root, ['record'], { findings: [designChoice, namingCard] });
    assert.deepEqual([stopped.decision, stopped.reason], ['stop', 'waiting']);
    const resumed = loop(root, ['start']);
    assert.deepEqual([resumed.status, resumed.awaiting, resumed.unattended], ['in-progress', 'decisions', false]);
    assert.deepEqual(resumed.stillOpen.map((item) => [item.id, item.deferredReason]), [['F-1', 'multipleFixes']]);
    assert.deepEqual(resumed.cards.map((item) => item.id), ['F-2']);
    assert.equal(savedState(root).unattended, false);
    assert.equal(loop(root, ['decide', '--id', 'F-1', '--choice', 'once']).choice, 'once');
  });

  test('an unattended run defers findings that need your call with the flag or rule that sent them', () => {
    const flagged = brokenRepository();
    loop(flagged, ['start', '--unattended']);
    const first = loop(flagged, ['record'], { findings: [designChoice, doubledPrice] });
    assert.deepEqual([first.decision, first.ask], ['continue', []]);
    assert.deepEqual(first.fix.map((item) => item.title), ['Price is doubled']);
    assert.deepEqual(first.deferred.map((item) => [item.id, item.deferredReason]), [['F-2', 'multipleFixes']]);
    assert.match(first.report, /Waiting for you \(not fixed in an unattended run\):\n- F-2 \[P2\] src\/cart\.js:1 Pick a rounding rule/);
    assert.match(first.report, /waiting because: multipleFixes/);

    const confirming = brokenRepository();
    loop(confirming, ['confirm', '--severity', 'P2']);
    loop(confirming, ['start', '--unattended']);
    const confirmed = loop(confirming, ['record'], { findings: [doubledPrice] });
    assert.deepEqual([confirmed.fix, confirmed.ask], [[], []]);
    assert.equal(confirmed.deferred[0].deferredReason, 'confirm --severity P2');

    const retried = brokenRepository();
    loop(retried, ['start', '--unattended']);
    loop(retried, ['record'], { findings: [doubledPrice] });
    loop(retried, ['next']);
    const second = loop(retried, ['record'], { stillOpen: ['F-1'], findings: [] });
    assert.deepEqual([second.reason, second.ask], ['waiting', []]);
    assert.equal(second.deferred[0].id, 'F-1');
    assert.match(second.deferred[0].deferredReason, /first fix did not resolve it/);
  });

  test('an unattended stop report says how many P1 or P2 wait for you instead of none left', () => {
    const root = brokenRepository();
    loop(root, ['start', '--unattended']);
    const currency = { ...designChoice, severity: 'P1', title: 'Pick a currency', quote: 'item.price' };
    const stopped = loop(root, ['record'], { findings: [designChoice, currency] });
    assert.deepEqual([stopped.decision, stopped.reason], ['stop', 'waiting']);
    assert.match(stopped.report, /Stopped: nothing left to fix without you; 2 P1 or P2 waiting for you/);
    assert.doesNotMatch(stopped.report, /no P1 or P2 left/);
    assert.deepEqual(stopped.deferred.map((item) => item.title).sort(), ['Pick a currency', 'Pick a rounding rule']);
  });

  test('deferred findings and cards stay pending after an unattended run so the commit gate blocks', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    loop(root, ['gate', '--on']);
    loop(root, ['delegate', '--scope', 'repo']);
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start', '--unattended']);
    loop(root, ['record'], { findings: [designChoice, namingCard] });
    assert.deepEqual(loop(root, ['status']).review.pendingDecisions.sort(), ['F-1', 'F-2']);
    assert.equal(commit(root).decision, 'deny');
    assert.match(commit(root).reason, /decide F-2, F-1/);
    loop(root, ['decide', '--id', 'F-1', '--choice', 'keep']);
    loop(root, ['decide', '--id', 'F-2', '--choice', 'keep']);
    assert.equal(commit(root).decision, 'allow');
  });

  test('turning unattended on while a round waits for fixes defers its ask findings', () => {
    const root = brokenRepository();
    loop(root, ['start']);
    assert.deepEqual(loop(root, ['record'], { findings: [designChoice, doubledPrice] }).ask.map((item) => item.id), ['F-2']);
    assert.deepEqual(loop(root, ['unattended', '--on']).deferred, ['F-2']);
    const resumed = loop(root, ['start']);
    assert.deepEqual([resumed.unattended, resumed.ask, resumed.fix.map((item) => item.id)], [true, [], ['F-1']]);
    assert.equal(resumed.deferred[0].deferredReason, 'multipleFixes');

    const switched = brokenRepository();
    loop(switched, ['start']);
    loop(switched, ['record'], { findings: [designChoice, doubledPrice] });
    const continued = loop(switched, ['start', '--unattended']);
    assert.deepEqual([continued.status, continued.unattended, continued.ask], ['in-progress', true, []]);
    assert.deepEqual(continued.deferred.map((item) => item.id), ['F-2']);
  });

  test('note records the phase and decision and why and evidence in the ledger', () => {
    const root = brokenRepository();
    loop(root, ['start', '--unattended']);
    const noted = loop(root, [
      'note', '--phase', 'commit', '--decision', 'left the change uncommitted', '--why', 'F-1 waits for you', '--evidence', 'pendingDecisions: F-1',
    ]);
    assert.equal(noted.recorded, true);
    const ledger = readFileSync(path.join(root, '.git', 'lim', 'review-loop', 'ledger.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const { at, ...note } = ledger.at(-1);
    assert.ok(!Number.isNaN(Date.parse(at)));
    assert.deepEqual(note, {
      event: 'note', phase: 'commit', decision: 'left the change uncommitted', why: 'F-1 waits for you', evidence: 'pendingDecisions: F-1',
    });
    assert.throws(() => loop(root, ['note', '--phase', 'commit', '--decision', 'left the change uncommitted']));
  });

  test('summary lists what happened since the run started and everything waiting for you', () => {
    const root = brokenRepository();
    loop(root, ['start']);
    loop(root, ['record'], { findings: [] });
    loop(root, ['start', '--fresh', '--unattended']);
    loop(root, ['record'], { findings: [doubledPrice, designChoice, namingCard] });
    writeFiles(root, { 'src/cart.js': correctCart });
    loop(root, ['next']);
    loop(root, ['record'], { resolved: ['F-1'], findings: [] });
    loop(root, ['note', '--phase', 'decide', '--decision', 'left F-3 pending', '--why', 'nobody to ask']);

    const summary = loop(root, ['summary']);
    assert.equal(summary.since, savedState(root).startedAt);
    assert.deepEqual(summary.events.map((entry) => entry.event), ['record', 'record', 'note']);
    assert.deepEqual(summary.events[1].resolved.map((item) => item.id), ['F-1']);
    assert.deepEqual(summary.waiting.deferred.map((item) => [item.id, item.reason]), [['F-2', 'multipleFixes']]);
    assert.deepEqual(summary.waiting.pendingDecisions.map((item) => item.id), ['F-3']);
    assert.equal(summary.waiting.gateNotConfigured, true);
    assert.match(summary.report, /Resolved F-1 \[P2\] Price is doubled/);
    assert.match(summary.report, /Note \(decide\): left F-3 pending\. Why: nobody to ask/);
    assert.match(summary.report, /Waiting for you:\n- F-2 \[P2\] src\/cart\.js:1 Pick a rounding rule \(not fixed: multipleFixes\)/);
    assert.match(summary.report, /- Decide F-3 \[P3\]/);

    assert.deepEqual(loop(root, ['summary', '--since', '2999-01-01T00:00:00Z']).events, []);
    assert.throws(() => loop(root, ['summary', '--since', 'yesterday']));
  });

  test('summary includes a next that stopped the loop with its reason and integrity issues', () => {
    const root = createRepository({ 'src/cart.js': correctCart, 'src/cart.test.js': "it('totals', () => {});\n" });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start', '--unattended']);
    loop(root, ['record'], { findings: [doubledPrice] });
    writeFiles(root, { 'src/cart.test.js': "it.skip('totals', () => {});\n" });
    loop(root, ['next']);

    const summary = loop(root, ['summary']);
    const { at, ...stop } = summary.events.at(-1);
    assert.deepEqual(stop, {
      event: 'next', round: 2, reason: 'integrity',
      integrity: [{ file: 'src/cart.test.js', reason: 'test skipped or focused', line: "it.skip('totals', () => {});" }],
    });
    assert.match(summary.report, /- Round 2: stopped: a fix weakened tests or checks\n {2}- src\/cart\.test\.js: test skipped or focused/);
  });

  test('summary leaves out a next that started another round', () => {
    const root = brokenRepository();
    loop(root, ['start', '--unattended']);
    loop(root, ['record'], { findings: [doubledPrice] });
    writeFiles(root, { 'src/cart.js': correctCart });
    loop(root, ['next']);
    assert.deepEqual(loop(root, ['summary']).events.map((entry) => entry.event), ['record']);
  });

  test('an unattended run reaches a stop without ask items and leaves the deferred P2 and the P3 waiting', () => {
    const root = brokenRepository();
    const asked = [];
    const step = (args, review) => {
      const result = loop(root, args, review);
      asked.push(...(result.ask ?? []), ...savedState(root).open.filter((item) => item.route === 'ask'));
      return result;
    };
    step(['start', '--unattended']);
    assert.equal(step(['record'], { findings: [doubledPrice, designChoice, namingCard] }).decision, 'continue');
    writeFiles(root, { 'src/cart.js': correctCart });
    step(['next']);
    const last = step(['record'], { resolved: ['F-1'], findings: [designChoice] });
    assert.deepEqual([last.decision, last.reason], ['stop', 'waiting']);
    assert.deepEqual(asked, []);
    const { waiting } = loop(root, ['summary']);
    assert.deepEqual(waiting.deferred.map((item) => [item.id, item.severity]), [['F-2', 'P2']]);
    assert.deepEqual(waiting.pendingDecisions.map((item) => [item.id, item.severity]), [['F-3', 'P3']]);
  });
});

describe('review file', () => {
  const excludeLines = (root) => readFileSync(path.join(root, '.git', 'info', 'exclude'), 'utf8').split('\n');
  const gitOutput = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const writeReview = (reviewPath, text) => {
    mkdirSync(path.dirname(reviewPath), { recursive: true });
    writeFileSync(reviewPath, text);
  };

  function startedRepository() {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    return { root, reviewPath: loop(root, ['start']).reviewPath };
  }

  test('start and next return a reviewPath in the worktree and list .lim-review/ in info/exclude once', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFileSync(path.join(root, '.git', 'info', 'exclude'), '# local\n*.log');
    writeFiles(root, { 'src/cart.js': brokenCart });
    const reviewFolder = path.join(realpathSync(root), '.lim-review');
    assert.equal(loop(root, ['start']).reviewPath, path.join(reviewFolder, 'round-1.json'));
    assert.equal(loop(root, ['start']).reviewPath, path.join(reviewFolder, 'round-1.json'));
    loop(root, ['record'], { findings: [doubledPrice] });
    writeFiles(root, { 'src/cart.js': correctCart });
    assert.equal(loop(root, ['next']).reviewPath, path.join(reviewFolder, 'round-2.json'));

    const worktree = `${root}-worktree`;
    execFileSync('git', ['worktree', 'add', '-q', worktree, '-b', 'side'], { cwd: root, stdio: 'ignore' });
    writeFiles(worktree, { 'src/cart.js': brokenCart });
    const worktreeReview = loop(worktree, ['start']).reviewPath;
    assert.equal(worktreeReview, path.join(realpathSync(worktree), '.lim-review', 'round-1.json'));
    writeReview(worktreeReview, '{"findings": []}');
    assert.equal(gitOutput(worktree, 'check-ignore', '.lim-review/round-1.json'), '.lim-review/round-1.json');
    assert.deepEqual(excludeLines(root), ['# local', '*.log', '.lim-review/', '']);
  });

  test('start creates info/exclude with .lim-review/ when the file is missing', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    rmSync(path.join(root, '.git', 'info'), { recursive: true, force: true });
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    assert.deepEqual(excludeLines(root), ['.lim-review/', '']);
  });

  test('record --file records the review and deletes the file and its empty folder', () => {
    const { root, reviewPath } = startedRepository();
    writeReview(reviewPath, JSON.stringify({ findings: [doubledPrice] }));
    const result = loop(root, ['record', '--file', reviewPath]);
    assert.deepEqual([result.decision, result.fix[0].id], ['continue', 'F-1']);
    assert.equal(existsSync(path.dirname(reviewPath)), false);
  });

  test('record --file keeps the file when the JSON is invalid', () => {
    const { root, reviewPath } = startedRepository();
    writeReview(reviewPath, '{"findings": [');
    assert.throws(() => loop(root, ['record', '--file', reviewPath]), /reviewer output is not JSON/);
    assert.equal(readFileSync(reviewPath, 'utf8'), '{"findings": [');
    assert.equal(loop(root, ['status']).review.awaiting, 'review');
  });

  test('a review file left from an earlier session is cleared when a review starts', () => {
    const { root, reviewPath } = startedRepository();
    writeReview(reviewPath, '{"findings": [');
    assert.equal(loop(root, ['start']).reviewPath, reviewPath);
    assert.equal(existsSync(reviewPath), false);
  });

  test('a review file is left out of the review diff even before .lim-review/ is excluded', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart, '.lim-review/round-1.json': '{"findings": []}' });
    const { diffPath } = loop(root, ['start']);
    assert.doesNotMatch(readFileSync(diffPath, 'utf8'), /lim-review/);
    assert.deepEqual(JSON.parse(readFileSync(path.join(root, '.git/lim/review-loop/state.json'), 'utf8')).files, ['src/cart.js']);
  });

  test('a review file is not staged by git add -A and does not make the commit gate block', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    loop(root, ['gate', '--on']);
    writeFiles(root, { 'src/cart.js': brokenCart });
    const { reviewPath } = loop(root, ['start']);
    loop(root, ['record'], { findings: [] });
    writeReview(reviewPath, '{"findings": []}');
    const result = gateDecision({ cwd: root, command: 'git commit -m "feat: coupon"' });
    assert.equal(result.decision, 'ask');
    assert.match(result.reason, /review passed/);
    execFileSync('git', ['add', '-A'], { cwd: root });
    assert.equal(gitOutput(root, 'diff', '--cached', '--name-only'), 'src/cart.js');
  });
});

describe('reviewer model', () => {
  const ledger = (root) => readFileSync(path.join(root, '.git', 'lim', 'review-loop', 'ledger.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));

  test('the reviewer model setting is saved for the repository and rejects other values', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    assert.equal(loop(root, ['reviewer']).model, 'inherit');
    assert.equal(loop(root, ['reviewer', '--model', 'sonnet']).model, 'sonnet');
    assert.equal(loop(root, ['reviewer']).model, 'sonnet');
    assert.throws(() => loop(root, ['reviewer', '--model', 'gpt-5']), /model must be inherit, opus, sonnet, haiku, or fable/);
    assert.throws(() => loop(root, ['reviewer', '--model']), /model must be inherit, opus, sonnet, haiku, or fable/);
    assert.equal(loop(root, ['reviewer']).model, 'sonnet');
    assert.equal(loop(root, ['reviewer', '--model', 'inherit']).model, 'inherit');
  });

  test('start and next and status return the reviewer model', () => {
    const fresh = createRepository({ 'src/cart.js': correctCart });
    writeFiles(fresh, { 'src/cart.js': brokenCart });
    assert.equal(loop(fresh, ['start']).reviewerModel, 'inherit');
    assert.equal(loop(fresh, ['status']).reviewerModel, 'inherit');

    const root = createRepository({ 'src/cart.js': correctCart });
    loop(root, ['reviewer', '--model', 'haiku']);
    writeFiles(root, { 'src/cart.js': brokenCart });
    assert.equal(loop(root, ['start']).reviewerModel, 'haiku');
    assert.equal(loop(root, ['status']).reviewerModel, 'haiku');
    loop(root, ['reviewer', '--model', 'opus']);
    assert.equal(loop(root, ['start']).reviewerModel, 'haiku');
    loop(root, ['record'], { findings: [doubledPrice] });
    writeFiles(root, { 'src/cart.js': correctCart });
    assert.equal(loop(root, ['next']).reviewerModel, 'opus');
    assert.equal(loop(root, ['status']).reviewerModel, 'opus');
  });

  test('the record event stores the reviewer model the round started with', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    loop(root, ['reviewer', '--model', 'sonnet']);
    writeFiles(root, { 'src/cart.js': brokenCart });
    loop(root, ['start']);
    loop(root, ['reviewer', '--model', 'haiku']);
    const first = loop(root, ['record'], { findings: [doubledPrice] });
    assert.equal(first.report.split('\n')[0], 'Review round 1 of 3 (reviewer: sonnet)');
    writeFiles(root, { 'src/cart.js': correctCart });
    loop(root, ['next']);
    const second = loop(root, ['record'], { findings: [], resolved: ['F-1'] });
    assert.equal(second.report.split('\n')[0], 'Review round 2 of 3 (reviewer: haiku)');
    const records = ledger(root).filter((entry) => entry.event === 'record');
    assert.deepEqual(records.map((entry) => entry.reviewerModel), ['sonnet', 'haiku']);
  });
});

describe('verify evidence', () => {
  const verifyScript = fileURLToPath(new URL('../../plugins/verify/skills/verify/scripts/verify.mjs', import.meta.url));
  const loadCart = [
    "import { readFileSync, writeFileSync } from 'node:fs';",
    "const { total } = await import('data:text/javascript,' + encodeURIComponent(readFileSync('src/cart.js', 'utf8')));",
  ];
  const checkFiles = {
    'verify-checks/total.mjs': [...loadCart, 'console.log(total([{ price: 10 }]));', ''].join('\n'),
    'verify-checks/empty.mjs': [...loadCart, 'console.log(total([]));', ''].join('\n'),
    'verify-checks/save-total.mjs': [...loadCart, "writeFileSync('verify-checks/total.txt', String(total([{ price: 10 }])));", ''].join('\n'),
  };
  const totalCheck = {
    id: 'cart-total', feature: 'Totals the prices of the items', run: ['node', 'verify-checks/total.mjs'], expect: { exitCode: 0, stdout: { equals: '10' } },
  };
  const emptyCheck = {
    id: 'cart-empty', feature: 'An empty cart totals 0', run: ['node', 'verify-checks/empty.mjs'], expect: { exitCode: 0, stdout: { equals: '0' } },
  };
  const savedTotalCheck = {
    id: 'saved-total',
    feature: 'Saves the total of the items',
    run: ['node', 'verify-checks/save-total.mjs'],
    expect: { exitCode: 0, files: [{ path: 'verify-checks/total.txt', equals: '10' }] },
  };
  const withCheck = { ...doubledPrice, check: 'cart-total' };
  const ledger = (root) => readFileSync(path.join(root, '.git/lim/review-loop/ledger.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));

  function reviewing(features = [totalCheck, emptyCheck, savedTotalCheck]) {
    const root = createRepository({ 'src/cart.js': correctCart, ...checkFiles, 'verify.features.json': JSON.stringify({ features }) });
    writeFiles(root, { 'src/cart.js': brokenCart });
    return root;
  }

  function verify(root, ...args) {
    return JSON.parse(spawnSync('node', [verifyScript, ...args], { cwd: root, encoding: 'utf8' }).stdout);
  }

  function reproduced(findings = [withCheck]) {
    const root = reviewing();
    loop(root, ['start']);
    loop(root, ['record'], { findings });
    assert.equal(verify(root, 'run', '--id', 'cart-total').status, 'failed');
    assert.equal(loop(root, ['reproduce', '--id', 'F-1']).status, 'fail');
    return root;
  }

  test('start and next return the feature map path and the report counts its entries', () => {
    const root = reviewing();
    const mapPath = path.join(realpathSync(root), 'verify.features.json');
    assert.equal(loop(root, ['start']).featureMapPath, mapPath);
    const first = loop(root, ['record'], { findings: [doubledPrice] });
    assert.match(first.report, /^Review round 1 of 3.*\nChecks: .*\nFeature map: verify\.features\.json \(3 entries\)\n/);
    writeFiles(root, { 'src/cart.js': correctCart });
    assert.equal(loop(root, ['next']).featureMapPath, mapPath);
    assert.equal(loop(root, ['start']).featureMapPath, mapPath);
  });

  test('a missing or invalid feature map adds nothing to start or the report', () => {
    const root = createRepository({ 'src/cart.js': correctCart });
    writeFiles(root, { 'src/cart.js': brokenCart });
    assert.equal(Object.hasOwn(loop(root, ['start']), 'featureMapPath'), false);
    writeFiles(root, { 'verify.features.json': '{ "features": [' });
    assert.equal(Object.hasOwn(loop(root, ['start', '--fresh']), 'featureMapPath'), false);
    assert.doesNotMatch(loop(root, ['record'], { findings: [] }).report, /Feature map/);
  });

  test('parseReview accepts a check id and rejects a check that is not a non-empty string', () => {
    assert.equal(parseReview(JSON.stringify({ findings: [withCheck] })).findings[0].check, 'cart-total');
    assert.throws(() => parseReview(JSON.stringify({ findings: [{ ...doubledPrice, check: 3 }] })), /finding 1 has check 3, use the id of a verify\.features\.json entry/);
    assert.throws(() => parseReview(JSON.stringify({ findings: [{ ...doubledPrice, check: ' ' }] })), /finding 1 has check " "/);
  });

  test('reproduce records a verify check that failed on the reviewed code as reproduced', () => {
    const root = reviewing();
    loop(root, ['start']);
    assert.equal(loop(root, ['record'], { findings: [withCheck] }).fix[0].check, 'cart-total');
    verify(root, 'run', '--id', 'cart-total');
    const result = loop(root, ['reproduce', '--id', 'F-1']);
    assert.equal(result.status, 'fail');
    assert.match(result.report, /^F-1 \[P2\] src\/cart\.js:1 Price is doubled\n {2}reproduced: verify check cart-total failed \(\.git\/lim\/verify\/runs\/[^)]+\.json\)\n {2}- stdout does not equal "10"/);
    const event = ledger(root).find((entry) => entry.event === 'reproduce');
    assert.deepEqual([event.id, event.check, event.status], ['F-1', 'cart-total', 'fail']);
    assert.ok(loop(root, ['status']).review.doneSteps.includes('reproduce'));
    loop(root, ['next']);
    const second = loop(root, ['record'], { stillOpen: ['F-1'], findings: [] });
    assert.match(second.report, /- F-1 .*\n(?: {2}.*\n)*? {2}reproduced: verify check cart-total failed \(\.git\/lim\/verify\/runs\//);
  });

  test('reproduce records a verify check that passed as not reproduced and leaves the finding open', () => {
    const root = reviewing();
    loop(root, ['start']);
    loop(root, ['record'], { findings: [{ ...doubledPrice, check: 'cart-empty' }] });
    verify(root, 'run', '--id', 'cart-empty');
    const result = loop(root, ['reproduce', '--id', 'F-1']);
    assert.equal(result.status, 'pass');
    assert.match(result.report, /not reproduced: verify check cart-empty passed/);
    assert.deepEqual(loop(root, ['status']).review.open.map((item) => item.id), ['F-1']);
    loop(root, ['next']);
    const second = loop(root, ['record'], { stillOpen: ['F-1'], findings: [] });
    assert.match(second.report, /- F-1 .*\n(?: {2}.*\n)*? {2}not reproduced: verify check cart-empty passed\n/);
  });

  test('reproduce needs a verify run of the check on the reviewed code', () => {
    const root = reviewing();
    loop(root, ['start']);
    loop(root, ['record'], { findings: [withCheck] });
    const noRun = /no verify run of cart-total on the reviewed code: run the verify skill's `run --id cart-total`/;
    assert.throws(() => loop(root, ['reproduce', '--id', 'F-1']), noRun);
    writeFiles(root, { 'src/notes.js': 'export const note = 1;\n' });
    verify(root, 'run', '--id', 'cart-total');
    assert.throws(() => loop(root, ['reproduce', '--id', 'F-1']), noRun);
    assert.equal(ledger(root).some((entry) => entry.event === 'reproduce'), false);
  });

  test('reproduce refuses a finding without a check or with a check the feature map does not have', () => {
    const root = reviewing();
    loop(root, ['start']);
    loop(root, ['record'], { findings: [doubledPrice, { ...doubledPrice, quote: 'items.reduce', check: 'cart-missing' }] });
    assert.throws(() => loop(root, ['reproduce', '--id', 'F-1']), /F-1 has no check/);
    assert.throws(() => loop(root, ['reproduce', '--id', 'F-2']), /F-2 names check cart-missing, which is not an id in verify\.features\.json/);
    assert.throws(() => loop(root, ['reproduce', '--id', 'F-9']), /no finding with id F-9/);
  });

  test('a guessed P1 or P2 reproduced by a failing check has evidence and stays a card', () => {
    const root = reproduced([{ ...withCheck, basis: 'guessed' }]);
    const resumed = loop(root, ['start']);
    assert.equal(resumed.awaiting, 'decisions');
    assert.deepEqual(resumed.cards.map((card) => [card.id, card.unproven, card.reproduced.check]), [['F-1', undefined, 'cart-total']]);
    assert.deepEqual(loop(root, ['status']).review.pendingDecisions, ['F-1']);
  });

  test('record lists a guessed P1 or P2 card with a check as reproducible while the round continues', () => {
    const root = reviewing();
    loop(root, ['start']);
    const guessedCard = { ...withCheck, line: 2, title: 'Empty cart total is wrong', quote: 'module.exports', basis: 'guessed' };
    const first = loop(root, ['record'], { findings: [doubledPrice, guessedCard] });
    assert.equal(first.decision, 'continue');
    assert.deepEqual(first.reproducible, ['F-2']);
    assert.equal(verify(root, 'run', '--id', 'cart-total').status, 'failed');
    assert.equal(loop(root, ['reproduce', '--id', 'F-2']).status, 'fail');
  });

  test('a reproduced finding whose check passes on the fixed code resolves', () => {
    const root = reproduced();
    writeFiles(root, { 'src/cart.js': correctCart });
    assert.equal(verify(root, 'run', '--id', 'cart-total').status, 'passed');
    loop(root, ['next']);
    const second = loop(root, ['record'], { resolved: ['F-1'], findings: [] });
    assert.equal(second.reason, 'clean');
    assert.match(second.report, /- F-1 \[P2\] Price is doubled \(fixed, measured: verify check cart-total passed on the fixed code, \.git\/lim\/verify\/runs\//);
  });

  test('a reproduced finding stays open when its check was not run or failed on the fixed code even if the re-review resolved it', () => {
    const root = reproduced();
    writeFiles(root, { 'src/cart.js': correctCart });
    loop(root, ['next']);
    const second = loop(root, ['record'], { resolved: ['F-1'], findings: [] });
    assert.deepEqual([second.decision, second.ask[0].id], ['continue', 'F-1']);
    assert.equal(second.ask[0].note, 'the re-review marked it resolved, but verify check cart-total was not run on the fixed code');
    assert.match(second.report, /rerun on the fix: verify check cart-total was not run on the fixed code/);
    writeFiles(root, { 'src/cart.js': brokenCart.replace('* 2', '* 3') });
    verify(root, 'run', '--id', 'cart-total');
    loop(root, ['next']);
    const third = loop(root, ['record'], { resolved: ['F-1'], findings: [] });
    assert.deepEqual([third.decision, third.reason, third.stillOpen[0].id], ['stop', 'stuck', 'F-1']);
    assert.match(third.report, /rerun on the fix: verify check cart-total failed \(\.git\/lim\/verify\/runs\/[^)]+\)\n {2}note: the re-review marked it resolved, but verify check cart-total failed on the fixed code/);
  });

  test('a check that writes a file is matched to the fixed code by the tree after its run', () => {
    const root = reviewing();
    loop(root, ['start']);
    loop(root, ['record'], { findings: [{ ...doubledPrice, check: 'saved-total' }] });
    assert.equal(verify(root, 'run', '--id', 'saved-total').status, 'failed');
    assert.equal(loop(root, ['reproduce', '--id', 'F-1']).status, 'fail');
    writeFiles(root, { 'src/cart.js': correctCart });
    assert.equal(verify(root, 'run', '--id', 'saved-total').status, 'passed');
    loop(root, ['next']);
    const second = loop(root, ['record'], { resolved: ['F-1'], findings: [] });
    assert.equal(second.reason, 'clean');
    assert.match(second.report, /fixed, measured: verify check saved-total passed on the fixed code/);
  });

  test('the report lists reproduced findings first within a severity', () => {
    const plain = { ...doubledPrice, id: 'F-1' };
    const failing = { ...doubledPrice, id: 'F-2', reproduced: { check: 'cart-total', evidencePath: 'runs/one.json', reasons: [] } };
    const blocker = { ...doubledPrice, id: 'F-3', severity: 'P1' };
    const report = renderReport({ round: 1, maxRounds: 3, fix: [plain, failing, blocker], decision: 'continue' });
    const order = report.split('\n').filter((line) => line.startsWith('- F-')).map((line) => line.slice(2, 5));
    assert.deepEqual(order, ['F-3', 'F-2', 'F-1']);
  });
});
