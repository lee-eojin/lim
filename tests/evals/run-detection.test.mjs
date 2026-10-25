import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { locationsOf, parseAgentFile, parseReviewerOutput, pool, prepareCase, rescoreResults, runOne, scoreCase, summarize } from '../../evals/review-loop/run-detection.mjs';

const casesDir = fileURLToPath(new URL('../../evals/review-loop/detection/', import.meta.url));
const caseNames = readdirSync(casesDir).filter((name) => existsSync(path.join(casesDir, name, 'expected.json')));
const readExpected = (name) => JSON.parse(readFileSync(path.join(casesDir, name, 'expected.json'), 'utf8'));

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

test('every detection case has an intent and a diff that applies, and seeded ranges cover lines the change adds', () => {
  const kinds = { bug: 0, clean: 0 };
  for (const name of caseNames) {
    const expected = readExpected(name);
    assert.ok(expected.intent, `${name} has an intent`);
    if (expected.seeded) {
      kinds.bug += 1;
      assert.equal(expected.expect.length, 1, `${name} seeds one bug`);
    } else {
      kinds.clean += 1;
      assert.deepEqual(expected.forbid, [{ severity: ['P1', 'P2'] }], `${name} forbids any P1 or P2`);
    }
    const { workDir, diffPath } = prepareCase(path.join(casesDir, name), expected);
    try {
      if (!expected.seeded) continue;
      const added = addedLines(readFileSync(diffPath, 'utf8'));
      const locations = locationsOf(expected.expect[0]);
      assert.ok(locations.length, `${name} names where the bug is`);
      for (const { file, lines: [from, to] } of locations) {
        const where = `${name}: ${file}:${from}-${to}`;
        const fileLines = readFileSync(path.join(workDir, file), 'utf8').replace(/\n$/, '').split('\n');
        assert.ok(from >= 1 && from <= to && to <= fileLines.length, `${where} exists in the changed file (${fileLines.length} lines)`);
        const changed = added.get(file) ?? new Set();
        assert.ok([...changed].some((line) => line >= from && line <= to), `${where} covers a line the change adds or changes`);
      }
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
  assert.ok(kinds.bug >= 10 && kinds.clean >= 5, `at least 10 seeded bugs and 5 clean changes, got ${kinds.bug} and ${kinds.clean}`);
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

test('every case names keywords that only a finding about the seeded bug would use', () => {
  for (const name of caseNames) {
    for (const entry of readExpected(name).expect) {
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
