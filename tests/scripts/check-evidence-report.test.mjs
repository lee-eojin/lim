import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/check-evidence-report.mjs', import.meta.url));
const required = ['revision', 'repro', 'run', 'proof', 'limits', 'verdict'];
const valid = { revision: 'abc1234', repro: 'node --test', run: 'one local run', proof: '12 pass, 0 fail', limits: 'Linux only', verdict: 'PASS' };
const asText = (fields) => Object.entries(fields).map(([key, value]) => `${key.toUpperCase()}: ${value}`).join('\n') + '\n';
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

function reportFile(t, content, name = 'report.md') {
  const cwd = mkdtempSync(path.join(tmpdir(), 'evidence-check-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const file = path.join(cwd, name);
  writeFileSync(file, content);
  return file;
}
const check = (t, content, name) => run(reportFile(t, content, name));

function assertFails(result, pattern) {
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, pattern);
}

test('valid JSON passes', (t) => {
  const result = check(t, JSON.stringify(valid), 'report.json');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Evidence report OK (verdict PASS).\n');
});

test('valid text passes', (t) => {
  const result = check(t, asText(valid));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Evidence report OK (verdict PASS).\n');
});

test('text labels ignore case, may drop the colon, and may follow a title', (t) => {
  const report = '# Report\n\nrevision: abc\nRepro\n  node --test\nRun: once\nProof:\nRun the tests and read the count.\n  12 pass\nLimits: none\nVerdict: FAIL\n';
  const result = check(t, report);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verdict FAIL/);
});

test('text accepts Windows line endings and a byte order mark', (t) => {
  const result = check(t, `﻿${asText(valid).replaceAll('\n', '\r\n')}`);
  assert.equal(result.status, 0, result.stderr);
});

for (const verdict of ['FAIL', 'NOT_RUN', 'BLOCKED']) {
  test(`verdict ${verdict} passes`, (t) => {
    const result = check(t, JSON.stringify({ ...valid, verdict }), 'report.json');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `Evidence report OK (verdict ${verdict}).\n`);
  });
}

for (const field of required) {
  const { [field]: _, ...rest } = valid;
  test(`JSON without ${field} fails`, (t) => {
    assertFails(check(t, JSON.stringify(rest), 'report.json'), new RegExp(`^${field}: missing$`, 'm'));
  });
  test(`text without ${field} fails`, (t) => {
    assertFails(check(t, asText(rest)), new RegExp(`^${field}: missing$`, 'm'));
  });
}

for (const verdict of ['OK', 'pass', 'PASS maybe', ' PASS ']) {
  test(`JSON verdict "${verdict}" fails`, (t) => {
    assertFails(check(t, JSON.stringify({ ...valid, verdict }), 'report.json'), /^verdict: must be one of/m);
  });
}

for (const verdict of ['OK', 'pass', 'PASS maybe', 'PASS\nand more text']) {
  test(`text verdict ${JSON.stringify(verdict)} fails`, (t) => {
    assertFails(check(t, asText({ ...valid, verdict })), /^verdict: must be one of/m);
  });
}

test('empty proof fails in JSON and text', (t) => {
  assertFails(check(t, JSON.stringify({ ...valid, proof: '   ' }), 'report.json'), /^proof: must not be empty$/m);
  assertFails(check(t, asText({ ...valid, proof: '' })), /^proof: must not be empty$/m);
});

test('a field that is not a string fails', (t) => {
  assertFails(check(t, JSON.stringify({ ...valid, proof: ['12 pass'] }), 'report.json'), /^proof: must be a string$/m);
  assertFails(check(t, JSON.stringify({ ...valid, proof: null }), 'report.json'), /^proof: must be a string$/m);
});

test('a repeated text label fails, so a later verdict cannot hide an earlier one', (t) => {
  assertFails(check(t, `${asText(valid)}Verdict: FAIL\n`), /^verdict: appears more than once$/m);
});

test('mutation is optional, and an empty one fails', (t) => {
  const withMutation = { ...valid, mutation: 'removed the guard; the test failed' };
  assert.equal(check(t, JSON.stringify(withMutation), 'report.json').status, 0);
  assert.equal(check(t, asText(withMutation)).status, 0);
  assertFails(check(t, JSON.stringify({ ...valid, mutation: ' ' }), 'report.json'), /^mutation: must not be empty$/m);
  assertFails(check(t, asText({ ...valid, mutation: '' })), /^mutation: must not be empty$/m);
  assertFails(check(t, JSON.stringify({ ...valid, mutation: 1 }), 'report.json'), /^mutation: must be a string$/m);
});

test('invalid JSON names the file', (t) => {
  const file = reportFile(t, '{ "revision": ', 'report.json');
  const result = run(file);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(`${file}: invalid JSON`), result.stderr);
});

test('a file with no labels lists every required field', (t) => {
  const result = check(t, 'All tests passed, trust me.\n');
  assert.equal(result.status, 1);
  assert.deepEqual(result.stderr.trim().split('\n'), required.map((field) => `${field}: missing`));
});

test('a missing argument exits 2', () => {
  const result = run();
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
});

test('an unreadable file exits 2 and names it', (t) => {
  const file = path.join(path.dirname(reportFile(t, '')), 'absent.md');
  const result = run(file);
  assert.equal(result.status, 2);
  assert.ok(result.stderr.includes(file), result.stderr);
});
