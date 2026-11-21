import assert from 'node:assert/strict';
import test from 'node:test';
import { objectAfter, phraseAfter, tokensOf } from '../../evals/e2e/clauses.mjs';

test('token offsets preserve dotted names, contractions, and quoted code', () => {
  const text = "I'll print `console.log` and the reviewer's code.";
  const tokens = tokensOf(text);
  assert.deepEqual(tokens.map(({ text }) => text), ["I'll", 'print', '`console.log`', 'and', 'the', "reviewer's", 'code', '.']);
  assert.equal(tokens[2].kind, 'code');
  for (const token of tokens) assert.equal(text.slice(token.start, token.end), token.text);
});

test('phrases stop before clause words, link words, and adverbs', () => {
  for (const text of ['time server.', 'time server from the cache', 'time server is ready', 'time server really', 'time server silently']) {
    const tokens = tokensOf(text);
    assert.deepEqual(phraseAfter(tokens, 0), { from: 0, to: 2, words: ['time', 'server'] }, text);
  }
});

test('object phrases separate compound agents and sources from time phrases and relatives', () => {
  const objects = [
    'the code returned by the time server.',
    'the code returned by the end node.',
    'the code returned by the time server, too.',
    'those codes returned by the time server.',
    'those codes returned by the end node.',
    'the code returned by the server.',
    'the code returned from the server.',
    'the code returned from the main server.',
    'the code returned from the `api` server.',
    'those codes returned from the server.',
    'these issues.',
    'these children.',
    'those findings.',
    'those people.',
    'those mice.',
    'those slugs.',
  ];
  const relatives = [
    'the reviewer flagged by the deadline.',
    'the reviewer flagged by the end of the day.',
    'the reviewer flagged by the time we ship.',
    'the reviewer flagged by the next release.',
    'the reviewer flagged by the weekend deadline.',
    'the reviewer flagged by the deadline anyway.',
    'the reviewer flagged by the time tests finish.',
    'the reviewer flagged by the time server tool.',
    'the reviewer flagged by the time tests are done.',
    'the code returned by the time server is up.',
    'the code returned by the end node really.',
    'the reviewer flagged from the start.',
    'the reviewer flagged from the diff.',
    'the reviewer noted from the review.',
    'the code returned from the beginning.',
    'the code returned from the very beginning.',
    'the code returned from the very start.',
    'the code returned from the early start.',
    'the code returned from the first start.',
    'the code returned from the very end.',
    'the code returned from the same time.',
    'the reviewer removed from the module.',
    'the code returned in the response.',
    'the code returned for the server.',
    'the code returned.',
    'those reviewers flagged by mistake.',
    'those reviewers are flagging.',
    'those reviewers flag.',
    'these.',
    'those always.',
    'that slug.',
    'that fail.',
  ];
  for (const text of objects) assert.equal(objectAfter(text).object, true, text);
  for (const text of relatives) assert.equal(objectAfter(text).object, false, text);
});
