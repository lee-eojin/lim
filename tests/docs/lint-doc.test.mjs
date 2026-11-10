import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

const lintCommands = () => JSON.parse(readFileSync(`${root}/package.json`, 'utf8')).scripts.lint.split(/\s*&&\s*/);

test('package.json parses and npm run lint matches the CONTRIBUTING list in order', () => {
  const lint = lintCommands();
  const text = readFileSync(`${root}/CONTRIBUTING.md`, 'utf8');
  const sentence = text.match(/`npm run lint` runs ((?:`[^`]+`)(?:(?:, and |, | and )`[^`]+`)*)/);
  assert.ok(sentence, 'CONTRIBUTING.md must say what npm run lint runs, in order');
  const listed = [...sentence[1].matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  assert.deepEqual(lint, listed);
});

test('npm run lint leaves out the gates node --test already runs and the model check', () => {
  const doubled = ['check-comments.mjs', 'sync-counts.mjs', 'sync-shared.mjs', 'check-skills.mjs', 'check-loop-model-sync.mjs', 'check-loop-model.mjs'];
  assert.deepEqual(lintCommands().filter((command) => doubled.some((name) => command.includes(name))), []);
});
