import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { russianBehaviorNoun } from '../../scripts/sync-counts.mjs';

const script = fileURLToPath(new URL('../../scripts/sync-counts.mjs', import.meta.url));

test('picks the Russian noun form for behaviors by the number', () => {
  const forms = { 1: 'вариант', 2: 'варианта', 4: 'варианта', 5: 'вариантов', 11: 'вариантов', 14: 'вариантов', 21: 'вариант', 22: 'варианта', 25: 'вариантов', 101: 'вариант', 111: 'вариантов' };
  for (const [count, form] of Object.entries(forms)) assert.equal(russianBehaviorNoun(Number(count)), form, `${count} ${form}`);
});

const rows = Array.from({ length: 22 }, (_, index) => `T${index + 1},do,does a thing,${index < 17 ? 'test: a test' : 'model run'},`);

const staleFiles = {
  'README.md': '# Tool\n\n[`behaviors.csv`](evals/tool/behaviors.csv) lists <!--total-->21 behaviors. Unit tests cover <!--tested-->20 of them. The other <!--rest-->1 needs a model run; P3 to P5 come later.\n',
  'docs/i18n/README.ru.md': '# Tool\n\n[`behaviors.csv`](../../evals/tool/behaviors.csv) содержит <!--total-->21 вариант поведения.\nТесты покрывают <!--tested-->20 из них. Остальные <!--rest-->1 требуют запуска модели.\n',
  'docs/i18n/README.ja.md': '# Tool\n\n[`behaviors.csv`](../../evals/tool/behaviors.csv)には、6つの軸にわたる<!--total-->21個の動作があります。そのうち<!--tested-->20個をテストがカバーします。残りの<!--rest-->1個はモデルの実行が必要です。その<!--rest-->1個は、P3からP5について1回だけ確認することです。\n',
  'docs/i18n/README.ko.md': '# Tool\n\n[`behaviors.csv`](../../evals/tool/behaviors.csv)에는 6개 축에 걸친 <!--total-->21개 동작이 있습니다. 그중 <!--tested-->20개를 다룹니다. 나머지 <!--rest-->1개는 모델 실행이 필요합니다. 그 <!--rest-->1개는 P3부터 P5까지를 한 번만 묻기입니다.\n',
  'plugins/tool/README.md': '# Tool\n\n[`behaviors.csv`](../../evals/tool/behaviors.csv) lists <!--total-->23 behaviors. Unit tests cover <!--tested-->20 of them. The other <!--rest-->1 needs a model run. The runs below caught it (30 of 30), see [`2026-10-27-claude-opus-5-5-detection-3runs.json`](results/runs.json).\n',
};

const syncedFiles = {
  'README.md': '# Tool\n\n[`behaviors.csv`](evals/tool/behaviors.csv) lists <!--total-->22 behaviors. Unit tests cover <!--tested-->17 of them. The other <!--rest-->5 needs a model run; P3 to P5 come later.\n',
  'docs/i18n/README.ru.md': '# Tool\n\n[`behaviors.csv`](../../evals/tool/behaviors.csv) содержит <!--total-->22 варианта поведения.\nТесты покрывают <!--tested-->17 из них. Остальные <!--rest-->5 требуют запуска модели.\n',
  'docs/i18n/README.ja.md': '# Tool\n\n[`behaviors.csv`](../../evals/tool/behaviors.csv)には、6つの軸にわたる<!--total-->22個の動作があります。そのうち<!--tested-->17個をテストがカバーします。残りの<!--rest-->5個はモデルの実行が必要です。その<!--rest-->5個は、P3からP5について1回だけ確認することです。\n',
  'docs/i18n/README.ko.md': '# Tool\n\n[`behaviors.csv`](../../evals/tool/behaviors.csv)에는 6개 축에 걸친 <!--total-->22개 동작이 있습니다. 그중 <!--tested-->17개를 다룹니다. 나머지 <!--rest-->5개는 모델 실행이 필요합니다. 그 <!--rest-->5개는 P3부터 P5까지를 한 번만 묻기입니다.\n',
  'plugins/tool/README.md': '# Tool\n\n[`behaviors.csv`](../../evals/tool/behaviors.csv) lists <!--total-->22 behaviors. Unit tests cover <!--tested-->17 of them. The other <!--rest-->5 needs a model run. The runs below caught it (30 of 30), see [`2026-10-27-claude-opus-5-5-detection-3runs.json`](results/runs.json).\n',
};

function fixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'sync-counts-'));
  mkdirSync(path.join(root, 'evals/tool'), { recursive: true });
  writeFileSync(path.join(root, 'evals/tool/behaviors.csv'), ['id,axis,behavior,verified_by,notes', ...rows].join('\n') + '\n');
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

function withFixture(files, body) {
  const root = fixture(files);
  try {
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const run = (root, ...args) => spawnSync(process.execPath, [script, ...args, root], { encoding: 'utf8' });
const contents = (root) => Object.fromEntries(Object.keys(staleFiles).map((file) => [file, readFileSync(path.join(root, file), 'utf8')]));

test('--check lists the stale files, exits 1, and writes nothing', () => {
  withFixture(staleFiles, (root) => {
    const result = run(root, '--check');
    assert.equal(result.status, 1);
    const listed = result.stdout.split('\n').filter((line) => line.includes(': ')).map((line) => line.split(':')[0]);
    assert.deepEqual(listed, ['README.md', 'docs/i18n/README.ja.md', 'docs/i18n/README.ko.md', 'docs/i18n/README.ru.md', 'plugins/tool/README.md']);
    assert.deepEqual(contents(root), staleFiles);
  });
});

test('rewrites only the marked counts and the Russian noun form, leaving the six axes, link text, and other numbers alone', () => {
  withFixture(staleFiles, (root) => {
    assert.equal(run(root).status, 0);
    assert.deepEqual(contents(root), syncedFiles);
  });
});

test('a second run changes nothing and --check then passes', () => {
  withFixture(staleFiles, (root) => {
    run(root);
    const second = run(root);
    assert.equal(second.status, 0);
    assert.equal(second.stdout, '');
    assert.deepEqual(contents(root), syncedFiles);
    assert.equal(run(root, '--check').status, 0);
  });
});

test('--check fails when only the second mention of the rest count is stale', () => {
  const ko = syncedFiles['docs/i18n/README.ko.md'].replace('그 <!--rest-->5개', '그 <!--rest-->11개');
  withFixture({ ...syncedFiles, 'docs/i18n/README.ko.md': ko }, (root) => {
    const result = run(root, '--check');
    assert.equal(result.status, 1);
    assert.match(result.stdout, /docs\/i18n\/README\.ko\.md: rest 5, 11 -> 5/);
  });
});

test('stops without writing when the second rest marker is written wrongly', () => {
  for (const broken of ['그 <!--rest -->1개', '그 <!--Rest-->1개', '그 <!--rest--> 1개']) {
    const files = { ...staleFiles, 'docs/i18n/README.ko.md': staleFiles['docs/i18n/README.ko.md'].replace('그 <!--rest-->1개', broken) };
    assert.notEqual(files['docs/i18n/README.ko.md'], staleFiles['docs/i18n/README.ko.md']);
    withFixture(files, (root) => {
      for (const args of [['--check'], []]) {
        const result = run(root, ...args);
        assert.equal(result.status, 1, broken);
        assert.match(result.stderr, /README\.ko\.md:3: .* is not a count marker; write it as <!--rest-->/, broken);
      }
      assert.deepEqual(contents(root), files);
    });
  }
});

test('stops without writing when a file lacks a count marker', () => {
  const unmarked = { ...staleFiles, 'README.md': staleFiles['README.md'].replace('<!--rest-->', '') };
  withFixture(unmarked, (root) => {
    for (const args of [['--check'], []]) {
      const result = run(root, ...args);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /README\.md: no <!--rest--> marker/);
    }
    assert.deepEqual(contents(root), unmarked);
  });
});
