import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALLOWED_TOOLS, SCENARIOS, buildSession, checkScenario, inOrder, parseEvents, reportShownAfter, scriptCall, sessionArgs,
} from '../../evals/e2e/run-sessions.mjs';

const WORK = '/tmp/cents-abc';
const LOOP = '/repo/plugins/review-loop/skills/review-loop/scripts/loop.mjs';
const VERIFY = '/repo/plugins/verify/skills/verify/scripts/verify.mjs';
const scenario = (name) => SCENARIOS.find((entry) => entry.name === name);

// A recorded stream: each step is [tool, input] or a string of assistant text; a third entry marks a subagent call.
function stream(steps, { denied = [], result = 'done' } = {}) {
  const events = [];
  steps.forEach((step, index) => {
    if (typeof step === 'string') {
      events.push({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: step }] } });
      return;
    }
    const [name, input, parent = null] = step;
    const id = `tool-${index}`;
    events.push({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'tool_use', id, name, input }] } });
    events.push({ type: 'user', parent_tool_use_id: parent, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: denied.includes(index) }] } });
  });
  events.push({ type: 'result', subtype: 'success', result, total_cost_usd: 1, permission_denials: denied.map((index) => ({ tool_use_id: `tool-${index}`, tool_name: 'Bash', tool_input: {} })) });
  return events;
}

const loop = (args) => ['Bash', { command: `node ${LOOP} ${args}` }];
const verify = (args) => ['Bash', { command: `node ${VERIFY} ${args}` }];
const reviewer = ['Agent', { subagent_type: 'review-loop:reviewer', prompt: 'round 1' }];
const fix = ['Edit', { file_path: `${WORK}/src/format.js`, old_string: 'a', new_string: 'b' }];

const happySteps = [
  ['Skill', { skill: 'review-loop:review-loop' }],
  loop('start --unattended'),
  reviewer,
  ['Read', { file_path: `${WORK}/src/format.js` }, 'tool-2'],
  ['Write', { file_path: `${WORK}/.lim-review/round-1.json`, content: '{}' }],
  loop('record --file .lim-review/round-1.json'),
  '```\nRound 1 of 3\n```',
  verify('run --id two-decimal-places'),
  '```\nfail\n```',
  loop('reproduce --id F-1'),
  fix,
  ['Write', { file_path: `${WORK}/test/padding.test.js`, content: 'test' }],
  loop('rule --id F-1 --draft test/padding.test.js'),
  verify('run --id two-decimal-places'),
  loop('next'),
  reviewer,
  loop('record --file .lim-review/round-2.json'),
  '```\nRound 2 of 3\n```',
  loop('summary'),
  '```\nSince ...\n```',
];

const happyRepository = {
  workDir: WORK,
  ledger: [
    { event: 'start', unattended: true },
    { event: 'record', round: 1, decision: 'continue' },
    { event: 'reproduce', id: 'F-1', check: 'two-decimal-places', status: 'fail' },
    { event: 'regression', id: 'F-1', proof: 'caught' },
    { event: 'next', round: 2 },
    { event: 'record', round: 2, decision: 'stop', reason: 'clean' },
  ],
  reviewState: {
    resolved: [{ id: 'F-1', severity: 'P1', title: 'Cents lose their leading zero', reproduced: { check: 'two-decimal-places', evidencePath: '.git/lim/verify/runs/a.json', reasons: ['stdout does not equal "$0.05"'] }, rerun: { status: 'pass' } }],
    open: [],
  },
  verify: { runs: 2, latest: { 'two-decimal-places': { status: 'pass' } } },
  changedFiles: ['README.md', 'bin/cents.js', 'src/format.js', 'test/padding.test.js'],
  commits: 1,
};

const outcome = (results, id) => results.find((item) => item.id === id);

test('script calls are labeled by script and arguments, and a command with anything before node is not one', () => {
  assert.deepEqual(scriptCall(`node ${LOOP} start --unattended`), { script: 'loop', path: LOOP, args: 'start --unattended' });
  assert.equal(scriptCall(`cd /tmp && node ${LOOP} start`), null);
  assert.equal(scriptCall('npm test'), null);
});

test('a session that follows review-loop and verify end to end passes every expectation', () => {
  const results = checkScenario(scenario('review-with-verify'), buildSession(stream(happySteps), happyRepository));
  assert.deepEqual(results.filter((item) => !item.pass), []);
  assert.match(outcome(results, 'reproduce-fix-rerun-order').evidence, /loop reproduce --id F-1 -> #\d+ Edit src\/format\.js/);
});

test('a fix made before the verify reproduction fails the order expectation and names where it stopped', () => {
  const fixFirst = happySteps.filter((step) => step !== fix);
  fixFirst.splice(fixFirst.indexOf(happySteps[7]), 0, fix);
  const results = checkScenario(scenario('review-with-verify'), buildSession(stream(fixFirst), happyRepository));
  const order = outcome(results, 'reproduce-fix-rerun-order');
  assert.equal(order.pass, false);
  assert.match(order.evidence, /loop reproduce --id F-1; then no step matches/);
});

test('subagent tool calls stay out of the main sequence', () => {
  const session = buildSession(stream(happySteps), happyRepository);
  assert.equal(session.steps.some((step) => step.label === 'Read src/format.js'), false);
  assert.deepEqual(session.subagentSteps.map((step) => step.label), ['Read src/format.js']);
});

test('an unattended run that asks the user, commits, or ends without loop summary fails those expectations', () => {
  const steps = [...happySteps.slice(0, -2), ['AskUserQuestion', { questions: [] }], ['Bash', { command: 'git commit -m wip' }]];
  const results = checkScenario(scenario('review-with-verify'), buildSession(stream(steps, { denied: [steps.length - 1] }), happyRepository));
  assert.equal(outcome(results, 'no-question').pass, false);
  assert.equal(outcome(results, 'no-commit-or-push').pass, false);
  assert.match(outcome(results, 'ends-with-summary').evidence, /last loop command: loop record/);
});

test('a resolved finding whose verify check never passed on the fixed code is not resolved as measured', () => {
  const repository = { ...happyRepository, reviewState: { resolved: [{ ...happyRepository.reviewState.resolved[0], rerun: undefined }] } };
  const result = outcome(checkScenario(scenario('review-with-verify'), buildSession(stream(happySteps), repository)), 'resolved-measured');
  assert.equal(result.pass, false);
  assert.match(result.evidence, /rerun none/);
});

test('a report counts as shown first only when the next text opens a code block before any other tool runs', () => {
  const shown = buildSession(stream([verify('run'), '```\nreport\n```']));
  const late = buildSession(stream([verify('run'), ['Read', { file_path: 'x' }], '```\nreport\n```']));
  const prose = buildSession(stream([verify('run'), 'All three checks passed.']));
  assert.equal(reportShownAfter(shown, /^verify run/).pass, true);
  assert.equal(reportShownAfter(late, /^verify run/).pass, false);
  assert.equal(reportShownAfter(prose, /^verify run/).pass, false);
});

test('the checks scenario accepts a checks P1 as its own proof and rejects another fixed P2 without a regression step', () => {
  const checksOnly = {
    ...happyRepository,
    reviewState: { resolved: [{ id: 'F-1', severity: 'P1', fromChecks: true, title: 'test failed' }], open: [] },
  };
  const steps = [['Skill', { skill: 'review-loop:review-loop' }], loop('start --unattended')];
  const regression = (repository) => outcome(checkScenario(scenario('failing-check'), buildSession(stream(steps), repository)), 'regression-or-reason');
  assert.equal(regression(checksOnly).pass, true);
  const withP2 = { ...checksOnly, ledger: [], reviewState: { resolved: [...checksOnly.reviewState.resolved, { id: 'F-2', severity: 'P2', title: 'trailing hyphen' }] } };
  assert.match(regression(withP2).evidence, /no regression entry for F-2/);
});

test('an explanation with a forbidden character or a transliterated concept fails', () => {
  const answer = (text) => checkScenario(scenario('explain-korean'), buildSession(stream([['Skill', { skill: 'clear-explain:clear-explain' }]], { result: text }), { changedFiles: [] }));
  const clean = answer('closure는 함수가 만들어진 scope의 변수를 기억하는 함수입니다.');
  assert.deepEqual(clean.filter((item) => !item.pass), []);
  const dash = answer(`closure는 함수입니다${String.fromCharCode(0x2014)}변수를 기억합니다.`);
  assert.match(outcome(dash, 'no-forbidden-chars').evidence, /U\+2014/);
  assert.equal(outcome(answer('클로저(closure)는 함수입니다.'), 'closure-in-english').pass, false);
});

test('in order matching needs each pattern after the previous match', () => {
  const steps = [{ label: 'loop next' }, { label: 'loop start' }];
  assert.equal(inOrder(steps, [/^loop start/, /^loop next/]).pass, false);
  assert.equal(inOrder(steps, [/^loop next/, /^loop start/]).pass, true);
});

test('sessions load all three plugins with no user settings and allow Bash only for the skills\' scripts', () => {
  const args = sessionArgs(scenario('verify-tool'), 'claude-opus-5-5');
  for (const flag of ['--strict-mcp-config', '--no-session-persistence']) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf('--setting-sources') + 1], '');
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.equal(args.filter((arg) => arg === '--plugin-dir').length, 3);
  const bash = ALLOWED_TOOLS.filter((tool) => tool.startsWith('Bash'));
  assert.equal(bash.length, 3);
  assert.ok(bash.every((tool) => /^Bash\(node (?:[A-Za-z]:)?\/.+\/scripts\/[\w-]+\.mjs:\*\)$/.test(tool)), bash.join(', '));
});

test('a truncated last line of a stream is dropped, not fatal', () => {
  assert.equal(parseEvents('{"type":"result"}\n{"type":"assis').length, 1);
});
