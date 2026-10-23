import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { measuredParagraph, proseLines } from '../../scripts/check-i18n.mjs';

const pathOf = (file) => fileURLToPath(new URL(`../../${file}`, import.meta.url));

function behaviorCounts() {
  const rows = readFileSync(pathOf('evals/review-loop/behaviors.csv'), 'utf8').trim().split('\n').slice(1).map((line) => line.split(','));
  const tested = rows.filter((row) => row[3].startsWith('test:')).length;
  return [rows.length, tested, rows.length - tested];
}

for (const file of ['README.md', 'plugins/review-loop/README.md']) {
  test(`${file} states the behavior counts in behaviors.csv`, () => {
    const measured = measuredParagraph(proseLines(pathOf(file)));
    assert.ok(measured, `${file} has no paragraph that links behaviors.csv`);
    assert.deepEqual(measured.numbers.slice(0, 3).map(Number), behaviorCounts(), 'total, covered by unit tests, and the rest');
  });
}
