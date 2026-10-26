import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { casesDirFor, compareResults, locationsOf, parseAgentFile, parseReviewerOutput, pool, prepareCase, rescoreResults, rescoreRuns, runOne, scoreCase, serializeResults, summarize } from '../../evals/review-loop/run-detection.mjs';

const evalsDir = fileURLToPath(new URL('../../evals/review-loop/', import.meta.url));
const casesDir = path.join(evalsDir, 'detection');
const caseSets = [
  { folder: 'detection', minBugs: 10, minClean: 5 },
  { folder: 'detection-hard', minBugs: 5, minClean: 3 },
].map((set) => {
  const dir = path.join(evalsDir, set.folder);
  const names = readdirSync(dir).filter((name) => existsSync(path.join(dir, name, 'expected.json')));
  return { ...set, dir, names };
});
const readCase = (dir, name) => JSON.parse(readFileSync(path.join(dir, name, 'expected.json'), 'utf8'));
const readExpected = (name) => readCase(casesDir, name);

const seeded = {
  seeded: 'off-by-one',
  expect: [{ locations: [{ file: 'src/page.js', lines: [3, 5] }], severity: ['P1', 'P2'], mentions: ['last'] }],
  forbid: [],
};
const clean = { seeded: null, expect: [], forbid: [{ severity: ['P1', 'P2'] }] };
const finding = (fields) => ({ severity: 'P2', file: 'src/page.js', line: 4, title: 'drops the last item', ...fields });

test('a seeded bug is found only at the expected place, severity, and subject', () => {
  assert.equal(scoreCase(seeded, { findings: [finding()] }).result, 'found');
  assert.equal(scoreCase(seeded, { findings: [finding({ severity: 'P3' })] }).result, 'low-severity');
  assert.equal(scoreCase(seeded, { findings: [finding({ line: 9 })] }).result, 'missed');
  assert.equal(scoreCase(seeded, { findings: [finding({ title: 'rename end' })] }).result, 'missed');
  assert.equal(scoreCase(seeded, { findings: [finding({ file: './src/page.js' })] }).result, 'found');
});

test('a quoted line inside the expected range counts when the reported line is off', () => {
  const lines = ['a', 'b', 'c', '  const end = items.length - 1;', 'e'];
  const review = { findings: [finding({ line: 40, quote: '+  const end = items.length - 1;' })] };
  assert.equal(scoreCase(seeded, review, () => lines).result, 'found');
});

test('a clean change fails only on a P1 or P2 and keeps the rest as other findings', () => {
  const score = scoreCase(clean, { findings: [finding({ severity: 'P3' }), finding({ severity: 'P4' })] });
  assert.equal(score.result, 'clean');
  assert.equal(score.otherLow, 2);
  const alarm = scoreCase(clean, { findings: [finding({ severity: 'P1' })] });
  assert.equal(alarm.result, 'false-alarm');
  assert.equal(alarm.forbidden.length, 1);
});

test('summary counts found, missed, and false P1 or P2 per run', () => {
  const runs = [
    { case: 'a', ...scoreCase(seeded, { findings: [finding()] }), tokens: { total: 100 }, wallMs: 2000 },
    { case: 'b', ...scoreCase(seeded, { findings: [] }), tokens: { total: 300 }, wallMs: 4000 },
    { case: 'c', ...scoreCase(clean, { findings: [finding()] }), tokens: { total: 200 }, wallMs: 3000 },
    { case: 'd', result: 'error', error: 'crashed' },
  ];
  const summary = summarize(runs);
  assert.equal(summary.found, 1);
  assert.equal(summary.missed, 1);
  assert.equal(summary.cleanWithFalseHigh, 1);
  assert.equal(summary.errors, 1);
  assert.equal(summary.averageTokens, 200);
  assert.equal(summary.totalWallSeconds, 9);
});

test('reviewer output is read from plain or fenced JSON', () => {
  assert.equal(parseReviewerOutput('{"findings":[]}').strict, true);
  assert.equal(parseReviewerOutput('Here:\n```json\n{"findings":[]}\n```').strict, false);
  assert.ok(parseReviewerOutput('no findings').error);
});

test('the reviewer definition keeps its tools and inherits the model', () => {
  const agent = parseAgentFile(readFileSync(fileURLToPath(new URL('../../plugins/review-loop/agents/reviewer.md', import.meta.url)), 'utf8'));
  assert.deepEqual(agent.tools, ['Read', 'Grep', 'Glob']);
  assert.equal(agent.model, undefined);
  assert.match(agent.prompt, /^You review one change/);
});

function addedLines(diff) {
  const added = new Map();
  let file = null;
  let line = 0;
  for (const text of diff.split('\n')) {
    if (text.startsWith('+++ ')) {
      file = text.slice(4).replace(/^b\//, '');
      added.set(file, new Set());
    } else if (text.startsWith('@@')) {
      line = Number(/\+(\d+)/.exec(text)[1]);
    } else if (file && text.startsWith('+')) {
      added.get(file).add(line);
      line += 1;
    } else if (file && text.startsWith(' ')) {
      line += 1;
    }
  }
  return added;
}

for (const { folder, dir, names, minBugs, minClean } of caseSets) test(`${folder}: every case has an intent and a diff that applies, and seeded ranges cover lines the change adds`, () => {
  const kinds = { bug: 0, clean: 0 };
  for (const name of names) {
    const expected = readCase(dir, name);
    assert.ok(expected.intent, `${name} has an intent`);
    if (expected.seeded) {
      kinds.bug += 1;
      assert.equal(expected.expect.length, 1, `${name} seeds one bug`);
    } else {
      kinds.clean += 1;
      assert.deepEqual(expected.forbid, [{ severity: ['P1', 'P2'] }], `${name} forbids any P1 or P2`);
    }
    const { workDir, diffPath } = prepareCase(path.join(dir, name), expected);
    try {
      if (!expected.seeded) continue;
      const added = addedLines(readFileSync(diffPath, 'utf8'));
      const locations = locationsOf(expected.expect[0]);
      assert.ok(locations.length, `${name} names where the bug is`);
      for (const { file, lines: [from, to], context } of locations) {
        const where = `${name}: ${file}:${from}-${to}`;
        const fileLines = readFileSync(path.join(workDir, file), 'utf8').replace(/\n$/, '').split('\n');
        assert.ok(from >= 1 && from <= to && to <= fileLines.length, `${where} exists in the changed file (${fileLines.length} lines)`);
        if (context) continue;
        const changed = added.get(file) ?? new Set();
        assert.ok([...changed].some((line) => line >= from && line <= to), `${where} covers a line the change adds or changes`);
      }
      assert.ok(locations.some((location) => !location.context), `${name} names a line the change adds or changes`);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
  assert.ok(kinds.bug >= minBugs && kinds.clean >= minClean, `at least ${minBugs} seeded bugs and ${minClean} clean changes, got ${kinds.bug} and ${kinds.clean}`);
});

test('the file and lines shorthand is read as one location', () => {
  assert.deepEqual(locationsOf({ file: 'src/page.js', lines: [3, 5] }), [{ file: 'src/page.js', lines: [3, 5] }]);
  const shorthand = { seeded: 'off-by-one', expect: [{ file: 'src/page.js', lines: [3, 5], mentions: ['drops the last'] }] };
  assert.equal(scoreCase(shorthand, { findings: [finding()] }).result, 'found');
});

test('mention keywords match whole words or exact phrases, not parts of words', () => {
  const entry = (mentions) => ({ seeded: 'x', expect: [{ locations: [{ file: 'src/page.js', lines: [3, 5] }], mentions }] });
  assert.equal(scoreCase(entry(['last']), { findings: [finding({ title: 'widens the blast radius' })] }).result, 'missed');
  assert.equal(scoreCase(entry(['last']), { findings: [finding({ title: 'Drops the LAST item' })] }).result, 'found');
  assert.equal(scoreCase(entry(['|| default']), { findings: [finding({ title: 'timeoutMs || default turns 0 into 5000' })] }).result, 'found');
  assert.equal(scoreCase(entry(['|| default']), { findings: [finding({ title: 'timeoutMs || defaults' })] }).result, 'missed');
  assert.equal(scoreCase(entry(['in place']), { findings: [finding({ title: 'sorts the array in\nplace' })] }).result, 'found');
});

const GENERIC_MENTIONS = new Set([
  'bug', 'issue', 'problem', 'error', 'value', 'number', 'string', 'data', 'check', 'test', 'order', 'sort',
  'first', 'last', 'wrong', 'default', 'zero', 'null', 'time', 'unit', 'second', 'seconds', 'ms',
]);

for (const { folder, dir, names } of caseSets) test(`${folder}: every case names keywords that only a finding about the seeded bug would use`, () => {
  for (const name of names) {
    for (const entry of readCase(dir, name).expect) {
      assert.ok(entry.mentions?.length, `${name} lists mention keywords`);
      for (const keyword of entry.mentions) {
        assert.ok(keyword.trim().length >= 3, `${name}: "${keyword}" is shorter than 3 characters`);
        assert.ok(!/^\d+$/.test(keyword.trim()), `${name}: "${keyword}" is a number alone`);
        assert.ok(!GENERIC_MENTIONS.has(keyword.trim().toLowerCase()), `${name}: "${keyword}" is too generic`);
      }
    }
  }
});

test('request-timeout: an unrelated P2 in range that mentions 200 ms is not the seeded bug', () => {
  const expected = readExpected('request-timeout');
  const callerSignal = {
    severity: 'P2',
    file: 'src/http.js',
    line: 6,
    category: 'correctness',
    title: "A caller's own AbortSignal is replaced by the internal controller",
    scenario: 'A caller passes signal to cancel the export after 200 ms. The spread then sets signal: controller.signal, so the cancel never reaches fetch.',
    quote: '  const controller = new AbortController();',
    whyNotPrevented: 'Nothing combines the two signals.',
  };
  assert.equal(scoreCase(expected, { findings: [callerSignal] }).result, 'missed');
  const seededBug = {
    ...callerSignal,
    line: 5,
    title: 'timeoutMs: 0 falls back to the 5s default, so the timeout can never be turned off',
    scenario: '0 || 5000 is 5000, so the export still aborts.',
    quote: '  const timeout = timeoutMs || DEFAULT_TIMEOUT_MS;',
  };
  assert.equal(scoreCase(expected, { findings: [callerSignal, seededBug] }).result, 'found');
});

test('rescoring a stored run applies the current expected.json and keeps the raw output and the first summary', () => {
  const review = {
    findings: [{
      severity: 'P2',
      file: 'src/http.js',
      line: 40,
      title: "A caller's own AbortSignal is replaced",
      scenario: 'A caller cancels after 200 ms and nothing happens.',
      quote: '+  const controller = new AbortController();',
    }],
  };
  const stored = {
    model: 'some-model',
    summary: { found: 1, missed: 0 },
    runs: [{ case: 'request-timeout', tokens: { total: 10 }, kind: 'bug', result: 'found', review }],
  };
  const rescored = rescoreResults(stored, casesDir, 'keywords changed');
  assert.equal(rescored.model, 'some-model');
  assert.equal(rescored.runs[0].result, 'missed');
  assert.equal(rescored.runs[0].review, review);
  assert.equal(rescored.summary.missed, 1);
  assert.deepEqual(rescored.scoredWith.originalSummary, { found: 1, missed: 0 });
  assert.equal(rescored.scoredWith.note, 'keywords changed');
  assert.deepEqual(rescoreResults(rescored, casesDir, 'again').scoredWith.originalSummary, { found: 1, missed: 0 });
});

test('rescoring uses the cases folder stored in the results file unless --cases is given', () => {
  const hardDir = caseSets.find((set) => set.folder === 'detection-hard').dir;
  assert.equal(casesDirFor(undefined, { cases: 'evals/review-loop/detection-hard' }), hardDir);
  assert.equal(casesDirFor(undefined, {}), casesDir);
  assert.equal(casesDirFor(undefined), casesDir);
  assert.equal(casesDirFor(hardDir, { cases: 'evals/review-loop/detection' }), hardDir);
});

const resultsDir = path.join(evalsDir, 'results');
const resultFiles = readdirSync(resultsDir).filter((name) => name.endsWith('.json')).sort();

test('every saved results file is scored with the current expected.json files', () => {
  assert.ok(resultFiles.length, 'there are saved results');
  for (const name of resultFiles) {
    const results = JSON.parse(readFileSync(path.join(resultsDir, name), 'utf8'));
    const rescored = summarize(rescoreRuns(results.runs, casesDirFor(undefined, results)));
    assert.deepEqual(results.summary, rescored, `${name} differs from a rescore; run node evals/review-loop/run-detection.mjs --rescore on it`);
  }
});

test('the round diff does not depend on the git config of the person running it', () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    GIT_CONFIG_COUNT: '3',
    GIT_CONFIG_KEY_0: 'diff.noprefix',
    GIT_CONFIG_VALUE_0: 'true',
    GIT_CONFIG_KEY_1: 'color.diff',
    GIT_CONFIG_VALUE_1: 'always',
    GIT_CONFIG_KEY_2: 'diff.mnemonicPrefix',
    GIT_CONFIG_VALUE_2: 'true',
  });
  let workDir;
  try {
    const prepared = prepareCase(path.join(casesDir, 'request-timeout'), readExpected('request-timeout'));
    workDir = prepared.workDir;
    const diff = readFileSync(prepared.diffPath, 'utf8');
    assert.match(diff, /^diff --git a\/src\/export\.js b\/src\/export\.js$/m);
    assert.doesNotMatch(diff, /\x1b\[/);
  } finally {
    process.env = saved;
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  }
});

test('a case whose preparation fails becomes an error entry and the other cases still run', async () => {
  const fixtureDir = mkdtempSync(path.join(tmpdir(), 'detection-cases-'));
  const writeCase = (name, source, diff) => {
    mkdirSync(path.join(fixtureDir, name, 'repo', 'src'), { recursive: true });
    writeFileSync(path.join(fixtureDir, name, 'repo', 'src', 'value.js'), source);
    writeFileSync(path.join(fixtureDir, name, 'change.diff'), diff);
  };
  const diff = 'diff --git a/src/value.js b/src/value.js\n--- a/src/value.js\n+++ b/src/value.js\n@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n';
  writeCase('stale', 'export const other = 1;\n', diff);
  writeCase('fresh', 'export const value = 1;\n', diff);
  const options = { dryRun: true, keep: false };
  try {
    const runs = await pool(['stale', 'fresh'].map((name) => () => runOne({
      name, caseDir: path.join(fixtureDir, name), expected: { intent: 'change the value' }, agent: {}, options,
    })), 1);
    assert.equal(runs[0].case, 'stale');
    assert.equal(runs[0].result, 'error');
    assert.match(runs[0].error, /^could not prepare the case: /);
    assert.equal(runs[1].case, 'fresh');
    assert.equal(runs[1].result, 'prepared');
    assert.equal(summarize(runs).errors, 1);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('saved results escape the long dash and the middle dot and parse back to the same text', () => {
  const results = { runs: [{ review: { findings: [{ measuredBy: 'Grep: no tests \u2014 none \u00b7 found' }] } }] };
  const text = serializeResults(results);
  assert.doesNotMatch(text, /[\u2014\u00b7]/);
  assert.deepEqual(JSON.parse(text), results);
});

test('compare marks fewer bugs found and more false alarms as worse on the cases both files ran', () => {
  const run = (name, kind, result, otherLow = 0) => ({ case: name, kind, result, otherHigh: 0, otherLow, forbidden: result === 'false-alarm' ? [{ severity: 'P2' }] : [] });
  const before = { cases: 'evals/review-loop/detection-hard', reviewer: { path: 'reviewer.md', sha256: 'aa' }, runs: [run('cache', 'bug', 'found'), run('cache', 'bug', 'found'), run('guard', 'clean', 'clean'), run('gone', 'bug', 'found')] };
  const after = { runs: [run('cache', 'bug', 'missed', 2), run('cache', 'bug', 'found'), run('guard', 'clean', 'false-alarm'), run('new', 'bug', 'found')] };
  const comparison = compareResults(before, after);
  assert.deepEqual([comparison.cases, comparison.onlyBefore, comparison.onlyAfter], [['cache', 'guard'], ['gone'], ['new']]);
  assert.deepEqual([comparison.before, comparison.after], [{ cases: 'evals/review-loop/detection-hard', reviewer: { path: 'reviewer.md', sha256: 'aa' } }, { cases: null, reviewer: null }]);
  const byName = Object.fromEntries(comparison.metrics.map((metric) => [metric.name, metric]));
  assert.deepEqual(byName['bugs found as P1 or P2'], { name: 'bugs found as P1 or P2', before: '2/2', after: '1/2', worse: true });
  assert.equal(byName['clean runs with a false P1 or P2'].worse, true);
  assert.deepEqual([byName['P3 to P5 findings per run'].before, byName['P3 to P5 findings per run'].after], ['0.00', '0.67']);
  assert.deepEqual(comparison.differing.map((entry) => entry.case), ['cache', 'guard']);
});

test('compare reports no change for the same results in a different order', () => {
  const run = (name, result) => ({ case: name, kind: 'bug', result, otherHigh: 0, otherLow: 0, forbidden: [] });
  const before = { runs: [run('cache', 'found'), run('cache', 'missed')] };
  const comparison = compareResults(before, { runs: [run('cache', 'missed'), run('cache', 'found')] });
  assert.deepEqual([comparison.differing, comparison.metrics.some((metric) => metric.worse)], [[], false]);
});

test('compare refuses files with no shared cases and other modes refuse stray arguments', () => {
  const script = fileURLToPath(new URL('../../evals/review-loop/run-detection.mjs', import.meta.url));
  const folder = mkdtempSync(path.join(tmpdir(), 'compare-'));
  try {
    const write = (name, caseName) => {
      const file = path.join(folder, name);
      writeFileSync(file, JSON.stringify({ runs: [{ case: caseName, kind: 'bug', result: 'found', otherHigh: 0, otherLow: 0, forbidden: [] }] }));
      return file;
    };
    const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    const disjoint = run('--compare', write('a.json', 'cache'), write('b.json', 'guard'));
    assert.notEqual(disjoint.status, 0);
    assert.match(disjoint.stderr, /share no cases/);
    const stray = run('--dry-run', 'stray');
    assert.notEqual(stray.status, 0);
    assert.match(stray.stderr, /unexpected argument: stray/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
