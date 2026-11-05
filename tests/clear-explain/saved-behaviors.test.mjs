import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const results = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../evals/clear-explain/results/${name}`, import.meta.url)), 'utf8'));

test('An explanation opens with a paragraph that answers the question', () => {
  const items = results('2026-10-27-opus-after.json').items;
  assert.equal(items.length, 12);
  for (const item of items) {
    assert.equal(item.answers.with.score.opensWithAnswer, true, item.id);
  }
});

test('The skill starts for explanation questions without being named', () => {
  const summary = results('2026-10-27-opus-triggers.json').summary;
  assert.equal(summary.explain.prompts, 12);
  assert.equal(summary.explain.started, 12);
  assert.equal(summary.trueTriggerRate, 1);
});

test('The skill does not start for requests to fix or write code or text or to translate or to look up a fact', () => {
  const summary = results('2026-10-27-opus-triggers.json').summary;
  assert.equal(summary.other.prompts, 8);
  assert.equal(summary.other.started, 0);
  assert.equal(summary.falseTriggerRate, 0);
});

test('The skill starts for held-out explanation questions that the description was not written against', () => {
  const summary = results('2026-10-27-opus-held-out-triggers.json').summary;
  assert.equal(summary.explain.prompts, 8);
  assert.equal(summary.explain.started, 8);
  assert.equal(summary.trueTriggerRate, 1);
});

test('The skill does not start for held-out requests to review a diff or write tests or JSDoc or summarize or rename or continue or ask the date or the weather', () => {
  const summary = results('2026-10-27-opus-held-out-triggers.json').summary;
  assert.equal(summary.other.prompts, 11);
  assert.equal(summary.other.started, 0);
  assert.equal(summary.falseTriggerRate, 0);
});
