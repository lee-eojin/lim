import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('package.json parses and npm run lint matches the CONTRIBUTING list in order', () => {
  const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));
  const lint = pkg.scripts.lint.split(/\s*&&\s*/);
  const text = readFileSync(`${root}/CONTRIBUTING.md`, 'utf8');
  const sentence = text.match(/`npm run lint` runs (.+?), in that order/);
  assert.ok(sentence, 'CONTRIBUTING.md must say what npm run lint runs, in that order');
  const listed = [...sentence[1].matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  assert.deepEqual(lint, listed);
});
