import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { behaviorCounts, behaviorRows, countTargets, statedCounts, syncCounts } from '../../scripts/sync-counts.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const pathOf = (file) => fileURLToPath(new URL(`../../${file}`, import.meta.url));

const testTitles = new Set(
  readdirSync(pathOf('tests'), { recursive: true })
    .filter((file) => file.endsWith('.mjs'))
    .flatMap((file) => [...readFileSync(pathOf(`tests/${file}`), 'utf8').matchAll(/\b(?:test|describe|it)(?:\.\w+)?\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)])
    .map((match) => match[2].replace(/\\(.)/g, '$1')),
);

const targets = countTargets(root).map((file) => ({ file, ...statedCounts(root, file) }));

for (const { file, csv, marks } of targets) {
  test(`${file} states the behavior counts in ${csv}`, () => {
    const expected = behaviorCounts(pathOf(csv));
    for (const { name, value } of marks) assert.equal(value, expected[name], `<!--${name}--> count; run node scripts/sync-counts.mjs`);
  });
}

test('node scripts/sync-counts.mjs --check finds nothing to change', () => {
  assert.deepEqual(syncCounts(root, { write: false }).map(({ file }) => file), []);
});

for (const csv of new Set(targets.map(({ csv }) => csv))) {
  test(`every tested row in ${csv} names a test under tests/`, () => {
    for (const [id, , , verifiedBy, ...rest] of behaviorRows(pathOf(csv))) {
      assert.equal(rest.length, 1, `${id} has 5 cells`);
      if (verifiedBy.startsWith('test:')) assert.ok(testTitles.has(verifiedBy.slice('test:'.length).trim()), `${id} names a test that does not exist: ${verifiedBy}`);
    }
  });
}
