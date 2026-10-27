import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { measuredParagraph, proseLines } from '../../scripts/check-i18n.mjs';

const pathOf = (file) => fileURLToPath(new URL(`../../${file}`, import.meta.url));

function csvCells(line) {
  const cells = [''];
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (quoted && character === '"' && line[index + 1] === '"') cells[cells.length - 1] += line[++index];
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) cells.push('');
    else cells[cells.length - 1] += character;
  }
  return cells;
}

const behaviorRows = (csv) => readFileSync(pathOf(csv), 'utf8').trim().split('\n').slice(1).map(csvCells);

function behaviorCounts(csv) {
  const rows = behaviorRows(csv);
  const tested = rows.filter((row) => row[3].startsWith('test:')).length;
  return [rows.length, tested, rows.length - tested];
}

const testTitles = new Set(
  readdirSync(pathOf('tests'), { recursive: true })
    .filter((file) => file.endsWith('.mjs'))
    .flatMap((file) => [...readFileSync(pathOf(`tests/${file}`), 'utf8').matchAll(/\b(?:test|describe|it)(?:\.\w+)?\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)])
    .map((match) => match[2].replace(/\\(.)/g, '$1')),
);

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

for (const csv of new Set(readmes.map(([, csv]) => csv))) {
  test(`every tested row in ${csv} names a test under tests/`, () => {
    for (const [id, , , verifiedBy, ...rest] of behaviorRows(csv)) {
      assert.equal(rest.length, 1, `${id} has 5 cells`);
      if (verifiedBy.startsWith('test:')) assert.ok(testTitles.has(verifiedBy.slice('test:'.length).trim()), `${id} names a test that does not exist: ${verifiedBy}`);
    }
  });
}
