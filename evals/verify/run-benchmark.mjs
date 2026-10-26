#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { compareRunFiles } from '../../plugins/verify/skills/verify/scripts/verify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const pluginDir = path.join(repoRoot, 'plugins/verify');
const skillFile = path.join(pluginDir, 'skills/verify/SKILL.md');
const verifyScript = path.join(pluginDir, 'skills/verify/scripts/verify.mjs');
const MAP_FILE = 'verify.features.json';
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const PROMPT = "/verify:verify Check that this project's features work.";
const ALLOWED_TOOLS = 'Read,Grep,Glob,Write,Edit,Skill,Bash(node:*)';

const usage = `Usage: node evals/verify/run-benchmark.mjs [options]

Copies each project in evals/verify/projects/ to a neutral temporary folder, broken or
working as evals/verify/cases.json says, runs Claude headlessly with the verify skill,
and scores the feature map it wrote: a broken feature is caught when a check fails on
the broken copy and passes on a fresh working copy. A run in which no check ran is
an error, not a miss. Each run records the Bash commands Claude tried and any permission
denials.

  --case <name>        run only this case (repeatable)
  --model <name>       model for the session (default: Claude Code's default)
  -j, --concurrency <n>  runs at once (default: 1)
  --label <text>       added to the results file name
  --out <file>         results file (default: evals/verify/results/<date>-<model>[-<label>].json)
  --timeout <seconds>  per run (default: 900)
  --dry-run            run each project's reference map on its broken and working copies,
                       without a model, to show every break is detectable
  --keep               keep the temporary folders
`;

const git = (cwd, ...args) => execFileSync('git', [
  '-c', 'user.name=dev', '-c', 'user.email=dev@localhost', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args,
], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export function projectNameOf(repo) {
  try {
    return JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')).name || 'app';
  } catch {
    try {
      return /^name\s*=\s*"([^"]+)"/m.exec(readFileSync(path.join(repo, 'pyproject.toml'), 'utf8'))?.[1] ?? 'app';
    } catch {
      return 'app';
    }
  }
}

// The model must not be able to tell it is being measured, so the copy has a plain project
// name and one commit, and the break is part of that commit rather than a visible change.
export function prepareProject(projectDir, broken) {
  const sourceRepo = path.join(projectDir, 'repo');
  const workDir = realpathSync(mkdtempSync(path.join(tmpdir(), `${projectNameOf(sourceRepo).replace(/[^\w.-]/g, '-')}-`)));
  try {
    cpSync(sourceRepo, workDir, { recursive: true });
    git(workDir, 'init', '-q');
    if (broken) git(workDir, 'apply', path.join(projectDir, 'broken.diff'));
    git(workDir, 'add', '-A');
    git(workDir, 'commit', '-q', '-m', 'Initial commit');
    return workDir;
  } catch (error) {
    rmSync(workDir, { recursive: true, force: true });
    throw error;
  }
}

export function runMap(workDir, mapFile) {
  if (mapFile !== path.join(workDir, MAP_FILE)) copyFileSync(mapFile, path.join(workDir, MAP_FILE));
  const result = spawnSync('node', [verifyScript, 'run'], { cwd: workDir, encoding: 'utf8', timeout: 10 * 60 * 1000 });
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { error: (result.stderr || result.stdout).trim().slice(0, 2000) };
  }
}

export const statusesOf = (result) => Object.fromEntries((result.checks ?? []).map((check) => [check.id, check.status]));

export function readEvidence(workDir) {
  const runsDir = path.join(workDir, '.git', 'lim', 'verify', 'runs');
  const files = existsSync(runsDir) ? readdirSync(runsDir).filter((name) => name.endsWith('.json')).sort(compareRunFiles) : [];
  const latest = {};
  const changedAfterFail = new Set();
  const removedAfterFail = new Set();
  for (const file of files) {
    const run = JSON.parse(readFileSync(path.join(runsDir, file), 'utf8'));
    for (const check of run.checks) {
      latest[check.id] = check;
      if (check.changedAfterFail) changedAfterFail.add(check.id);
    }
    for (const id of run.removedAfterFail ?? []) removedAfterFail.add(id);
  }
  return { runs: files.length, latest, changedAfterFail: [...changedAfterFail], removedAfterFail: [...removedAfterFail] };
}

export function scoreCase({ broken, evidenceRuns, modelStatuses, intactStatuses }) {
  if (evidenceRuns === 0) return { result: 'error', error: 'no check ran', catching: [], falseFailures: [], notVerified: [] };
  const failing = Object.keys(modelStatuses).filter((id) => modelStatuses[id] === 'fail');
  const catching = failing.filter((id) => intactStatuses[id] === 'pass');
  const falseFailures = broken ? failing.filter((id) => intactStatuses[id] !== 'pass') : failing;
  const notVerified = Object.keys(modelStatuses).filter((id) => modelStatuses[id] === 'not-verified');
  const result = broken ? (catching.length ? 'caught' : 'missed') : (falseFailures.length ? 'false-failure' : 'clean');
  return { result, catching, falseFailures, notVerified };
}

function runClaude({ cwd, model, timeoutSeconds }) {
  const args = [
    '-p', PROMPT,
    '--plugin-dir', pluginDir,
    '--setting-sources', '',
    '--strict-mcp-config',
    '--permission-mode', 'dontAsk',
    '--allowedTools', ALLOWED_TOOLS,
    '--no-session-persistence',
    '--output-format', 'stream-json',
    '--verbose',
  ];
  if (model) args.push('--model', model);
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutSeconds * 1000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, wallMs: Date.now() - started });
    });
  });
}

export function parseStream(text) {
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // A partial last line after a timeout carries nothing to score.
    }
  }
  return { events, result: events.findLast((event) => event.type === 'result') };
}

const excerpt = (value, length = 300) => (typeof value === 'string' ? value : JSON.stringify(value) ?? '').slice(0, length);

const inputSummary = (input = {}) => input.command ?? input.file_path ?? input.skill ?? excerpt(input);

// What Claude tried, kept because a headless run leaves no session to look at afterwards.
export function toolActivity(events, result = {}) {
  const outcomes = new Map();
  for (const event of events) {
    if (event.type !== 'user') continue;
    const decisions = new Map((event.tool_result_meta ?? []).map((meta) => [meta.id, meta.permission_decision]));
    for (const block of event.message?.content ?? []) {
      if (block.type !== 'tool_result') continue;
      const content = Array.isArray(block.content) ? block.content.map((part) => part.text ?? '').join('\n') : block.content;
      outcomes.set(block.tool_use_id, { isError: Boolean(block.is_error), output: excerpt(content), decision: decisions.get(block.tool_use_id) });
    }
  }
  const deniedIds = new Set((result.permission_denials ?? []).map((denial) => denial.tool_use_id));
  const bashCommands = [];
  const filesWritten = [];
  for (const event of events) {
    if (event.type !== 'assistant') continue;
    for (const block of event.message?.content ?? []) {
      if (block.type !== 'tool_use') continue;
      if (FILE_TOOLS.has(block.name)) {
        const file = block.input?.file_path ?? block.input?.notebook_path;
        if (file && !filesWritten.includes(file)) filesWritten.push(file);
      }
      if (block.name !== 'Bash') continue;
      const outcome = outcomes.get(block.id);
      bashCommands.push({
        command: block.input?.command,
        denied: deniedIds.has(block.id),
        isError: outcome?.isError ?? null,
        ...(outcome?.decision && { permission: outcome.decision.decision }),
        ...(outcome?.isError && { output: outcome.output }),
      });
    }
  }
  const permissionDenials = (result.permission_denials ?? []).map((denial) => ({ tool: denial.tool_name, input: inputSummary(denial.tool_input) }));
  return { bashCommands, permissionDenials, filesWritten };
}

function tokenUsage(output) {
  const usage = output.usage ?? {};
  const input = usage.input_tokens ?? 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  return { input, cacheCreation, cacheRead, output: outputTokens, total: input + cacheCreation + cacheRead + outputTokens };
}

function mainModel(output) {
  const entries = Object.entries(output.modelUsage ?? {});
  entries.sort((a, b) => (b[1].outputTokens ?? 0) - (a[1].outputTokens ?? 0));
  return entries[0]?.[0];
}

export const untrackedFiles = (workDir) => git(workDir, 'ls-files', '--others', '--exclude-standard', '-z')
  .split('\0').filter((file) => file && file !== MAP_FILE);

const applyEdit = (text, { old_string: before, new_string: after, replace_all: all }) => (all ? text.split(before).join(after) : text.replace(before, () => after));

// A check can change the fixture it reads, so the working copy gets each file as Claude last wrote it.
// null means Claude edited a file it never wrote in full, and the file on disk is used instead.
export function writtenContents(events) {
  const contents = new Map();
  for (const event of events) {
    if (event.type !== 'assistant') continue;
    for (const block of event.message?.content ?? []) {
      if (block.type !== 'tool_use' || !FILE_TOOLS.has(block.name) || !block.input?.file_path) continue;
      const { file_path: file, content, edits } = block.input;
      const before = contents.get(file);
      if (block.name === 'Write') contents.set(file, content);
      else if (typeof before !== 'string') contents.set(file, null);
      else contents.set(file, (edits ?? [block.input]).reduce(applyEdit, before));
    }
  }
  return contents;
}

// Checks often read fixture files the model wrote next to the map, so the working copy needs them.
// Only files the model wrote with its file tools are copied: files the checks wrote are results, not inputs.
export function copyFixtures(fromDir, toDir, filesWritten, contents = new Map()) {
  const written = new Map(filesWritten.map((file) => {
    const target = path.resolve(fromDir, file);
    return [path.relative(fromDir, existsSync(target) ? realpathSync(target) : target), contents.get(file) ?? null];
  }));
  const fixtures = untrackedFiles(fromDir).filter((file) => written.has(file));
  for (const file of fixtures) {
    mkdirSync(path.dirname(path.join(toDir, file)), { recursive: true });
    const content = written.get(file);
    if (typeof content === 'string') writeFileSync(path.join(toDir, file), content);
    else copyFileSync(path.join(fromDir, file), path.join(toDir, file));
  }
  return fixtures;
}

function changedSource(workDir) {
  return git(workDir, 'diff', '--name-only', 'HEAD').split('\n').filter((file) => file && file !== MAP_FILE);
}

function scoreWorkDir(entry, projectDir, workDir, filesWritten, contents) {
  const mapFile = path.join(workDir, MAP_FILE);
  if (!existsSync(mapFile)) return { result: 'error', error: 'no feature map was written' };
  let map;
  try {
    map = JSON.parse(readFileSync(mapFile, 'utf8'));
  } catch (error) {
    return { result: 'error', error: `the feature map is not JSON: ${error.message}` };
  }
  const evidence = readEvidence(workDir);
  const ids = (map.features ?? []).map((feature) => feature.id);
  const modelStatuses = Object.fromEntries(ids.filter((id) => evidence.latest[id]).map((id) => [id, evidence.latest[id].status]));
  const intactDir = prepareProject(projectDir, false);
  let intact;
  let fixtureFiles;
  try {
    fixtureFiles = copyFixtures(workDir, intactDir, filesWritten, contents);
    intact = runMap(intactDir, mapFile);
  } finally {
    rmSync(intactDir, { recursive: true, force: true });
  }
  if (intact.error) return { result: 'error', error: `the final map does not run on a working copy: ${intact.error}`, map };
  const intactStatuses = statusesOf(intact);
  const intactReasons = Object.fromEntries((intact.checks ?? []).map((check) => [check.id, check.reasons]));
  return {
    ...scoreCase({ broken: entry.broken, evidenceRuns: evidence.runs, modelStatuses, intactStatuses }),
    evidenceRuns: evidence.runs,
    checkCount: ids.length,
    unrun: ids.filter((id) => !evidence.latest[id]),
    changedAfterFail: evidence.changedAfterFail,
    removedAfterFail: evidence.removedAfterFail,
    sourceChanged: changedSource(workDir),
    createdFiles: untrackedFiles(workDir),
    fixtureFiles,
    checks: (map.features ?? []).map((feature) => ({
      ...feature,
      modelStatus: modelStatuses[feature.id] ?? null,
      reasons: evidence.latest[feature.id]?.reasons ?? [],
      intactStatus: intactStatuses[feature.id] ?? null,
      intactReasons: intactReasons[feature.id] ?? [],
    })),
  };
}

async function runOne(entry, options) {
  const projectDir = path.join(here, 'projects', entry.project);
  const record = { case: entry.case, project: entry.project, broken: entry.broken };
  let workDir;
  try {
    workDir = prepareProject(projectDir, entry.broken);
  } catch (error) {
    return { ...record, result: 'error', error: `could not prepare the case: ${String(error.stderr || error.message).trim().slice(0, 500)}` };
  }
  if (options.keep) record.workDir = workDir;
  try {
    const run = await runClaude({ cwd: workDir, model: options.model, timeoutSeconds: options.timeout });
    record.wallMs = run.wallMs;
    const { events, result: output } = parseStream(run.stdout);
    Object.assign(record, toolActivity(events, output));
    if (!output) {
      return { ...record, result: 'error', error: `claude exited with ${run.signal ?? run.code}: ${(run.stderr || run.stdout).slice(-500)}` };
    }
    Object.assign(record, {
      model: mainModel(output),
      tokens: tokenUsage(output),
      costUsd: output.total_cost_usd,
      apiMs: output.duration_api_ms,
      turns: output.num_turns,
      finalMessage: String(output.result ?? '').slice(0, 4000),
    });
    if (output.is_error) return { ...record, result: 'error', error: String(output.result ?? output.subtype).slice(0, 500) };
    return { ...record, ...scoreWorkDir(entry, projectDir, workDir, record.filesWritten, writtenContents(events)) };
  } finally {
    if (!options.keep) rmSync(workDir, { recursive: true, force: true });
  }
}

// The reference map's checks read files from reference-files/, such as a script that calls a library function;
// they are copied in after the commit, so a prepared copy for Claude never has them.
export function dryRun(projectDir) {
  const reference = path.join(projectDir, 'reference.features.json');
  const referenceFiles = path.join(projectDir, 'reference-files');
  const outcome = {};
  for (const broken of [false, true]) {
    const workDir = prepareProject(projectDir, broken);
    try {
      if (existsSync(referenceFiles)) cpSync(referenceFiles, workDir, { recursive: true });
      outcome[broken ? 'broken' : 'working'] = statusesOf(runMap(workDir, reference));
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
  return outcome;
}

export async function pool(tasks, size) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, worker));
  return results;
}

export function summarize(runs) {
  const scored = runs.filter((run) => run.result !== 'error');
  const broken = scored.filter((run) => run.broken);
  const working = scored.filter((run) => !run.broken);
  const withTokens = runs.filter((run) => run.tokens);
  const totalTokens = withTokens.reduce((sum, run) => sum + run.tokens.total, 0);
  const totalWall = runs.reduce((sum, run) => sum + (run.wallMs ?? 0), 0);
  return {
    runs: runs.length,
    errors: runs.length - scored.length,
    errorCases: runs.filter((run) => run.result === 'error').map((run) => ({ case: run.case, error: run.error })),
    brokenCases: broken.length,
    caught: broken.filter((run) => run.result === 'caught').length,
    missed: broken.filter((run) => run.result === 'missed').length,
    workingCases: working.length,
    casesWithFalseFailure: scored.filter((run) => run.falseFailures.length).length,
    falseFailureChecks: scored.reduce((sum, run) => sum + run.falseFailures.length, 0),
    checks: scored.reduce((sum, run) => sum + run.checkCount, 0),
    notVerifiedChecks: scored.reduce((sum, run) => sum + run.notVerified.length, 0),
    changedAfterFail: scored.reduce((sum, run) => sum + run.changedAfterFail.length, 0),
    removedAfterFail: scored.reduce((sum, run) => sum + run.removedAfterFail.length, 0),
    casesWithSourceChanges: scored.filter((run) => run.sourceChanged.length).length,
    totalTokens,
    averageTokens: withTokens.length ? Math.round(totalTokens / withTokens.length) : 0,
    totalCostUsd: Number(withTokens.reduce((sum, run) => sum + (run.costUsd ?? 0), 0).toFixed(4)),
    totalWallSeconds: Math.round(totalWall / 1000),
    averageWallSeconds: runs.length ? Math.round(totalWall / runs.length / 1000) : 0,
  };
}

function table(runs) {
  const rows = [['case', 'result', 'checks', 'failing', 'false failures', 'not verified', 'tokens', 'cost', 'seconds']];
  for (const run of runs) {
    const failing = run.checks ? run.checks.filter((check) => check.modelStatus === 'fail').length : '-';
    rows.push([run.case, run.result, String(run.checkCount ?? '-'), String(failing), String(run.falseFailures?.length ?? '-'),
      String(run.notVerified?.length ?? '-'), run.tokens ? String(run.tokens.total) : '-',
      run.costUsd === undefined ? '-' : `$${run.costUsd.toFixed(2)}`, run.wallMs ? (run.wallMs / 1000).toFixed(0) : '-']);
  }
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd()).join('\n');
}

function defaultOut(model, label) {
  const now = new Date();
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, '0')).join('-');
  const base = [date, (model ?? 'unknown-model').replace(/[^\w.-]/g, '-'), label].filter(Boolean).join('-');
  let file = path.join(here, 'results', `${base}.json`);
  for (let suffix = 2; existsSync(file); suffix += 1) file = path.join(here, 'results', `${base}-${suffix}.json`);
  return file;
}

async function main() {
  const { values } = parseArgs({
    options: {
      case: { type: 'string', multiple: true },
      model: { type: 'string' },
      concurrency: { type: 'string', short: 'j', default: '1' },
      label: { type: 'string' },
      out: { type: 'string' },
      timeout: { type: 'string', default: '900' },
      'dry-run': { type: 'boolean', default: false },
      keep: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    process.stdout.write(usage);
    return;
  }
  const cases = JSON.parse(readFileSync(path.join(here, 'cases.json'), 'utf8'))
    .filter((entry) => !values.case || values.case.includes(entry.case));
  if (!cases.length) throw new Error('no cases selected');
  if (values['dry-run']) {
    let ok = true;
    for (const project of [...new Set(cases.map((entry) => entry.project))]) {
      const outcome = dryRun(path.join(here, 'projects', project));
      const workingPasses = Object.values(outcome.working).every((status) => status === 'pass');
      const brokenFails = Object.values(outcome.broken).some((status) => status === 'fail');
      ok &&= workingPasses && brokenFails;
      process.stdout.write(`${project}: working ${JSON.stringify(outcome.working)}\n${project}: broken ${JSON.stringify(outcome.broken)}\n`);
    }
    if (!ok) process.exitCode = 1;
    return;
  }
  const options = { model: values.model, timeout: Number(values.timeout), keep: values.keep };
  const started = Date.now();
  const runs = await pool(cases.map((entry) => async () => {
    const result = await runOne(entry, options);
    process.stderr.write(`${entry.case}: ${result.result}${result.error ? ` (${result.error.split('\n')[0]})` : ''}\n`);
    return result;
  }), Number(values.concurrency));
  const model = values.model ?? runs.find((run) => run.model)?.model;
  const results = {
    date: new Date().toISOString(),
    model,
    claudeVersion: execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(),
    skill: { path: path.relative(repoRoot, skillFile), sha256: createHash('sha256').update(readFileSync(skillFile)).digest('hex') },
    prompt: PROMPT,
    label: values.label ?? null,
    runsPerCase: 1,
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
    summary: summarize(runs),
    runs,
  };
  const out = values.out ? path.resolve(values.out) : defaultOut(model, values.label);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
  const { summary } = results;
  process.stdout.write(`${table(runs)}\n\n`);
  process.stdout.write(`broken features caught: ${summary.caught}/${summary.brokenCases} (missed: ${summary.missed})\n`);
  process.stdout.write(`working features reported as failing: ${summary.falseFailureChecks} checks in ${summary.casesWithFalseFailure} cases; not verified: ${summary.notVerifiedChecks}\n`);
  process.stdout.write(`errors (not scored): ${summary.errors}${summary.errorCases.map((entry) => `; ${entry.case}: ${entry.error}`).join('')}\n`);
  process.stdout.write(`checks edited after failing: ${summary.changedAfterFail}, removed after failing: ${summary.removedAfterFail}, cases with source changes: ${summary.casesWithSourceChanges}\n`);
  process.stdout.write(`tokens: ${summary.totalTokens} total, ${summary.averageTokens} per run; cost: $${summary.totalCostUsd}; wall: ${summary.totalWallSeconds} s total\n`);
  process.stdout.write(`results: ${out}\n`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
