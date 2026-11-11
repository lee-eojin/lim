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
