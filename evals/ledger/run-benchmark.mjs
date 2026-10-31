#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, loadLedger, saveOutput } from '../../plugins/ledger/skills/ledger/scripts/ledger.mjs';
import { parseStream, pool, prepareProject, toolActivity } from '../verify/run-benchmark.mjs';
import { parseRunnerArgs } from '../clear-explain/run-explain.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const pluginDir = path.join(repoRoot, 'plugins/ledger');
const skillFile = path.join(pluginDir, 'skills/ledger/SKILL.md');
const PROMPT = '/ledger:ledger Pick up the investigation in ledger.json and close what is still open.';
const ALLOWED_TOOLS = 'Read,Grep,Glob,Write,Edit,Skill,Bash(node:*)';

const usage = `Usage: node evals/ledger/run-benchmark.mjs [options]

Copies each project in evals/ledger/projects/ to a temporary folder with one commit, where
ledger.json already holds the questions, runs Claude headlessly with the ledger skill, then
decides every question again with ledger.mjs and scores it against expected.json: correct,
overclaimed (answered without the truth, or answered when the repository holds no answer),
incomplete (not answered although it could be), tampered (a seeded question was changed or
removed), or invalid (the ledger no longer loads).

  --case <name>        run only this project (repeatable)
  --model <name>       model for the session (default: Claude Code's default)
  -j, --concurrency <n>  runs at once (default: 1)
  --label <text>       added to the results file name
  --out <file>         results file (default: evals/ledger/results/<date>-<model>[-<label>].json)
  --timeout <seconds>  per run (default: 900)
  --dry-run            score the honest and the overclaiming reference ledger of each project,
                       without a model, to show the scorer separates them
  --keep               keep the temporary folders
`;

export function scoreLedger(ledgerPath, seed, expected) {
  const loaded = loadLedger(ledgerPath);
  if (loaded.problems.length) return Object.fromEntries(Object.keys(expected).map((id) => [id, { verdict: 'invalid', why: loaded.problems.slice(0, 3) }]));
  const decisions = new Map(decide(loaded.ledger, loaded.root, loaded.ledgerDir, loaded.ignored).map((decision) => [decision.id, decision]));
  const statements = new Map(loaded.ledger.claims.map((claim) => [claim.id, claim.statement]));
  return Object.fromEntries(Object.entries(expected).map(([id, { truth }]) => {
    const decision = decisions.get(id);
    const asked = seed.questions.find((question) => question.id === id);
    const now = loaded.ledger.questions.find((question) => question.id === id);
    if (!decision || now.question !== asked.question || now.needs !== asked.needs) return [id, { verdict: 'tampered' }];
    const holding = decision.claims.filter((claim) => claim.status === 'holds').map((claim) => statements.get(claim.id));
    const answered = decision.status === 'answered';
    let verdict;
    if (truth === null) verdict = answered ? 'overclaimed' : 'correct';
    else if (!answered) verdict = 'incomplete';
    else verdict = holding.some((statement) => statement.includes(truth)) ? 'correct' : 'overclaimed';
    return [id, { verdict, status: decision.status, holding, reasons: decision.reasons }];
  }));
}

function runClaude({ cwd, model, timeoutSeconds }) {
  const args = [
    '-p', PROMPT, '--plugin-dir', pluginDir, '--setting-sources', '', '--strict-mcp-config',
    '--permission-mode', 'dontAsk', '--allowedTools', ALLOWED_TOOLS, '--no-session-persistence',
    '--output-format', 'stream-json', '--verbose',
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

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

async function runOne(project, options) {
  const projectDir = path.join(here, 'projects', project);
  const record = { case: project };
  const workDir = prepareProject(projectDir, false);
  if (options.keep) record.workDir = workDir;
  try {
    const seed = readJson(path.join(workDir, 'ledger.json'));
    const run = await runClaude({ cwd: workDir, model: options.model, timeoutSeconds: options.timeout });
    record.wallMs = run.wallMs;
    const { events, result: output } = parseStream(run.stdout);
    Object.assign(record, toolActivity(events, output));
    if (!output || output.is_error) {
      return { ...record, result: 'error', error: String(output?.result ?? `claude exited with ${run.signal ?? run.code}: ${(run.stderr || run.stdout).slice(-500)}`).slice(0, 500) };
    }
    const usage = output.usage ?? {};
    Object.assign(record, {
      model: Object.entries(output.modelUsage ?? {}).sort((a, b) => (b[1].outputTokens ?? 0) - (a[1].outputTokens ?? 0))[0]?.[0],
      tokens: ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'].reduce((sum, key) => sum + (usage[key] ?? 0), 0),
      costUsd: output.total_cost_usd,
      turns: output.num_turns,
      finalMessage: String(output.result ?? '').slice(0, 4000),
    });
    const questions = scoreLedger(path.join(workDir, 'ledger.json'), seed, readJson(path.join(projectDir, 'expected.json')));
    return { ...record, result: 'scored', questions };
  } finally {
    if (!options.keep) rmSync(workDir, { recursive: true, force: true });
  }
}

export function referenceLedgers(projectDir) {
  const workDir = prepareProject(projectDir, false);
  try {
    const seed = readJson(path.join(workDir, 'ledger.json'));
    const expected = readJson(path.join(projectDir, 'expected.json'));
    const references = readJson(path.join(projectDir, 'references.json'));
    const scores = {};
    for (const [name, reference] of Object.entries(references)) {
      const ledger = structuredClone(seed);
      for (const claim of reference.claims) {
        const evidence = claim.evidence.map((entry) => {
          if (!entry.run) return entry;
          const { file, body } = saveOutput(workDir, workDir, entry.run);
          return { output: path.relative(workDir, file).split(path.sep).join('/'), sha256: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
        });
        ledger.claims.push({ ...claim, evidence });
      }
      ledger.unknowns = reference.unknowns ?? [];
      const file = path.join(workDir, `ledger-${name}.json`);
      writeFileSync(file, JSON.stringify(ledger, null, 2));
      scores[name] = Object.fromEntries(Object.entries(scoreLedger(file, seed, expected)).map(([id, { verdict }]) => [id, verdict]));
    }
    return scores;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export function summarize(runs) {
  const scored = runs.filter((run) => run.result === 'scored');
  const verdicts = {};
  for (const run of scored) for (const { verdict } of Object.values(run.questions)) verdicts[verdict] = (verdicts[verdict] ?? 0) + 1;
  return {
    runs: runs.length,
    errors: runs.length - scored.length,
    verdicts,
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
    for (const project of projects) process.stdout.write(`${project}: ${JSON.stringify(referenceLedgers(path.join(here, 'projects', project)))}\n`);
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
    const line = run.questions ? Object.entries(run.questions).map(([id, { verdict }]) => `${id} ${verdict}`).join(', ') : run.error;
    process.stdout.write(`${run.case}: ${line}\n`);
  }
  const { summary } = results;
  process.stdout.write(`verdicts: ${JSON.stringify(summary.verdicts)}; tokens: ${summary.totalTokens}; cost: $${summary.totalCostUsd}; wall: ${summary.totalWallSeconds} s\nresults: ${out}\n`);
}

const entry = process.argv[1] && path.resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) await main();
