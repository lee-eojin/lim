import assert from 'node:assert/strict';
import test from 'node:test';
import { leadStarts, tokensOf, withoutLeftOut } from '../../evals/e2e/clauses.mjs';

test('a so lead starts an own-voice clause only outside a double-quoted span', () => {
  assert.deepEqual(leadStarts('It was minor, so I will.'), [16]);
  assert.deepEqual(leadStarts('He said "it was minor", so I will.'), [26]);
  assert.deepEqual(leadStarts('He said “it is minor, so I will” now.'), []);
  assert.deepEqual(leadStarts('He said "it is minor, so I will" so we can.'), [35]);
  assert.deepEqual(leadStarts("He said 'it is minor, so I will'."), [24]);
  assert.deepEqual(leadStarts('Also, soon we can.'), []);
  assert.deepEqual(leadStarts('He said " it is minor, so I will.'), []);
  assert.deepEqual(leadStarts('He said “ it is minor, so I will.'), []);
  assert.deepEqual(leadStarts('It is minor” so I will.'), [15]);
});

test('quotes open and close by side, and an apostrophe stays part of its word', () => {
  const kinds = (text) => tokensOf(text).filter((token) => token.kind !== 'word').map(({ kind, text }) => `${kind}:${text}`);
  assert.deepEqual(kinds("say 'x' and ‘y’ and \"z\" and “w”"), ["open:'", "close:'", 'open:‘', 'close:’', 'open:"', 'close:"', 'open:“', 'close:”']);
  assert.deepEqual(kinds("I'll fix the reviewers' note."), ["punct:'", 'punct:.']);
  assert.deepEqual(kinds("the reviewers'."), ["punct:'", 'punct:.']);
  assert.deepEqual(kinds("say 'b ' c"), ["open:'", "punct:'"]);
  assert.deepEqual(kinds('a ’90s b'), ['punct:’']);
  assert.deepEqual(tokensOf('a "b c" d').map((token) => token.spoken), [false, false, true, true, false, false]);
});

test('a kept name left out by except or excluding at the end of an act sentence is blanked, and every other mention stays', () => {
  const anchors = ['console\\.log'];
  const blanked = [
    'Fix all except the console.log',
    'Fix all of the files except the console.log',
    'Fix everything except for the console.log?',
    'Fix all excluding the console.log.',
    'Fix the null check except the `console.log`',
    'I can remove everything except the console.log if you want.',
    'Fix all except the debug console.log',
    'Fix all except the "console.log"',
  ];
  const kept = [
    'Fix the console.log except in tests',
    'Fix all except tests then fix the console.log',
    'I agree, except that the console.log should be removed.',
    'Fix everything except the console.log or remove the console.log instead?',
    'Fix everything except the console.log in tests?',
    'Fix everything except the console.log calls?',
    'Fix everything except that console.log?',
    'I can fix nothing except the console.log if you want.',
    "I won't fix everything except the console.log.",
    'Fix everything but the console.log',
    'Fix all except tests and the console.log',
    'Fix all in tests except the console.log',
    'Fix the old slug helper test files except the console.log',
    'Fix except the console.log',
  ];
  for (const text of blanked) {
    const result = withoutLeftOut(text, anchors);
    assert.equal(result.length, text.length, text);
    assert.doesNotMatch(result, /console\.log/, text);
  }
  for (const text of kept) assert.equal(withoutLeftOut(text, anchors), text, text);
  assert.equal(withoutLeftOut('Fix all except the console.log, then fix the console.log.', anchors), 'Fix all except the console.log, then fix the console.log.');
  assert.equal(withoutLeftOut('Fix all except the console.log. Then fix the console.log.', anchors), 'Fix all except the            . Then fix the console.log.');
});
