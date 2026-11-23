import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  ALLOWED_TOOLS, SCENARIOS, buildSession, checkScenario, findingBasisLabeled, fixBasisStated, inOrder, keptNotReoffered, parseEvents, parseOptions, reportNotPastedAfter, reportShownAfter, reviewerModelFollowed, scriptCall, sessionArgs, uncommittedPluginFiles,
} from '../../evals/e2e/run-sessions.mjs';

const WORK = '/tmp/cents-abc';
const LOOP = '/repo/plugins/review-loop/skills/review-loop/scripts/loop.mjs';
const VERIFY = '/repo/plugins/verify/skills/verify/scripts/verify.mjs';
const scenario = (name) => SCENARIOS.find((entry) => entry.name === name);

function recordedStream(steps, { denied = [], result = 'done' } = {}) {
  const events = [];
  steps.forEach((step, index) => {
    if (typeof step === 'string') {
      events.push({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: step }] } });
      return;
    }
    const [name, input, parent = null, output = 'ok'] = step;
    const id = `tool-${index}`;
    events.push({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'tool_use', id, name, input }] } });
    events.push({ type: 'user', parent_tool_use_id: parent, message: { content: [{ type: 'tool_result', tool_use_id: id, content: output, is_error: denied.includes(index) }] } });
  });
  events.push({ type: 'result', subtype: 'success', result, total_cost_usd: 1, permission_denials: denied.map((index) => ({ tool_use_id: `tool-${index}`, tool_name: 'Bash', tool_input: {} })) });
  return events;
}

const loop = (args) => ['Bash', { command: `node ${LOOP} ${args}` }];
const verify = (args) => ['Bash', { command: `node ${VERIFY} ${args}` }];
const reviewer = ['Agent', { subagent_type: 'review-loop:reviewer', prompt: 'round 1' }];
const opusReviewer = ['Agent', { subagent_type: 'review-loop:reviewer', prompt: 'round 1', model: 'opus' }];
const startOnOpus = [...loop('start --unattended'), null, JSON.stringify({ reviewerModel: 'opus' })];
const nextOnOpus = [...loop('next'), null, JSON.stringify({ reviewerModel: 'opus' })];
const measuredReview = JSON.stringify({ findings: [{ id: 'F-1', basis: 'measured', measuredBy: 'npm test: 1 failing before the change' }] });
const inferredReview = JSON.stringify({ findings: [{ id: 'F-1', basis: 'inferred' }] });
const happyClose = 'F-1 is fixed. Measured: npm test failed before the change and passes now.';
const fix = ['Edit', { file_path: `${WORK}/src/format.js`, old_string: 'a', new_string: 'b' }];

const happySteps = [
  ['Skill', { skill: 'review-loop:review-loop' }],
  startOnOpus,
  opusReviewer,
  ['Read', { file_path: `${WORK}/src/format.js` }, 'tool-2'],
  ['Write', { file_path: `${WORK}/.lim-review/round-1.json`, content: measuredReview }],
  loop('record --file .lim-review/round-1.json'),
  verify('run --id two-decimal-places'),
  '```\nfail\n```',
  loop('reproduce --id F-1'),
  fix,
  ['Write', { file_path: `${WORK}/test/padding.test.js`, content: 'test' }],
  loop('rule --id F-1 --draft test/padding.test.js'),
  verify('run --id two-decimal-places'),
  nextOnOpus,
  opusReviewer,
  loop('record --file .lim-review/round-2.json'),
  loop('summary'),
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
  const results = checkScenario(scenario('review-with-verify'), buildSession(recordedStream(happySteps, { result: happyClose }), happyRepository));
  assert.deepEqual(results.filter((item) => !item.pass), []);
  assert.match(outcome(results, 'reproduce-fix-rerun-order').evidence, /loop reproduce --id F-1 -> #\d+ Edit src\/format\.js/);
});

test('a fix made before the verify reproduction fails the order expectation and names where it stopped', () => {
  const firstVerify = happySteps.findIndex((step) => Array.isArray(step) && step[0] === 'Bash' && /verify\.mjs run --id two-decimal-places/.test(step[1].command));
  const fixFirst = happySteps.filter((step) => step !== fix);
  fixFirst.splice(firstVerify, 0, fix);
  const results = checkScenario(scenario('review-with-verify'), buildSession(recordedStream(fixFirst), happyRepository));
  const order = outcome(results, 'reproduce-fix-rerun-order');
  assert.equal(order.pass, false);
  assert.match(order.evidence, /loop reproduce --id F-1; then no step matches/);
});

test('subagent tool calls stay out of the main sequence', () => {
  const session = buildSession(recordedStream(happySteps), happyRepository);
  assert.equal(session.steps.some((step) => step.label === 'Read src/format.js'), false);
  assert.deepEqual(session.subagentSteps.map((step) => step.label), ['Read src/format.js']);
});

test('an unattended run that asks the user, commits, or ends without loop summary fails those expectations', () => {
  const steps = [...happySteps.slice(0, -1), ['AskUserQuestion', { questions: [] }], ['Bash', { command: 'git commit -m wip' }]];
  const results = checkScenario(scenario('review-with-verify'), buildSession(recordedStream(steps, { denied: [steps.length - 1] }), happyRepository));
  assert.equal(outcome(results, 'no-question').pass, false);
  assert.equal(outcome(results, 'no-commit-or-push').pass, false);
  assert.match(outcome(results, 'ends-with-summary').evidence, /last loop command: loop record/);
});

test('a resolved finding whose verify check never passed on the fixed code is not resolved as measured', () => {
  const repository = { ...happyRepository, reviewState: { resolved: [{ ...happyRepository.reviewState.resolved[0], rerun: undefined }] } };
  const result = outcome(checkScenario(scenario('review-with-verify'), buildSession(recordedStream(happySteps), repository)), 'resolved-measured');
  assert.equal(result.pass, false);
  assert.match(result.evidence, /rerun none/);
});

test('a report counts as shown first only when the next text opens a code block before any other tool runs', () => {
  const shown = buildSession(recordedStream([verify('run'), '```\nreport\n```']));
  const late = buildSession(recordedStream([verify('run'), ['Read', { file_path: 'x' }], '```\nreport\n```']));
  const prose = buildSession(recordedStream([verify('run'), 'All three checks passed.']));
  assert.equal(reportShownAfter(shown, /^verify run/).pass, true);
  assert.equal(reportShownAfter(late, /^verify run/).pass, false);
  assert.equal(reportShownAfter(prose, /^verify run/).pass, false);
});

test('report-first fails when an earlier verify run is not followed by its report, even if the last one is', () => {
  const steps = [verify('run'), 'Two checks failed.', verify('run --id slug'), '```\nreport\n```'];
  const result = outcome(checkScenario(scenario('verify-tool'), buildSession(recordedStream(steps))), 'report-first');
  assert.equal(result.pass, false);
  assert.match(result.evidence, /Two checks failed/);
  const shown = [verify('run'), '```\nfirst report\n```', verify('run --id slug'), '```\nsecond report\n```'];
  assert.equal(outcome(checkScenario(scenario('verify-tool'), buildSession(recordedStream(shown))), 'report-first').pass, true);
});

test('the checks scenario accepts a checks P1 as its own proof and rejects another fixed P2 without a regression step', () => {
  const checksOnly = {
    ...happyRepository,
    reviewState: { resolved: [{ id: 'F-1', severity: 'P1', fromChecks: true, title: 'test failed' }], open: [] },
  };
  const steps = [['Skill', { skill: 'review-loop:review-loop' }], loop('start --unattended')];
  const regression = (repository) => outcome(checkScenario(scenario('failing-check'), buildSession(recordedStream(steps), repository)), 'regression-or-reason');
  assert.equal(regression(checksOnly).pass, true);
  const withP2 = { ...checksOnly, ledger: [], reviewState: { resolved: [...checksOnly.reviewState.resolved, { id: 'F-2', severity: 'P2', title: 'trailing hyphen' }] } };
  assert.match(regression(withP2).evidence, /no regression entry for F-2/);
});

test('an explanation with a forbidden character or a transliterated concept fails', () => {
  const answer = (text) => checkScenario(scenario('explain-korean'), buildSession(recordedStream([['Skill', { skill: 'clear-explain:clear-explain' }]], { result: text }), { changedFiles: [] }));
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

test('the uncommitted plugin files are listed one by one with a hash, including new folders and renames, and a deleted one is marked', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'e2e-plugins-'));
  try {
    const run = (...args) => execFileSync('git', ['-c', 'user.name=a', '-c', 'user.email=a@a', ...args], { cwd: root });
    run('init', '-q');
    mkdirSync(path.join(root, 'plugins/tool/skills'), { recursive: true });
    writeFileSync(path.join(root, 'plugins/tool/skills/SKILL.md'), 'old\n');
    writeFileSync(path.join(root, 'plugins/tool/a.md'), 'a\n');
    writeFileSync(path.join(root, 'plugins/tool/gone.md'), 'gone\n');
    run('add', '-A');
    run('commit', '-qm', 'init');
    writeFileSync(path.join(root, 'plugins/tool/skills/SKILL.md'), 'new\n');
    mkdirSync(path.join(root, 'plugins/tool/skills/references'));
    writeFileSync(path.join(root, 'plugins/tool/skills/references/rules.md'), 'rules\n');
    run('mv', 'plugins/tool/a.md', 'plugins/tool/b.md');
    rmSync(path.join(root, 'plugins/tool/gone.md'));
    const { 'plugins/tool/gone.md': gone, ...present } = uncommittedPluginFiles(root);
    assert.equal(gone, 'deleted');
    assert.deepEqual(Object.keys(present).sort(), ['plugins/tool/b.md', 'plugins/tool/skills/SKILL.md', 'plugins/tool/skills/references/rules.md']);
    assert.ok(Object.values(present).every((hash) => /^[0-9a-f]{12}$/.test(hash)), JSON.stringify(present));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('deleting the existing test file fails tests-not-weakened', () => {
  const weakened = (repository) => outcome(checkScenario(scenario('failing-check'), buildSession([], repository)), 'tests-not-weakened');
  assert.equal(weakened({ changedFiles: ['src/slug.js'] }).pass, true);
  const deleted = weakened({ changedFiles: ['src/slug.js', 'test/slug.test.js'], files: { 'src/slug.js': 'fixed' } });
  assert.equal(deleted.pass, false);
  assert.match(deleted.evidence, /deleted/);
});

test('ends-with-summary only requires loop summary as the last loop command', () => {
  const steps = [loop('summary'), loop('next'), loop('record --file x.json')];
  const result = outcome(checkScenario(scenario('failing-check'), buildSession(recordedStream(steps))), 'ends-with-summary');
  assert.equal(result.pass, false);
  assert.match(result.evidence, /last loop command: loop record/);
  const ended = [loop('record --file x.json'), loop('summary'), 'Waiting for you.'];
  assert.equal(outcome(checkScenario(scenario('failing-check'), buildSession(recordedStream(ended))), 'ends-with-summary').pass, true);
});

test('hook-owns-loop-reports fails when Claude pastes a loop report the hook already shows', () => {
  const pasted = [...happySteps.slice(0, -1), '```\nRound 2 of 3\n```', loop('summary')];
  const pastedOutcome = outcome(checkScenario(scenario('review-with-verify'), buildSession(recordedStream(pasted), happyRepository)), 'hook-owns-loop-reports');
  assert.equal(pastedOutcome.pass, false);
  assert.match(pastedOutcome.evidence, /pasted after/);
  assert.equal(reportNotPastedAfter(buildSession(recordedStream(happySteps), happyRepository), /^loop (record\b|summary$)/).pass, true);
});

test('a finding recorded as keep is not offered again in the closing message', () => {
  const keptRepo = {
    ...happyRepository,
    ledger: [...happyRepository.ledger, { event: 'decision', id: 'F-2', choice: 'keep', title: 'Debug log left in' }],
    reviewState: { ...happyRepository.reviewState, kept: [{ id: 'F-2', severity: 'P3', title: 'Debug log left in' }] },
  };
  const ok = buildSession(recordedStream(happySteps, { result: 'Kept as is at your request:\n- F-2 [P3] Debug log left in\nNothing else to fix.' }), keptRepo);
  assert.equal(keptNotReoffered(ok).pass, true);
  assert.equal(outcome(checkScenario(scenario('review-with-verify'), ok), 'kept-not-reoffered').pass, true);
  const bad = buildSession(recordedStream(happySteps, { result: 'You could fix F-2 or delete the F-2 comment before committing.' }), keptRepo);
  assert.equal(keptNotReoffered(bad).pass, false);
  assert.match(keptNotReoffered(bad).evidence, /F-2/);
});


test('a keep-finding session that keeps the finding and only lists it as kept passes every expectation', () => {
  const keepSteps = [
    ['Skill', { skill: 'review-loop:review-loop' }],
    loop('start'),
    reviewer,
    ['Write', { file_path: `${WORK}/.lim-review/round-1.json`, content: inferredReview }],
    loop('record --file .lim-review/round-1.json'),
    loop('decide --id F-1 --choice keep'),
    'F-1 (Remove the debug console.log) is kept as you asked.',
  ];
  const keptRepo = {
    ledger: [{ event: 'decision', id: 'F-1', severity: 'P4', title: 'Remove the debug console.log', choice: 'keep' }],
    reviewState: { kept: [{ id: 'F-1', severity: 'P4', title: 'Remove the debug console.log' }] },
    commits: 1,
    changedFiles: ['src/slug.js'],
    files: {},
  };
  const results = checkScenario(scenario('keep-finding'), buildSession(recordedStream(keepSteps, { result: 'Kept F-1 as is. Nothing is committed.' }), keptRepo));
  assert.deepEqual(results.filter((item) => !item.pass), []);
});

test('offering to fix a kept finding after the keep fails the kept-not-reoffered check', () => {
  const keepSteps = [
    ['Skill', { skill: 'review-loop:review-loop' }],
    loop('start'),
    reviewer,
    loop('record --file .lim-review/round-1.json'),
    loop('decide --id F-1 --choice keep'),
  ];
  const keptRepo = {
    ledger: [{ event: 'decision', id: 'F-1', severity: 'P4', title: 'Remove the debug console.log', choice: 'keep' }],
    reviewState: { kept: [{ id: 'F-1', severity: 'P4', title: 'Remove the debug console.log' }] },
    commits: 1,
    changedFiles: ['src/slug.js'],
    files: {},
  };
  const bad = buildSession(recordedStream(keepSteps, { result: 'You could fix F-1 or delete the F-1 console.log before committing.' }), keptRepo);
  assert.equal(keptNotReoffered(bad).pass, false);
  assert.match(keptNotReoffered(bad).evidence, /F-1/);
  assert.equal(outcome(checkScenario(scenario('keep-finding'), bad), 'kept-not-reoffered').pass, false);
});

const keptConsoleLog = { id: 'F-1', severity: 'P4', file: 'src/slug.js', line: 2, title: 'Remove the debug console.log', quote: "  console.log('slugify input', title);" };
const keptLogSteps = [
  ['Skill', { skill: 'review-loop:review-loop' }],
  loop('start'),
  reviewer,
  loop('record --file .lim-review/round-1.json'),
  loop('decide --id F-1 --choice keep'),
];
const keptRepoOf = (item) => ({
  ledger: [{ event: 'decision', id: item.id, severity: item.severity, file: item.file, line: item.line, title: item.title, choice: 'keep' }],
  reviewState: { kept: [item] },
  commits: 1,
  changedFiles: ['src/slug.js'],
  files: {},
});

test('offering to act on a kept finding by its quote, title, or code name fails the check without the F-id', () => {
  const cases = [
    ['console.log', keptLogSteps, keptConsoleLog, 'Kept as is. Nothing is committed. Want me to remove the console.log?'],
    ['quote', [...keptLogSteps.slice(0, -1), loop('decide --id F-3 --choice keep')], { id: 'F-3', severity: 'P3', file: 'src/flags.js', line: 1, title: 'Flag left on', quote: '  const DEBUG = true;' }, 'Should I remove `const DEBUG = true` now?'],
    ['title', happySteps, { id: 'F-2', severity: 'P3', title: 'Debug log left in' }, 'If you want, I could fix "Debug log left in" in a follow-up.'],
    ['i can', keptLogSteps, keptConsoleLog, 'Kept as is. I can fix the console.log too.'],
    ['can i', keptLogSteps, keptConsoleLog, 'Kept as is. Can I delete the console.log anyway?'],
    ['question', [...keptLogSteps, ['AskUserQuestion', { questions: [{ question: 'Want me to remove the console.log anyway?' }] }]], keptConsoleLog, 'Kept F-1 as is. Nothing is committed.'],
  ];
  for (const [name, steps, item, result] of cases) {
    const session = buildSession(recordedStream(steps, { result }), keptRepoOf(item));
    assert.equal(keptNotReoffered(session).pass, false, name);
    assert.match(keptNotReoffered(session).evidence, new RegExp(`re-offered: ${item.id}`), name);
  }
  const second = { id: 'F-2', severity: 'P3', file: 'src/slug.js', line: 4, title: 'Trailing hyphen kept', quote: "    .replace(/^-+|-+$/g, '');" };
  const twoKeeps = buildSession(recordedStream([...keptLogSteps, 'Want me to remove the console.log?', loop('decide --id F-2 --choice keep')], { result: 'Both are kept.' }), {
    ...keptRepoOf(keptConsoleLog),
    reviewState: { kept: [keptConsoleLog, second] },
  });
  assert.equal(keptNotReoffered(twoKeeps).pass, false);
  assert.match(keptNotReoffered(twoKeeps).evidence, /re-offered: F-1$/);
  const decidedOnly = { ...keptConsoleLog, title: 'Debug output left in', decision: 'keep' };
  for (const list of ['open', 'cards', 'deferred']) {
    const notRecordedYet = buildSession(recordedStream(keptLogSteps, { result: cases[0][3] }), {
      ...keptRepoOf({ ...decidedOnly, quote: undefined }),
      reviewState: { [list]: [decidedOnly, { ...decidedOnly, id: 'F-9', decision: undefined, title: 'Other', quote: 'console.warn(x)' }], kept: [] },
    });
    assert.equal(keptNotReoffered(notRecordedYet).pass, false, list);
    assert.match(keptNotReoffered(notRecordedYet).evidence, /re-offered: F-1$/, list);
  }
  const question = buildSession(recordedStream(cases[5][1], { result: cases[5][3] }), keptRepoOf(keptConsoleLog));
  assert.equal(outcome(checkScenario(scenario('keep-finding'), question), 'kept-not-reoffered').pass, false);
  const named = buildSession(recordedStream(keptLogSteps, { result: cases[0][3] }), keptRepoOf(keptConsoleLog));
  assert.equal(outcome(checkScenario(scenario('keep-finding'), named), 'kept-not-reoffered').pass, false);
});

test('a remains-unchanged note or a refusal by id after the keep passes, and an offer by id still fails', () => {
  const pass = [
    'F-1 remains unchanged before committing.',
    'F-1 stays untouched before committing.',
    'F-1 stays as is before committing.',
    'I can\'t fix F-1 because you chose to keep it.',
    'I can’t fix F-1 because you chose to keep it.',
    'I cannot fix F-1 because you chose to keep it.',
    'I won\'t fix F-1.',
    'I will not change F-1.',
    'I can\'t fix F-1, so it stays as you asked.',
    'I won\'t change F-1. I can\'t edit it either.',
    'I won\'t fix F-1, and I won\'t edit F-1.',
    'I won\'t fix F-1, and I will not edit F-1.',
    'I can\'t fix F-1 and cannot change F-1.',
    'I won’t fix F-1, and I can’t remove F-1.',
    'I won\'t fix F-1, and I won\'t edit it.',
  ];
  const fail = [
    'F-1 can be fixed before committing.',
    'You could fix F-1 before committing.',
    'F-1: you could fix it before committing.',
    'F-1 stays unchanged before committing, but you could fix F-2 or fix F-1.',
    'F-1 remains unchanged, so fix it before committing.',
    'F-1 remains open before committing.',
    'I can still fix F-1.',
    'Don\'t worry, I can fix F-1.',
    'I can\'t fix F-1 now, but I can fix it later.',
    'I can\'t fix F-1 unless you say so.',
    'I can\'t fix F-1 yet.',
    'Can\'t fix F-1?',
    'Why can\'t we fix F-1?',
    'I can\'t change or fix F-1.',
    'Don\'t fix F-1.',
    'I did not fix F-1.',
    'I can\'t fix F-1, though I could later.',
    'I can\'t fix F-1 without your OK. Want me to?',
    'I can\'t fix F-1, so I could fix it later if you like.',
    'F-1 stays as is before committing. Want me to fix it?',
    'F-1 stays unchanged before committing unless you want it fixed.',
    'F-1 remains untouched before committing, but I can fix it.',
    'I can\'t fix F-1 now, but maybe later.',
    'I can\'t change F-1 now, I could remove it later.',
    'I can\'t fix F-1 for now. Should it go in?',
    'I can\'t fix F-1 now, let me know.',
    'I can\'t fix F-1 because you chose to keep it. I can still fix it later.',
    'I can\'t fix F-1 now. I could remove it later.',
    'I won\'t fix F-1, and I can edit F-1.',
    'I won\'t fix or edit F-1.',
    'I won\'t fix F-1, and I won\'t edit F-1. Want me to?',
    'I won\'t fix F-1, but I won\'t edit F-1 either.',
    'I won\'t fix F-1, and I won\'t ever edit F-1.',
  ];
  for (const result of pass) {
    assert.equal(keptNotReoffered(buildSession(recordedStream(keptLogSteps, { result }), keptRepoOf(keptConsoleLog))).pass, true, result);
    assert.equal(keptNotReoffered(buildSession(recordedStream(keptBeforeSteps, { result }), keptBeforeRepo)).pass, true, `kept before: ${result}`);
  }
  for (const result of fail) {
    assert.equal(keptNotReoffered(buildSession(recordedStream(keptLogSteps, { result }), keptRepoOf(keptConsoleLog))).pass, false, result);
    assert.equal(keptNotReoffered(buildSession(recordedStream(keptBeforeSteps, { result }), keptBeforeRepo)).pass, true, `kept before: ${result}`);
  }
  const split = buildSession(recordedStream([...keptLogSteps, 'I can\'t fix F-1 because you chose to keep it.'], { result: 'Want me to fix it?' }), keptRepoOf(keptConsoleLog));
  assert.equal(keptNotReoffered(split).pass, false, 'refusal then a closing offer');
  const quiet = buildSession(recordedStream([...keptLogSteps, 'I can\'t fix F-1 because you chose to keep it.'], { result: 'Nothing is committed.' }), keptRepoOf(keptConsoleLog));
  assert.equal(keptNotReoffered(quiet).pass, true, 'refusal then a plain closing');
  const earlier = keptLogSteps.slice(0, 4);
  assert.equal(keptNotReoffered(buildSession(recordedStream(earlier, { result: 'I can\'t fix F-1 now.' }), keptRepoOf(keptConsoleLog))).pass, true, 'refusal with the keep from an earlier session');
  assert.equal(keptNotReoffered(buildSession(recordedStream(earlier, { result: 'I can\'t fix F-1 now.\nWant me to?' }), keptRepoOf(keptConsoleLog))).pass, false, 'refusal then an offer line with the keep from an earlier session');
});

test('an id offer after a kept listing and a passive or reversed re-offer fail the check', () => {
  const cases = [
    ['id after listing', keptLogSteps, 'F-1 is kept as you asked. You could fix F-1 before committing.'],
    ['id after listing in an earlier step', [...keptLogSteps, 'F-1 (Remove the debug console.log) is kept as you asked.'], 'You could fix F-1 before committing.'],
    ['id offer in the same sentence as the listing', keptLogSteps, 'F-1 is kept, but I can still fix F-1 if you want.'],
    ['passive', keptLogSteps, 'Kept as is. The console.log could still be removed if you would like.'],
    ['passive with the id', keptLogSteps, 'Kept as is. F-1 can be fixed later, just let me know.'],
    ['cue before the name', keptLogSteps, 'Kept as is. If you would like, the console.log could still be removed.'],
  ];
  for (const [name, steps, result] of cases) {
    const session = buildSession(recordedStream(steps, { result }), keptRepoOf(keptConsoleLog));
    assert.equal(keptNotReoffered(session).pass, false, name);
    assert.match(keptNotReoffered(session).evidence, /re-offered: F-1/, name);
  }
  const passive = buildSession(recordedStream(keptLogSteps, { result: 'Kept as is. The console.log could still be removed if you would like.' }), keptRepoOf(keptConsoleLog));
  assert.equal(outcome(checkScenario(scenario('keep-finding'), passive), 'kept-not-reoffered').pass, false);
});

test('naming a kept finding without offering to act on it after the keep passes the check', () => {
  const cases = [
    ['listed as kept', keptLogSteps, 'Kept as is at your request:\n- F-1 [P4] Remove the debug console.log\nNothing else to fix.'],
    ['offer after the name', keptLogSteps, 'The console.log stays as you asked; let me know if anything else should change.'],
    ['offer before the keep', [...keptLogSteps.slice(0, -1), 'Should I remove the console.log or keep it?', keptLogSteps.at(-1)], 'Kept F-1 as is. Nothing is committed.'],
    ['offer in another sentence', keptLogSteps, 'Kept as is. Should I fix the other one? The console.log stays.'],
    ['offer about another finding', keptLogSteps, 'Kept F-1 as is. Want me to fix the missing null check in src/slug.js?'],
    ['refusal', keptLogSteps, "I can't fix the console.log because you chose to keep it."],
    ['offer in another clause', keptLogSteps, 'I can fix the missing null check; the console.log stays.'],
    ['offer before a comma', keptLogSteps, 'I can fix the missing null check, and the console.log stays.'],
    ['id of another finding', keptLogSteps, 'F-1 is kept as you asked. Want me to fix F-12 instead?'],
    ['reviewer voice without a cue', keptLogSteps, 'The reviewer said the console.log could be removed, and you chose to keep it.'],
    ['cue after a semicolon', keptLogSteps, 'As the reviewer noted, the console.log could be removed; let me know if you want anything else.'],
    ['passive about another finding after a comma', keptLogSteps, 'The console.log stays, and the null check could be fixed if you would like.'],
    ['kept as the participle', keptLogSteps, 'The console.log can be kept as is if you would like.'],
    ['could not be', keptLogSteps, 'The console.log could not be removed if you want the trace kept.'],
    ['passive about another finding', keptLogSteps, 'Kept F-1 as is. The missing null check could still be fixed if you would like.'],
    ['passive before the keep', [...keptLogSteps.slice(0, -1), 'The console.log could be removed if you would like, or kept.', keptLogSteps.at(-1)], 'Kept F-1 as is. Nothing is committed.'],
  ];
  for (const [name, steps, result] of cases) {
    const session = buildSession(recordedStream(steps, { result }), keptRepoOf(keptConsoleLog));
    assert.equal(keptNotReoffered(session).pass, true, name);
  }
});

const keptBeforeLog = { severity: 'P4', file: 'src/slug.js', line: 2, title: 'Remove the debug console.log', fingerprint: 'slug-console-log' };
const keptBeforeRepo = { ...keptRepoOf(keptConsoleLog), ledger: [], reviewState: { kept: [keptBeforeLog] } };
const keptBeforeSteps = keptLogSteps.slice(0, -1);

test('offering to act on a kept-before finding with no id, or by an imperative or a want phrasing, fails the check', () => {
  const before = [
    ['passive', keptBeforeSteps, 'The console.log could still be removed if you would like.'],
    ['offer in an earlier step', [...keptBeforeSteps, 'Want me to remove the console.log?'], 'Nothing is committed.'],
    ['question', [...keptBeforeSteps, ['AskUserQuestion', { questions: [{ question: 'Should I delete the console.log?' }] }]], 'Nothing is committed.'],
    ['want without be', keptBeforeSteps, 'Would you like the console.log removed?'],
  ];
  for (const [name, steps, result] of before) {
    const session = buildSession(recordedStream(steps, { result }), keptBeforeRepo);
    assert.equal(keptNotReoffered(session).pass, false, name);
    assert.equal(keptNotReoffered(session).evidence, 're-offered: "Remove the debug console.log"', name);
  }
  const listed = 'F-1 (Remove the debug console.log) is kept as you asked.';
  const kept = [
    ['imperative id after listing', [...keptLogSteps, listed], 'Fix F-1 before committing?'],
    ['imperative id in the same message as the listing', keptLogSteps, 'Kept as is: F-1. Fix F-1 before committing?'],
    ['imperative id question', [...keptLogSteps, listed, ['AskUserQuestion', { questions: [{ question: 'Fix F-1 before committing?' }] }]], 'Nothing is committed.'],
    ['imperative name before committing', keptLogSteps, 'Kept as is. Remove the console.log before you commit.'],
    ['want without be', keptLogSteps, 'Kept as is. Would you like the console.log removed?'],
    ['want at the start', keptLogSteps, 'Kept as is. Want the console.log removed?'],
    ['want question', [...keptLogSteps, ['AskUserQuestion', { questions: [{ question: 'Do you want the console.log removed?' }] }]], 'Kept F-1 as is.'],
    ['should be', keptLogSteps, 'Kept as is. The console.log should be removed if you would like.'],
  ];
  for (const [name, steps, result] of kept) {
    const session = buildSession(recordedStream(steps, { result }), keptRepoOf(keptConsoleLog));
    assert.equal(keptNotReoffered(session).pass, false, name);
    assert.match(keptNotReoffered(session).evidence, /re-offered: F-1$/, name);
  }
  const debuggerItem = { id: 'F-4', severity: 'P3', file: 'src/slug.js', line: 3, title: 'Remove the stray debugger statement' };
  const title = buildSession(recordedStream([...keptLogSteps.slice(0, -1), loop('decide --id F-4 --choice keep')], { result: 'Kept as is. Remove the stray debugger statement?' }), keptRepoOf(debuggerItem));
  assert.equal(keptNotReoffered(title).pass, false);
  const both = buildSession(recordedStream(keptLogSteps, { result: 'Want me to remove the console.log?' }), { ...keptRepoOf(keptConsoleLog), reviewState: { kept: [keptConsoleLog, keptBeforeLog] } });
  assert.equal(keptNotReoffered(both).evidence, 're-offered: F-1, "Remove the debug console.log"');
  const scenarioRun = buildSession(recordedStream(keptBeforeSteps, { result: before[0][2] }), keptBeforeRepo);
  assert.equal(outcome(checkScenario(scenario('keep-finding'), scenarioRun), 'kept-not-reoffered').pass, false);
});

test('naming a kept-before finding or a kept id without an imperative or a want offer passes the check', () => {
  const before = [
    ['loop report line', keptBeforeSteps, '1 finding you kept before was raised again, including:\n- [P4] src/slug.js:2 Remove the debug console.log'],
    ['stays', keptBeforeSteps, 'The console.log stays as you asked earlier; nothing is committed.'],
    ['reviewer voice with should', keptBeforeSteps, 'The reviewer said the console.log should be removed, and you chose to keep it.'],
  ];
  for (const [name, steps, result] of before) {
    const session = buildSession(recordedStream(steps, { result }), keptBeforeRepo);
    assert.equal(keptNotReoffered(session).pass, true, name);
    assert.equal(keptNotReoffered(session).evidence, 'kept settled: "Remove the debug console.log"', name);
  }
  const kept = [
    ['colon after the verb', 'Update: F-1 stays kept, nothing else to do before committing.'],
    ['colon after the verb before committing', 'Update: F-1 stays kept before committing.'],
    ['nothing to change', 'Change nothing about the console.log before committing.'],
    ['want another finding fixed', 'Would you like the console.log kept and F-2 fixed?'],
    ['want as a recap', 'As you want the console.log kept and F-2 fixed, both are done.'],
    ['imperative about another id', 'F-1 is kept as you asked. Fix F-12 before committing?'],
    ['fixed another id after a kept listing', 'Kept as is: F-1. Fixed F-2; F-1 stays as you asked.'],
    ['reviewer voice with should', 'The reviewer said the console.log should be removed, and you chose to keep it.'],
    ['did not want', 'You did not want the console.log removed, so it stays.'],
  ];
  for (const [name, result] of kept) {
    const session = buildSession(recordedStream(keptLogSteps, { result }), keptRepoOf(keptConsoleLog));
    assert.equal(keptNotReoffered(session).pass, true, name);
  }
  const none = buildSession(recordedStream(keptBeforeSteps, { result: 'Nothing is committed.' }), { ...keptBeforeRepo, reviewState: { kept: [{ ...keptBeforeLog, title: undefined }] } });
  assert.equal(keptNotReoffered(none).evidence, 'no kept findings');
});

const ask = (...options) => ['AskUserQuestion', { questions: [{ question: 'What next', header: 'Next', options }] }];
const removeLabel = { label: 'Remove the console.log', description: 'Delete line 2' };

test('an uncued should-be, an inverted question, or an option label that acts on a kept finding fails the check', () => {
  const before = [
    ['should be', keptBeforeSteps, 'The console.log should be removed before committing.'],
    ['inverted', keptBeforeSteps, 'Should the console.log be removed?'],
    ['option label', [...keptBeforeSteps, ask(removeLabel, { label: 'Leave it', description: 'No change' })], 'Nothing is committed.'],
    ['label is the title', [...keptBeforeSteps, ask({ label: 'Remove the debug console.log', description: 'Delete line 2' })], 'Nothing is committed.'],
    ['inverted question step', [...keptBeforeSteps, ['AskUserQuestion', { questions: [{ question: 'Should the console.log be removed?' }] }]], 'Nothing is committed.'],
  ];
  for (const [name, steps, result] of before) {
    const session = buildSession(recordedStream(steps, { result }), keptBeforeRepo);
    assert.equal(keptNotReoffered(session).pass, false, name);
    assert.equal(keptNotReoffered(session).evidence, 're-offered: "Remove the debug console.log"', name);
  }
  const kept = [
    ['should be', keptLogSteps, 'Kept as is. The console.log should be removed before committing.'],
    ['must before you commit', keptLogSteps, 'Kept as is. The console.log must be removed before you commit.'],
    ['needs to with an adjective', keptLogSteps, 'The debug console.log still needs to be removed before the commit.'],
    ['should be by id', keptLogSteps, 'F-1 is kept as you asked. F-1 should be fixed before committing.'],
    ['inverted', keptLogSteps, 'Kept as is. Should the console.log be removed?'],
    ['inverted could', keptLogSteps, 'Kept as is. Could the console.log be dropped?'],
    ['inverted negated modal', keptLogSteps, "Shouldn't the debug console.log be removed?"],
    ['inverted by id', keptLogSteps, 'F-1 is kept as you asked. Should F-1 be fixed?'],
    ['inverted we', keptLogSteps, 'Kept as is. Should we remove the console.log?'],
    ['label by name', [...keptLogSteps, ask(removeLabel, { label: 'Leave it', description: 'No change' })], 'Kept F-1 as is.'],
    ['label by title', [...keptLogSteps, ask({ label: 'Remove the debug console.log', description: 'Delete line 2' })], 'Kept F-1 as is.'],
    ['label by quote', [...keptLogSteps, ask({ label: "Delete console.log('slugify input', title)", description: 'Line 2' })], 'Kept F-1 as is.'],
    ['label by id', [...keptLogSteps, ask({ label: 'Fix F-1', description: 'Delete line 2' })], 'F-1 is kept as you asked.'],
  ];
  for (const [name, steps, result] of kept) {
    const session = buildSession(recordedStream(steps, { result }), keptRepoOf(keptConsoleLog));
    assert.equal(keptNotReoffered(session).pass, false, name);
    assert.match(keptNotReoffered(session).evidence, /re-offered: F-1$/, name);
  }
  const label = buildSession(recordedStream(before[2][1], { result: before[2][2] }), keptBeforeRepo);
  assert.equal(outcome(checkScenario(scenario('keep-finding'), label), 'kept-not-reoffered').pass, false);
});

test('a reviewer-voice should-be, a keep question, or a keep or other-finding option label passes the check', () => {
  const texts = [
    ['reviewer voice before committing', 'The reviewer said the console.log should be removed before committing, but you kept it.'],
    ['reviewer voice after the name', 'The console.log should be removed, the reviewer said, and you chose to keep it.'],
    ['should not', 'The console.log should not be removed before committing.'],
    ['should be kept', 'The console.log should be kept before committing.'],
    ['other finding should be', 'The null check should be fixed before committing; the console.log stays.'],
    ['keep question', 'Should the console.log be kept?'],
    ['decide question', 'Should the console.log stay or be removed?'],
    ['inverted about another finding', 'Should the null check be fixed while the console.log stays?'],
    ['we about another finding', 'Should we fix the null check and keep the console.log?'],
    ['quoted question recap', 'You answered "Should the console.log be removed?" with keep, so it stays.'],
    ['inverted other id', 'F-1 is kept as you asked. Should F-12 be fixed?'],
    ['kept listing in another sentence', 'Kept as is at your request:\n- F-1 [P4] Remove the debug console.log\nFixed F-2 and left F-1 alone.'],
  ];
  for (const [name, result] of texts) {
    const session = buildSession(recordedStream(keptLogSteps, { result }), keptRepoOf(keptConsoleLog));
    assert.equal(keptNotReoffered(session).pass, true, name);
  }
  const labels = [
    ['keep labels', ask({ label: 'Keep the console.log', description: 'No change' }, { label: 'Keep it', description: 'No change' })],
    ['label on another finding', ask({ label: 'Fix the null check', description: 'Fix the null check next to the console.log' }, { label: 'Keep it', description: 'Change nothing' })],
    ['label other id', ask({ label: 'Fix F-12', description: 'Line 9' })],
  ];
  for (const [name, step] of labels) {
    const session = buildSession(recordedStream([...keptLogSteps, step], { result: 'Kept F-1 as is.' }), keptRepoOf(keptConsoleLog));
    assert.equal(keptNotReoffered(session).pass, true, name);
  }
  const beforeKeep = [
    ['label before the keep', ask(removeLabel, { label: 'Keep it', description: 'No change' })],
    ['inverted before the keep', 'Should the console.log be removed?'],
    ['should be before the keep', 'The console.log should be removed before committing.'],
  ];
  for (const [name, step] of beforeKeep) {
    const session = buildSession(recordedStream([...keptLogSteps.slice(0, -1), step, keptLogSteps.at(-1)], { result: 'Kept F-1 as is. Nothing is committed.' }), keptRepoOf(keptConsoleLog));
    assert.equal(keptNotReoffered(session).pass, true, name);
  }
  const keptBefore = [
    ['loop report line', '1 finding you kept before was raised again, including:\n- [P4] src/slug.js:2 Remove the debug console.log'],
    ['reviewer voice before committing', texts[0][1]],
  ];
  for (const [name, result] of keptBefore) {
    const session = buildSession(recordedStream(keptBeforeSteps, { result }), keptBeforeRepo);
    assert.equal(keptNotReoffered(session).pass, true, name);
    assert.equal(keptNotReoffered(session).evidence, 'kept settled: "Remove the debug console.log"', name);
  }
});

const askAbout = (question, ...options) => ['AskUserQuestion', { questions: [{ question, header: 'Next', options }] }];
const logQuestion = 'What should happen with the console.log?';
const keepIt = { label: 'Keep it', description: 'No change' };
const dueTitle = { id: 'F-1', severity: 'P4', file: 'src/slug.js', line: 2, title: 'The debug console.log should be removed' };
const dueTitleBefore = { ...keptBeforeRepo, reviewState: { kept: [{ ...keptBeforeLog, title: dueTitle.title }] } };

test('a bare, mid-sentence, or parenthetical should-be, a pronoun, description, or header option, or a does, is, you, or do question that acts on a kept finding fails the check', () => {
  const shapes = [
    ['bare should-be', [], 'The console.log should be removed.'],
    ['bare should-be by id or title', [], 'F-1 is kept as you asked. Remove the debug console.log should be fixed, and F-1 should be fixed.'],
    ['mid-sentence should-be', [], 'Kept, but the console.log should be removed before committing.'],
    ['should-be after another voice turns', [], 'The reviewer said it is minor, but the console.log should be removed.'],
    ['could-be after if you wanted', [], 'If you wanted, the console.log could be removed.'],
    ['parenthetical subject', [], 'F-1 is kept as you asked. F-1 (Remove the debug console.log) should be fixed before committing.'],
    ['pronoun label remove', [askAbout(logQuestion, { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label fix', [askAbout(logQuestion, { label: 'Fix it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label after yes', [askAbout(logQuestion, { label: 'Yes, remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['bare verb label', [askAbout(logQuestion, { label: 'Remove', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun description', [askAbout(logQuestion, { label: 'Proceed', description: 'Remove it' }, keepIt)], 'Nothing is committed.'],
    ['description only', [ask({ label: 'Proceed', description: 'Delete the console.log' })], 'Nothing is committed.'],
    ['description second sentence', [ask({ label: 'Proceed', description: 'Go ahead. Delete the console.log' })], 'Nothing is committed.'],
    ['header only', [['AskUserQuestion', { questions: [{ question: 'What next', header: 'Delete the console.log', options: [{ label: 'Proceed', description: 'Go ahead' }] }] }]], 'Nothing is committed.'],
    ['i with a neighbor after the name', [], 'Should I fix the console.log next to the null check?'],
    ['want me', [], 'Want me to remove the console.log?'],
    ['want me with a neighbor after the name', [], 'Want me to remove the console.log next to the null check?'],
    ['passive with a cue and a neighbor after the name', [], 'The console.log near the null check could be removed if you would like.'],
    ['imperative question', [], 'Remove the console.log before committing?'],
    ['do you want', [], 'Do you want the console.log removed?'],
    ['should be with a push', [], 'Kept as is. The console.log should be removed before committing.'],
    ['push before another clause names the reviewer', [], 'The console.log should be removed before committing, and the reviewer said so.'],
    ['neighbor then including the name', [], 'Want me to remove everything near the console.log, including the console.log?'],
    ['neighbor then and also the name', [], 'Want me to remove the null check near the console.log, and also the console.log?'],
    ['reviewer voice about something else after a push', [], 'The console.log should be removed before committing (the reviewer said the tests also need changes).'],
    ['reviewer voice about something else', [], 'The console.log should be removed (the reviewer said the tests also need changes).'],
    ['does need', [], 'Does the console.log need to be removed?'],
    ['is to be', [], 'Is the console.log to be removed?'],
    ['should you', [], 'Should you remove the console.log?'],
    ['do we', [], 'Do we remove the console.log?'],
    ['do we need to', [], 'Do we need to remove the console.log?'],
    ['does need question step', [['AskUserQuestion', { questions: [{ question: 'Does the console.log need to be removed?' }] }]], 'Nothing is committed.'],
    ['mid-sentence inverted', [], 'Kept, but should the console.log be removed?'],
    ['mid-sentence inverted we', [], 'Kept, but should we remove the console.log?'],
    ['mid-sentence do we', [], 'Kept, but do we remove the console.log?'],
    ['is to be statement', [], 'The console.log is to be removed.'],
    ['pronoun label under a question with and decide', [askAbout('Should we review the console.log and decide?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with and add tests for it', [askAbout('Should we look at the console.log and add tests for it?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with and push it', [askAbout('Should we look at the console.log and push it?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with and fix tests', [askAbout('Should we look at the console.log and fix tests?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['label by name under a two-finding question', [askAbout('What about the console.log and the null check?', { label: 'Remove the console.log', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with and when', [askAbout('What should happen with the console.log and when?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under keep or remove', [askAbout('Should I keep or remove the console.log?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with and why', [askAbout('What should happen with the console.log and why?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with or not', [askAbout('Should I touch the console.log or not?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with and fix', [askAbout('Should I look at the console.log and fix it?', { label: 'Fix it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with and should', [askAbout('What about the console.log and should it go?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['mid-sentence inverted after an unquoted voice', [], 'The reviewer said it is minor, but should the console.log be removed?'],
    ['mid-sentence inverted after a closed voice quote', [], 'The reviewer asked "why", but should the console.log be removed?'],
    ['inverted after a semicolon', [], 'Kept; should we remove the console.log?'],
    ['pronoun label under a question with and its', [askAbout('What about the console.log and its impact?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['mid-sentence inverted after a closed single voice quote', [], "The reviewer asked 'why', but should the console.log be removed?"],
    ['inverted after a possessive that is not a voice quote', [], "According to the reviewer's note; should we remove the console.log?"],
    ['pronoun label under a question with and moving on', [askAbout('What about the console.log and moving on?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with and move on', [askAbout('Should we look at the console.log and move on?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with and go ahead', [askAbout('Should we look at the console.log and go ahead?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with and proceed', [askAbout('Should we look at the console.log and proceed?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with or continue', [askAbout('Should we look at the console.log or continue?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with or skip', [askAbout('Should we look at the console.log or skip ahead?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with and ship', [askAbout('Should we look at the console.log and ship?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with and merge', [askAbout('Should we look at the console.log and merge?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with or do nothing', [askAbout('Should we review console.log or do nothing?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with and add tests', [askAbout('Should we look at the console.log and add tests?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with and rerun review', [askAbout('Should we look at the console.log and rerun review?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with and carry on', [askAbout('Should we look at the console.log and carry on?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with and wrap up', [askAbout('Should we look at the console.log and wrap up?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with and decide later', [askAbout('Should we look at the console.log and decide later?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with and moving forward', [askAbout('What about the console.log and moving forward?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with and send notes for it', [askAbout('Should we look at the console.log and send notes for it?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['inverted after a comma', [], 'Kept, should we remove the console.log?'],
    ['inverted after a voice quote that opens too far from the voice', [], 'The reviewer said it is minor, and my own question is "Kept; should we remove the console.log?"'],
    ['pronoun label under a question that opens with and', [askAbout('And the console.log?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a second sentence that opens with and', [askAbout('What next. And the console.log?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with and the reason for keeping it', [askAbout('What about the console.log and the reason for keeping it?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with and the tests for it', [askAbout('What about the console.log and the tests for it?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with bare words away from an opener before the kept name', [askAbout('Did you see tests pass and the console.log?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with an -ing phrase before the kept name', [askAbout('What about shipping now and the console.log?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['inverted after a voice quote that closes after the comma', [], 'The reviewer said "Kept," but should we remove the console.log?'],
    ['inverted after a single voice quote that closes after the comma', [], "The reviewer said 'Kept,' but should we remove the console.log?"],
    ['inverted after a curly voice quote that closes after the comma', [], 'The reviewer said “Kept,” but should we remove the console.log?'],
    ['question step inverted after a voice quote that closes after the comma', [['AskUserQuestion', { questions: [{ question: 'The reviewer said "Kept," but should we remove the console.log?' }] }]], 'Nothing is committed.'],
    ['inverted in a quote on its own line after a line with no reviewer voice', [], 'Nothing else is open\n“Kept; should we remove the console.log?”'],
    ['pronoun label under a verb-led question with and run tests', [askAbout('Should we review the console.log and run tests?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a what about question with and fix tests', [askAbout('What about the console.log and fix tests?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a what about question with and do nothing', [askAbout('What about the console.log and do nothing?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a what about question with and add tests', [askAbout('What about the console.log and add tests?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a what about question with and rerun review', [askAbout('What about the console.log and rerun review?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a what about question with and go ahead', [askAbout('What about the console.log and go ahead?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a what about question with and skip ahead', [askAbout('What about the console.log and skip ahead?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a what about question with and carry on', [askAbout('What about the console.log and carry on?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a what about question with and wrap up', [askAbout('What about the console.log and wrap up?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a what about question with and revisit later', [askAbout('What about the console.log and revisit later?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a what about question with and handle it', [askAbout('What about the console.log and handle it?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a what about question with and decide', [askAbout('What about the console.log and decide?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a what about question with and push', [askAbout('What about the console.log and push?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a verb-led question with two bare words after at, kept second', [askAbout('Should we look at tests pass and the console.log?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a verb-led question with a pronoun after at, kept second', [askAbout('Should we look at it and the console.log?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question with a bare word after a word that ends in at', [askAbout('So what next and the console.log?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['inverted in a quote after a blank line and a line with no reviewer voice', [], 'Nothing else is open\n\n“Kept; should we remove the console.log?”'],
    ['inverted in an indented quote after a line with no reviewer voice', [], 'Nothing else is open\n  “Kept; should we remove the console.log?”'],
    ['inverted on an indented line after a blank line', [], 'Kept as is\n\n   Should we remove the console.log?'],
    ['pronoun label under a question with only the kept name in backticks', [askAbout('What about `console.log`?', { label: 'Fix it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['inverted in a second sentence after an unquoted reviewer voice', [], 'The reviewer said it was kept. However, should we remove the console.log?'],
    ['inverted at the start of the second sentence of a quote with no reviewer voice', [], 'My question is: "It was kept. Should we remove the console.log?"'],
    ['inverted at the start of the second sentence of a curly quote with no reviewer voice', [], 'My question is: “It was kept. Should we remove the console.log?”'],
    ['inverted at the start of a sentence after a reviewer quote closes', [], 'The reviewer asked "Was it kept?" and left. Should we remove the console.log?'],
    ['inverted at the start of a sentence after a curly reviewer quote closes', [], 'The reviewer asked “Was it kept?” and left. Should we remove the console.log?'],
    ['plural them label under a two-finding question', [askAbout('What about the console.log and the null check?', { label: 'Remove them', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['plural these label under a two-finding question', [askAbout('What about the console.log and the null check?', { label: 'Fix these', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['plural those label under a two-finding question', [askAbout('What about the console.log and the null check?', { label: 'Remove those', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['both label under a two-finding question', [askAbout('What about the console.log and the null check?', { label: 'Fix both', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['plural them label under a two-finding question, kept second', [askAbout('What about the null check and the console.log?', { label: 'Remove them', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['plural them label under a one-finding question', [askAbout(logQuestion, { label: 'Remove them', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['inverted after a long voice gap with no colon or comma before the quote', [], "The reviewer asked about the finding in round one and my own question is \"Kept; should we remove the console.log?\""],
    ['inverted after a long voice gap with a comma inside and a colon before the quote', [], "The reviewer said it is minor, and my own question is: \"Kept; should we remove the console.log?\""],
    ['inverted in the second sentence of a quote after a voice, a sentence end, and a colon', [], "The reviewer asked about the first round. My own question is: \"It was kept. Should we remove the console.log?\""],
    ['inverted in the second sentence of a quote after a voice, a line break, and a colon', [], "The reviewer asked about the finding in round one\nMy own question is: \"It was kept. Should we remove the console.log?\""],
    ['pronoun label under a verb-led question with and three bare words', [askAbout('Should we look at the console.log and send notes out?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['inverted in a single quote on its own line after a line with no reviewer voice', [], "Nothing else is open\n'Kept; should we remove the console.log?'"],
    ['inverted in a curly single quote on its own line after a line with no reviewer voice', [], "Nothing else is open\n‘Kept; should we remove the console.log?’"],
  ];
  for (const [name, extra, result] of shapes) {
    const kept = buildSession(recordedStream([...keptLogSteps, ...extra], { result }), keptRepoOf(keptConsoleLog));
    assert.equal(keptNotReoffered(kept).pass, false, `kept id: ${name}`);
    assert.match(keptNotReoffered(kept).evidence, /re-offered: F-1$/, `kept id: ${name}`);
    const before = buildSession(recordedStream([...keptBeforeSteps, ...extra], { result }), keptBeforeRepo);
    assert.equal(keptNotReoffered(before).pass, false, `kept before: ${name}`);
    assert.equal(keptNotReoffered(before).evidence, 're-offered: "Remove the debug console.log"', `kept before: ${name}`);
  }
  const restated = [
    ['own voice at the start', 'Kept as is. The debug console.log should be removed.'],
    ['own voice mid-sentence', 'Kept, but the debug console.log should be removed.'],
    ['listed title with a push', 'Kept as is:\n- The debug console.log should be removed before committing'],
  ];
  for (const [name, result] of restated) {
    const kept = buildSession(recordedStream(keptLogSteps, { result }), keptRepoOf(dueTitle));
    assert.equal(keptNotReoffered(kept).pass, false, `kept id: ${name}`);
    const before = buildSession(recordedStream(keptBeforeSteps, { result }), dueTitleBefore);
    assert.equal(keptNotReoffered(before).pass, false, `kept before: ${name}`);
  }
  const pronoun = buildSession(recordedStream([...keptBeforeSteps, askAbout(logQuestion, { label: 'Remove it', description: 'Line 2' }, keepIt)], { result: 'Nothing is committed.' }), keptBeforeRepo);
  assert.equal(outcome(checkScenario(scenario('keep-finding'), pronoun), 'kept-not-reoffered').pass, false);
});

test('a reported or denied should-be, an act on something next to a kept finding, a pronoun option under another question, or a keep question passes the check', () => {
  const shapes = [
    ['reviewer voice after the name', [], 'The console.log should be removed, the reviewer said, and you chose to keep it.'],
    ['reviewer voice before the name', [], 'The reviewer said the console.log should be removed, and you chose to keep it.'],
    ['reviewer voice before committing', [], 'The reviewer said the console.log should be removed before committing, but you kept it.'],
    ['reviewer voice after but', [], 'Kept, but the reviewer said the console.log should be removed.'],
    ['reviewer voice as noted', [], 'As the reviewer noted, the console.log could be removed; nothing else is open.'],
    ['reviewer voice with a list', [], 'The reviewer found two things: the null check is wrong and the console.log should be removed.'],
    ['according to before', [], 'According to the review, the console.log should be removed, and you kept it.'],
    ['according to after', [], 'The console.log should be removed, according to the reviewer, and it stays.'],
    ['your own words', [], 'You said the console.log should be removed later, so it stays for now.'],
    ['quoted answer recap', [], 'You answered "The console.log should be removed" with keep, so it stays.'],
    ['denied', [], "I don't think the console.log should be removed."],
    ['should not', [], 'Kept, and the console.log should not be removed.'],
    ['should be kept', [], 'Kept, and the console.log should be kept.'],
    ['should-be about a neighbor', [], 'The null check near the console.log should be fixed.'],
    ['should-be in a later clause', [], 'The console.log stays while F-2 should be fixed.'],
    ['inverted about a neighbor', [], 'Should the test near the console.log be fixed?'],
    ['inverted about a longer neighbor', [], 'Should the null check near the console.log be fixed?'],
    ['we about a neighbor', [], 'Should we fix the null check near the console.log?'],
    ['i about a neighbor', [], 'Should I fix the null check next to the console.log?'],
    ['want me about a neighbor', [], 'Want me to fix the null check next to the console.log?'],
    ['passive with a cue about a neighbor', [], 'The null check next to the console.log could be removed if you would like.'],
    ['cue before a passive about a neighbor', [], 'If you want, the test near the console.log could be removed.'],
    ['imperative question about a neighbor', [], 'Fix the null check next to the console.log?'],
    ['do you want about a neighbor', [], 'Do you want the test near the console.log removed?'],
    ['reviewer voice after a push', [], 'The console.log should be removed before committing, the reviewer said, and you kept it.'],
    ['reviewer voice in brackets after a push', [], 'The console.log should be removed before committing (the reviewer said).'],
    ['reviewer voice in brackets with a short tail', [], 'The console.log should be removed (as the reviewer said earlier).'],
    ['reviewer voice with a previous review tail', [], 'The console.log should be removed, as the reviewer noted in the previous review.'],
    ['reviewer voice with a round tail', [], 'The console.log should be removed before committing, as the reviewer noted in round 1.'],
    ['neighbor then keep after a comma', [], 'Want me to fix the null check near the console.log, and keep the console.log?'],
    ['does need to be kept', [], 'Does the console.log need to be kept?'],
    ['is to be kept or removed', [], 'Is the console.log to be kept or removed?'],
    ['do we keep', [], 'Do we keep the console.log?'],
    ['do we about another finding', [], 'Do we fix the null check and keep the console.log?'],
    ['label about a neighbor', [ask({ label: 'Fix the null check next to the console.log', description: 'Line 9' })], 'Nothing is committed.'],
    ['description about a neighbor', [ask({ label: 'Proceed', description: 'Fix the null check next to the console.log' })], 'Nothing is committed.'],
    ['description keeps', [ask({ label: 'Proceed', description: 'Keep the console.log and commit' })], 'Nothing is committed.'],
    ['pronoun label under another question', [askAbout('What about the null check in src/slug.js?', { label: 'Fix it', description: 'Line 9' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a question about a neighbor', [askAbout('What about the null check next to the console.log?', { label: 'Fix it', description: 'Line 9' }, keepIt)], 'Nothing is committed.'],
    ['keep labels under the question', [askAbout(logQuestion, keepIt, { label: 'Leave it', description: 'Change nothing' })], 'Nothing is committed.'],
    ['other object under the question', [askAbout(logQuestion, { label: 'Fix the null check', description: 'Line 9' }, keepIt)], 'Nothing is committed.'],
    ['is to be kept', [], 'The console.log is to be kept.'],
    ['is not to be', [], 'The console.log is not to be removed.'],
    ['reviewer voice is to be', [], 'The reviewer said the console.log is to be removed.'],
    ['mid-sentence inverted about a neighbor', [], 'Kept, but should the null check near the console.log be fixed?'],
    ['mid-sentence inverted keep', [], 'Kept, but should the console.log be kept?'],
    ['pronoun label under a two-finding question', [askAbout('What about the console.log and the null check?', { label: 'Fix it', description: 'Line 9' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a two-finding question, kept second', [askAbout('What about the null check and the console.log?', { label: 'Fix it', description: 'Line 9' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under an or question with an id', [askAbout('What about the console.log or F-2?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a two-finding question without a determiner', [askAbout('What about the console.log and null check?', { label: 'Fix it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under an or question without a determiner', [askAbout('What about the console.log or null check?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a two-finding question with a backticked name', [askAbout('What about console.log and `cache`?', { label: 'Fix it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a two-finding question with a dotted name', [askAbout('What about the console.log and cache.get?', { label: 'Fix it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under an or question with a call', [askAbout('What about the console.log or parse()?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a two-finding question with an underscored name', [askAbout('What about the console.log and null_check?', { label: 'Fix it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['reviewer voice quotes a mid-sentence inverted', [], 'The reviewer asked, "Kept, but should the console.log be removed?"'],
    ['reviewer voice quotes a mid-sentence inverted we after a colon', [], 'The reviewer asked: "Kept, but should we remove the console.log?"'],
    ['reviewer voice quotes a mid-sentence do we', [], 'The reviewer asked, "Kept, but do we remove the console.log?"'],
    ['reviewer voice quotes an inverted after a semicolon', [], 'The reviewer asked, "Kept; should we remove the console.log?"'],
    ['inverted about a neighbor after a semicolon', [], 'Kept; should we fix the null check near the console.log?'],
    ['reviewer voice quotes an inverted after a semicolon in single quotes', [], "The reviewer asked, 'Kept; should we remove the console.log?'"],
    ['reviewer voice quotes an inverted after a semicolon in curly single quotes', [], 'The reviewer asked, ‘Kept; should we remove the console.log?’'],
    ['reviewer voice quotes an apostrophe before the semicolon', [], "The reviewer asked, 'It's kept; shouldn't we remove the console.log?'"],
    ['reviewer possessive voice quotes in single quotes', [], "The reviewer's note: 'Kept; should we remove the console.log?'"],
    ['reviewer voice quotes an inverted after the question and a colon', [], 'The reviewer asked the question: "Kept; should we remove the console.log?"'],
    ['pronoun label under an or question with an id, kept second', [askAbout('What about F-2 or the console.log?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a two-finding question with a dotted name, kept second', [askAbout('What about cache.get and the console.log?', { label: 'Fix it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a two-finding question without a determiner, kept second', [askAbout('What about null check and the console.log?', { label: 'Fix it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['reviewer voice quotes an inverted after a quote that closes inside it', [], "The reviewer asked, \"You said 'kept,' but should we remove the console.log?\""],
    ['reviewer voice quotes an inverted on the next line', [], 'The reviewer asked:\n“Kept; should we remove the console.log?”'],
    ['reviewer voice quotes an inverted on the next line in straight quotes', [], 'The reviewer asked the question:\n"Kept; should we remove the console.log?"'],
    ['pronoun label under a two-finding question with one bare word', [askAbout('What about the console.log and deadlock?', { label: 'Fix it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a two-finding question with one bare word, kept second', [askAbout('What about deadlock and the console.log?', { label: 'Fix it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a how about question without a determiner', [askAbout('How about the console.log or null check?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a what should happen with question without a determiner', [askAbout('What should happen with the console.log and null check?', { label: 'Fix it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a verb-led question with an underscored name', [askAbout('Should we look at the console.log and null_check?', { label: 'Fix it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a verb-led question with an id, kept second', [askAbout('Should we look at F-2 or the console.log?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a verb-led question with one bare word', [askAbout('Should we look at the console.log and deadlock?', { label: 'Fix it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a verb-led question with one bare word, kept second', [askAbout('Should we look at deadlock and the console.log?', { label: 'Fix it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a verb-led or question with one bare word and no preposition', [askAbout('Should we review the console.log or deadlock?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['reviewer voice quotes an inverted after a blank line', [], 'The reviewer asked:\n\n“Kept; should we remove the console.log?”'],
    ['reviewer voice quotes an inverted after a blank line in straight quotes', [], 'The reviewer asked the question:\n\n"Kept; should we remove the console.log?"'],
    ['reviewer voice quotes an inverted on an indented next line', [], 'The reviewer asked:\n  “Kept; should we remove the console.log?”'],
    ['reviewer voice quotes an inverted after a blank line with carriage returns', [], 'The reviewer asked:\r\n\r\n“Kept; should we remove the console.log?”'],
    ['pronoun label under a verb-led question with an underscored name and more text', [askAbout('Should we look at the console.log and null_check first?', { label: 'Fix it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a verb-led question with an underscored name and a longer tail', [askAbout('Should we look at the console.log and null_check before the release?', { label: 'Fix it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a verb-led question with an id and no preposition, kept second', [askAbout('Should we review F-2 or the console.log?', { label: 'Remove it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a two-finding question with the kept name in backticks', [askAbout('What about `console.log` and the null check?', { label: 'Fix it', description: 'Line 9' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a two-finding question with the kept name in backticks, kept second', [askAbout('What about the null check and `console.log`?', { label: 'Fix it', description: 'Line 9' }, keepIt)], 'Nothing is committed.'],
    ['reviewer voice quotes an inverted in its second sentence', [], 'The reviewer asked: "It was kept. However, should we remove the console.log?"'],
    ['reviewer voice quotes an inverted in its second sentence in curly quotes', [], 'The reviewer asked: “It was kept. However, should we remove the console.log?”'],
    ['pronoun label under a what about question with the kept name in backticks and a bare two-word finding', [askAbout('What about `console.log` and null check?', { label: 'Fix it', description: 'Line 9' }, keepIt)], 'Nothing is committed.'],
    ['this label under a two-finding question', [askAbout('What about the console.log and the null check?', { label: 'Remove this', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['that label under a two-finding question', [askAbout('What about the console.log and the null check?', { label: 'Fix that', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['bare act label under a two-finding question', [askAbout('What about the console.log and the null check?', { label: 'Fix', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['reviewer voice quotes an inverted after a long attribution and a colon', [], "The reviewer asked the following question about the finding: \"Kept; should we remove the console.log?\""],
    ['reviewer voice quotes an inverted after a long attribution and a comma', [], "The reviewer asked the following question about the finding, \"Kept; should we remove the console.log?\""],
    ['reviewer voice quotes an inverted after a short attribution with no colon', [], 'The reviewer asked us once "Kept; should we remove the console.log?"'],
    ['pronoun label under a verb-led question with a bare two-word finding and first', [askAbout('Should we review the console.log and null check first?', { label: 'Fix it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a verb-led question with a bare two-word finding', [askAbout('Should we look at the console.log and null check?', { label: 'Fix it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a verb-led question with a bare two-word finding and too', [askAbout('Should we review the console.log and null check too?', { label: 'Fix it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['pronoun label under a verb-led question with a bare two-word finding and as well', [askAbout('Should we review the console.log and null check as well?', { label: 'Fix it', description: 'Line 2' }, keepIt)], 'Nothing is committed.'],
    ['reviewer voice quotes an inverted on the next line in single quotes', [], "The reviewer asked:\n'Kept; should we remove the console.log?'"],
    ['reviewer voice quotes an inverted on the next line in curly single quotes', [], "The reviewer asked:\n‘Kept; should we remove the console.log?’"],
  ];
  for (const [name, extra, result] of shapes) {
    const kept = buildSession(recordedStream([...keptLogSteps, ...extra], { result }), keptRepoOf(keptConsoleLog));
    assert.equal(keptNotReoffered(kept).pass, true, `kept id: ${name}`);
    const before = buildSession(recordedStream([...keptBeforeSteps, ...extra], { result }), keptBeforeRepo);
    assert.equal(keptNotReoffered(before).pass, true, `kept before: ${name}`);
    assert.equal(keptNotReoffered(before).evidence, 'kept settled: "Remove the debug console.log"', `kept before: ${name}`);
  }
  const beforeKeep = [
    ['pronoun label before the keep', askAbout(logQuestion, { label: 'Remove it', description: 'Line 2' }, keepIt)],
    ['description before the keep', ask({ label: 'Proceed', description: 'Delete the console.log' })],
    ['bare should-be before the keep', 'The console.log should be removed.'],
    ['does need before the keep', 'Does the console.log need to be removed?'],
  ];
  for (const [name, step] of beforeKeep) {
    const session = buildSession(recordedStream([...keptLogSteps.slice(0, -1), step, keptLogSteps.at(-1)], { result: 'Kept F-1 as is. Nothing is committed.' }), keptRepoOf(keptConsoleLog));
    assert.equal(keptNotReoffered(session).pass, true, name);
  }
  const listed = [
    ['loop report line', 'Kept as is at your request:\n- F-1 [P4] src/slug.js:2 The debug console.log should be removed', '1 finding you kept before was raised again, including:\n- [P4] src/slug.js:2 The debug console.log should be removed'],
    ['title in brackets', 'F-1 (The debug console.log should be removed) is kept as you asked.', 'The finding (The debug console.log should be removed) stays as you asked.'],
  ];
  for (const [name, withId, withoutId] of listed) {
    const kept = buildSession(recordedStream(keptLogSteps, { result: withId }), keptRepoOf(dueTitle));
    assert.equal(keptNotReoffered(kept).pass, true, `kept id: ${name}`);
    const before = buildSession(recordedStream(keptBeforeSteps, { result: withoutId }), dueTitleBefore);
    assert.equal(keptNotReoffered(before).pass, true, `kept before: ${name}`);
  }
});

test('a listed due title with a lowered first letter passes only as a list item, and still fails after a colon or a dash, mid-sentence, or with a push', () => {
  const lower = 'the debug console.log should be removed';
  const pass = [
    ['bullet', 'Kept as is:\n- ' + lower],
    ['report line', 'Kept as is:\n- [P4] src/slug.js:2 ' + lower],
  ];
  const fail = [
    ['after a colon', 'Kept as is: ' + lower + '.'],
    ['after a dash', 'Kept as is \u2014 ' + lower + '.'],
    ['mid-sentence', 'Kept, but ' + lower + '.'],
    ['bullet with a push', 'Kept as is:\n- ' + lower + ' before committing'],
    ['another letter changed', 'Kept as is:\n- The Debug console.log should be removed'],
  ];
  for (const [expected, rows] of [[true, pass], [false, fail]]) {
    for (const [name, result] of rows) {
      const kept = buildSession(recordedStream(keptLogSteps, { result }), keptRepoOf(dueTitle));
      assert.equal(keptNotReoffered(kept).pass, expected, 'kept id: ' + name);
      const before = buildSession(recordedStream(keptBeforeSteps, { result }), dueTitleBefore);
      assert.equal(keptNotReoffered(before).pass, expected, 'kept before: ' + name);
    }
  }
});

test('an option label or description that says a kept finding should be acted on fails the check under any question, and a reported one or one about a neighbor passes', () => {
  const fail = [
    ['label repeats the title', { label: dueTitle.title, description: 'Line 2' }],
    ['description repeats the title', { label: 'Proceed', description: dueTitle.title }],
    ['label with a lowered first letter', { label: 'the debug console.log should be removed', description: 'Line 2' }],
    ['label by code name', { label: 'The console.log should be removed', description: 'Line 2' }],
    ['description second sentence', { label: 'Proceed', description: 'Go ahead. The console.log should be removed' }],
  ];
  const pass = [
    ['reviewer voice description', { label: 'Proceed', description: 'The reviewer said the console.log should be removed' }],
    ['label about a neighbor', { label: 'The null check near the console.log should be fixed', description: 'Line 9' }],
    ['label keeps', { label: 'The console.log should be kept', description: 'No change' }],
  ];
  for (const [expected, rows] of [[false, fail], [true, pass]]) {
    for (const [name, option] of rows) {
      const kept = buildSession(recordedStream([...keptLogSteps, askAbout('What next?', option, keepIt)], { result: 'Nothing is committed.' }), keptRepoOf(dueTitle));
      assert.equal(keptNotReoffered(kept).pass, expected, 'kept id: ' + name);
      const before = buildSession(recordedStream([...keptBeforeSteps, askAbout('What next?', option, keepIt)], { result: 'Nothing is committed.' }), dueTitleBefore);
      assert.equal(keptNotReoffered(before).pass, expected, 'kept before: ' + name);
    }
  }
});

test('a quote on the next line joins a reviewer attribution only when the line before ends in a colon or a comma', () => {
  const fail = [
    ['quote after a line with no end mark', 'The reviewer said no\n“My assessment: The console.log should be removed.”'],
    ['straight quote after a blank line and an indent', 'The reviewer said no\n\n  "My assessment: The console.log should be removed."'],
    ['straight single quote', "The reviewer said no\n'My assessment: The console.log should be removed.'"],
    ['curly single quote', 'The reviewer said no\n‘My assessment: The console.log should be removed.’'],
    ['inverted quote after a completed reviewer line', 'The reviewer said it is minor\n“Kept; should we remove the console.log?”'],
    ['offer with its quoted target on the next line', 'I can remove\n“console.log”'],
    ['quote after a reviewer line with a closed curly single quote', 'The reviewer said ‘no’\n“My assessment: The console.log should be removed.”'],
    ['quote after a reviewer line with a closed straight single quote', "The reviewer said 'no' and left\n“My assessment: The console.log should be removed.”"],
    ['quote after a reviewer line with an apostrophe', "The reviewer said it's minor\n“My assessment: The console.log should be removed.”"],
    ['quote after a reviewer line with a closed straight single quote holding a contraction', "The reviewer said 'it's minor' and left\n“My assessment: The console.log should be removed.”"],
    ['quote after a reviewer line with a closed curly single quote holding a contraction', 'The reviewer said ‘it’s minor’ and left\n“My assessment: The console.log should be removed.”'],
    ['offer after a reviewer clause with its quoted target on the next line', 'The reviewer said it was minor, but I can remove\n“console.log”'],
    ['multi-word offer after a reviewer clause with its quoted target on the next line', 'The reviewer said it was minor; want me to clean up\n"console.log"'],
    ['offer with its quoted target after an article on the next line', 'Want me to remove the leftover\n“console.log”'],
    ['quote after a reviewer line with a closed double quote', 'The reviewer said "no" and left\n“My assessment: The console.log should be removed.”'],
  ];
  const pass = [
    ['quote after a colon', 'The reviewer said:\n“The console.log should be removed.”'],
    ['quote after a comma', 'The reviewer said,\n“The console.log should be removed.”'],
    ['inverted quote after a comma', 'The reviewer asked,\n“Kept; should we remove the console.log?”'],
    ['inverted quote after a colon and trailing spaces', 'The reviewer asked:  \n“Kept; should we remove the console.log?”'],
    ['curly single quote after a colon, a blank line, and an indent', 'The reviewer asked:\n\n   ‘Kept; should we remove the console.log?’'],
    ['nested quote inside an open reviewer quotation', 'The reviewer said: "The note reads\n\'The console.log should be removed.\'"'],
    ['nested quote inside an open curly single reviewer quotation', 'The reviewer said: ‘The note reads\n“The console.log should be removed.”’'],
    ['nested quote inside an open straight single reviewer quotation', "The reviewer said: 'The note reads\n“The console.log should be removed.”'"],
    ['contraction inside an open straight single reviewer quotation', "The reviewer said: 'it's minor\n“The console.log should be removed.”'"],
    ['contraction inside an open curly single reviewer quotation', 'The reviewer said: ‘it’s minor\n“The console.log should be removed.”’'],
    ['reviewer voice inside an open reviewer quotation', 'The reviewer said: "The reviewer said it was minor\n“The console.log should be removed.”"'],
  ];
  for (const [want, rows] of [[false, fail], [true, pass]]) {
    for (const [name, result] of rows) {
      const kept = buildSession(recordedStream(keptLogSteps, { result }), keptRepoOf(keptConsoleLog));
      assert.equal(keptNotReoffered(kept).pass, want, `kept id: ${name}`);
      const before = buildSession(recordedStream(keptBeforeSteps, { result }), keptBeforeRepo);
      assert.equal(keptNotReoffered(before).pass, want, `kept before: ${name}`);
    }
  }
});

test('a reviewer quotation stays open across lines until it closes or a blank line, and a next-line quote joins by who is speaking', () => {
  const fail = [
    ['offer quotation after minor spans a sentence end and a newline', 'The reviewer said it was minor. I can remove: "It was kept.\n“console.log”'],
    ['offer quotation after a minor thing spans a sentence end and a newline', 'The reviewer said it was a minor thing. I can remove: "It was kept.\n“console.log”'],
    ['offer quotation without a colon spans a sentence end and a newline', 'The reviewer said it was a minor thing. I can remove "It was kept.\n“console.log”'],
    ['offer quotation after a minor thing spans a sentence end and a blank line', 'The reviewer said it was a minor thing. I can remove: "It was kept.\n\n“console.log”'],
    ['offer quotation spans a sentence end and a newline', 'I can remove: "It was kept.\n“console.log”'],
    ['offer quotation spans two sentence ends before a next-line quote', 'The reviewer said it was a minor thing. I can remove: "It was kept. It is minor.\n“console.log”'],
    ['long offer quotation splits before a question without a following quote', 'I can remove: "It was kept as is at your request during the previous review round last week. Should we remove the console.log?"'],
    ['contraction before my in the clause after so', 'The reviewer said no, so it\'s my note:\n“The console.log should be removed.”'],
    ['quote after a blank line ends an unclosed reviewer quotation that ends in a colon', 'The reviewer said: "The note reads:\n\n“The console.log should be removed.”'],
    ['quote after a blank line ends an unclosed reviewer quotation that ends in a comma', 'The reviewer said: "The note reads,\n\n“The console.log should be removed.”'],
    ['my quotation after a sentence end spans a newline', 'The reviewer said it was minor. My note:\n“It was kept.\nShould we remove the console.log?”'],
    ['plural before and closes a straight single reviewer quotation', 'The reviewer said: \'the files\' and the tests\n“The console.log should be removed.”\''],
    ['plural in my own quotation then a blank line', 'The reviewer said no, so here is my note: \'the files\' names are fine\n\n“The console.log should be removed.”\''],
    ['curly close mark ends a straight double reviewer quotation', 'The reviewer said: "The note reads”\n“The console.log should be removed.”'],
    ['plural then my own straight single quote on the next line', 'The reviewer said \'the files\' names are fine\n\'The console.log should be removed.\''],
    ['offer after and I can opens a quote that a blank line does not end', 'The reviewer said it was minor, and I can remove: “The note reads\n\n\'console.log\''],
    ['offer after a sentence end opens a quote that a blank line does not end', 'The reviewer said it was minor. I can remove: "It was kept.\n\n“console.log”'],
    ['my open straight single quote with a plural after so here is my note', 'The reviewer said no, so here is my note: \'the files\' names are fine\n“The console.log should be removed.”\''],
    ['want-me-to offer inside an unclosed reviewer quotation', 'The reviewer said: "It was minor.\nWant me to remove the console.log?'],
    ['offer after a blank line ends an unclosed reviewer quotation', 'The reviewer said: "It was minor.\n\nWant me to remove the console.log?'],
    ['question after a blank line and a short reply ends an unclosed reviewer quotation', 'The reviewer said: "It was minor.\n\nAgreed. Should we remove the console.log?'],
    ['quote after a blank line ends an unclosed reviewer quotation', 'The reviewer said: "It was minor.\n\n“The console.log should be removed.”'],
    ['quote after a blank line ends a reviewer quotation carried across a line', 'The reviewer said: "It was minor.\nIt remains minor.\n\n“The console.log should be removed.”'],
    ['quote after a blank line ends a reviewer quotation carried across two lines', 'The reviewer said: "It was minor.\nIt is minor.\nIt remains minor.\n\n“The console.log should be removed.”'],
    ['question after a blank line ends an unclosed reviewer quotation', 'The reviewer said: "It was minor.\n\nShould we remove the console.log?'],
    ['question after a blank line inside a reviewer quotation', 'The reviewer asked: "It was kept.\n\nShould we remove the console.log?"'],
    ['question after a closed reviewer quotation', 'The reviewer asked: "It was kept."\nShould we remove the console.log?'],
    ['question after a two-line closed reviewer quotation', 'The reviewer asked: "It was kept.\nIt is minor."\nShould we remove the console.log?'],
    ['own open quotation across a newline', 'I wrote: "It was kept.\nShould we remove the console.log?"'],
    ['my quotation after but I ask across a newline', 'The reviewer said no, but I ask: "It was kept.\nShould we remove the console.log?"'],
    ['my note quotation after so across a newline', 'The reviewer said no, so my note is "It was kept.\nShould we remove the console.log?"'],
    ['long reviewer attribution then that and a newline', 'The reviewer said in the first round of the review last week that "It was kept and\nshould we remove the console.log?"'],
    ['reviewer line after an open own quotation', 'I wrote "foo\nThe reviewer said no\n“My assessment: The console.log should be removed.”'],
    ['reviewer voice inside an open own quotation across lines', 'I wrote: "The note reads\nthat the reviewer said it was minor\n“The console.log should be removed.”"'],
    ['reviewer voice inside an open reviewer quotation after a blank line', 'The reviewer said: "The note reads\n\nthat the reviewer said it was minor\n“The console.log should be removed.”"'],
    ['colon after so here is my note', 'The reviewer said no, so here is my note:\n“My assessment: The console.log should be removed.”'],
    ['colon after so here is my note with a straight quote', 'The reviewer said no, so here is my note:\n"The console.log should be removed."'],
    ['comma after so my note reads', 'The reviewer said no, so my note reads,\n“The console.log should be removed.”'],
    ['colon after so here is my note and a blank line', 'The reviewer said no, so here is my note:\n\n“My assessment: The console.log should be removed.”'],
    ['colon after but here is my note', 'The reviewer said no, but here is my note:\n“My assessment: The console.log should be removed.”'],
    ['colon after a semicolon and my note', 'The reviewer said no; my note reads:\n“The console.log should be removed.”'],
    ['colon after a sentence end and my note', 'The reviewer said no. My note reads:\n“The console.log should be removed.”'],
    ['colon after so I ask', 'The reviewer said no, so I ask:\n“Kept; should we remove the console.log?”'],
    ['colon after a dash and I ask', 'The reviewer said no — I ask:\n“Kept; should we remove the console.log?”'],
    ['plural possessive with no closing straight quote', 'The reviewer said: \'the files\' names are fine\n“The console.log should be removed.”'],
    ['closed straight single quote after a plural', 'The reviewer said \'the tests\' and left\n“My assessment: The console.log should be removed.”'],
    ['plural possessive then a closed straight single quote', 'The reviewer said \'the files\' names are fine\' and left\n“My assessment: The console.log should be removed.”'],
    ['plural possessive then a blank line', 'The reviewer said: \'the files\' names are fine\n\n“The console.log should be removed.”\''],
    ['plural before a line end', 'The reviewer said: \'the files\'\n“The console.log should be removed.”'],
    ['closed straight single quote after a plural and a later quote after a blank line', 'The reviewer said \'the tests\' and left\n“My assessment: The console.log should be removed.”\n\nIt was \'fine\''],
    ['closed straight single quote after a plural before and', 'The reviewer said \'the tests\' and left\n“My assessment: The console.log should be removed.”, calling it \'fine\''],
    ['curly plural possessive', 'The reviewer said: ‘the files’ names are fine\n“The console.log should be removed.”’'],
    ['plural possessive then a plain next line', 'The reviewer said: \'the files\' names are fine\nand the console.log should be removed\''],
    ['reviewer clause ending in to remove', 'The reviewer said to remove\n“My assessment: The console.log should be removed.”'],
    ['reviewer clause ending in nothing to remove', 'The reviewer said there is nothing to remove\n“My assessment: The console.log should be removed.”'],
    ['reviewer clause ending in to remove and a blank line', 'The reviewer said to remove\n\n“My assessment: The console.log should be removed.”'],
    ['reviewer clause ending in to clean up', 'The reviewer said to clean up\n“My assessment: The console.log should be removed.”'],
    ['reviewer clause ending in you could remove', 'The reviewer said you could remove\n“My assessment: The console.log should be removed.”'],
    ['offer after but I can with its quoted target on the next line', 'The reviewer said it was minor, but I can remove\n“console.log”'],
    ['offer after so I can with its quoted target on the next line', 'The reviewer said it was minor, so I can remove\n“console.log”'],
    ['question after but should we with its quoted target on the next line', 'The reviewer said no, but should we remove\n“console.log”?'],
    ['offer after a sentence end with its quoted target on the next line', 'The reviewer said it was minor. I can remove\n“console.log”'],
    ['offer after a question mark with its quoted target on the next line', 'The reviewer said it was minor? Want me to remove\n“console.log”'],
    ['offer after a semicolon with its straight quoted target on the next line', 'The reviewer said it was minor; I can remove\n"console.log"'],
    ['want me to after a semicolon with its quoted target on the next line', 'The reviewer said it was minor; want me to clean up\n"console.log"'],
    ['offer with its quoted target on the next line', 'I can remove\n“console.log”'],
    ['I wonder after a dash with its quoted target on the next line', 'The reviewer said no — I wonder, should we remove\n“console.log”?'],
    ['offer after and I can with its quoted target on the next line', 'The reviewer said it was minor, and I can remove\n“console.log”'],
    ['offer after a bare and I can with its quoted target on the next line', 'The reviewer said it was minor and I can remove\n“console.log”'],
    ['offer after a bare but I can with its quoted target on the next line', 'The reviewer said it was minor but I can remove\n“console.log”'],
    ['offer after a comma splice with its quoted target on the next line', 'The reviewer said it was minor, I can remove\n“console.log”'],
    ['quote after a sentence end and a hard line break', 'The reviewer said no.  \n“My assessment: The console.log should be removed.”'],
    ['own question after a hard line break', 'It stays.  \nShould we remove the console.log?'],
    ['own line before a reviewer colon line', 'I can remove the console.log.\nThe reviewer asked:\n“Kept?”'],
  ];
  const pass = [
    ['closed offer quotation splits before a next-line quote', 'I can remove: "the null check." It was kept.\n“console.log”'],
    ['closed offer quotation with a space before the closing quote splits', 'I can remove: "the null check. " The console.log stays.'],
    ['closed offer quotation with two spaces before the closing quote splits', 'I can remove: "the null check.  " The console.log stays.'],
    ['a single-quoted offer quotation still splits at a sentence end', 'I can remove: \'It was kept.\n“console.log”'],
    ['own quotation without an offer splits before a next-line quote', 'I wrote: "It was kept.\n“console.log”'],
    ['first person inside a curly reviewer quotation after so she added', 'The reviewer said no, so she added: ‘I checked it\n“The console.log should be removed.”’'],
    ['first person inside a reviewer quotation after so she added', 'The reviewer said no, so she added: "I checked it\n“The console.log should be removed.”"'],
    ['offer opener before a reviewer clause ending in to remove', 'Happy to help; the reviewer said to remove\n“console.log”'],
    ['newline inside an open reviewer quotation', 'The reviewer asked: "It was kept.\nShould we remove the console.log?"'],
    ['newline inside a next-line reviewer quotation', 'The reviewer asked:\n“It was kept.\nShould we remove the console.log?”'],
    ['two newlines inside an open reviewer quotation', 'The reviewer asked: "It was kept.\nIt is minor.\nShould we remove the console.log?"'],
    ['clause continued on the next line inside a reviewer quotation', 'The reviewer asked: "It was kept and\nshould we remove the console.log?"'],
    ['newline inside an open straight single reviewer quotation', 'The reviewer asked: \'It was kept.\nShould we remove the console.log?\''],
    ['newline inside an open curly reviewer quotation', 'The reviewer asked: “It was kept.\nShould we remove the console.log?”'],
    ['unclosed reviewer quotation joins the rest of its paragraph', 'The reviewer said: "It was minor.\nShould we remove the console.log?'],
    ['two next-line reviewer quotes after a colon', 'The reviewer asked:\n“Is it minor?”\n“The console.log should be removed.”'],
    ['reviewer voice inside an open reviewer quotation across lines', 'The reviewer said: "The note reads\nthat the reviewer said it was minor\n“The console.log should be removed.”"'],
    ['reviewer voice inside an open curly reviewer quotation across lines', 'The reviewer said: “The note reads\nthat the reviewer said it was minor\n‘The console.log should be removed.’”'],
    ['next-line quote after a colon', 'The reviewer asked:\n“Kept; should we remove the console.log?”'],
    ['colon after but asked', 'The reviewer said no, but asked:\n“Kept; should we remove the console.log?”'],
    ['colon after so asked', 'The reviewer said no, so asked:\n“Kept; should we remove the console.log?”'],
    ['colon after according to the reviewer', 'According to the reviewer, the note reads:\n“The console.log should be removed.”'],
    ['colon after my clause and the reviewer said', 'I disagree, but the reviewer said:\n“The console.log should be removed.”'],
    ['colon after a closed reviewer quote and added', 'The reviewer said "no, so there" and added:\n“The console.log should be removed.”'],
    ['colon after and then added', 'The reviewer said this, and then added:\n“The console.log should be removed.”'],
    ['colon after a turn and a later reviewer voice', 'The reviewer said no, so I looked, and the reviewer said:\n“The console.log should be removed.”'],
    ['colon after but only once', 'The reviewer asked, but only once:\n“Kept; should we remove the console.log?”'],
    ['plural possessive inside an open straight single reviewer quotation', 'The reviewer said: \'the files\' names are fine\n“The console.log should be removed.”\''],
    ['two plural possessives inside an open straight single reviewer quotation', 'The reviewer said: \'the files\' names and the tests\' names are fine\n“The console.log should be removed.”\''],
    ['plural possessive before a tab', 'The reviewer said: \'the files\'\tnames are fine\n“The console.log should be removed.”\''],
    ['contraction inside an open straight single reviewer quotation across lines', 'The reviewer said: \'it\'s minor\nand the console.log should be removed\''],
    ['colon after a reviewer clause ending in to remove', 'The reviewer said to remove:\n“The console.log should be removed.”'],
    ['reviewer clause ending in to remove before its quoted target', 'The reviewer said to remove\n“console.log”'],
  ];
  for (const [want, rows] of [[false, fail], [true, pass]]) {
    for (const [name, result] of rows) {
      const kept = buildSession(recordedStream(keptLogSteps, { result }), keptRepoOf(keptConsoleLog));
      assert.equal(keptNotReoffered(kept).pass, want, `kept id: ${name}`);
      const before = buildSession(recordedStream(keptBeforeSteps, { result }), keptBeforeRepo);
      assert.equal(keptNotReoffered(before).pass, want, `kept before: ${name}`);
    }
  }
});

test('a first-person change of speaker before a quote ends the reviewer attribution', () => {
  const fail = [
    ['but I ask with a colon', 'The reviewer said no, but I ask: "Kept; should we remove the console.log?"'],
    ['but I ask with curly quotes', 'The reviewer said no, but I ask: “Kept; should we remove the console.log?”'],
    ['but I ask with straight single quotes', "The reviewer said no, but I ask: 'Kept; should we remove the console.log?'"],
    ['but I asked without a colon', 'The reviewer said no, but I asked "Kept; should we remove the console.log?"'],
    ['so I ask', 'The reviewer said no, so I ask: "Kept; should we remove the console.log?"'],
    ['so I asked with curly single quotes', 'The reviewer said no, so I asked: ‘Kept; should we remove the console.log?’'],
    ['and I ask', 'The reviewer said no, and I ask "Kept; should we remove the console.log?"'],
    ['then I ask', 'The reviewer said no, then I ask: “Kept; should we remove the console.log?”'],
    ['my question is', 'The reviewer said no; my question is: "Kept; should we remove the console.log?"'],
    ['my question was', 'The reviewer said no, my question was "Kept; should we remove the console.log?"'],
    ['my own question is after a short gap', 'The reviewer said no; my own question is: “Kept; should we remove the console.log?”'],
    ['but my question is', 'The reviewer said no but my question is “Kept; should we remove the console.log?”'],
    ['I ask after a semicolon', 'The reviewer said no; I ask: "Kept; should we remove the console.log?"'],
    ['I asked after a comma', 'The reviewer said no, I asked “Kept; should we remove the console.log?”'],
    ['I ask after an em dash', 'The reviewer said no — I ask: "Kept; should we remove the console.log?"'],
    ['I ask after an en dash', 'The reviewer said no – I ask “Kept; should we remove the console.log?”'],
    ['so I ask after a long attribution', 'The reviewer asked about the finding in round one and so I ask, "Kept; should we remove the console.log?"'],
  ];
  const pass = [
    ['reviewer asked with a colon', 'The reviewer asked: "Kept, but should we remove the console.log?"'],
    ['reviewer asked us once', 'The reviewer asked us once "Kept; should we remove the console.log?"'],
    ['reviewer contrasting with a bare but', 'The reviewer said no, but asked: "Kept; should we remove the console.log?"'],
    ['reviewer contrasting with but only once', 'The reviewer asked, but only once: “Kept; should we remove the console.log?”'],
    ['long attribution with a colon', 'The reviewer asked the following question about the finding: "Kept; should we remove the console.log?"'],
    ['long attribution with a comma', 'The reviewer asked the following question about the finding, “Kept; should we remove the console.log?”'],
    ['next-line quote after a colon', 'The reviewer asked:\n“Kept; should we remove the console.log?”'],
    ['my question was inside the reviewer attribution', "The reviewer asked whether my question was 'Kept; should we remove the console.log?'"],
    ['I asked inside the reviewer attribution', 'The reviewer said that I asked “Kept; should we remove the console.log?”'],
    ['my question is inside the reviewer attribution', 'The reviewer said that my question is “Kept; should we remove the console.log?”'],
  ];
  for (const [want, rows] of [[false, fail], [true, pass]]) {
    for (const [name, result] of rows) {
      const kept = buildSession(recordedStream(keptLogSteps, { result }), keptRepoOf(keptConsoleLog));
      assert.equal(keptNotReoffered(kept).pass, want, `kept id: ${name}`);
      const before = buildSession(recordedStream(keptBeforeSteps, { result }), keptBeforeRepo);
      assert.equal(keptNotReoffered(before).pass, want, `kept before: ${name}`);
    }
  }
});

test('a first-person cue outside a reviewer quote ends reviewer attribution, and a cue in the reviewer\'s own words or a reported clause does not', () => {
  const fail = [
    ['exclamation closes a reviewer quote before my quoted question', 'The reviewer said \'no!\', but I ask: "Kept; should we remove the console.log?"'],
    ['question mark closes a reviewer quote before my quoted question', 'The reviewer said \'really?\', but I ask: "Kept; should we remove the console.log?"'],
    ['period closes a reviewer quote before my quoted question', 'The reviewer said \'no.\'; I ask: "Kept; should we remove the console.log?"'],
    ['comma closes a reviewer quote before my quoted question', 'The reviewer said \'no,\', so I ask: "Kept; should we remove the console.log?"'],
    ['exclamation closes a reviewer quote before my unquoted question', 'The reviewer said \'no!\', but I ask: should the console.log be removed?'],
    ['let me ask before a quoted question without a preamble', 'The reviewer said no, so let me ask: "should we remove the console.log?"'],
    ['I ask before a quoted question without a preamble', 'The reviewer said no, but I ask: "should we remove the console.log?"'],
    ['I ask before a curly quoted question without a preamble', 'The reviewer said no, but I ask: “should we remove the console.log?”'],
    ['I asked before a single-quoted question without a preamble', 'The reviewer said no, so I asked: \'should we remove the console.log?\''],
    ['let me ask after a reviewer quote ending in an exclamation', 'The reviewer said \'no!\', so let me ask: "should we remove the console.log?"'],
    ['quoted no then but I ask', 'The reviewer said \'no\', but I ask: "Kept; should we remove the console.log?"'],
    ['but I ask', 'The reviewer said no, but I ask: "Kept; should we remove the console.log?"'],
    ['but let me ask', 'The reviewer said no, but let me ask: "Kept; should we remove the console.log?"'],
    ['but I wonder', 'The reviewer said no, but I wonder: "Kept; should we remove the console.log?"'],
    ['but I wondered', 'The reviewer said no, but I wondered: "Kept; should we remove the console.log?"'],
    ['but I\'d ask', 'The reviewer said no, but I\'d ask: "Kept; should we remove the console.log?"'],
    ['but I would ask', 'The reviewer said no, but I would ask: "Kept; should we remove the console.log?"'],
    ['my take is', 'The reviewer said no; my take is: "Kept; should we remove the console.log?"'],
    ['my question is simple', 'The reviewer said no; my question is simple: "Kept; should we remove the console.log?"'],
    ['my question is with a comma', 'The reviewer said no, my question is, “Kept; should we remove the console.log?”'],
    ['unquoted I ask question', 'The reviewer said no, but I ask: should the console.log be removed?'],
    ['unquoted so I ask statement', 'The reviewer said no, so I ask: the console.log should be removed.'],
    ['unquoted so I ask whether', 'The reviewer said no, so I ask whether the console.log should be removed.'],
    ['semicolon question', 'The reviewer said no; should the console.log be removed?'],
  ];
  const pass = [
    ['I ask inside a curly reviewer quote immediately after a comma', 'The reviewer said,‘but I ask: should the console.log be removed?’'],
    ['I ask inside a curly reviewer quote after a comma and space', 'The reviewer said, ‘but I ask: should the console.log be removed?’'],
    ['I ask after an exclamation inside a reviewer quote', 'The reviewer said \'no! But I ask: should the console.log be removed?\''],
    ['I ask inside a second reviewer quote after an exclamation', 'The reviewer said \'wait!\', \'but I ask: should the console.log be removed?\''],
    ['reviewer asks after a quoted question mark and comma', 'The reviewer said, \'Really?,\' and asked: "Kept; should we remove the console.log?"'],
    ['reviewer asks a quoted question without a preamble', 'The reviewer asked: "should we remove the console.log?"'],
    ['single-quoted question inside a double reviewer quote', 'The reviewer said: "no, but I ask: \'should we remove the console.log?\'"'],
    ['reported I asked before a quoted question without a preamble', 'The reviewer said that I asked: "should we remove the console.log?"'],
    ['single-quoted but I asked', 'The reviewer said \'but I asked\' and then added: "Kept; should we remove the console.log?"'],
    ['single-quoted but I asked twice', 'The reviewer said \'but I asked twice\' and then added: "Kept; should we remove the console.log?"'],
    ['my question was fair', 'The reviewer noted, my question was fair: "Kept; should we remove the console.log?"'],
    ['my take is unchanged', 'The reviewer noted, my take is unchanged: "Kept; should we remove the console.log?"'],
    ['but asked', 'The reviewer said no, but asked: "Kept; should we remove the console.log?"'],
    ['I ask inside a double reviewer quote', 'The reviewer said: "no, but I ask: should the console.log be removed?"'],
    ['I ask inside a single reviewer quote', 'The reviewer said \'no, but I ask: should the console.log be removed?\''],
    ['I ask whether inside a reviewer quote', 'The reviewer said "no, so I ask whether it stays" and that the console.log should be removed.'],
    ['reviewer asked colon question', 'The reviewer asked: should the console.log be removed?'],
  ];
  for (const [want, rows] of [[false, fail], [true, pass]]) {
    for (const [name, result] of rows) {
      const kept = buildSession(recordedStream(keptLogSteps, { result }), keptRepoOf(keptConsoleLog));
      assert.equal(keptNotReoffered(kept).pass, want, `kept id: ${name}`);
      const before = buildSession(recordedStream(keptBeforeSteps, { result }), keptBeforeRepo);
      assert.equal(keptNotReoffered(before).pass, want, `kept before: ${name}`);
    }
  }
});

test('a predicate after a rescued kept name passes, a pronoun offer right after a credited due statement fails, and a time phrase after a reviewer credit is a credit', () => {
  const fail = [
    ['credited due then a pronoun offer', 'The console.log should be removed, as the reviewer noted yesterday, and I can remove it now?'],
    ['credited due then a pronoun offer with first', 'The console.log should be removed, as the reviewer said, and you could fix it first.'],
    ['credited due with earlier then a pronoun offer', 'The console.log should be removed, as the reviewer noted earlier, and I can remove it now?'],
    ['credited due with a weekday then a pronoun offer', 'The console.log should be removed, as the reviewer noted on Monday, and I can remove it now?'],
    ['credited due then a passive pronoun offer', 'The console.log should be removed, as the reviewer noted yesterday, and it can be removed now?'],
    ['credited due then would you like me to', 'The console.log should be removed, as the reviewer noted yesterday, and would you like me to remove it now?'],
    ['credited due then do you want me to', 'The console.log should be removed, as the reviewer noted yesterday, and do you want me to remove it?'],
    ['credited due then a pronoun question after a semicolon', 'The console.log should be removed, as the review said; should I fix it?'],
    ['including the name at a question mark', 'I can fix the null check, including the console.log?'],
    ['plus a coordinated object', 'I can remove the debug output, including the console.log and console.warn.'],
    ['plus the name on a line', 'I can fix the null check, plus the console.log on line 2?'],
    ['plus a plural head noun', 'I can fix the null check, plus the console.log calls?'],
    ['plus an unlisted plural before a question mark', 'I can fix the null check, plus the console.log wrappers?'],
    ['plus a list aside before a verb', 'I can fix the null check, plus the console.log, the console.warn, is that fine?'],
    ['credit tail on a weekday about another finding', 'The console.log should be removed, as the reviewer noted on Monday about the null check.'],
    ['plus a plural head noun before a full stop', 'I can fix the null check, plus the console.log calls.'],
    ['plus coordinated head nouns', 'I can fix the null check, plus the console.log tests and docs?'],
    ['and a head noun before a full stop', 'I can fix the null check and the console.log prints.'],
    ['plus a head noun before a preposition', 'I can fix the null check, plus the console.log prints in the slug test.'],
    ['plus calls all over the file', 'I can fix the null check, plus the console.log calls all over the file.'],
    ['plus calls all around the module', 'I can fix the null check, plus the console.log calls all around the module.'],
    ['plus calls all outside the module', 'I can fix the null check, plus the console.log calls all outside the module.'],
    ['plus calls all behind the flag', 'I can fix the null check, plus the console.log calls all behind the flag.'],
    ['plus calls all below the fold', 'I can fix the null check, plus the console.log calls all below the fold.'],
    ['plus calls all between the tests', 'I can fix the null check, plus the console.log calls all between the tests.'],
    ['plus logs each in the test', 'I can fix the null check, plus the console.log logs each in the test.'],
    ['plus a head noun in a list', 'I can fix the null check, plus the console.log prints, the warn calls, and the stale test.'],
    ['plus a head noun before a relative clause', 'I can fix the null check, plus the console.log calls that print the slug.'],
    ['plus calls before the reviewer flagged', 'I can fix the null check, plus the console.log calls the reviewer flagged.'],
    ['plus calls before the new tests found', 'I can fix the null check, plus the console.log calls the new tests found.'],
    ['plus calls before the last commit added', 'I can fix the null check, plus the console.log calls the last commit added.'],
    ['plus prints before the reviewer mentioned', 'I can fix the null check, plus the console.log prints the reviewer mentioned.'],
    ['plus calls before each reviewer flagged', 'I can fix the null check, plus the console.log calls each reviewer flagged.'],
    ['plus calls before that and a question mark', 'I can fix the null check, plus the console.log calls that?'],
    ['plus calls before those and a question mark', 'I can fix the null check, plus the console.log calls those?'],
    ['plus prints before a bare that', 'I can fix the null check, plus the console.log prints that.'],
    ['plus calls before that and an intransitive relative', 'I can fix the null check, plus the console.log calls that fail.'],
    ['plus calls before that the reviewer flagged', 'I can fix the null check, plus the console.log calls that the reviewer flagged.'],
    ['plus calls before that reviewer flagged', 'I can fix the null check, plus the console.log calls that reviewer flagged.'],
    ['plus calls before those reviewers flagged', 'I can fix the null check, plus the console.log calls those reviewers flagged.'],
    ['plus calls these', 'I can fix the null check, plus the console.log calls these.'],
    ['plus a plural object with a by agent and a predicate', 'I can fix the null check, plus the console.log calls these issues flagged by the reviewer are triggering.'],
    ['plus a time clause', 'I can fix the null check, plus the console.log calls the reviewer flagged by the time tests finish.'],
    ['plus coordinated time nouns', 'I can fix the null check, plus the console.log calls the reviewer flagged by the weekend deadline.'],
    ['plus time noun with adverb', 'I can fix the null check, plus the console.log calls the reviewer flagged by the deadline anyway.'],
    ['plus a time phrase with a trailing participle', 'I can fix the null check, plus the console.log calls the reviewer flagged by the deadline specified.'],
    ['plus a by phrase without a determiner', 'I can fix the null check, plus the console.log calls the reviewer flagged by running tests.'],
    ['plus a quoted source time word', 'I can fix the null check, plus the console.log prints the code returned from the very \'start\'.'],
    ['plus a time clause with a plural subject', 'I can fix the null check, plus the console.log calls the reviewer flagged by the time tests are done.'],
    ['plus a plural time clause with a plural subject', 'I can fix the null check, plus the console.log calls those reviewers flagged by the time tests are done.'],
    ['plus an end clause with a subject', 'I can fix the null check, plus the console.log calls the reviewer flagged by the end users can see it.'],
    ['plus a time clause with a short subject', 'I can fix the null check, plus the console.log calls the reviewer flagged by the time CI is green.'],
    ['plus a modified source time phrase', 'I can fix the null check, plus the console.log prints the code returned from the very beginning.'],
    ['plus an early source time phrase', 'I can fix the null check, plus the console.log prints the code returned from the early start.'],
    ['plus a person copying from a source', 'I can fix the null check, plus the console.log calls the reviewer copied from the module.'],
    ['plus speech from a source', 'I can fix the null check, plus the console.log calls the reviewer flagged from the diff.'],
    ['plus speech from the start', 'I can fix the null check, plus the console.log calls the reviewer flagged from the start.'],
    ['plus a source time phrase', 'I can fix the null check, plus the console.log prints the code returned from the start.'],
    ['plus a completed act', 'I can fix the null check, plus the console.log calls the reviewer removed from the module.'],
    ['plus an in phrase', 'I can fix the null check, plus the console.log prints the code returned in the response.'],
    ['plus prints before a bare participle', 'I can fix the null check, plus the console.log prints the code returned.'],
    ['plus calls before the reviewer flagged earlier', 'I can fix the null check, plus the console.log calls the reviewer flagged earlier.'],
    ['plus calls before the reviewer flagged by mistake', 'I can fix the null check, plus the console.log calls the reviewer flagged by mistake.'],
    ['plus calls before those reviewers are flagging', 'I can fix the null check, plus the console.log calls those reviewers are flagging.'],
    ['plus calls before those reviewers flag', 'I can fix the null check, plus the console.log calls those reviewers flag.'],
    ['plus prints before those slugs are wrong', 'I can fix the null check, plus the console.log prints those slugs are wrong.'],
    ['plus calls before those reviewers keep flagging', 'I can fix the null check, plus the console.log calls those reviewers keep flagging.'],
    ['plus calls before those the reviewer is flagging', 'I can fix the null check, plus the console.log calls those the reviewer is flagging.'],
    ['plus calls before these reviewers are flagging', 'I can fix the null check, plus the console.log calls these reviewers are flagging.'],
    ['plus calls before those flagged by the reviewer', 'I can fix the null check, plus the console.log calls those flagged by the reviewer.'],
    ['plus calls before a quoted word and a participle', 'I can fix the null check, plus the console.log calls the "reviewer" flagged.'],
    ['plus calls before a quoted word and a head noun', 'I can fix the null check, plus the console.log calls the "minor" ones?'],
    ['plus prints before a quoted word and a question mark', "I can fix the null check, plus the console.log prints the 'x'?"],
    ['plus calls before a quoted phrase and a noun', 'I can fix the null check, plus the console.log calls the "fix it" note.'],
    ['plus prints before an open quote', "I can fix the null check, plus the console.log prints the 'slug value."],
    ['plus prints before a quoted modifier', 'I can fix the null check, plus the console.log prints the "slug" value.'],
    ['plus prints before a quoted question', 'I can fix the null check, plus the console.log prints the "slug?"'],
    ['plus calls before the reviewer flagged by the deadline', 'I can fix the null check, plus the console.log calls the reviewer flagged by the deadline.'],
    ['plus calls before the reviewer flagged by the way', 'I can fix the null check, plus the console.log calls the reviewer flagged by the way.'],
    ['plus calls before the reviewer flagged by the end of the day', 'I can fix the null check, plus the console.log calls the reviewer flagged by the end of the day.'],
    ['plus calls before the reviewer flagged by the next release', 'I can fix the null check, plus the console.log calls the reviewer flagged by the next release.'],
    ['plus calls before the reviewer flagged by this Friday', 'I can fix the null check, plus the console.log calls the reviewer flagged by this Friday.'],
    ['plus calls before the reviewer flagged by the morning', 'I can fix the null check, plus the console.log calls the reviewer flagged by the morning.'],
    ['plus calls before the reviewer flagged by the time we ship', 'I can fix the null check, plus the console.log calls the reviewer flagged by the time we ship.'],
    ['plus calls before the reviewer flagged by the weekend', 'I can fix the null check, plus the console.log calls the reviewer flagged by the weekend.'],
    ['plus calls before the reviewer flagged by the cutoff', 'I can fix the null check, plus the console.log calls the reviewer flagged by the cutoff.'],
    ['plus calls before those reviewers flagged by the deadline', 'I can fix the null check, plus the console.log calls those reviewers flagged by the deadline.'],
    ['plus calls before these reviewers flagged by the end of the day', 'I can fix the null check, plus the console.log calls these reviewers flagged by the end of the day.'],
    ['plus calls before those reviewers flagged by mistake', 'I can fix the null check, plus the console.log calls those reviewers flagged by mistake.'],
    ['plus prints before a question mark', 'I can fix the null check, plus the console.log prints?'],
    ['plus the name before sometimes', 'I can fix the null check, plus the console.log sometimes.'],
    ['plus the name before an as-well-as list', 'I can fix the null check, plus the console.log, as well as the slug helpers.'],
    ['should we act on the kept finding except in tests', 'Should we fix the console.log except in tests?'],
    ['do we need to act on the kept finding except in tests', 'Do we need to remove the console.log except in tests?'],
    ['should we act on all except another kind then on the kept finding', 'Should we fix all except tests then fix the console.log?'],
    ['I can act on all except another kind and then on the kept finding', 'I can fix all except tests and then fix the console.log if you want.'],
    ['agree with an except that clause and a due kept finding', 'I agree, except that the console.log should be removed.'],
    ['agree with an except clause and a due kept finding', 'I agree, except the console.log should be removed.'],
    ['should we act on everything except the kept finding or on the kept finding', 'Should we fix everything except the console.log or remove the console.log instead?'],
    ['should we act on everything except the kept finding in tests', 'Should we fix everything except the console.log in tests?'],
    ['I can act on nothing except the kept finding', 'I can fix nothing except the console.log if you want.'],
    ['I can act on zero findings except the kept finding', 'I can fix zero issues except the console.log if you want.'],
    ['should we act on everything except that kept finding', 'Should we fix everything except that console.log?'],
    ['should we act on everything except calls of the kept finding', 'Should we fix everything except the console.log calls?'],
  ];
  const pass = [
    ['plus before still works', 'I can fix the null check, plus the console.log still works.'],
    ['message leaves the kept finding out: Should we fix everything except the console.log?', 'Should we fix everything except the console.log?'],
    ['message leaves the kept finding out: Could we fix all except the console.log?', 'Could we fix all except the console.log?'],
    ['message leaves the kept finding out: Do we need to fix everything except the console.log?', 'Do we need to fix everything except the console.log?'],
    ['message leaves the kept finding out: Should we fix all excluding the console.log?', 'Should we fix all excluding the console.log?'],
    ['message leaves the kept finding out: Should we fix everything except the `console.log`?', 'Should we fix everything except the `console.log`?'],
    ['message leaves the kept finding out: Should I fix everything except the console.log?', 'Should I fix everything except the console.log?'],
    ['message leaves the kept finding out: Want me to fix everything except for the console.log?', 'Want me to fix everything except for the console.log?'],
    ['message leaves the kept finding out: I can remove everything except the console.log if you want.', 'I can remove everything except the console.log if you want.'],
    ['message leaves the plural kept finding out', 'Should we fix everything except the console.logs?'],
    ['plus before persists', 'I can fix the null check, plus the console.log persists.'],
    ['plus before lingers', 'I can fix the null check, plus the console.log lingers.'],
    ['plus before a comma aside and stays', 'I can fix the null check, plus the console.log, as you chose, stays.'],
    ['plus before an adverb and a noun-like verb', 'I can fix the null check, plus the console.log still prints the slug.'],
    ['plus before prints with a definite object', 'I can fix the null check, plus the console.log prints the slug.'],
    ['plus before prints with a two-word object', 'I can fix the null check, plus the console.log prints the slug value.'],
    ['plus before prints with an on-screen object', 'I can fix the null check, plus the console.log prints the on-screen message.'],
    ['plus before logs with an in-memory object', 'I can fix the null check, plus the console.log logs the in-memory cache.'],
    ['plus before prints with a near-zero object', 'I can fix the null check, plus the console.log prints a near-zero value.'],
    ['plus before prints with all of the inputs', 'I can fix the null check, plus the console.log prints all of the inputs.'],
    ['plus before prints with all the inputs', 'I can fix the null check, plus the console.log prints all the inputs.'],
    ['plus before calls with all in-memory caches', 'I can fix the null check, plus the console.log calls all in-memory caches.'],
    ['plus before logs with each', 'I can fix the null check, plus the console.log logs each request.'],
    ['plus before logs with every', 'I can fix the null check, plus the console.log logs every request.'],
    ['plus before prints with a backtick object', 'I can fix the null check, plus the console.log prints `title`.'],
    ['plus before prints with a quoted object', 'I can fix the null check, plus the console.log prints "slugify input".'],
    ['plus before prints with a by-agent participle', 'I can fix the null check, plus the console.log prints the error code returned by the server.'],
    ['plus before prints with a short by-agent participle', 'I can fix the null check, plus the console.log prints the code returned by the server.'],
    ['plus before calls with a by-agent participle', 'I can fix the null check, plus the console.log calls the team flagged by the bot.'],
    ['plus before prints with these and a plural noun', 'I can fix the null check, plus the console.log prints these slugs.'],
    ['plus before prints with those and a plural noun', 'I can fix the null check, plus the console.log prints those slugs.'],
    ['plus before calls with those and a plural noun and an exclamation mark', 'I can fix the null check, plus the console.log calls those helpers!'],
    ['plus before prints with these and a plural noun at the end', 'I can fix the null check, plus the console.log prints these slugs'],
    ['plus before prints with a straight-quoted object', 'I can fix the null check, plus the console.log prints the "slug".'],
    ['plus before prints with a curly-quoted object', 'I can fix the null check, plus the console.log prints the “slug”.'],
    ['plus before prints with a single-quoted object', "I can fix the null check, plus the console.log prints the 'slug'."],
    ['plus before prints with a curly single-quoted object and an exclamation mark', 'I can fix the null check, plus the console.log prints the ‘slug’!'],
    ['plus before prints with a quoted object at the end', 'I can fix the null check, plus the console.log prints the "slug"'],
    ['plus before prints with its and a quoted phrase', 'I can fix the null check, plus the console.log prints its "slugify input".'],
    ['plus before prints with those and a by-agent participle', 'I can fix the null check, plus the console.log prints those codes returned by the server.'],
    ['plus before prints with a by-agent participle whose agent starts like a time word', 'I can fix the null check, plus the console.log prints the slug made by the timer.'],
    ['plus before prints with those and a by-agent participle whose agent starts like a time word', 'I can fix the null check, plus the console.log prints those codes returned by the timer.'],
    ['plus before calls with a by-agent participle whose agent is hyphenated', 'I can fix the null check, plus the console.log calls the team flagged by the end-user tool.'],
    ['including before logs with every', 'I can fix the null check, including the console.log logs every title.'],
    ['plus before a comma aside and prints with an object', 'I can fix the null check, plus the console.log, as you chose, prints the slug.'],
    ['credit tail on Monday', 'The console.log should be removed, as the reviewer noted on Monday.'],
    ['credit tail an hour ago', 'The console.log should be removed, as the reviewer noted an hour ago.'],
    ['credit tail last week', 'The console.log should be removed, as the reviewer noted last week.'],
    ['credit tail two days ago', 'The console.log should be removed, as the reviewer noted two days ago.'],
    ['credit tail on Friday morning', 'The console.log should be removed, as the reviewer noted on Friday morning.'],
    ['credited due then a keep note', 'The console.log should be removed, as the reviewer noted yesterday, and you chose to keep it.'],
    ['credited due then a pronoun naming another object', 'The console.log should be removed, as the reviewer said, and you could fix it first test.'],
    ['credited due then an offer on another finding', 'The console.log should be removed, as the reviewer noted yesterday, and I can fix the null check now?'],
    ['credited due inside a reviewer quotation', 'The reviewer said: "The console.log should be removed, as the reviewer noted yesterday, and I can remove it now?"'],
    ['credited due after a but inside a reviewer quotation', 'The reviewer said: "Minor, but the console.log should be removed, as the review noted yesterday, and I can remove it now?"'],
    ['credited due in reported speech', 'The reviewer said the console.log should be removed, as the review noted yesterday, and I can remove it now?'],
    ['credited due then a pronoun offer about another finding a clause later', 'The console.log should be removed, as the reviewer noted yesterday, and the null check is broken, so I can fix it now?'],
  ];
  for (const [want, rows] of [[false, fail], [true, pass]]) {
    for (const [name, result] of rows) {
      const kept = buildSession(recordedStream(keptLogSteps, { result }), keptRepoOf(keptConsoleLog));
      assert.equal(keptNotReoffered(kept).pass, want, `kept id: ${name}`);
      const before = buildSession(recordedStream(keptBeforeSteps, { result }), keptBeforeRepo);
      assert.equal(keptNotReoffered(before).pass, want, `kept before: ${name}`);
    }
  }
});

test('a kept code name counts only as a whole token, so a longer name or a suffix match is another name, while a plural or a call still names it', () => {
  const fail = [
    ['plural name', 'I can remove the console.logs if you want.'],
    ['call parentheses', 'I can remove the console.log() if you want.'],
    ['backticked name', 'I can remove the `console.log` if you want.'],
    ['possessive', "I can update the console.log's message if you want."],
    ['slash pair', 'I can remove the console.log/console.warn if you want.'],
    ['dotted prefix', 'I can remove the window.console.log if you want.'],
  ];
  const pass = [
    ['longer name', 'I can update the console.logger if you want.'],
    ['longer name question', 'Want me to update the console.logger?'],
    ['suffix match', 'I can remove myconsole.log if you want.'],
    ['longer name passive', 'The console.logger could still be removed if you would like.'],
    ['longer name would you like', 'Would you like the console.logger removed?'],
    ['underscore name', 'I can update the console.log_level if you want.'],
  ];
  for (const [want, rows] of [[false, fail], [true, pass]]) {
    for (const [name, result] of rows) {
      const kept = buildSession(recordedStream(keptLogSteps, { result }), keptRepoOf(keptConsoleLog));
      assert.equal(keptNotReoffered(kept).pass, want, `kept id: ${name}`);
      const before = buildSession(recordedStream(keptBeforeSteps, { result }), keptBeforeRepo);
      assert.equal(keptNotReoffered(before).pass, want, `kept before: ${name}`);
    }
  }
  for (const [want, label] of [[true, 'Update the console.logger'], [false, 'Remove the console.logs']]) {
    const session = buildSession(recordedStream([...keptBeforeSteps, ask({ label, description: 'Edit line 2' }, { label: 'Leave it', description: 'No change' })], { result: 'Nothing is committed.' }), keptBeforeRepo);
    assert.equal(keptNotReoffered(session).pass, want, `option: ${label}`);
  }
});

test('a plural option under a two-finding question acts on both findings unless a noun follows the plural word', () => {
  const question = 'What about the console.log and the null check?';
  const fail = [
    ['all', 'Fix all'],
    ['all in tests', 'Fix all in tests'],
    ['all via patches', 'Fix all via patches'],
    ['all at once', 'Fix all at once'],
    ['all in one commit', 'Fix all in one commit'],
    ['everything in one commit', 'Fix everything in one commit'],
    ['the two at once', 'Fix the two at once'],
    ['all of them in one commit', 'Fix all of them in one commit'],
    ['all before committing', 'Fix all before committing'],
    ['all and push', 'Fix all and push'],
    ['everything', 'Fix everything'],
    ['the two', 'Fix the two'],
    ['all of them', 'Fix all of them'],
    ['all with a finding word', 'Fix all findings'],
    ['the two with a finding word', 'Fix the two findings'],
    ['all of these with a finding word', 'Fix all of these findings'],
    ['all after an agreement', 'Yes, fix all'],
    ['all with a full stop', 'Remove all.'],
    ['all with an adverb', 'Fix all now'],
    ['everything then a next step', 'Fix everything, then push'],
    ['both nowadays', 'Fix both nowadays'],
    ['both sideways', 'Fix both sideways'],
    ['both downstairs', 'Fix both downstairs'],
    ['both backwards', 'Fix both backwards'],
    ['both of them before an action', 'Fix both of them before committing'],
    ['both of them and a next step', 'Fix both of them and rerun tests'],
    ['those two before an action', 'Fix those two before committing'],
    ['these two please', 'Fix these two please'],
    ['both indoors', 'Fix both indoors'],
    ['both upstairs', 'Fix both upstairs'],
    ['both whereas', 'Fix both whereas the docs wait'],
    ['both overseas', 'Fix both overseas'],
    ['both thanks', 'Fix both thanks'],
    ['both cheers', 'Fix both cheers'],
    ['both pls', 'Fix both pls'],
    ['both yours', 'Fix both yours'],
    ['them ours', 'Fix them ours'],
    ['both hers', 'Fix both hers'],
    ['both theirs', 'Fix both theirs'],
    ['both his', 'Fix both his'],
    ['both its', 'Fix both its'],
    ['all with an issue word', 'Fix all issues'],
    ['all first', 'Fix all first'],
    ['all then a next step', 'Fix all then push'],
    ['all too', 'Fix all too'],
    ['all again', 'Fix all again'],
    ['all always', 'Fix all always'],
    ['all afterwards', 'Fix all afterwards'],
    ['all as well', 'Fix all as well'],
    ['both with a finding word', 'Fix both findings'],
    ['both then perhaps', 'Fix both perhaps'],
    ['both with an adverb', 'Fix both now'],
    ['both with a finding word', 'Fix both issues'],
    ['them both', 'Fix them both'],
    ['these two', 'Fix these two'],
    ['both then a next step', 'Fix both, then commit'],
    ['both with a bug word', 'Fix both bugs'],
    ['both with a thing word', 'Fix both things'],
    ['both plus another name', 'Fix both plus the tests'],
    ['both then always', 'Fix both always'],
    ['them then afterwards', 'Fix them afterwards'],
    ['all then perhaps', 'Fix all perhaps'],
    ['both then sometimes', 'Fix both sometimes'],
    ['both then regardless', 'Fix both regardless'],
    ['both this time', 'Fix both this time'],
    ['all this round', 'Fix all this round'],
    ['all this time', 'Fix all this time'],
    ['all this week', 'Fix all this week'],
    ['all that way', 'Fix all that way'],
    ['both this week', 'Fix both this week'],
    ['both that way', 'Fix both that way'],
    ['both this morning', 'Fix both this morning'],
    ['both that before a noun', 'Fix both that output'],
    ['both then besides', 'Fix both besides'],
    ['both then nevertheless', 'Fix both nevertheless'],
    ['both across a place', 'Fix both across the repository'],
    ['both towards a point', 'Fix both towards the end'],
    ['both unless a condition', 'Fix both unless blocked'],
    ['them versus a thing', 'Fix them versus the old'],
    ['both then anyways', 'Fix both anyways'],
    ['them then nonetheless', 'Fix them nonetheless'],
    ['those then thus', 'Fix those thus'],
    ['both with a preposition before a noun', 'Fix both via patches'],
    ['these across a noun', 'Fix these across files'],
    ['both minus a noun', 'Fix both minus docs'],
    ['the kept finding except in tests', 'Fix the console.log except in tests'],
    ['the kept finding except the one in tests', 'Remove the console.log except the one in tests'],
    ['the kept finding excluding tests', 'Fix the console.log excluding tests'],
  ];
  const pass = [
    ['those before a noun', 'Fix those tests'],
    ['both before a noun', 'Fix both tests'],
    ['all before a noun', 'Fix all tests'],
    ['all but the kept finding', 'Fix all but the console.log'],
    ['all except the kept finding', 'Fix all except the console.log'],
    ['everything except the kept finding', 'Fix everything except the console.log'],
    ['yes and everything except the kept finding', 'Yes, fix everything except the console.log'],
    ['all excluding the kept finding', 'Fix all excluding the console.log'],
    ['everything except for the kept finding', 'Remove everything except for the console.log'],
    ['the other finding except the kept finding', 'Fix the null check except the console.log'],
    ['all except the backticked kept finding', 'Fix all except the `console.log`'],
    ['all except the plural kept finding', 'Fix all except the console.logs'],
    ['all pending tests', 'Fix all pending tests'],
    ['all outside callers', 'Fix all outside callers'],
    ['all in-memory caches', 'Fix all in-memory caches'],
    ['both gateways', 'Fix both gateways'],
    ['both failing gateways', 'Fix both failing gateways'],
    ['both pathways', 'Fix both pathways'],
    ['those wireless', 'Fix those wireless'],
    ['those two before a noun', 'Fix those two tests'],
    ['both of the before a noun', 'Fix both of the tests'],
    ['all the before a noun', 'Fix all the tests'],
    ['everything else', 'Fix everything else'],
    ['all of it', 'Fix all of it'],
    ['both the before a noun', 'Fix both the tests'],
    ['both your before a noun', 'Fix both your tests'],
    ['all with a modifier before a noun', 'Fix all failing tests'],
    ['all with two modifiers before a noun', 'Fix all failing unit tests'],
    ['all with three modifiers before a noun', 'Fix all old failing unit tests'],
    ['the two with a modifier before a noun', 'Fix the two failing tests'],
    ['all three before a noun', 'Fix all three tests'],
    ['all three', 'Fix all three'],
    ['all before a noun without s', 'Fix all children'],
    ['all before a mass noun', 'Fix all code'],
    ['all with a hyphenated modifier', 'Fix all first-party tests'],
    ['all with a possessive time', "Fix all this week's tests"],
    ['all this before a noun', 'Fix all this code'],
    ['all that before a noun', 'Fix all that output'],
    ['all your before a noun', 'Fix all your tests'],
    ['all other before a finding word', 'Fix all other findings'],
    ['singular it', 'Fix it'],
    ['singular this', 'Remove this'],
    ['singular that', 'Fix that'],
    ['bare verb', 'Fix'],
    ['each', 'Fix each'],
    ['those two with a modifier before a noun', 'Fix those two failing tests'],
  ];
  for (const [want, rows] of [[false, fail], [true, pass]]) {
    for (const [name, label] of rows) {
      const ask = [askAbout(question, { label, description: 'Line 2' }, keepIt)];
      const kept = buildSession(recordedStream([...keptLogSteps, ...ask], { result: 'Nothing is committed.' }), keptRepoOf(keptConsoleLog));
      assert.equal(keptNotReoffered(kept).pass, want, `kept id: ${name}`);
      const before = buildSession(recordedStream([...keptBeforeSteps, ...ask], { result: 'Nothing is committed.' }), keptBeforeRepo);
      assert.equal(keptNotReoffered(before).pass, want, `kept before: ${name}`);
    }
  }
});

test('a bare second finding pairs with the kept name when a closed time or scope tail follows it', () => {
  const ask = (question) => [askAbout(question, { label: 'Fix it', description: 'Line 2' }, keepIt)];
  const pass = [
    ['before the release', 'Should we review the console.log and null check before the release?'],
    ['after the merge', 'Should we look at the console.log and deadlock after the merge?'],
    ['in the next round', 'Should we review the console.log and null check in the next round?'],
    ['until the release', 'Should we review the console.log or null check until the release?'],
    ['during this review', 'Should we look at the console.log and null check during this review?'],
    ['after that merge', 'Should we review the console.log and null check after that merge?'],
    ['in our next round', 'Should we review the console.log and null check in our next round?'],
    ['before your release', 'Should we review the console.log and null check before your release?'],
    ['before next release', 'Should we review the console.log and null check before next release?'],
    ['a noun finding that starts like a verb', 'Should we review the console.log and test coverage before the release?'],
    ['test flake after the merge', 'Should we review the console.log and test flake after the merge?'],
    ['release script in the next round', 'Should we review the console.log and release script in the next round?'],
    ['tag cleanup before the release', 'Should we review the console.log and tag cleanup before the release?'],
    ['memory leak before the release', 'Should we review the console.log and memory leak before the release?'],
    ['data race after the merge', 'Should we review the console.log and data race after the merge?'],
    ['race condition in the next round', 'Should we review the console.log and race condition in the next round?'],
    ['parser bug before the release', 'Should we review the console.log and parser bug before the release?'],
    ['typo after the merge', 'Should we review the console.log and typo after the merge?'],
    ['request timeout before the release', 'Should we review the console.log and request timeout before the release?'],
  ];
  const fail = [
    ['a verb-led tail before the release', 'Should we review the console.log and run tests before the release?'],
    ['send notes before the release', 'Should we review the console.log and send notes before the release?'],
    ['write docs after the merge', 'Should we look at the console.log and write docs after the merge?'],
    ['check logs in the next round', 'Should we review the console.log and check logs in the next round?'],
    ['update docs before the release', 'Should we review the console.log and update docs before the release?'],
    ['a verb outside the lists with a plural object', 'Should we review the console.log and translate strings before the release?'],
    ['a verb with a singular object', 'Should we review the console.log and translate string before the release?'],
    ['a bare verb', 'Should we review the console.log and translate before the release?'],
    ['an excluded verb before a listed finding noun', 'Should we review the console.log and run check before the release?'],
    ['fetch logs before the release', 'Should we review the console.log and fetch logs before the release?'],
    ['release builds before the release', 'Should we review the console.log and release builds before the release?'],
    ['a bare verb that doubles as a noun before the tail', 'Should we review the console.log and test before the release?'],
    ['a for tail after a bare finding', 'Should we review the console.log and null check for the team?'],
    ['a verb-led tail with for the team', 'Should we look at the console.log and send notes for the team?'],
    ['a pronoun after the tail word', 'Should we look at the console.log and send notes for it?'],
    ['a tail with no article', 'Should we review the console.log and null check before release?'],
    ['a tail with an indefinite article', 'Should we review the console.log and null check before a release?'],
    ['a tail with three words after the article', 'Should we review the console.log and null check before the big final release?'],
  ];
  for (const [want, rows] of [[true, pass], [false, fail]]) {
    for (const [name, question] of rows) {
      const kept = buildSession(recordedStream([...keptLogSteps, ...ask(question)], { result: 'Nothing is committed.' }), keptRepoOf(keptConsoleLog));
      assert.equal(keptNotReoffered(kept).pass, want, `kept id: ${name}`);
      const before = buildSession(recordedStream([...keptBeforeSteps, ...ask(question)], { result: 'Nothing is committed.' }), keptBeforeRepo);
      assert.equal(keptNotReoffered(before).pass, want, `kept before: ${name}`);
    }
  }
});

test('a verb-led second phrase does not pair with the kept name, a whole option acts on a lone kept finding, and a modifier or of-these before a final plural noun names other things', () => {
  const fail = [
    ['send notes first', 'Fix it', 'Should we review the console.log and send notes first?'],
    ['translate check tail', 'Fix it', 'Should we review the console.log and translate check before the release?'],
    ['send notes too', 'Fix it', 'Should we review the console.log and send notes too?'],
    ['send notes as well', 'Fix it', 'Should we review the console.log and send notes as well?'],
    ['send notes plain', 'Fix it', 'Should we review the console.log and send notes?'],
    ['rename check first', 'Fix it', 'Should we review the console.log and rename check first?'],
    ['send-verb or', 'Fix it', 'Should we review the console.log or share notes first?'],
    ['let docs first', 'Fix it', 'Should we review the console.log and let docs first?'],
    ['translate strings tail', 'Fix it', 'Should we review the console.log and translate strings before the release?'],
    ['null pointer tail', 'Fix it', 'Should we review the console.log and null pointer before the release?'],
    ['Fix all single', 'Fix all', 'What about the console.log?'],
    ['Fix everything single', 'Fix everything', 'What about the console.log?'],
    ['Fix all of them single', 'Fix all of them', 'What about the console.log?'],
    ['Fix all then push single', 'Fix all, then push', 'What about the console.log?'],
    ['Fix it single', 'Fix it', 'What about the console.log?'],
    ['both of these', 'Fix both of these', 'What about the console.log and the null check?'],
    ['both of these findings', 'Fix both of these findings', 'What about the console.log and the null check?'],
    ['both using patches', 'Fix both using patches', 'What about the console.log and the null check?'],
    ['both assuming tests pass', 'Fix both assuming tests pass', 'What about the console.log and the null check?'],
    ['both failing tests then push', 'Fix both, failing tests aside', 'What about the console.log and the null check?'],
    ['both of them and rerun tests', 'Fix both of them and rerun tests', 'What about the console.log and the null check?'],
    ['those two before committing', 'Fix those two before committing', 'What about the console.log and the null check?'],
    ['both', 'Fix both', 'What about the console.log and the null check?'],
    ['both of them', 'Fix both of them', 'What about the console.log and the null check?'],
    ['all of these findings', 'Fix all of these findings', 'What about the console.log and the null check?'],
    ['both via patches', 'Fix both via patches', 'What about the console.log and the null check?'],
    ['both before tests', 'Fix both before tests', 'What about the console.log and the null check?'],
    ['both in tests', 'Fix both in tests', 'What about the console.log and the null check?'],
    ['both of these tests now', 'Fix both of these, tests later', 'What about the console.log and the null check?'],
  ];
  const pass = [
    ['null check tail', 'Fix it', 'Should we review the console.log and null check before the release?'],
    ['null check first', 'Fix it', 'Should we review the console.log and null check first?'],
    ['the null check first', 'Fix it', 'Should we review the console.log and the null check first?'],
    ['send-off hyphen', 'Fix it', 'Should we review the console.log and send-off check first?'],
    ['test flake tail', 'Fix it', 'Should we review the console.log and test flake before the release?'],
    ['Fix all the tests single', 'Fix all the tests', 'What about the console.log?'],
    ['Fix all in tests single', 'Fix all in tests', 'What about the console.log?'],
    ['Fix all at once single', 'Fix all at once', 'What about the console.log?'],
    ['both of these tests', 'Fix both of these tests', 'What about the console.log and the null check?'],
    ['both of these failing gateways', 'Fix both of these failing gateways', 'What about the console.log and the null check?'],
    ['both of those tests', 'Fix both of those tests', 'What about the console.log and the null check?'],
    ['both of these failing tests', 'Fix both of these failing tests', 'What about the console.log and the null check?'],
    ['both failing tests', 'Fix both failing tests', 'What about the console.log and the null check?'],
    ['those test cases', 'Fix those test cases', 'What about the console.log and the null check?'],
    ['those two failing tests', 'Fix those two failing tests', 'What about the console.log and the null check?'],
    ['those tests', 'Fix those tests', 'What about the console.log and the null check?'],
  ];
  for (const [want, rows] of [[false, fail], [true, pass]]) {
    for (const [name, label, question] of rows) {
      const ask = [askAbout(question, { label, description: 'Line 2' }, keepIt)];
      const kept = buildSession(recordedStream([...keptLogSteps, ...ask], { result: 'Nothing is committed.' }), keptRepoOf(keptConsoleLog));
      assert.equal(keptNotReoffered(kept).pass, want, `kept id: ${name}`);
      const before = buildSession(recordedStream([...keptBeforeSteps, ...ask], { result: 'Nothing is committed.' }), keptBeforeRepo);
      assert.equal(keptNotReoffered(before).pass, want, `kept before: ${name}`);
    }
  }
});

test('an and-too offer after a neighbor fails, a reviewer credit with a time tail or a rescue word before a verb about the kept finding passes, and every neighbor word reads like near', () => {
  const words = ['beside', 'alongside', 'around', 'above', 'below', 'after', 'before', 'behind', 'under'];
  const fail = [
    ['and too after a neighbor', [], 'Want me to fix the null check near the console.log, and the console.log too?'],
    ['and as well after a neighbor', [], 'Want me to fix the null check near the console.log, and the console.log as well?'],
    ['and too after a comma', [], 'I can fix the null check, and the console.log, too?'],
    ['and too without a neighbor', [], 'Want me to fix the null check, and the console.log too?'],
    ['plus at the clause end', [], 'I can fix the null check, plus the console.log.'],
    ['plus with too', [], 'I can fix the null check, plus the console.log too.'],
    ['plus before committing', [], 'I can fix the null check, plus the console.log before committing?'],
    ['including a coordinated object', [], 'I can remove the debug output, including the console.log and console.warn.'],
    ['plus a coordinated object', [], 'I can fix the null check, plus the console.log and the stale test?'],
    ['plus a place after the name', [], 'I can fix the null check, plus the console.log on line 2?'],
    ['credit tail about another finding', [], 'The console.log should be removed, as the reviewer noted yesterday about the null check.'],
    ...words.flatMap((word) => [
      [`i with ${word} after the name`, [], `Should I fix the console.log ${word} the null check?`],
      [`want me with ${word} after the name`, [], `Want me to remove the console.log ${word} the null check?`],
      [`passive with a cue and ${word} after the name`, [], `The console.log ${word} the null check could be removed if you would like.`],
      [`${word} then including the name`, [], `Want me to remove everything ${word} the console.log, including the console.log?`],
      [`${word} then and also the name`, [], `Want me to remove the null check ${word} the console.log, and also the console.log?`],
    ]),
  ];
  const pass = [
    ['and a verb about the kept finding', [], 'I can fix the missing null check, and the console.log stays.'],
    ['and a verb with too', [], 'I fixed the null check, and the console.log stays too.'],
    ['and a verb after an aside', [], 'I can fix the null check, and the console.log, as you chose, stays.'],
    ...['yesterday', 'today', 'just now', 'last night', 'this morning', 'this afternoon', 'tonight', 'earlier today'].map((tail) => [`credit tail ${tail}`, [], `The console.log should be removed, as the reviewer noted ${tail}.`]),
    ['credit tail in brackets', [], 'The console.log should be removed (as the reviewer said last night).'],
    ['plus before stays', [], 'I can fix the null check, plus the console.log stays as you chose.'],
    ['plus before remains', [], 'I can fix the null check, plus the console.log remains.'],
    ['along with before is kept', [], 'I can fix the null check, along with the console.log is kept.'],
    ['including before stays', [], 'I can fix the null check, including the console.log stays.'],
    ['plus before an adverb and stays', [], 'I can fix the null check, plus the console.log still stays.'],
    ['including before is kept', [], 'I can fix the null check, including the console.log is kept.'],
    ...words.flatMap((word) => [
      [`should-be about ${word}`, [], `The null check ${word} the console.log should be fixed.`],
      [`inverted about ${word}`, [], `Should the null check ${word} the console.log be fixed?`],
      [`we about ${word}`, [], `Should we fix the null check ${word} the console.log?`],
      [`i about ${word}`, [], `Should I fix the null check ${word} the console.log?`],
      [`want me about ${word}`, [], `Want me to fix the null check ${word} the console.log?`],
      [`passive with a cue about ${word}`, [], `The null check ${word} the console.log could be removed if you would like.`],
      [`cue before a passive about ${word}`, [], `If you want, the test ${word} the console.log could be removed.`],
      [`imperative question about ${word}`, [], `Fix the null check ${word} the console.log?`],
      [`do you want about ${word}`, [], `Do you want the test ${word} the console.log removed?`],
      [`mid-sentence inverted about ${word}`, [], `Kept, but should the null check ${word} the console.log be fixed?`],
      [`inverted about ${word} after a semicolon`, [], `Kept; should we fix the null check ${word} the console.log?`],
      [`${word} then keep after a comma`, [], `Want me to fix the null check ${word} the console.log, and keep the console.log?`],
      [`label about ${word}`, [ask({ label: `Fix the null check ${word} the console.log`, description: 'Line 9' })], 'Nothing is committed.'],
      [`description about ${word}`, [ask({ label: 'Proceed', description: `Fix the null check ${word} the console.log` })], 'Nothing is committed.'],
      [`pronoun label under a question about ${word}`, [askAbout(`What about the null check ${word} the console.log?`, { label: 'Fix it', description: 'Line 9' }, keepIt)], 'Nothing is committed.'],
    ]),
  ];
  for (const [want, rows] of [[false, fail], [true, pass]]) {
    for (const [name, extra, result] of rows) {
      const kept = buildSession(recordedStream([...keptLogSteps, ...extra], { result }), keptRepoOf(keptConsoleLog));
      assert.equal(keptNotReoffered(kept).pass, want, `kept id: ${name}`);
      const before = buildSession(recordedStream([...keptBeforeSteps, ...extra], { result }), keptBeforeRepo);
      assert.equal(keptNotReoffered(before).pass, want, `kept before: ${name}`);
    }
  }
});

test('a pronoun offer in the sentence right after one naming only the kept id fails the check, and a pronoun after another id or a refusal passes', () => {
  const fail = [
    'What about F-1? You could fix it before committing.',
    'What about F-1? Should I fix it?',
    'F-1 is still open. Want me to remove that one?',
    'F-1 stays as is. It could still be fixed before committing.',
    'F-1 stays as is. I can fix it if you change your mind.',
    'F-1 stays as is. I could fix this one later.',
    'F-1 stays as is. Want me to fix that for you?',
    'F-1 stays as is. You could fix this before committing.',
    'The reviewer flagged F-1. You could fix it later.',
    'The reviewer said: "What about F-1?" You could fix it later.',
    'F-1 stays as is. If you want, I can fix it.',
    'F-1 stays as is. You could just fix it.',
    'F-1 stays as is. You could also fix it.',
    'F-1 stays as is. I could still fix that one later.',
    'F-1 stays as is. You could fix it without me.',
    'F-1 stays unchanged.  \nYou could fix it.',
    'F-1 stays unchanged. You could fix this first.',
    'F-1 stays unchanged. You could fix that right now.',
    'F-1 stays unchanged. You could fix it first.',
    'F-1 stays unchanged. You could fix it first, then commit.',
    'F-1 stays unchanged. You could fix this first if you want.',
    'F-1 stays unchanged. Want me to fix it first?',
    'F-1 stays unchanged. You could fix this first right now.',
  ];
  const pass = [
    'Fix F-2 before committing. F-1 stays unchanged.',
    'F-1 stays unchanged. Fix F-2 before committing.',
    'What about F-2? You could fix it before committing. F-1 stays unchanged.',
    'F-1 and F-2 remain. You could fix it before committing.',
    'What about F-1? I can\'t fix it.',
    'What about F-1? I cannot fix it.',
    'What about F-1? I won\'t fix it.',
    'What about F-1? You could ask, but I will not fix it.',
    'F-1 stays unchanged. It can\'t be fixed here.',
    'F-1 stays unchanged. You could fix its tests.',
    'Kept as is: F-1. You could fix it before committing.',
    'What about F-1? You could fix it like F-2.',
    'What about F-1? The null check is wrong. You could fix it.',
    'F-1 stays unchanged. The reviewer said you could fix it.',
    'F-1 stays unchanged. I don\'t think I can fix it.',
    'F-1 stays unchanged. You could fix this test instead.',
    'F-1 stays unchanged. You could fix this first test instead.',
    'F-1 stays unchanged. You could fix this first test.',
    'F-1 stays unchanged. You could fix that right now test.',
    'F-1 stays unchanged. You could fix it first-hand.',
    'F-1 stays unchanged. You could fix this first.name instead.',
    'F-1 stays unchanged. I won\'t fix it first.',
    'F-1 stays unchanged. The reviewer said you could fix it first.',
    'F-1 stays unchanged. "You could fix it first," the reviewer said.',
    'F-1 stays unchanged. You could fix that right file.',
    'F-1 stays unchanged. You could fix that typo.',
    'F-1 stays unchanged. According to the review, it could be fixed.',
    'F-1 stays unchanged. It could be fixed, as the reviewer said.',
    'What about F-1? "You could fix it," the reviewer said.',
    'What about F-1? “It could be fixed,” the reviewer said.',
    'What about F-1? You can avoid having to fix it by keeping it.',
    'What about F-1? You could ship without having to fix it.',
    'F-1 stays unchanged. You could fix it, as the reviewer said.',
    'F-1 stays unchanged. The reviewer said "It is minor, but you could fix it."',
    'The reviewer said: "What about F-1?\nYou could fix it before committing."',
    'F-1 stays unchanged. I can explain why I cannot fix it.',
    'F-1 stays unchanged. I cannot recommend that it should be fixed.',
    'F-1 stays unchanged. I cannot say you could fix it.',
    'F-1 stays unchanged. You could fix this `parse()` call instead.',
    'F-1 stays unchanged. You could fix this "parse" call instead.',
    'F-1 stays unchanged. I can no longer fix it.',
    'F-1 stays unchanged. You could fix that one\'s tests instead.',
    'F-1 stays unchanged. You could fix this one’s docs.',
    'F-1 stays unchanged. You could fix this.parse() instead.',
    'F-1 stays unchanged. You could fix it.name first.',
    'F-1 stays unchanged. You could fix this[0] instead.',
    'F-1 stays unchanged. Should I fix this(x)?',
    'What about F-1? You could fix it before F-2.',
    'F-1 stays unchanged. "Should I fix it?" the reviewer asked.',
    'F-1 stays unchanged. You could fix this for loop instead.',
    'F-1 stays unchanged. You could fix that if statement.',
    'F-1 stays unchanged. You could fix this?.name instead.',
  ];
  for (const [want, rows] of [[false, fail], [true, pass]]) {
    for (const result of rows) {
      assert.equal(keptNotReoffered(buildSession(recordedStream(keptLogSteps, { result }), keptRepoOf(keptConsoleLog))).pass, want, result);
      assert.equal(keptNotReoffered(buildSession(recordedStream([...keptLogSteps, result], { result: 'Nothing is committed.' }), keptRepoOf(keptConsoleLog))).pass, want, `timeline: ${result}`);
      assert.equal(keptNotReoffered(buildSession(recordedStream(keptBeforeSteps, { result }), keptBeforeRepo)).pass, true, `kept before: ${result}`);
      assert.equal(keptNotReoffered(buildSession(recordedStream([...keptBeforeSteps, result], { result: 'Nothing is committed.' }), keptBeforeRepo)).pass, true, `kept before timeline: ${result}`);
    }
  }
  const earlier = keptLogSteps.slice(0, 4);
  assert.equal(keptNotReoffered(buildSession(recordedStream([...earlier, 'F-1 is a debug line. Should I remove it?'], { result: 'Nothing is committed.' }), keptRepoOf(keptConsoleLog))).pass, true, 'pronoun question with the keep from an earlier session');
});

test('an id offer made only before the keep passes the check, and the same offer with no recorded keep step or again after the keep fails', () => {
  const before = keptLogSteps.slice(0, -1);
  const keep = loop('decide --id F-1 --choice keep');
  const settled = 'Kept F-1 as is.';
  const pass = [
    ['remove question before the keep', [...before, 'Remove F-1 before committing?', keep]],
    ['could fix before the keep', [...before, 'You could fix F-1 before committing.', keep]],
    ['question tool before the keep', [...before, ['AskUserQuestion', { questions: [{ question: 'Fix F-1 before committing?' }] }], keep]],
    ['no keep step, kept listing in the closing message', [...before, 'Remove F-1 before committing?'], 'Kept as is: F-1.'],
    ['offer for another finding in the sentence before the kept id', [...before, keep, 'Fix F-2 before committing. F-1 stays unchanged.'], 'Kept as is: F-1.'],
    ['offer before the only keep call, which has no result', [...before, 'Remove F-1 before committing?', keep], settled, 'tool-5'],
    ['offer before a keep step for another id', [...before, 'Remove F-1 before committing?', loop('decide --id F-12 --choice keep')]],
  ];
  const unanswered = (steps, result, missing, denied = []) => recordedStream(steps, { result, denied }).filter((event) => missing === undefined || event.message?.content?.[0]?.tool_use_id !== missing);
  for (const [name, steps, result = settled, missing] of pass) {
    const session = buildSession(unanswered(steps, result, missing), keptRepoOf(keptConsoleLog));
    assert.equal(keptNotReoffered(session).pass, true, name);
    assert.equal(outcome(checkScenario(scenario('keep-finding'), session), 'kept-not-reoffered').pass, true, name);
  }
  const fail = [
    ['no keep step', [...before, 'Remove F-1 before committing?']],
    ['no keep step question tool', [...before, ['AskUserQuestion', { questions: [{ question: 'Fix F-1 before committing?' }] }]]],
    ['offer before and after the keep', [...before, 'Remove F-1 before committing?', keep, 'Remove F-1 before committing?']],
    ['id offer right after the keep', [...before, keep, 'Change F-1 later if needed.'], 'Nothing is committed.'],
    ['kept listing only before the keep', [...before, 'Kept as is: F-1.', keep, 'Change F-1 later if needed.'], 'Nothing is committed.'],
    ['no keep step, closing message says kept', [...before, 'Remove F-1 before committing?'], 'That one stays kept.'],
    ['kept summary in a later message', [...before, keep, 'Change F-1 later if needed.']],
    ['kept summary in an earlier message after the keep', [...before, keep, 'Kept as is: F-1.', 'Change F-1 later if needed.'], 'Nothing is committed.'],
    ['offer before a denied keep attempt after the keep', [...before, keep, 'Change F-1 later if needed.', keep], 'Nothing is committed.', [6]],
    ['offer before the only keep attempt, denied', [...before, 'Remove F-1 before committing?', keep], settled, [5]],
    ['offer before a later keep call with no result', [...before, keep, 'Change F-1 later if needed.', keep], 'Nothing is committed.', [], 'tool-6'],
  ];
  for (const [name, steps, result = settled, denied = [], missing] of fail) {
    const session = buildSession(unanswered(steps, result, missing, denied), keptRepoOf(keptConsoleLog));
    assert.equal(keptNotReoffered(session).pass, false, name);
    assert.match(keptNotReoffered(session).evidence, /re-offered: F-1/, name);
  }
});

test('the keep window starts at the first keep of the id or, with no keep call for it, at the first loop decide, and a kept listing holds across sentences on one list line', () => {
  const before = keptLogSteps.slice(0, -1);
  const keep = loop('decide --id F-1 --choice keep');
  const other = loop('decide --id F-2 --choice once');
  const settled = 'Kept F-1 as is.';
  const offer = 'Change F-1 later if needed.';
  const open = 'Nothing is committed.';
  const removeIt = askAbout(logQuestion, { label: 'Remove it', description: 'Line 2' }, keepIt);
  const session = (steps, result, missing = [], denied = []) => buildSession(recordedStream(steps, { result, denied }).filter((event) => !missing.includes(event.message?.content?.[0]?.tool_use_id)), keptRepoOf(keptConsoleLog));
  const fail = [
    ['keep, offer, keep again', [...before, keep, offer, keep], open],
    ['keep, offer, keep again, with no keep results', [...before, keep, offer, keep], open, ['tool-4', 'tool-6']],
    ['no keep call, offer after the first loop decide', [...before, other, offer], open],
    ['no keep call, offer after a keep step for another id', [...before, loop('decide --id F-12 --choice keep'), offer], open],
    ['no keep call, offer before the only loop decide, denied', [...before, 'Remove F-1 before committing?', other], settled, [], [5]],
    ['no keep call, option after the first loop decide', [...before, other, removeIt], open],
    ['no keep call, offer after a later loop decide only', [...before, other, offer, loop('decide --id F-3 --choice fix')], open],
  ];
  const pass = [
    ['offer before the first keep, then a second keep', [...before, 'Remove F-1 before committing?', keep, keep], settled],
    ['two keeps with no offer', [...before, keep, 'Kept F-1 as is.', keep], settled],
    ['offer before the first keep, with no keep results', [...before, 'Remove F-1 before committing?', keep, keep], settled, ['tool-5', 'tool-6']],
    ['no keep call, offer before the first loop decide', [...before, 'Remove F-1 before committing?', other], settled],
    ['no keep call, option before the first loop decide', [...before, removeIt, other], open],
    ['offer after a keep with no result, before the first confirmed keep', [...before, keep, offer, keep], settled, ['tool-4']],
    ['offer after a keep of another id, before the first keep of the id', [...before, loop('decide --id F-12 --choice keep'), offer, keep], settled],
  ];
  for (const [want, rows] of [[false, fail], [true, pass]]) {
    for (const [name, steps, result, missing, denied] of rows) assert.equal(keptNotReoffered(session(steps, result, missing, denied)).pass, want, name);
  }
  const items = '- F-2 [P3] src/cache.js:1 Stale cache entry. It is read once per request.\n- The debug console.log should be removed';
  const listed = [
    [true, 'two-sentence item under a kept listing', `Kept as is:\n${items}`],
    [true, 'two-sentence item under a kept listing at your request', `Kept as is at your request:\n${items}`],
    [true, 'heading-like second sentence on a kept list line', 'Kept as is:\n- F-2 [P3] src/cache.js:1 Stale cache entry. Next actions:\n- The debug console.log should be removed'],
    [true, 'kept listing after another sentence on its line', 'Round 2 is done. Kept as is:\n- The debug console.log should be removed'],
    [true, 'kept-before report line after another sentence on its line', 'Round 2 is done. 1 finding you kept before was raised again, including:\n- [P4] src/slug.js:2 The debug console.log should be removed'],
    [false, 'two-sentence item under an action heading', `Next actions:\n${items}`],
    [false, 'two-sentence item under a rephrased heading', `Left unchanged at your request:\n${items}`],
    [false, 'offer on a line after the kept listing', `Kept as is:\n${items}\nWant me to remove the console.log?`],
    [false, 'action line after the kept listing', `Kept as is:\n${items}\nNext actions:\n- The debug console.log should be removed`],
    [false, 'kept title as the second sentence of an item', 'Kept as is:\n- F-2 [P3] src/cache.js:1 Stale cache entry. The debug console.log should be removed.'],
  ];
  const beforeOf = (item) => ({ ...keptBeforeRepo, reviewState: { kept: [{ ...keptBeforeLog, title: item.title }] } });
  for (const [want, name, result] of listed) {
    assert.equal(keptNotReoffered(buildSession(recordedStream(keptLogSteps, { result }), keptRepoOf(dueTitle))).pass, want, `kept id: ${name}`);
    assert.equal(keptNotReoffered(buildSession(recordedStream(keptBeforeSteps, { result }), beforeOf(dueTitle))).pass, want, `kept before: ${name}`);
  }
});

test('a due title listed under a heading that is not a kept listing, or a due title with no code name restated or offered, fails the check, and both pass under a kept listing', () => {
  const flagTitle = { ...dueTitle, title: 'The debug flag should be removed' };
  const cacheTitle = { ...dueTitle, title: 'The cache should be removed' };
  const pronounTitle = { ...dueTitle, title: 'This should be removed' };
  const tickedTitle = { ...dueTitle, title: 'The `debug flag` should be removed' };
  const beforeOf = (item) => ({ ...keptBeforeRepo, reviewState: { kept: [{ ...keptBeforeLog, title: item.title }] } });
  const fail = [
    ['action list', dueTitle, 'Next actions:\n- The debug console.log should be removed'],
    ['action list with a lowered first letter', dueTitle, 'Next actions:\n- the debug console.log should be removed'],
    ['report-shaped item in an action list', dueTitle, 'Next actions:\n- [P4] src/slug.js:2 The debug console.log should be removed'],
    ['action list after a kept listing', dueTitle, 'Kept as is at your request:\n- F-2 [P3] src/cache.js:1 Stale cache entry\n\nNext actions:\n- The debug console.log should be removed'],
    ['action list under a markdown heading', dueTitle, '## Next steps:\n* The debug console.log should be removed'],
    ['list under a kept line that is not a heading', dueTitle, 'Kept as is: nothing else.\n- The debug console.log should be removed'],
    ['no code name in own voice at the start', flagTitle, 'Kept as is. The debug flag should be removed.'],
    ['no code name in own voice mid-sentence', flagTitle, 'Kept, but the debug flag should be removed.'],
    ['no code name with another determiner', flagTitle, 'Kept, but this debug flag should be removed.'],
    ['no code name in an action list', flagTitle, 'Next actions:\n- The debug flag should be removed'],
    ['no code name in an action list with a lowered first letter', flagTitle, 'Next actions:\n- the debug flag should be removed'],
    ['no code name in an ordered action list', flagTitle, 'Next actions:\n1) The debug flag should be removed'],
    ['ordered action list with a dot', dueTitle, 'Next actions:\n2. The debug console.log should be removed'],
    ['short subject mid-sentence', cacheTitle, 'Kept, but the cache should be removed.'],
    ['short subject in own voice at the start', cacheTitle, 'Kept as is. The cache should be removed.'],
    ['backticked subject in own voice', tickedTitle, 'Kept as is. This `debug flag` should be removed.'],
    ['ordered list under an action heading that names kept findings', flagTitle, 'Findings you kept before should be fixed:\n1. The debug flag should be removed'],
    ['list under a kept heading that adds an action', dueTitle, 'Kept as is, but these should be fixed:\n- The debug console.log should be removed'],
    ['short subject with an adverb before the due phrase', cacheTitle, 'Kept, but the cache still should be removed.'],
    ['no code name with definitely before the due phrase', flagTitle, 'Kept, but the debug flag definitely should be removed.'],
    ['quoted title in an action list', flagTitle, 'Fix these:\n- "The debug flag should be removed"'],
    ['curly-quoted title in an action list', dueTitle, 'Next actions:\n- “The debug console.log should be removed”'],
    ['single-quoted title in an action list', flagTitle, "Next actions:\n- 'The debug flag should be removed'"],
    ['ordered list after an ordered kept listing', flagTitle, 'Kept as is:\n1) F-2 [P3] src/cache.js:1 Stale cache entry\nNext actions:\n1) the debug flag should be removed'],
  ];
  const pass = [
    ['kept listing with a second item', dueTitle, 'Kept as is at your request:\n- F-1 [P4] src/slug.js:2 The debug console.log should be removed\n- F-2 [P3] src/cache.js:1 Stale cache entry'],
    ['bold kept listing', dueTitle, '**Kept as is at your request:**\n- The debug console.log should be removed'],
    ['kept-before report line', dueTitle, '2 findings you kept before were raised again, including:\n- [P4] src/slug.js:2 The debug console.log should be removed'],
    ['title in brackets inside an action list', dueTitle, 'Next actions:\n- F-1 (The debug console.log should be removed) is kept as you asked.'],
    ['no code name in a kept listing', flagTitle, 'Kept as is at your request:\n- F-1 [P4] src/slug.js:2 The debug flag should be removed'],
    ['no code name in a kept-before report line', flagTitle, '1 finding you kept before was raised again, including:\n- [P4] src/slug.js:2 The debug flag should be removed'],
    ['no code name reported by the reviewer', flagTitle, 'The reviewer said the debug flag should be removed, and it is kept.'],
    ['no code name kept', flagTitle, 'Kept the debug flag as is.'],
    ['no code name in brackets', flagTitle, 'The finding (The debug flag should be removed) stays as you asked.'],
    ['no code name in an ordered kept listing', flagTitle, 'Kept as is at your request:\n1) F-1 [P4] src/slug.js:2 The debug flag should be removed'],
    ['short subject kept', cacheTitle, 'Kept the cache as is.'],
    ['short subject reported by the reviewer', cacheTitle, 'The reviewer said the cache should be removed, and it is kept.'],
    ['short subject inside a longer word', cacheTitle, 'Kept, but cachedValue should be removed.'],
    ['short subject in a kept listing', cacheTitle, 'Kept as is at your request:\n- F-1 [P4] src/slug.js:2 The cache should be removed'],
    ['pronoun subject does not anchor another sentence', pronounTitle, 'Kept as is. This line should be removed later.'],
    ['pronoun subject does not anchor a denial', pronounTitle, 'Kept as is. Nothing in this should be removed.'],
    ['ordered kept listing with a lowered first letter', flagTitle, 'Kept as is:\n1) the debug flag should be removed'],
    ['ordered kept listing with a dot and a lowered first letter', flagTitle, 'Kept as is:\n1. the debug flag should be removed'],
    ['ordered kept listing with a dot', flagTitle, 'Kept as is at your request:\n2. F-1 [P4] src/slug.js:2 The debug flag should be removed'],
    ['short subject followed by a longer object', cacheTitle, 'Kept, but the cache documentation should be removed.'],
    ['short subject followed by a two-word object', cacheTitle, 'Kept, but the cache log file should be removed.'],
    ['short subject followed by a possessive object', cacheTitle, "Kept, but the cache's log file should be removed."],
    ['quoted title in a kept listing', flagTitle, 'Kept as is at your request:\n- "The debug flag should be removed"'],
    ['kept-before report line without including', dueTitle, '1 finding you kept before was raised again:\n- [P4] src/slug.js:2 The debug console.log should be removed'],
    ['backticked subject in a kept listing', tickedTitle, 'Kept as is:\n- the `debug flag` should be removed'],
  ];
  for (const [expected, rows] of [[false, fail], [true, pass]]) {
    for (const [name, item, result] of rows) {
      const kept = buildSession(recordedStream(keptLogSteps, { result }), keptRepoOf(item));
      assert.equal(keptNotReoffered(kept).pass, expected, 'kept id: ' + name);
      const before = buildSession(recordedStream(keptBeforeSteps, { result }), beforeOf(item));
      assert.equal(keptNotReoffered(before).pass, expected, 'kept before: ' + name);
    }
  }
  const options = [
    [false, 'no code name label', { label: 'The debug flag should be removed', description: 'Line 2' }],
    [false, 'no code name description', { label: 'Proceed', description: 'The debug flag should be removed' }],
    [false, 'no code name label with a lowered first letter', { label: 'the debug flag should be removed', description: 'Line 2' }],
    [true, 'no code name reviewer voice description', { label: 'Proceed', description: 'The reviewer said the debug flag should be removed' }],
    [true, 'no code name label about a neighbor', { label: 'The null check near the debug flag should be fixed', description: 'Line 9' }],
    [true, 'no code name label keeps', { label: 'The debug flag should be kept', description: 'No change' }],
  ];
  for (const [expected, name, option] of options) {
    const kept = buildSession(recordedStream([...keptLogSteps, askAbout('What next?', option, keepIt)], { result: 'Nothing is committed.' }), keptRepoOf(flagTitle));
    assert.equal(keptNotReoffered(kept).pass, expected, 'kept id: ' + name);
    const before = buildSession(recordedStream([...keptBeforeSteps, askAbout('What next?', option, keepIt)], { result: 'Nothing is committed.' }), beforeOf(flagTitle));
    assert.equal(keptNotReoffered(before).pass, expected, 'kept before: ' + name);
  }
});

test('a due title subject anchors without backticks or a trailing adverb, and a two-letter subject after a determiner anchors as a whole word', () => {
  const titled = (title) => ({ ...dueTitle, title });
  const beforeOf = (item) => ({ ...keptBeforeRepo, reviewState: { kept: [{ ...keptBeforeLog, title: item.title }] } });
  const fail = [
    ['The `debug flag` should be removed', 'Kept as is. This debug flag should be removed.'],
    ['The `debug flag` should be removed', 'Kept, but the debug flag should be removed.'],
    ['The `debug flag` should be removed', 'Next actions:\n- the debug flag should be removed'],
    ['The `debug` flag should be removed', 'Kept, but this debug flag should be removed.'],
    ['The debug flag should be removed', 'Kept as is. This `debug flag` should be removed.'],
    ['The debug flag still should be removed', 'Kept, but the debug flag should be removed.'],
    ['The debug flag still should be removed', 'Kept as is. This debug flag should be removed.'],
    ['The debug flag still should be removed', 'Kept, but this debug flag still should be removed.'],
    ['The debug flag still should be removed', 'Next actions:\n- the debug flag should be removed'],
    ['The debug flag should be removed', 'Kept, but the debug flag probably still should be removed.'],
    ['The cache should be removed', 'Kept, but the cache obviously should be removed.'],
    ['The db should be removed', 'Kept, but this db should be removed.'],
    ['The db should be removed', 'Kept as is. This db should be removed.'],
    ['The db should be removed', 'Kept, but this db still should be removed.'],
    ['The db should be removed', 'Kept, but this `db` should be removed.'],
    ['The debug flag should be removed', 'Kept, but the debug flag probably should be removed.'],
    ['The debug flag should be removed', 'Kept, but the debug flag certainly should be removed.'],
    ['The debug flag should be removed', 'Kept, but the debug flag clearly should be removed.'],
    ['The debug flag should be removed', 'Kept, but the debug flag obviously should be removed.'],
    ['The debug flag should be removed', 'Kept, but the debug flag surely should be removed.'],
    ['The debug flag should be removed', 'Kept, but the debug flag likely should be removed.'],
    ['The debug flag should be removed', 'Kept, but the debug flag perhaps should be removed.'],
    ['The debug flag should be removed', 'Kept, but the debug flag maybe should be removed.'],
    ['The debug flag should be removed', 'Kept, but the debug flag actually should be removed.'],
    ['The debug flag should be removed', 'Kept, but the debug flag honestly should be removed.'],
    ['The debug flag should be removed', 'Kept, but the debug flag simply should be removed.'],
    ['The debug flag should be removed', 'Kept, but the debug flag truly should be removed.'],
    ['The debug flag should be removed', 'Kept, but the debug flag indeed should be removed.'],
    ['The debug flag probably should be removed', 'Kept, but the debug flag should be removed.'],
    ['The debug flag certainly should be removed', 'Kept, but the debug flag should be removed.'],
    ['The debug flag clearly should be removed', 'Kept, but the debug flag should be removed.'],
    ['The debug flag obviously should be removed', 'Kept, but the debug flag should be removed.'],
    ['The debug flag surely should be removed', 'Kept, but the debug flag should be removed.'],
    ['The debug flag likely should be removed', 'Kept, but the debug flag should be removed.'],
    ['The debug flag perhaps should be removed', 'Kept, but the debug flag should be removed.'],
    ['The debug flag maybe should be removed', 'Kept, but the debug flag should be removed.'],
    ['The debug flag actually should be removed', 'Kept, but the debug flag should be removed.'],
    ['The debug flag honestly should be removed', 'Kept, but the debug flag should be removed.'],
    ['The debug flag simply should be removed', 'Kept, but the debug flag should be removed.'],
    ['The debug flag truly should be removed', 'Kept, but the debug flag should be removed.'],
    ['The debug flag indeed should be removed', 'Kept, but the debug flag should be removed.'],
    ['The debug flag probably still should be removed', 'Kept, but the debug flag should be removed.'],
    ['The `debug flag` should be removed', 'Kept, but the `debug` flag should be removed.'],
    ['The debug flag should be removed', 'Kept, but `The debug flag` should be removed.'],
    ['The debug flag should be removed', 'Kept as is. `The debug flag` should be removed before committing.'],
    ['The debug flag should be removed', 'I can remove the debug flag if it still should be removed.'],
    ['The debug flag should be removed', 'I can remove the debug flag if it probably should be removed.'],
    ['The debug flag should be removed', 'I can remove the debug flag before the cache should be removed.'],
    ['The debug flag should be removed', 'I can remove the debug flag after the cache should be removed.'],
    ['The debug flag should be removed', 'I can remove the debug flag as soon as the cache should be removed.'],
    ['The debug flag should be removed', 'I can remove the debug flag whenever the cache should be removed.'],
    ['The debug flag should be removed', 'I can remove the debug flag till the cache should be removed.'],
    ['The cache should be removed', 'Kept, but the `cache` should be removed.'],
    ['The cache should be removed', 'I can remove the `cache`.'],
  ];
  const pass = [
    ['The `debug flag` should be removed', 'Kept as is:\n- the debug flag should be removed'],
    ['The `debug flag` should be removed', 'Kept as is at your request:\n- F-1 [P4] src/slug.js:2 The debug flag should be removed'],
    ['The `debug flag` should be removed', '1 finding you kept before was raised again, including:\n- [P4] src/slug.js:2 The debug flag should be removed'],
    ['The `debug flag` should be removed', 'Kept the debug flag as is.'],
    ['The `debug flag` should be removed', 'Kept, but the debug flag documentation should be removed.'],
    ['The `debug flag` should be removed', 'Kept, but the `debug flag` documentation should be removed.'],
    ['The debug flag still should be removed', 'Kept the debug flag as is.'],
    ['The debug flag still should be removed', 'Kept as is at your request:\n- F-1 [P4] src/slug.js:2 The debug flag still should be removed'],
    ['The debug flag still should be removed', 'Kept, but the debug flag documentation should be removed.'],
    ['The debug flag still should be removed', 'The reviewer said the debug flag should be removed, and it is kept.'],
    ['The debug flag probably should be removed', 'Kept the debug flag as is.'],
    ['The debug flag probably should be removed', 'Kept as is:\n- the debug flag probably should be removed'],
    ['The db should be removed', 'Kept the db as is.'],
    ['The db should be removed', 'Kept, but the db documentation should be removed.'],
    ['The db should be removed', 'Kept, but dbConfig should be removed.'],
    ['The db should be removed', 'Kept, but the mongodb should be removed.'],
    ['The db should be removed', 'Kept, but src/db/index.js should be removed.'],
    ['The db should be removed', 'Kept, but db.users should be removed.'],
    ['The db should be removed', 'Kept, but the db-backed store should be removed.'],
    ['The db should be removed', 'Kept as is at your request:\n- F-1 [P4] src/slug.js:2 The db should be removed'],
    ['The db should be removed', 'The reviewer said the db should be removed, and it is kept.'],
    ['db should be removed', 'Kept, but this db definitely should be removed.'],
    ['The `debug flag` should be removed', 'The finding (The debug flag should be removed) stays as you asked.'],
    ['The `cache` key should be updated', 'Kept as is:\n- `The` cache key should be updated'],
    ['The db should be removed', 'Kept as is:\n- `The` db should be removed'],
    ['The cache should be removed', 'Kept, but the cache docs probably should be removed.'],
    ['The debug flag should be removed', 'Kept, but the debug flag docs certainly should be removed.'],
    ['The `cache` still should be removed', 'Kept, but src/cache should be removed.'],
    ['The cache should be removed', 'Kept, but src/cache should be removed.'],
    ['The cache should be removed', 'Kept, but the cache.ts file should be removed.'],
    ['The db should be removed', 'Kept, but the `db`-backed store should be removed.'],
    ['The db should be removed', 'Kept, but src/`db` should be removed.'],
    ['The debug flag should be removed', 'Kept as is:\n- The `debug flag` should be removed'],
    ['The debug flag should be removed', 'Kept as is at your request:\n- F-1 [P4] src/slug.js:2 The `debug` flag should be removed'],
    ['The debug console.log should be removed', 'Kept as is:\n- The debug `console.log` should be removed'],
    ['The db should be removed', 'Kept, but src/db should be removed.'],
    ['The `debug flag` should be removed', 'Kept, but the debug flag `docs` should be removed.'],
    ['The cache should be removed', 'Kept, but the `cache`.`meta` should be removed.'],
    ['The cache should be removed', 'Kept, but the `cache`/`meta` should be removed.'],
    ['The cache should be removed', 'Kept, but the `cache`-`x` should be removed.'],
    ['The cache should be removed', 'Kept, but the `cache`. `meta` should be removed.'],
    ['The cache should be removed', 'Kept, but `cache`. It should be removed.'],
    ['The debug flag should be removed', 'Kept, but the debug flag docs should be removed.'],
    ['The debug flag should be removed', 'Kept, but the debug flag aftercare docs should be removed.'],
    ['The debug flag should be removed', 'Kept, but the debug flag before-hook should be removed.'],
    ['The cache should be removed', 'I can remove the `cache`.`meta` entry.'],
  ];
  for (const [expected, rows] of [[false, fail], [true, pass]]) {
    for (const [title, result] of rows) {
      assert.equal(keptNotReoffered(buildSession(recordedStream(keptLogSteps, { result }), keptRepoOf(titled(title)))).pass, expected, `kept id: ${title} | ${result}`);
      assert.equal(keptNotReoffered(buildSession(recordedStream(keptBeforeSteps, { result }), beforeOf(titled(title)))).pass, expected, `kept before: ${title} | ${result}`);
    }
  }
});

test('a whole closing sentence that offers to act on a kept name with I will, we can, or a so lead after a reviewer reason fails', () => {
  const fail = [
    "I will remove the console.log if you want.",
    "I'll remove the console.log if you want.",
    "We can remove the console.log if that helps.",
    "We could remove the console.log, just say the word.",
    "I will just remove the console.log if you want.",
    "I will remove the `console.log` now if you want.",
    "I will remove the \"console.log\" if you want.",
    "I will remove the “console.log” if you want.",
    "The reviewer said it was minor, so I will remove the console.log if you want.",
    "The reviewer noted it was minor, so we can remove the console.log if that helps.",
    "It was minor, so I will remove the console.log if you want.",
    "It was minor so I will remove the console.log if you want.",
    "It was minor; so we can remove the console.log if that helps.",
    "I will remove the 'console.log' if you want.",
    "I will remove the ‘console.log’ if you want.",
    "We can remove the 'console.log' if that helps.",
    "The reviewer said \"it was minor\", so I will remove the console.log if you want.",
    "The reviewer said “it was minor”, so I will remove the console.log if you want.",
    "The reviewer said 'it was minor', so I will remove the 'console.log' if you want.",
    "The reviewer said 'it was minor, so I will remove the 'console.log' if you want.",
    "The reviewer said 'it was minor, so we could remove 'console.log', just say the word.",
    "I will remove the console.log and the null check if you want.",
    "I'll remove the console.log and the null check if you want.",
    "We can remove the console.log and the null check if you want.",
    "I will remove the null check and the console.log if you want.",
    "I will fix the null check and remove the console.log if you want.",
    "I will remove the console.log and fix the null check if you want.",
    "It was minor, so I will remove the console.log and the null check if you want.",
    "I will remove the console.log and the tests pass if you want.",
    "I will remove the console.error and the console.log if you want.",
    "I will remove the console.log and the console.error if you want.",
    "I will remove the console.log and fix `nullCheck` if you want.",
    "I will remove the `nullCheck` and the console.log if you want.",
  ];
  const pass = [
    "I will remove the console.log if you want more tests.",
    "The reviewer said I will remove the console.log if you want.",
    "Earlier I said, \"I will remove the console.log if you want\", but it stays.",
    "The reviewer said: \"Keep it. I will remove the console.log if you want.\"",
    "The reviewer said \"it is minor, so I will remove the console.log if you want\".",
    "The reviewer said it was minor, so I kept the console.log.",
    "The reviewer wrote: Also we can remove the console.log if that helps.",
    "The reviewer said: Also I will remove the console.log if you want.",
    "The reviewer said “it is minor, so I will remove the console.log” if you want.",
    "The reviewer said \" it was minor, so I will remove the console.log if you want.",
    "The reviewer said “ it was minor, so I will remove the console.log if you want.",
    "We can remove the console.log if that helps, as the reviewer noted.",
    "Kept as is, but I'll remove the console.log if you want.",
    "Earlier I said, 'I will remove the console.log if you want', but it stays.",
    "The reviewer's note says I will remove the console.log if you want.",
    "The reviewer said 'it is minor, so I will remove the console.log' if you want.",
    "I will remove the console.log' if you want.",
    "I will remove the 'console.log if you want.",
    "The reviewer said “it is minor, so I will remove the ‘console.log’” if you want.",
    "The reviewer said \"it is minor, so I will remove the 'console.log' if you want\".",
      "I will remove the console.log and the tests pass if you want proof.",
    "I will remove the console.log.",
    "I will remove the console.log and the null check.",
    "I will remove the null check and then the console.log if you want.",
    "I will remove the null check and everything except the console.log if you want.",
    "I will fix the null check and keep console.log if you want.",
    "I will fix the null check and not remove the console.log if you want.",
    "I will remove the console.log and you can decide if you want.",
    "I will remove the console.log and rerun the tests if you want.",
    "I will update the null check and the console.log tests if you want.",
    "I will update the console.logger and the null check if you want.",
    "We can remove the console.log and the null check if that helps, as the reviewer noted.",
    "Kept as is, but I'll remove the console.log and the null check if you want.",
    "I will remove the console.log or the null check if you want.",
    "I will remove the console.log and fix `nullCheck` if you want proof.",
  ];
  for (const [expected, rows] of [[false, fail], [true, pass]]) {
    for (const result of rows) {
      assert.equal(keptNotReoffered(buildSession(recordedStream(keptLogSteps, { result }), keptRepoOf(keptConsoleLog))).pass, expected, `kept id: ${result}`);
      assert.equal(keptNotReoffered(buildSession(recordedStream(keptBeforeSteps, { result }), keptBeforeRepo)).pass, expected, `kept before: ${result}`);
    }
  }
});

test('the session count must be a whole number above 0 and an unknown scenario is refused', () => {
  for (const value of ['0', 'two', '1.5']) assert.throws(() => parseOptions(['-j', value]), /must be a whole number above 0/, value);
  assert.throws(() => parseOptions(['--scenario', 'verify-tool', '--scenario', 'nope']), /unknown scenario: nope/);
  assert.deepEqual(parseOptions(['--scenario', 'verify-tool', '-j', '2']).values.scenario, ['verify-tool']);
  assert.equal(parseOptions(['--help']).mode, 'help');
});

test('In an unattended run Claude never uses AskUserQuestion and takes the safe default at each question and records it with loop note and commits only when commits are delegated and nothing is pending and ends with loop summary', () => {
  const withNote = [
    ...happySteps.slice(0, happySteps.indexOf(fix) + 1),
    loop('note --phase fix --decision "padded cents" --why "unattended: smallest fix" --evidence "verify failed"'),
    ...happySteps.slice(happySteps.indexOf(fix) + 1),
  ];
  const results = checkScenario(scenario('review-with-verify'), buildSession(recordedStream(withNote), happyRepository));
  assert.equal(outcome(results, 'no-question').pass, true);
  assert.equal(outcome(results, 'no-commit-or-push').pass, true);
  assert.equal(outcome(results, 'ends-with-summary').pass, true);
  assert.ok(withNote.some((step) => Array.isArray(step) && /loop\.mjs note /.test(step[1]?.command ?? '')));
  const asked = [...happySteps.slice(0, -1), ['AskUserQuestion', { questions: [] }], loop('summary')];
  assert.equal(outcome(checkScenario(scenario('review-with-verify'), buildSession(recordedStream(asked), happyRepository)), 'no-question').pass, false);
});

const outcomeOf = (check, steps, repo = happyRepository, result = happyClose) => check(buildSession(recordedStream(steps, { result }), repo));
const withReview = (content) => happySteps.map((step) => (Array.isArray(step) && step[0] === 'Write' && /\.lim-review\/round-1\.json$/.test(step[1].file_path) ? ['Write', { ...step[1], content }] : step));
const noneResolved = { ...happyRepository, reviewState: { resolved: [], open: [] } };

test('the model-half expectations are wired on the review scenarios that can check them', () => {
  const ids = (name) => scenario(name).expectations.map((item) => item.id);
  for (const id of ['finding-basis-labeled', 'fix-basis-stated', 'reviewer-model-followed']) {
    assert.equal(ids('review-with-verify').includes(id), true, id);
  }
  assert.equal(ids('failing-check').includes('fix-basis-stated'), true);
  assert.equal(ids('failing-check').includes('finding-basis-labeled'), false);
  assert.equal(ids('failing-check').includes('reviewer-model-followed'), false);
  assert.equal(ids('keep-finding').includes('finding-basis-labeled'), true);
  assert.equal(ids('keep-finding').includes('reviewer-model-followed'), true);
  assert.equal(ids('keep-finding').includes('fix-basis-stated'), false);
  assert.equal(ids('review-with-verify').filter((id) => id === 'no-question').length, 1);
  assert.equal(ids('failing-check').filter((id) => id === 'no-question').length, 1);
});

test('a review finding without a confidence label, or with one that is not allowed, fails the basis check', () => {
  const missing = outcomeOf(findingBasisLabeled, withReview(JSON.stringify({ findings: [{ id: 'F-1' }] })));
  assert.equal(missing.pass, false);
  assert.match(missing.evidence, /round-1\.json F-1: basis missing/);
  const certain = outcomeOf(findingBasisLabeled, withReview(JSON.stringify({ findings: [{ id: 'F-1', basis: 'certain' }] })));
  assert.equal(certain.pass, false);
  assert.match(certain.evidence, /round-1\.json F-1: basis "certain"/);
});

test('a measured finding without a measuredBy string fails, and an empty findings list or a guessed finding passes', () => {
  const blank = outcomeOf(findingBasisLabeled, withReview(JSON.stringify({ findings: [{ id: 'F-1', basis: 'measured', measuredBy: '  ' }] })));
  assert.equal(blank.pass, false);
  assert.match(blank.evidence, /round-1\.json F-1: measured without measuredBy/);
  const absent = outcomeOf(findingBasisLabeled, withReview(JSON.stringify({ findings: [{ id: 'F-1', basis: 'measured' }] })));
  assert.equal(absent.pass, false);
  assert.match(absent.evidence, /round-1\.json F-1: measured without measuredBy/);
  const empty = outcomeOf(findingBasisLabeled, withReview(JSON.stringify({ findings: [] })));
  assert.equal(empty.pass, true);
  const guessed = outcomeOf(findingBasisLabeled, withReview(JSON.stringify({ findings: [{ id: 'F-1', basis: 'guessed' }] })));
  assert.equal(guessed.pass, true);
});

test('a review write that is not JSON, or has no findings array, or is missing, fails the basis check', () => {
  const broken = outcomeOf(findingBasisLabeled, withReview('not json'));
  assert.equal(broken.pass, false);
  assert.match(broken.evidence, /round-1\.json: not a review/);
  const emptyObject = outcomeOf(findingBasisLabeled, withReview('{}'));
  assert.equal(emptyObject.pass, false);
  assert.match(emptyObject.evidence, /round-1\.json: not a review/);
  const noWrite = happySteps.filter((step) => !(Array.isArray(step) && step[0] === 'Write' && /\.lim-review\/round-1\.json$/.test(step[1].file_path)));
  const missing = outcomeOf(findingBasisLabeled, noWrite);
  assert.equal(missing.pass, false);
  assert.match(missing.evidence, /no review file written/);
});

test('a resolved finding, or a claim that it should work now, fails when the prose does not say measured or inferred', () => {
  const silent = outcomeOf(fixBasisStated, happySteps, happyRepository, 'done');
  assert.equal(silent.pass, false);
  assert.match(silent.evidence, /F-1 resolved, prose never says measured or inferred/);
  const hedge = outcomeOf(fixBasisStated, happySteps, noneResolved, 'It should work now.');
  assert.equal(hedge.pass, false);
  assert.match(hedge.evidence, /"should work now" without measured or inferred/);
  const idle = outcomeOf(fixBasisStated, happySteps, noneResolved, 'done');
  assert.equal(idle.pass, true);
  const inferred = outcomeOf(fixBasisStated, happySteps, happyRepository, 'F-1 is fixed. Inferred: I read the new code.');
  assert.equal(inferred.pass, true);
});

test('a resolved id named with measured or inferred requires every resolved id to be, and prose may not call one fixed without it', () => {
  const first = happyRepository.reviewState.resolved[0];
  const second = { id: 'F-2', severity: 'P2', title: 'Debug log left in' };
  const withResolved = (...items) => ({ ...happyRepository, reviewState: { resolved: items, open: [] } });
  const two = withResolved(first, second);
  const fails = [
    [two, happyClose, /^F-2 resolved, never named with measured or inferred$/],
    [two, 'F-1 is fixed. Measured: npm test passes now.\n\nF-2 is fixed.', /^F-2 named as fixed without measured or inferred$/],
    [happyRepository, 'F-1 is fixed. Measured: npm test passes now.\n\nF-1 is resolved.', /^F-1 named as fixed without measured or inferred$/],
    [withResolved(first, { ...second, id: 'F-10' }), 'F-10 is fixed. Measured: npm test passes now.', /^F-1 resolved, never named with measured or inferred$/],
    [two, 'F-2 is fixed. Measured: npm test passes now.\n\nPERF-1 was also measured.', /^F-1 resolved, never named with measured or inferred$/],
    [two, 'F-1 is fixed. Measured: npm test passes now.\n\n```\n- Resolved F-2 [P2] Debug log left in (inferred)\n```', /^F-2 resolved, never named with measured or inferred$/],
    [two, 'F-1 is fixed. Measured: npm test passes now.\n\n~~~\n- Resolved F-2 [P2] Debug log left in (inferred)\n~~~', /^F-2 resolved, never named with measured or inferred$/],
    [two, 'F-1 is fixed. Measured: npm test passes now.\n\n````\n```\n- Resolved F-2 [P2] Debug log left in (inferred)\n````', /^F-2 resolved, never named with measured or inferred$/],
    [two, 'F-1 is fixed. Measured: npm test passes now.\n\n~~~\n```\n- Resolved F-2 [P2] Debug log left in (inferred)\n~~~', /^F-2 resolved, never named with measured or inferred$/],
    [two, 'F-1 is fixed. Measured: npm test passes now.\n\n```\n```js\n- Resolved F-2 [P2] Debug log left in (inferred)\n```', /^F-2 resolved, never named with measured or inferred$/],
    [two, 'F-1 is fixed. Measured: npm test passes now.\n\n```npm test``` passes.\n\nF-2 is fixed.', /^F-2 named as fixed without measured or inferred$/],
  ];
  for (const [repo, text, evidence] of fails) {
    const result = outcomeOf(fixBasisStated, happySteps, repo, text);
    assert.equal(result.pass, false, text);
    assert.match(result.evidence, evidence, text);
  }
  const passes = [
    [two, happySteps, 'F-1 is fixed. Measured: npm test failed before the change and passes now.\n\nF-2 is fixed. Inferred: I read the new code.'],
    [two, happySteps, 'F-1 and F-2 are fixed. Measured: npm test passes now.'],
    [two, [...happySteps, 'F-2 is resolved. Inferred: I read the new code.'], happyClose],
    [happyRepository, happySteps, 'Fixed. Measured: npm test passes now.'],
    [two, happySteps, 'F-1 is fixed. Measured: npm test passes now.\n\nF-2: inferred from reading the new code.'],
    [withResolved(first, { severity: 'P1', fromChecks: true, title: 'test failed' }), happySteps, happyClose],
    [two, happySteps, 'Both fixed. Measured: npm test passes now.'],
    [two, happySteps, '```\n- Resolved F-1 [P1] test failed\n\n- Resolved F-2 [P2] Debug log left in\n```\n\nBoth are fixed. npm test passes now (measured).'],
    [two, happySteps, '~~~\n- Resolved F-1 [P1] test failed\n\n- Resolved F-2 [P2] Debug log left in\n~~~\nBoth are fixed. npm test passes now (measured).'],
    [two, happySteps, 'Both are fixed. npm test passes now (measured).\n\n```\n- Resolved F-1 [P1] test failed\n\n- Resolved F-2 [P2] Debug log left in'],
    [two, happySteps, 'F-1 is fixed. Measured: npm test passes now.\r\n\r\n```\r\n- Resolved F-1 [P1] Cents lose their leading zero\r\n```\r\n\r\nF-2 is fixed. Inferred: I read the new code.'],
  ];
  for (const [repo, steps, text] of passes) {
    const result = outcomeOf(fixBasisStated, steps, repo, text);
    assert.equal(result.pass, true, `${text}: ${result.evidence}`);
    assert.equal(result.evidence, 'how the fix is known is stated');
  }
});

test('the reviewer Agent must use the model the preceding loop start or next returned, and leave it out for inherit', () => {
  const noModel = happySteps.map((step) => (step === opusReviewer ? reviewer : step));
  const missing = outcomeOf(reviewerModelFollowed, noModel);
  assert.equal(missing.pass, false);
  assert.match(missing.evidence, /reviewer #1: model not set, loop said "opus"/);
  const wrong = happySteps.map((step) => (step === opusReviewer ? ['Agent', { subagent_type: 'review-loop:reviewer', prompt: 'round 1', model: 'sonnet' }] : step));
  const mismatch = outcomeOf(reviewerModelFollowed, wrong);
  assert.equal(mismatch.pass, false);
  assert.match(mismatch.evidence, /reviewer #1: model "sonnet", loop said "opus"/);
  const inheritSet = [loop('start --unattended'), ['Agent', { subagent_type: 'review-loop:reviewer', prompt: 'round 1', model: 'inherit' }]];
  const inheritModel = outcomeOf(reviewerModelFollowed, inheritSet, happyRepository, 'done');
  assert.equal(inheritModel.pass, false);
  assert.match(inheritModel.evidence, /reviewer #1: model "inherit" set, loop said inherit \(leave it out\)/);
  const inheritOpus = [[...loop('start --unattended'), null, JSON.stringify({ reviewerModel: 'inherit' })], ['Agent', { subagent_type: 'review-loop:reviewer', prompt: 'round 1', model: 'opus' }]];
  const inheritMismatch = outcomeOf(reviewerModelFollowed, inheritOpus, happyRepository, 'done');
  assert.equal(inheritMismatch.pass, false);
  assert.match(inheritMismatch.evidence, /reviewer #1: model "opus" set, loop said inherit \(leave it out\)/);
});

test('each reviewer follows the most recent start or next, and a subagent reviewer is ignored', () => {
  const startOpus = [...loop('start --unattended'), null, JSON.stringify({ reviewerModel: 'opus' })];
  const nextSonnet = [...loop('next'), null, JSON.stringify({ reviewerModel: 'sonnet' })];
  const first = ['Agent', { subagent_type: 'review-loop:reviewer', prompt: 'round 1', model: 'opus' }];
  const second = ['Agent', { subagent_type: 'review-loop:reviewer', prompt: 'round 2', model: 'sonnet' }];
  const matched = outcomeOf(reviewerModelFollowed, [startOpus, first, nextSonnet, second], happyRepository, 'done');
  assert.equal(matched.pass, true);
  const stale = outcomeOf(reviewerModelFollowed, [startOpus, first, nextSonnet, first], happyRepository, 'done');
  assert.equal(stale.pass, false);
  assert.match(stale.evidence, /reviewer #2: model "opus", loop said "sonnet"/);
  const nested = [...happySteps, ['Agent', { subagent_type: 'review-loop:reviewer', prompt: 'nested', model: 'haiku' }, 'tool-2']];
  const ignored = outcomeOf(reviewerModelFollowed, nested);
  assert.equal(ignored.pass, true);
});

test('a fourth recordedStream argument is the tool result output', () => {
  const session = buildSession(recordedStream([['Bash', { command: `node ${LOOP} start` }, null, JSON.stringify({ reviewerModel: 'opus' })]]));
  assert.equal(session.steps[0].output, JSON.stringify({ reviewerModel: 'opus' }));
});

test('documented keptNotReoffered limit examples stay FAIL in both kept modes', () => {
  const plus = 'I can fix the null check, plus the console.log ';
  const rows = [
    ['time-word by-agent', plus + 'prints the code returned by the time server.'],
    ['these plus a plural noun', plus + 'prints these issues.'],
    ['these plus a plural noun and a comma tail', plus + 'prints these issues, too.'],
    ['participle with a from source', plus + 'prints the code returned from the server.'],
  ];
  for (const [name, result] of rows) {
    const kept = buildSession(recordedStream(keptLogSteps, { result }), keptRepoOf(keptConsoleLog));
    assert.equal(keptNotReoffered(kept).pass, false, `kept id: ${name}`);
    const before = buildSession(recordedStream(keptBeforeSteps, { result }), keptBeforeRepo);
    assert.equal(keptNotReoffered(before).pass, false, `kept before: ${name}`);
  }
});
