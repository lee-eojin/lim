#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRunnerArgs, parseStream, pool, runClaude } from '../clear-explain/run-explain.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

const usage = `Usage: node evals/review-loop/run-triggers.mjs [options]

Sends each request in a set once to claude -p in a small git repository with one uncommitted
change, and reports whether Claude started the review-loop skill when it should and did not
when it should not. Uses your Claude account.

  --set <file>          requests (default: evals/review-loop/triggers/tuning.json; the requests
                        written after the description are in triggers/held-out.json)
  --plugin-dir <dir>    plugin to load (default: plugins/review-loop)
  --model <name>        model (default: opus)
  -j, --concurrency <n> runs at once (default: 4)
  --timeout <seconds>   per run (default: 180)
  --label <text>        added to the results file name
`;

const ISOLATION = ['--setting-sources', '', '--strict-mcp-config', '--no-session-persistence', '--permission-mode', 'dontAsk'];

export const startedReviewLoop = (skills) => skills.some((skill) => String(skill).includes('review-loop'));

// No --tools: the run gets the same tools as a normal session, so the skill competes with
// running git directly, as it does when a person asks.
export function triggerArgs(prompt, model, pluginDir) {
  return ['-p', prompt, ...ISOLATION, '--max-turns', '2', '--output-format', 'stream-json', '--verbose', '--model', model, '--plugin-dir', pluginDir];
}

export function triggerRecord(request, run) {
  const { result, skills } = parseStream(run.stdout);
  const record = { id: request.id, want: request.want, prompt: request.prompt, skills, started: startedReviewLoop(skills), wallMs: run.wallMs };
  if (!result) return { ...record, error: `claude exited with ${run.signal ?? run.code}: ${(run.stderr || run.stdout).slice(-500)}` };
  return { ...record, stop: result.subtype, costUsd: result.total_cost_usd };
}

export function summarizeTriggers(records) {
  const answered = records.filter((record) => !record.error);
  const shouldStart = answered.filter((record) => record.want);
  const shouldNot = answered.filter((record) => !record.want);
  return {
    errors: records.length - answered.length,
    startedWhenWanted: shouldStart.filter((record) => record.started).length,
    wanted: shouldStart.length,
    startedWhenNotWanted: shouldNot.filter((record) => record.started).length,
    notWanted: shouldNot.length,
  };
}

function practiceRepository() {
  const repo = realpathSync(mkdtempSync(path.join(tmpdir(), 'shop-')));
  const git = (...args) => execFileSync('git', args, { cwd: repo });
  git('init', '-q');
  writeFileSync(path.join(repo, 'README.md'), '# Shop\n\nA small shop service.\n');
  writeFileSync(path.join(repo, 'src.js'), 'export const total = (items) => items.reduce((sum, item) => sum + item.price, 0);\n');
  git('add', '-A');
  git('-c', 'user.name=shop', '-c', 'user.email=shop@example.test', 'commit', '-qm', 'init');
  writeFileSync(path.join(repo, 'src.js'), 'export const total = (items) => items.reduce((sum, item) => sum + item.price * item.qty, 0);\n');
  return repo;
}

export function parseOptions(args) {
  return parseRunnerArgs(args, {
    options: {
      set: { type: 'string', default: path.join(here, 'triggers/tuning.json') },
      'plugin-dir': { type: 'string', default: path.join(repoRoot, 'plugins/review-loop') },
      model: { type: 'string', default: 'opus' },
      concurrency: { type: 'string', short: 'j', default: '4' },
      timeout: { type: 'string', default: '180' },
      label: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    modes: { 'a trigger run': ['set', 'plugin-dir', 'model', 'concurrency', 'timeout', 'label'] },
    modeOf: () => 'a trigger run',
    counts: ['concurrency', 'timeout'],
  });
}

async function main() {
  const { mode, values } = parseOptions(process.argv.slice(2));
  if (mode === 'help') {
    process.stdout.write(usage);
    return;
  }
  const requests = JSON.parse(readFileSync(values.set, 'utf8'));
  const pluginDir = path.resolve(values['plugin-dir']);
  const records = await pool(requests.map((request) => async () => {
    const repo = practiceRepository();
    try {
      return triggerRecord(request, await runClaude(triggerArgs(request.prompt, values.model, pluginDir), Number(values.timeout), { workDir: repo }));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }), Number(values.concurrency));
  for (const { id, want, started, error } of records) {
    process.stdout.write(error ? `ERROR ${id}: ${error.split('\n')[0]}\n` : `${started === want ? 'ok   ' : 'WRONG'} ${id}: should start ${want}, started ${started}\n`);
  }
  const summary = summarizeTriggers(records);
  process.stdout.write(`started for ${summary.startedWhenWanted} of ${summary.wanted} requests it should start for, `
    + `and ${summary.startedWhenNotWanted} of ${summary.notWanted} it should not; errors: ${summary.errors}\n`);
  const date = new Date().toISOString().slice(0, 10);
  const name = [date, 'triggers', path.basename(values.set, '.json'), values.model, values.label].filter(Boolean).join('-');
  const out = path.join(here, 'triggers/results', `${name}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ date: new Date().toISOString(), model: values.model, set: path.relative(repoRoot, path.resolve(values.set)), summary, records }, null, 2)}\n`);
  process.stdout.write(`results: ${out}\n`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
