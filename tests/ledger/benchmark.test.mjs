import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { referenceLedgers } from '../../evals/ledger/run-benchmark.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const projects = JSON.parse(readFileSync(path.join(root, 'evals/ledger/cases.json'), 'utf8'));

test('the ledger benchmark scores the honest reference correct and the overclaiming one not', () => {
  for (const project of projects) {
    const scores = referenceLedgers(path.join(root, 'evals/ledger/projects', project));
    assert.ok(Object.values(scores.honest).every((verdict) => verdict === 'correct'), JSON.stringify(scores.honest));
    assert.ok(Object.values(scores.overclaiming).every((verdict) => verdict !== 'correct'), JSON.stringify(scores.overclaiming));
  }
});

test('no file in the ledger plugin names a benchmark project or its functions or its answers', () => {
  const words = ['relaybox', 'legacyExport', 'formatSize', 'migrate.js', 'RELAY_PORT', '1536', '1.54 KiB'];
  const plugin = path.join(root, 'plugins/ledger');
  const files = readdirSync(plugin, { recursive: true }).filter((file) => statSync(path.join(plugin, file)).isFile());
  for (const file of files) {
    const text = readFileSync(path.join(plugin, file), 'utf8');
    for (const word of words) assert.ok(!text.includes(word), `${file} mentions ${word}`);
  }
});
