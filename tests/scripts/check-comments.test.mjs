import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { EXCLUDED, blankComments, findComments, scopedFiles } from '../../scripts/check-comments.mjs';

const script = fileURLToPath(new URL('../../scripts/check-comments.mjs', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
const run = (cwd) => spawnSync(process.execPath, [script, cwd], { encoding: 'utf8' });
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const render = 'plugins/gap-map/skills/gap-map/scripts/render.mjs';
const gate = 'plugins/review-loop/hooks/commit-gate.mjs';

function fixture(t, files) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'comment-check-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const all = { 'plugins/.keep': '', 'evals/.keep': '', 'scripts/clean.mjs': 'export const a = 1;\n', ...files };
  for (const [file, content] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    writeFileSync(path.join(cwd, file), content);
  }
  return run(cwd);
}

const count = (source) => findComments(source).length;

test('the repository has no comments in scanned files', () => {
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Checked \d+ files: no comments\./);
});

test('scope includes real files from plugins, scripts, evals and shared', () => {
  const files = scopedFiles(root);
  for (const file of ['scripts/check-comments.mjs', 'scripts/sync-shared.mjs', 'shared/entry-point.mjs', 'plugins/gap-map/skills/gap-map/scripts/_shared/entry-point.mjs', render, gate]) assert.ok(files.includes(file), file);
  assert.ok(files.includes('plugins/review-loop/skills/review-loop/scripts/loop.mjs'));
  assert.ok(files.includes('plugins/verify/skills/verify/scripts/verify.mjs'));
  assert.ok(files.includes('evals/e2e/run-sessions.mjs'));
});

test('EXCLUDED holds only the three fixture path rules', () => {
  assert.deepEqual(EXCLUDED.map(String), [
    String.raw`/^evals\/(?:.+\/)?repo\//`,
    String.raw`/(?:^|\/)fixtures\//`,
    String.raw`/(?:^|\/)node_modules\//`,
  ]);
});


test('a comment in shared/ fails with path and line', (t) => {
  const result = fixture(t, { 'shared/helper.mjs': 'export const a = 1;\n// x\n' });
  assert.equal(result.status, 1, result.stderr);
  assert.ok(result.stderr.includes('shared/helper.mjs:2:'), result.stderr);
});

test('an appended comment is always found in every real file', () => {
  for (const file of scopedFiles(root)) {
    const text = read(file);
    for (const extra of ['\n// x\n', '\n/* x */\n']) {
      assert.equal(count(text + extra), count(text) + 1, `${file} ${JSON.stringify(extra)}`);
    }
  }
});

test('a comment added to a real clean file fails with path and line', (t) => {
  for (const file of [render, gate]) {
    const text = read(file);
    const line = text.split('\n').length + 1;
    for (const extra of ['// x\n', '/* x */\n']) {
      const result = fixture(t, { [file]: `${text}\n${extra}` });
      assert.equal(result.status, 1, result.stderr);
      assert.ok(result.stderr.includes(`${file}:${line}:`), result.stderr);
    }
  }
});

test('negative controls report nothing', (t) => {
  const source = '#!/usr/bin/env node\nconst a = "http://a";\nconst b = /\\/\\//;\nconst c = `${"//"}`;\nexport { a, b, c };\n';
  const result = fixture(t, { 'scripts/controls.mjs': source });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(count(source), 0);
});

test('strings, regexes and templates hide comment markers', () => {
  const cases = [
    "a = 'http://a'", 'a = `http://a`', "a = 'it\\'s // fine'", 'a = "a\\"//b"',
    "a = 'x\\\n//'", "a = 'x\\\r\n//'",
    'a = /[/]/', 'a = /[/*]/.test(a)', 'a = /\\/*/.test(a)', 'a = /[\\]/]/.test(a)', 'a = /a/gimsuy.test(b)',
    'a = `${`//`}`', "a = `${'/*'}*/`", 'a = `\\${//}`', 'a = `a${b}//c`', "a = `${{ a: '//' }.a}//`",
    'a = `${`${`${"//"}`}`}`',
    'return /\\/\\//', 'typeof /\\/\\//', 'void /\\/\\//', 'delete /\\/\\//', 'new /\\/\\//',
    'await /\\/\\//', 'yield /\\/\\//', 'case /\\/\\//:', 'else /\\/\\//', 'do /\\/\\//',
    'export default /\\/\\//', 'f = () => /\\/\\//', 'a ? /\\/\\// : /\\/\\//',
    'x<!--y;', 'x-->y;',
  ];
  for (const source of cases) assert.equal(count(source), 0, source);
});

test('real comments are found at the right line', () => {
  const cases = [
    ['// x', [1]], ['/* x */', [1]], ['/**/', [1]], ['/*/ x */', [1]], ['/* a *//* b */', [1, 1]],
    ['a\n/* x\ny */', [2]], ['a\r\n// x\r\nb', [2]], ['#!/usr/bin/env node\n// x\n', [2]],
    ['`${a /* x */}`', [1]], ['`${a // x\n}`', [1]],
    ['a /* x */ / 2 // y', [1, 1]], ['a = /* x */ /\\/\\//;', [1]],
  ];
  for (const [source, lines] of cases) assert.deepEqual(findComments(source).map((c) => c.line), lines, source);
  assert.equal(findComments('a\r\n// x\r\nb')[0].end, 7);
});

test('division before a comment is not read as a regex', () => {
  const cases = [
    '(a) / 2', 'a[0] / 2', 'a++ / 2', 'a-- / 2', 'a.return / 2', 'a?.return / 2', 'this.#in / 2',
    '1 / 2', '1. / 2', '`t` / 2', '/r/ / 2', 'x = {} / 2', 'x = function () {} / 2',
    'const of = 1; of / 2', 'a = b\n/c/g',
  ];
  for (const source of cases) assert.equal(count(`${source} // c`), 1, source);
});

test('blanking keeps length, line breaks and parsing', () => {
  const source = 'function f() { return /* x\n*/ 1 }\n';
  const blank = blankComments(source, findComments(source));
  assert.equal(blank.length, source.length);
  assert.equal(blank.split('\n').length, source.split('\n').length);
  assert.equal(new Function(`${blank}; return f();`)(), new Function(`${source}; return f();`)());
});

test('a misread regex stops with exit 2 instead of a false report', (t) => {
  const result = fixture(t, { 'scripts/misread.mjs': 'if (a) /\\/\\//.test(b);\n' });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /scripts\/misread\.mjs/);
});

test('broken files exit 2 and name the file', (t) => {
  for (const source of ['const a = ; // x\n', "const a = 'x\n", '/* x\n']) {
    const result = fixture(t, { 'scripts/broken.mjs': source });
    assert.equal(result.status, 2, source);
    assert.match(result.stderr, /scripts\/broken\.mjs/);
  }
});

test('an empty or missing root exits 2', (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'comment-check-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  assert.equal(run(cwd).status, 2);
  assert.equal(run(path.join(cwd, 'missing')).status, 2);
});

test('fixture paths are excluded, lookalikes are not', (t) => {
  const bad = '// x\n';
  const skipped = fixture(t, {
    'evals/t/repo/a.mjs': bad, 'evals/t/deep/er/repo/b.mjs': bad, 'evals/t/fixtures/c.mjs': bad,
    'plugins/t/fixtures/d.mjs': bad, 'plugins/t/node_modules/e.mjs': bad, 'evals/t/a.js': bad,
  });
  assert.equal(skipped.status, 0, skipped.stderr);
  for (const file of ['plugins/t/repo/a.mjs', 'evals/t/repository/a.mjs']) {
    const result = fixture(t, { [file]: bad });
    assert.equal(result.status, 1, file);
  }
});

test('comments are listed sorted by path then line', (t) => {
  const result = fixture(t, { 'scripts/b.mjs': '// x\n// y\n', 'plugins/a.mjs': 'a;\n/* x */\n' });
  assert.equal(result.status, 1);
  const lines = result.stderr.split('\n').filter((line) => line.includes(' comment'));
  assert.deepEqual(lines.slice(0, 3), ['plugins/a.mjs:2: block comment', 'scripts/b.mjs:1: line comment', 'scripts/b.mjs:2: line comment']);
});
