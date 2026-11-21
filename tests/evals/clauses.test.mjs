import assert from 'node:assert/strict';
import test from 'node:test';
import { leadStarts, tokensOf } from '../../evals/e2e/clauses.mjs';

test('a so lead starts an own-voice clause only outside a double-quoted span', () => {
  assert.deepEqual(leadStarts('It was minor, so I will.'), [16]);
  assert.deepEqual(leadStarts('He said "it was minor", so I will.'), [26]);
  assert.deepEqual(leadStarts('He said “it is minor, so I will” now.'), []);
  assert.deepEqual(leadStarts('He said "it is minor, so I will" so we can.'), [35]);
  assert.deepEqual(leadStarts("He said 'it is minor, so I will'."), [24]);
  assert.deepEqual(leadStarts('Also, soon we can.'), []);
  assert.deepEqual(leadStarts('He said " it is minor, so I will.'), []);
  assert.deepEqual(leadStarts('He said “ it is minor, so I will.'), []);
});

test('quotes open and close by side, and an apostrophe stays part of its word', () => {
  const kinds = (text) => tokensOf(text).filter((token) => token.kind !== 'word').map(({ kind, text }) => `${kind}:${text}`);
  assert.deepEqual(kinds("say 'x' and ‘y’ and \"z\" and “w”"), ["open:'", "close:'", 'open:‘', 'close:’', 'open:"', 'close:"', 'open:“', 'close:”']);
  assert.deepEqual(kinds("I'll fix the reviewers' note."), ["punct:'", 'punct:.']);
  assert.deepEqual(kinds("the reviewers'."), ["punct:'", 'punct:.']);
  assert.deepEqual(kinds("say 'b ' c"), ["open:'", "punct:'"]);
  assert.deepEqual(tokensOf('a "b c" d').map((token) => token.spoken), [false, false, true, true, false, false]);
});
