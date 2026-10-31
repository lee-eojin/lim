#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaude, tokensAndCost } from '../ledger/run-benchmark.mjs';
import { parseStream, pool, prepareProject, toolActivity } from '../verify/run-benchmark.mjs';
import { parseRunnerArgs } from '../clear-explain/run-explain.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const pluginDir = path.join(repoRoot, 'plugins/gap-map');
const skillFile = path.join(pluginDir, 'skills/gap-map/SKILL.md');
const gapmapScript = path.join(pluginDir, 'skills/gap-map/scripts/gapmap.mjs');
const PROMPT = '/gap-map:gap-map Map this language against its README, guide, and won\'t-fix list: add an obligation for every promise to gap-map.json and run it.';
const OWN = /^(gap-map\.json|gap-map\/)/;

const usage = `Usage: node evals/gap-map/run-benchmark.mjs [options]

Copies each project in evals/gap-map/projects/ to a temporary folder with one commit, where
gap-map.json holds stages and a verifier but no obligations, runs Claude headlessly with the
gap-map skill, then runs the map again with gapmap.mjs and scores every promise in
expected.json by the obligations whose source points at its line: correct, overclaimed
(proven, or not marked as the promise requires), missed (no obligation points at it), or
incomplete. A changed or added file other than gap-map.json and gap-map/ is tampering.

  --case <name>        run only this project (repeatable)
  --model <name>       model for the session (default: Claude Code's default)
  -j, --concurrency <n>  runs at once (default: 1)
  --label <text>       added to the results file name
  --out <file>         results file (default: evals/gap-map/results/<date>-<model>[-<label>].json)
  --timeout <seconds>  per run (default: 900)
  --dry-run            score the honest and the overclaiming reference map of each project,
                       without a model, to show the scorer separates them
  --keep               keep the temporary folders
`;

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

function covers(pointer, promise) {
  const match = /^(.+?):(\d+)(?:-(\d+))?$/.exec(pointer ?? '');
  const [file, line] = promise.split(':');
  if (!match || match[1] !== file) return false;
  return Number(match[2]) <= Number(line) && Number(line) <= Number(match[3] ?? match[2]);
}

const WANTED = {
  closed: (statuses) => (statuses.includes('closed') ? 'correct' : 'incomplete'),
  'not-closed': (statuses) => (statuses.includes('closed') ? 'overclaimed' : 'correct'),
  contradicted: (statuses) => (statuses.includes('closed') ? 'overclaimed' : statuses.includes('contradicted') ? 'correct' : 'incomplete'),
  wontfix: (statuses) => (statuses.includes('closed') ? 'overclaimed' : statuses.includes('wontfix') ? 'correct' : 'incomplete'),
};

export function scoreMap(workDir, expected) {
  rmSync(path.join(workDir, 'gap-map'), { recursive: true, force: true });
  const run = spawnSync(process.execPath, [gapmapScript, 'run', '--map', path.join(workDir, 'gap-map.json')], { cwd: workDir, encoding: 'utf8', timeout: 600000 });
  if (run.status !== 0) return { invalid: (run.stdout || run.stderr).slice(0, 500) };
  const map = readJson(path.join(workDir, 'gap-map.json'));
  const { obligations } = readJson(path.join(workDir, 'gap-map', 'status.json'));
  const promises = Object.fromEntries(Object.entries(expected).map(([id, { lines, want }]) => {
    const matched = map.obligations.filter((obligation) => lines.some((line) => covers(obligation.source, line)));
    if (matched.length === 0) return [id, { verdict: 'missed' }];
    const statuses = matched.map((obligation) => obligations[obligation.id].status);
    return [id, { verdict: WANTED[want](statuses), obligations: matched.map((obligation) => obligation.id), statuses }];
  }));
  const changed = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: workDir, encoding: 'utf8' })
    .split('\n').filter(Boolean).map((line) => line.slice(3)).filter((file) => !OWN.test(file));
  return { promises, tampered: changed };
}

async function runOne(project, options) {
  const projectDir = path.join(here, 'projects', project);
  const record = { case: project };
  const workDir = prepareProject(projectDir, false);
  if (options.keep) record.workDir = workDir;
  try {
    const run = await runClaude({ cwd: workDir, model: options.model, timeoutSeconds: options.timeout, prompt: PROMPT, plugin: pluginDir });
    record.wallMs = run.wallMs;
    const { events, result: output } = parseStream(run.stdout);
    Object.assign(record, toolActivity(events, output));
    if (!output || output.is_error) {
      return { ...record, result: 'error', error: String(output?.result ?? `claude exited with ${run.signal ?? run.code}: ${(run.stderr || run.stdout).slice(-500)}`).slice(0, 500) };
    }
    Object.assign(record, tokensAndCost(output));
    return { ...record, result: 'scored', ...scoreMap(workDir, readJson(path.join(projectDir, 'expected.json'))) };
  } finally {
    if (!options.keep) rmSync(workDir, { recursive: true, force: true });
  }
}

export function referenceMaps(projectDir) {
  const expected = readJson(path.join(projectDir, 'expected.json'));
  const references = readJson(path.join(projectDir, 'references.json'));
  const scores = {};
  for (const [name, obligations] of Object.entries(references)) {
    const workDir = prepareProject(projectDir, false);
    try {
      const map = readJson(path.join(workDir, 'gap-map.json'));
      map.obligations = obligations.map(({ verifiers, ...obligation }) => obligation);
      for (const { verifiers } of obligations) Object.assign(map.verifiers, verifiers ?? {});
      writeFileSync(path.join(workDir, 'gap-map.json'), JSON.stringify(map, null, 2));
      const scored = scoreMap(workDir, expected);
      scores[name] = scored.invalid ? { invalid: scored.invalid } : Object.fromEntries(Object.entries(scored.promises).map(([id, { verdict }]) => [id, verdict]));
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
  return scores;
}

export function summarize(runs) {
  const scored = runs.filter((run) => run.result === 'scored' && run.promises);
  const verdicts = {};
  for (const run of scored) for (const { verdict } of Object.values(run.promises)) verdicts[verdict] = (verdicts[verdict] ?? 0) + 1;
  return {
    runs: runs.length,
    errors: runs.length - scored.length,
    verdicts,
    tamperedRuns: scored.filter((run) => run.tampered.length).length,
    totalTokens: scored.reduce((sum, run) => sum + (run.tokens ?? 0), 0),
    totalCostUsd: Number(scored.reduce((sum, run) => sum + (run.costUsd ?? 0), 0).toFixed(4)),
    totalWallSeconds: Math.round(runs.reduce((sum, run) => sum + (run.wallMs ?? 0), 0) / 1000),
  };
}

function parseOptions(args) {
  return parseRunnerArgs(args, {
    options: {
      case: { type: 'string', multiple: true },
      model: { type: 'string' },
      concurrency: { type: 'string', short: 'j', default: '1' },
      label: { type: 'string' },
      out: { type: 'string' },
      timeout: { type: 'string', default: '900' },
      'dry-run': { type: 'boolean' },
      keep: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    modes: {
      'a model run': ['case', 'model', 'concurrency', 'label', 'out', 'timeout', 'keep'],
      '--dry-run': ['case', 'dry-run'],
    },
    modeOf: (values) => (values['dry-run'] ? '--dry-run' : 'a model run'),
    counts: ['concurrency', 'timeout'],
  });
}

async function main() {
  const { mode, values } = parseOptions(process.argv.slice(2));
  if (mode === 'help') {
    process.stdout.write(usage);
    return;
  }
  const projects = values.case ?? readJson(path.join(here, 'cases.json'));
  if (values['dry-run']) {
    for (const project of projects) process.stdout.write(`${project}: ${JSON.stringify(referenceMaps(path.join(here, 'projects', project)))}\n`);
    return;
  }
  const options = { model: values.model, timeout: Number(values.timeout), keep: values.keep };
  const runs = await pool(projects.map((project) => async () => {
    const result = await runOne(project, options);
    process.stderr.write(`${project}: ${result.result}${result.error ? ` (${result.error.split('\n')[0]})` : ''}\n`);
    return result;
  }), Number(values.concurrency));
  const model = values.model ?? runs.find((run) => run.model)?.model ?? 'default';
  const results = {
    date: new Date().toISOString(),
    model,
    claudeVersion: execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(),
    skill: { path: path.relative(repoRoot, skillFile), sha256: createHash('sha256').update(readFileSync(skillFile)).digest('hex') },
    prompt: PROMPT,
    summary: summarize(runs),
    runs,
  };
  const out = values.out ? path.resolve(values.out)
    : path.join(here, 'results', `${results.date.slice(0, 10)}-${model}${values.label ? `-${values.label}` : ''}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
  for (const run of runs) {
    const line = run.promises ? Object.entries(run.promises).map(([id, { verdict }]) => `${id} ${verdict}`).join(', ') + (run.tampered.length ? `; tampered: ${run.tampered.join(' ')}` : '') : (run.invalid ?? run.error);
    process.stdout.write(`${run.case}: ${line}\n`);
  }
  const { summary } = results;
  process.stdout.write(`verdicts: ${JSON.stringify(summary.verdicts)}; tampered runs: ${summary.tamperedRuns}; tokens: ${summary.totalTokens}; cost: $${summary.totalCostUsd}; wall: ${summary.totalWallSeconds} s\nresults: ${out}\n`);
}

const entry = process.argv[1] && path.resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) await main();
