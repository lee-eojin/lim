import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseOptions, summarizeTriggers, triggerArgs, triggerRecord } from '../../evals/review-loop/run-triggers.mjs';

const skillCall = (skill) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill } }] } });
const resultEvent = JSON.stringify({ type: 'result', subtype: 'success', total_cost_usd: 0.01 });

test('a trigger run that started review-loop and finished counts as started', () => {
  const record = triggerRecord({ id: 'gate', want: true, prompt: 'p' }, { stdout: [skillCall('review-loop:review-loop'), resultEvent].join('\n'), wallMs: 5 });
  assert.deepEqual([record.started, record.error], [true, undefined]);
});

test('a trigger run without a result event is an error, not a request that did not start the skill', () => {
  const record = triggerRecord({ id: 'gate', want: true, prompt: 'p' }, { stdout: '', stderr: 'Not logged in', code: 1, wallMs: 5 });
  assert.match(record.error, /Not logged in/);
  assert.deepEqual(summarizeTriggers([record]), { errors: 1, startedWhenWanted: 0, wanted: 0, startedWhenNotWanted: 0, notWanted: 0 });
});

test('trigger runs get the tools of a normal session and the plugin', () => {
  const args = triggerArgs('commit this', 'opus', '/plugins/review-loop');
  assert.equal(args.includes('--tools'), false);
  assert.deepEqual(args.slice(args.indexOf('--plugin-dir'), args.indexOf('--plugin-dir') + 2), ['--plugin-dir', '/plugins/review-loop']);
});

test('each trigger set has unique ids and requests that should and should not start review-loop', () => {
  for (const name of ['tuning', 'held-out']) {
    const requests = JSON.parse(readFileSync(new URL(`../../evals/review-loop/triggers/${name}.json`, import.meta.url), 'utf8'));
    assert.equal(new Set(requests.map((request) => request.id)).size, requests.length, `${name} ids are unique`);
    assert.ok(requests.some((request) => request.want === true) && requests.some((request) => request.want === false), `${name} has both kinds`);
    assert.ok(requests.every((request) => typeof request.prompt === 'string' && request.prompt.length > 0), `${name} prompts are text`);
  }
});

test('trigger options refuse a count that is not a whole number above 0', () => {
  for (const args of [['-j', '0'], ['--concurrency', 'two'], ['--timeout', '0']]) {
    assert.throws(() => parseOptions(args), /must be a whole number above 0/, args.join(' '));
  }
  assert.equal(parseOptions(['-j', '2', '--timeout', '60']).values.concurrency, '2');
  assert.equal(parseOptions(['--help', '-j', '0']).mode, 'help');
});
