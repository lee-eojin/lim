import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { measuredParagraph, proseLines } from '../../scripts/check-i18n.mjs';

const pathOf = (file) => fileURLToPath(new URL(`../../${file}`, import.meta.url));

function behaviorCounts(csv) {
  const rows = readFileSync(pathOf(csv), 'utf8').trim().split('\n').slice(1).map((line) => line.split(','));
  const tested = rows.filter((row) => row[3].startsWith('test:')).length;
  return [rows.length, tested, rows.length - tested];
}

const readmes = [
  ['README.md', 'evals/review-loop/behaviors.csv'],
  ['plugins/review-loop/README.md', 'evals/review-loop/behaviors.csv'],
  ['plugins/clear-explain/README.md', 'evals/clear-explain/behaviors.csv'],
  ['plugins/verify/README.md', 'evals/verify/behaviors.csv'],
];

for (const [file, csv] of readmes) {
  test(`${file} states the behavior counts in ${csv}`, () => {
    const measured = measuredParagraph(proseLines(pathOf(file)));
    assert.ok(measured, `${file} has no paragraph that links behaviors.csv`);
    assert.deepEqual(measured.numbers.slice(0, 3).map(Number), behaviorCounts(csv), 'total, covered by unit tests, and the rest');
  });
}
