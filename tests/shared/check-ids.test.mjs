
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkIds } from '../../shared/check-ids.mjs';

function run(list, label, options) {
  const problems = [];
  const seen = checkIds(list, label, problems, options);
  return { seen: [...seen], problems };
}

test('checkIds reads a missing list as empty', () => {
  for (const list of [undefined, null]) assert.deepEqual(run(list, 'group'), { seen: [], problems: [] });
});

test('checkIds refuses a repeat under every label unless the caller allows repeats', () => {
  const list = [{ id: 'a' }, { id: 'a' }];
  for (const label of ['group', 'unknown']) assert.deepEqual(run(list, label).problems, [`${label} id a appears twice`]);
  assert.deepEqual(run(list, 'group', { allowRepeats: true }).problems, []);
});

test('allowing repeats does not allow a malformed id', () => {
  assert.deepEqual(run([{ id: 'A' }], 'unknown', { allowRepeats: true }).problems, ['unknown id "A" must match /^[a-z0-9][a-z0-9._-]*$/']);
});

test('checkIds returns every id it read, malformed or not, in list order', () => {
  assert.deepEqual(run([{ id: 'b' }, { id: 'Bad' }, {}, null, { id: 'b' }], 'group').seen, ['b', 'Bad', undefined]);
});
