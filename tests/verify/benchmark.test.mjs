import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { copyFixtures, dryRun, parseStream, prepareProject, scoreCase, summarize, toolActivity, writtenContents } from '../../evals/verify/run-benchmark.mjs';

const evalsDir = fileURLToPath(new URL('../../evals/verify/', import.meta.url));
const projectsDir = path.join(evalsDir, 'projects');
const projects = readdirSync(projectsDir).filter((name) => existsSync(path.join(projectsDir, name, 'repo')));
const cases = JSON.parse(readFileSync(path.join(evalsDir, 'cases.json'), 'utf8'));

test('the benchmark has at least 4 projects with a broken case and 2 working cases', () => {
  assert.ok(projects.length >= 4);
  for (const project of projects) assert.ok(cases.some((entry) => entry.project === project && entry.broken), project);
  assert.ok(cases.filter((entry) => !entry.broken).length >= 2);
});

test('each project reference map passes on the working copy and fails only on the broken feature', () => {
  for (const project of projects) {
    const outcome = dryRun(path.join(projectsDir, project));
    assert.ok(Object.values(outcome.working).every((status) => status === 'pass'), `${project}: ${JSON.stringify(outcome.working)}`);
    assert.equal(Object.values(outcome.broken).filter((status) => status === 'fail').length, 1, `${project}: ${JSON.stringify(outcome.broken)}`);
  }
});

test('a prepared copy has one commit, a plain name, and no trace of the benchmark', () => {
  const workDir = prepareProject(path.join(projectsDir, 'slugkit'), true);
  try {
    assert.match(path.basename(workDir), /^slugkit-/);
    assert.equal(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: workDir, encoding: 'utf8' }).trim(), '1');
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: workDir, encoding: 'utf8' }), '');
    const files = execFileSync('git', ['ls-files'], { cwd: workDir, encoding: 'utf8' });
    assert.doesNotMatch(files, /broken|expected|reference|verify/);
    assert.doesNotMatch(readFileSync(path.join(workDir, 'src/slugify.js'), 'utf8'), /\\p\{M\}/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('a prepared copy of a Python project takes its name from pyproject.toml', () => {
  const workDir = prepareProject(path.join(projectsDir, 'centshare'), false);
  try {
    assert.match(path.basename(workDir), /^centshare-/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('a broken feature is caught only by a check that passes on the working copy', () => {
  assert.equal(scoreCase({ broken: true, modelStatuses: { a: 'fail', b: 'pass' }, intactStatuses: { a: 'pass', b: 'pass' } }).result, 'caught');
  const both = scoreCase({ broken: true, modelStatuses: { a: 'fail' }, intactStatuses: { a: 'fail' } });
  assert.equal(both.result, 'missed');
  assert.deepEqual(both.falseFailures, ['a']);
  assert.equal(scoreCase({ broken: true, modelStatuses: { a: 'pass' }, intactStatuses: { a: 'pass' } }).result, 'missed');
});

test('a run in which no check ran is an error, not a miss', () => {
  const score = scoreCase({ broken: true, evidenceRuns: 0, modelStatuses: {}, intactStatuses: { a: 'fail' } });
  assert.equal(score.result, 'error');
  assert.equal(score.error, 'no check ran');
  assert.equal(scoreCase({ broken: true, evidenceRuns: 1, modelStatuses: { a: 'pass' }, intactStatuses: { a: 'pass' } }).result, 'missed');
});

test('on a working project every failing check is a false failure', () => {
  const score = scoreCase({ broken: false, modelStatuses: { a: 'fail', b: 'not-verified' }, intactStatuses: { a: 'pass', b: 'pass' } });
  assert.equal(score.result, 'false-failure');
  assert.deepEqual(score.falseFailures, ['a']);
  assert.deepEqual(score.notVerified, ['b']);
  assert.equal(scoreCase({ broken: false, modelStatuses: { a: 'pass' }, intactStatuses: { a: 'pass' } }).result, 'clean');
});

test('summary counts a run in which no check ran as an error, apart from caught and missed', () => {
  const base = { checkCount: 3, notVerified: [], changedAfterFail: [], removedAfterFail: [], sourceChanged: [], falseFailures: [] };
  const summary = summarize([
    { ...base, case: 'one', broken: true, result: 'caught' },
    { ...base, case: 'two', broken: true, result: 'error', error: 'no check ran', checkCount: 10 },
  ]);
  assert.deepEqual([summary.caught, summary.missed, summary.brokenCases, summary.errors, summary.checks], [1, 0, 1, 1, 3]);
  assert.deepEqual(summary.errorCases, [{ case: 'two', error: 'no check ran' }]);
});

test('summary counts caught, missed, false failures, and cost', () => {
  const base = { checkCount: 3, notVerified: [], changedAfterFail: [], removedAfterFail: [], sourceChanged: [] };
  const summary = summarize([
    { ...base, broken: true, result: 'caught', falseFailures: [], tokens: { total: 100 }, costUsd: 0.5, wallMs: 1000 },
    { ...base, broken: true, result: 'missed', falseFailures: ['x'], tokens: { total: 50 }, costUsd: 0.25, wallMs: 3000 },
    { ...base, broken: false, result: 'clean', falseFailures: [], sourceChanged: ['src/a.js'] },
    { broken: false, result: 'error', error: 'crashed' },
  ]);
  assert.deepEqual(
    [summary.caught, summary.missed, summary.brokenCases, summary.workingCases, summary.falseFailureChecks, summary.errors],
    [1, 1, 2, 1, 1, 1],
  );
  assert.equal(summary.totalCostUsd, 0.75);
  assert.equal(summary.casesWithSourceChanges, 1);
});

test('only untracked files Claude wrote with its file tools are copied to the working copy', () => {
  const brokenDir = prepareProject(path.join(projectsDir, 'jot'), true);
  const intactDir = prepareProject(path.join(projectsDir, 'jot'), false);
  try {
    mkdirSync(path.join(brokenDir, 'fixtures'));
    writeFileSync(path.join(brokenDir, 'fixtures/list.json'), '[]\n');
    mkdirSync(path.join(brokenDir, '.verify-tmp/done'), { recursive: true });
    writeFileSync(path.join(brokenDir, '.verify-tmp/done/todo.json'), '[{"text":"from a check"}]\n');
    writeFileSync(path.join(brokenDir, 'verify.features.json'), '{}');
    writeFileSync(path.join(brokenDir, 'src/todos.js'), 'export {};\n');
    const filesWritten = [path.join(brokenDir, 'fixtures/list.json'), path.join(brokenDir, 'verify.features.json'), 'src/todos.js'];
    assert.deepEqual(copyFixtures(brokenDir, intactDir, filesWritten), ['fixtures/list.json']);
    assert.equal(readFileSync(path.join(intactDir, 'fixtures/list.json'), 'utf8'), '[]\n');
    assert.equal(existsSync(path.join(intactDir, '.verify-tmp')), false);
    assert.equal(existsSync(path.join(intactDir, 'verify.features.json')), false);
    assert.notEqual(readFileSync(path.join(intactDir, 'src/todos.js'), 'utf8'), 'export {};\n');
  } finally {
    rmSync(brokenDir, { recursive: true, force: true });
    rmSync(intactDir, { recursive: true, force: true });
  }
});

test('a fixture a check changed is copied to the working copy as Claude last wrote it', () => {
  const brokenDir = prepareProject(path.join(projectsDir, 'jot'), true);
  const intactDir = prepareProject(path.join(projectsDir, 'jot'), false);
  try {
    const fixture = path.join(brokenDir, 'fixtures/list.json');
    const edited = path.join(brokenDir, 'fixtures/edited.json');
    const events = [{ type: 'assistant', message: { content: [
      { type: 'tool_use', name: 'Write', input: { file_path: fixture, content: '[1]\n' } },
      { type: 'tool_use', name: 'Edit', input: { file_path: fixture, old_string: '1', new_string: '2' } },
      { type: 'tool_use', name: 'Edit', input: { file_path: edited, old_string: 'a', new_string: 'b' } },
    ] } }];
    mkdirSync(path.dirname(fixture));
    writeFileSync(fixture, '[2, "changed by a check"]\n');
    writeFileSync(edited, 'on disk\n');
    const contents = writtenContents(events);
    assert.deepEqual([...contents], [[fixture, '[2]\n'], [edited, null]]);
    assert.deepEqual(copyFixtures(brokenDir, intactDir, [fixture, edited], contents).sort(), ['fixtures/edited.json', 'fixtures/list.json']);
    assert.equal(readFileSync(path.join(intactDir, 'fixtures/list.json'), 'utf8'), '[2]\n');
    assert.equal(readFileSync(path.join(intactDir, 'fixtures/edited.json'), 'utf8'), 'on disk\n');
  } finally {
    rmSync(brokenDir, { recursive: true, force: true });
    rmSync(intactDir, { recursive: true, force: true });
  }
});

test('the stream keeps every Bash command Claude tried and each permission denial', () => {
  const lines = [
    { type: 'system', subtype: 'init' },
    { type: 'assistant', message: { content: [
      { type: 'text', text: 'Running the checks.' },
      { type: 'tool_use', id: 'allowed', name: 'Bash', input: { command: 'node /plugin/verify.mjs run' } },
      { type: 'tool_use', id: 'blocked', name: 'Bash', input: { command: 'mkdir -p .fixtures && node /plugin/verify.mjs run' } },
      { type: 'tool_use', id: 'read', name: 'Read', input: { file_path: '/repo/README.md' } },
      { type: 'tool_use', id: 'fixture', name: 'Write', input: { file_path: '/repo/fixtures/a.csv', content: 'a\\n' } },
      { type: 'tool_use', id: 'again', name: 'Edit', input: { file_path: '/repo/fixtures/a.csv', old_string: 'a', new_string: 'b' } },
    ] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'allowed', content: 'verify: 3 passed', is_error: false }] },
      tool_result_meta: [{ id: 'allowed', permission_decision: { decision: 'accept' } }] },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'blocked', content: [{ type: 'text', text: 'Permission to use Bash has been denied' }], is_error: true }] } },
    { type: 'result', subtype: 'success', result: 'done', permission_denials: [
      { tool_name: 'Bash', tool_use_id: 'blocked', tool_input: { command: 'mkdir -p .fixtures && node /plugin/verify.mjs run' } },
      { tool_name: 'Write', tool_use_id: 'write', tool_input: { file_path: '/repo/out.txt', content: 'x' } },
    ] },
  ];
  const { events, result } = parseStream(`${lines.map((line) => JSON.stringify(line)).join('\n')}\n{"type":"assist`);
  assert.equal(result.result, 'done');
  const activity = toolActivity(events, result);
  assert.deepEqual(activity.bashCommands, [
    { command: 'node /plugin/verify.mjs run', denied: false, isError: false, permission: 'accept' },
    { command: 'mkdir -p .fixtures && node /plugin/verify.mjs run', denied: true, isError: true, output: 'Permission to use Bash has been denied' },
  ]);
  assert.deepEqual(activity.filesWritten, ['/repo/fixtures/a.csv']);
  assert.deepEqual(activity.permissionDenials, [
    { tool: 'Bash', input: 'mkdir -p .fixtures && node /plugin/verify.mjs run' },
    { tool: 'Write', input: '/repo/out.txt' },
  ]);
});

test('a run that never finished has no result but keeps what Claude tried', () => {
  const { events, result } = parseStream(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'node x.js' } }] } }));
  assert.equal(result, undefined);
  assert.deepEqual(toolActivity(events).bashCommands, [{ command: 'node x.js', denied: false, isError: null }]);
});
