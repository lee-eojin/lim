import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseOptions as detectionOptions } from '../../evals/review-loop/run-detection.mjs';
import { parseOptions as verifyOptions } from '../../evals/verify/run-benchmark.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const HEADING = '### When a benchmark result moves and nothing here changed';

const section = () => {
  const text = readFileSync(`${root}/CONTRIBUTING.md`, 'utf8');
  const start = text.indexOf(`${HEADING}\n`);
  assert.notEqual(start, -1, `CONTRIBUTING.md must have the heading ${HEADING}`);
  const rest = text.slice(start + HEADING.length);
  const end = rest.search(/\n##+ /);
  return end === -1 ? rest : rest.slice(0, end);
};

const commandsFor = (script) => section().split('\n')
  .filter((line) => /^\(?(cd|node) /.test(line) && line.includes(script))
  .map((line) => line.slice(line.indexOf(script) + script.length).replace(/\)$/, '').trim().split(/\s+/).map((word) => word.replace(/^"|"$/g, '')));

const withoutOut = (args) => args.filter((word, index) => word !== '--out' && args[index - 1] !== '--out');

test('the manual comparison with an old commit has its three steps in order: clone, run both, compare', () => {
  const text = section();
  const positions = [/^1\. .*temporary clone/m, /^2\. .*same small set/m, /^3\. Compare/m].map((step) => text.search(step));
  assert.ok(positions.every((position) => position !== -1), 'CONTRIBUTING.md must keep steps 1, 2, and 3');
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.match(text, /git clone --quiet \. "\$old"/);
  assert.match(text, /checkout --quiet --detach <commit>/);
  assert.match(text, /git diff --stat <commit> -- evals\//);
  assert.match(text, /git status --short --untracked-files=all -- evals\//);
  assert.match(text, /There is no `--baseline` option/);
});

test('the detection commands in the manual comparison use options run-detection.mjs accepts and run the same set on both sides', () => {
  const commands = commandsFor('evals/review-loop/run-detection.mjs');
  const parsed = commands.map((args) => detectionOptions(args));
  assert.deepEqual(parsed.map((entry) => entry.mode), ['a model run', 'a model run', '--compare']);
  assert.deepEqual(withoutOut(commands[0]), withoutOut(commands[1]));
  assert.notEqual(parsed[0].values.out, parsed[1].values.out);
  assert.deepEqual(parsed[2].positionals, [parsed[0].values.out, parsed[1].values.out]);
});

test('the verify commands in the manual comparison use options run-benchmark.mjs accepts and run the same set on both sides', () => {
  const commands = commandsFor('evals/verify/run-benchmark.mjs');
  const parsed = commands.map((args) => verifyOptions(args));
  assert.deepEqual(parsed.map((entry) => entry.mode), ['a model run', 'a model run']);
  assert.deepEqual(withoutOut(commands[0]), withoutOut(commands[1]));
  assert.notEqual(parsed[0].values.out, parsed[1].values.out);
});
