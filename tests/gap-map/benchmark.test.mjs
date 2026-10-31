import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { referenceMaps } from '../../evals/gap-map/run-benchmark.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const projects = JSON.parse(readFileSync(path.join(root, 'evals/gap-map/cases.json'), 'utf8'));

test('the gap-map benchmark scores the honest reference map correct and the overclaiming one not', () => {
  for (const project of projects) {
    const scores = referenceMaps(path.join(root, 'evals/gap-map/projects', project));
    assert.ok(Object.values(scores.honest).every((verdict) => verdict === 'correct'), JSON.stringify(scores.honest));
    assert.ok(Object.values(scores.overclaiming).every((verdict) => verdict !== 'correct'), JSON.stringify(scores.overclaiming));
  }
});

test('no file in the gap-map plugin names a benchmark language or its tests', () => {
  const words = ['Quill', 'quill', 'power.q', 'rebind.q', 'right-associative', '512'];
  const plugin = path.join(root, 'plugins/gap-map');
  const files = readdirSync(plugin, { recursive: true }).filter((file) => statSync(path.join(plugin, file)).isFile() && !file.endsWith('.png'));
  for (const file of files) {
    const text = readFileSync(path.join(plugin, file), 'utf8');
    for (const word of words) assert.ok(!text.includes(word), `${file} mentions ${word}`);
  }
});
