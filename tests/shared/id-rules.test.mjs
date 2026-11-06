
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { validate as validateMap } from '../../plugins/gap-map/skills/gap-map/scripts/gapmap.mjs';
import { validate as validateLedger } from '../../plugins/ledger/skills/ledger/scripts/ledger.mjs';

const root = tmpdir();
const rule = '/^[a-z0-9][a-z0-9._-]*$/';

const group = { id: 'g' };
const region = { id: 'r' };
const stage = { id: 's', label: 'S', group: 'g' };
const obligation = { id: 'o', stage: 's', claim: 'c', cases: ['positive'], authority: 'read' };
const question = { id: 'q', question: 'Q', needs: 'static' };
const claim = { id: 'c', question: 'q', statement: 's', kind: 'observed', evidence: [{ file: 'a' }] };
const unknown = { id: 'u', question: 'q', revision: 1, state: 'open', probe: 'p' };

const mapProblems = (fields) => validateMap({ target: 't', goal: 'g', groups: [group], stages: [stage], edges: [], obligations: [], ...fields }, root);
const ledgerProblems = (fields) => validateLedger({ subject: 's', questions: [question], claims: [], ...fields }, root);

test('gap-map refuses a repeated id in each of its lists', () => {
  assert.deepEqual(mapProblems({ groups: [group, group] }), ['group id g appears twice']);
  assert.deepEqual(mapProblems({ regions: [region, region] }), ['region id r appears twice']);
  assert.deepEqual(mapProblems({ stages: [stage, stage] }), ['stage id s appears twice']);
  assert.deepEqual(mapProblems({ obligations: [obligation, obligation] }), ['obligation id o appears twice']);
});

test('ledger refuses a repeated question or claim id', () => {
  assert.deepEqual(ledgerProblems({ questions: [question, question] }), ['question id q appears twice']);
  assert.deepEqual(ledgerProblems({ claims: [claim, claim] }), ['claim id c appears twice']);
});

test('ledger accepts a repeated unknown id', () => {
  assert.deepEqual(ledgerProblems({ unknowns: [unknown, { ...unknown, revision: 2 }] }), []);
});

test('a malformed unknown id is refused each time it appears', () => {
  const problem = `unknown id "U" must match ${rule}`;
  assert.deepEqual(ledgerProblems({ unknowns: [{ ...unknown, id: 'U' }, { ...unknown, id: 'U' }] }), [problem, problem]);
});

test('an id that is not a string is refused with its JSON form', () => {
  assert.deepEqual(mapProblems({ regions: [{}, { id: 5 }, null] }), [
    `region id undefined must match ${rule}`,
    `region id 5 must match ${rule}`,
    `region id undefined must match ${rule}`,
  ]);
});

test('a reference to a malformed id is not also reported as missing', () => {
  assert.deepEqual(mapProblems({ groups: [{ id: 'BAD' }], stages: [{ ...stage, group: 'BAD' }] }), [`group id "BAD" must match ${rule}`]);
  assert.deepEqual(ledgerProblems({ questions: [{ ...question, id: 'Q' }], claims: [{ ...claim, question: 'Q' }] }), [`question id "Q" must match ${rule}`]);
});

test('a list that is not a list stops ledger before any id is read', () => {
  for (const value of [null, 5]) {
    assert.deepEqual(ledgerProblems({ questions: value }), ['questions must be a list']);
    assert.deepEqual(ledgerProblems({ claims: value }), ['claims must be a list']);
    assert.deepEqual(ledgerProblems({ unknowns: value }), ['unknowns must be a list']);
  }
});

test('gap-map reads a null regions list as empty', () => {
  assert.deepEqual(mapProblems({ regions: null }), []);
});

test('today a gap-map whose regions is not a list throws TypeError from checkIds', () => {
  assert.throws(() => mapProblems({ regions: 5 }), (error) => {
    assert.equal(error instanceof TypeError, true);
    assert.match(error.stack, /checkIds/);
    assert.match(error.stack, /_shared\/check-ids\.mjs/);
    return true;
  });
});
