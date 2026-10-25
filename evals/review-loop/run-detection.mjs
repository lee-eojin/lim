#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const HIGH = ['P1', 'P2'];

const usage = `Usage: node evals/review-loop/run-detection.mjs [options]

Runs the review-loop reviewer once per case on a copy of each case repository and scores
its findings against expected.json.

  --cases <dir>        folder of cases (default: evals/review-loop/detection; the harder set
                       is evals/review-loop/detection-hard)
  --case <name>        run only this case (repeatable)
  --reviewer <file>    reviewer definition (default: plugins/review-loop/agents/reviewer.md)
  --model <name>       model for the reviewer (default: the reviewer's own setting)
  --runs <n>           runs per case (default: 1)
  -j, --concurrency <n>  runs at once (default: 1)
  --label <text>       added to the results file name, for example without-basis
  --out <file>         results file (default: evals/review-loop/results/<date>-<model>[-<label>].json)
  --timeout <seconds>  per run (default: 600)
  --dry-run            prepare every case and check that its diff applies, without a model
  --keep               keep the temporary repositories
  --rescore <file>     score the reviewer output stored in a results file again against the
                       current expected.json files, without a model, and write it back
                       (or to --out), using the cases folder stored in that file unless
                       --cases is given
  --note <text>        with --rescore, what changed, recorded in scoredWith.note
`;

const DEFAULT_RESCORE_NOTE = 'Scored again from the stored reviewer output with --rescore, without new model runs.';

export function parseAgentFile(text) {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) return { prompt: text.trim(), tools: ['Read', 'Grep', 'Glob'] };
  const fields = Object.fromEntries(match[1].split('\n').flatMap((line) => {
    const pair = /^(\w+):\s*(.*)$/.exec(line);
    return pair ? [[pair[1], pair[2].trim()]] : [];
  }));
  return {
    description: fields.description,
    tools: (fields.tools ?? 'Read, Grep, Glob').split(',').map((tool) => tool.trim()).filter(Boolean),
    model: fields.model && fields.model !== 'inherit' ? fields.model : undefined,
    prompt: match[2].trim(),
  };
}

export function parseReviewerOutput(text) {
  const attempts = [text.trim()];
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(text);
  if (fenced) attempts.push(fenced[1]);
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) attempts.push(text.slice(first, last + 1));
  for (const attempt of attempts) {
    try {
      const review = JSON.parse(attempt);
      if (review && Array.isArray(review.findings)) return { review, strict: attempt === attempts[0] };
    } catch {
      continue;
    }
  }
  return { error: 'reviewer output is not JSON with a findings array' };
}

const normalizeFile = (file) => String(file ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
const sameFile = (expected, reported) => {
  const want = normalizeFile(expected);
  const got = normalizeFile(reported);
  return got === want || got.endsWith(`/${want}`);
};
const inRange = (line, [from, to]) => Number(line) >= from && Number(line) <= to;
const cleanQuote = (quote) => String(quote ?? '').replace(/^[+-]/, '').trim();

function locatedAt(location, finding, readLines) {
  if (!sameFile(location.file, finding.file)) return false;
  if (!location.lines || inRange(finding.line, location.lines)) return true;
  const quote = cleanQuote(finding.quote);
  if (!quote) return false;
  const lines = readLines(normalizeFile(location.file)) ?? [];
  const [from, to] = location.lines;
  return lines.slice(from - 1, to).some((line) => line.includes(quote) || (quote.length > 8 && quote.includes(line.trim()) && line.trim().length > 8));
}

// A keyword only counts as a whole word or phrase, so "0" does not match "200 ms". Edges that are
// symbols, as in "|| default", have no word boundary and must match exactly.
function keywordPattern(keyword) {
  const words = keyword.trim();
  const phrase = words.split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  const before = /^\w/.test(words) ? '(?<!\\w)' : '';
  const after = /\w$/.test(words) ? '(?!\\w)' : '';
  return new RegExp(`${before}${phrase}${after}`, 'i');
}

function mentions(entry, finding) {
  if (!entry.mentions?.length) return true;
  const text = [finding.title, finding.scenario, finding.quote, finding.whyNotPrevented].join(' ');
  return entry.mentions.some((keyword) => keywordPattern(keyword).test(text));
}

export const locationsOf = (entry) => entry.locations ?? (entry.file ? [{ file: entry.file, lines: entry.lines }] : []);

function matchesEntry(entry, finding, readLines) {
  const locations = locationsOf(entry);
  if (locations.length && !locations.some((location) => locatedAt(location, finding, readLines))) return false;
  if (entry.category && entry.category !== finding.category) return false;
  return mentions(entry, finding);
}

const severityOf = (finding) => String(finding.severity ?? '').toUpperCase();
const summarizeFinding = (finding) => ({
  severity: severityOf(finding),
  file: finding.file,
  line: finding.line,
  category: finding.category,
  title: finding.title,
});

export function scoreCase(expected, review, readLines = () => null) {
  const findings = review.findings ?? [];
  const used = new Set();
  const expect = (expected.expect ?? []).map((entry) => {
    const hits = findings.filter((finding) => matchesEntry(entry, finding, readLines));
    const found = hits.find((finding) => !entry.severity || entry.severity.includes(severityOf(finding)));
    hits.forEach((finding) => used.add(finding));
    const status = found ? 'found' : hits.length ? 'low-severity' : 'missed';
    return { status, finding: found || hits[0] ? summarizeFinding(found ?? hits[0]) : null };
  });
  const forbidden = findings.filter((finding) => (expected.forbid ?? []).some((entry) =>
    matchesEntry(entry, finding, readLines) && (!entry.severity || entry.severity.includes(severityOf(finding)))));
  forbidden.forEach((finding) => used.add(finding));
  const other = findings.filter((finding) => !used.has(finding));
  const kind = expected.seeded ? 'bug' : expect.length ? 'rubric' : 'clean';
  let result;
  if (kind === 'clean') result = forbidden.length ? 'false-alarm' : 'clean';
  else if (expect.every((entry) => entry.status === 'found')) result = forbidden.length ? 'found+forbidden' : 'found';
  else result = expect.some((entry) => entry.status !== 'missed') ? 'low-severity' : 'missed';
  return {
    kind,
    result,
    expect,
    forbidden: forbidden.map(summarizeFinding),
    other: other.map(summarizeFinding),
    otherHigh: other.filter((finding) => HIGH.includes(severityOf(finding))).length,
    otherLow: other.filter((finding) => !HIGH.includes(severityOf(finding))).length,
  };
}

const DIFF_COMMAND = ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'];

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=dev', '-c', 'user.email=dev@localhost', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function applies(cwd, diffFile, reverse) {
  try {
    git(cwd, 'apply', '--check', ...(reverse ? ['-R'] : []), diffFile);
    return true;
  } catch {
    return false;
  }
}

function projectNameOf(repo) {
  try {
    return JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')).name || 'app';
  } catch {
    return 'app';
  }
}

// The reviewer must not be able to tell it is being measured, so the copy lives under a
// plain project name in the system temp folder and the diff sits where review-loop keeps it.
export function prepareCase(caseDir, expected) {
  const sourceRepo = path.join(caseDir, expected.root ?? 'repo');
  const diffFile = path.join(caseDir, expected.diff ?? 'change.diff');
  const projectName = projectNameOf(sourceRepo).replace(/[^\w.-]/g, '-');
  const workDir = realpathSync(mkdtempSync(path.join(tmpdir(), `${projectName}-`)));
  try {
    cpSync(sourceRepo, workDir, { recursive: true });
    git(workDir, 'init', '-q');
    const alreadyApplied = !applies(workDir, diffFile, false) && applies(workDir, diffFile, true);
    if (alreadyApplied) git(workDir, 'apply', '-R', diffFile);
    git(workDir, 'add', '-A');
    git(workDir, 'commit', '-q', '-m', 'Initial commit');
    git(workDir, 'apply', diffFile);
    git(workDir, 'add', '-A');
    const diffDir = path.join(workDir, '.git', 'lim', 'review-loop');
    mkdirSync(diffDir, { recursive: true });
    const diffPath = path.join(diffDir, 'round-1.diff');
    writeFileSync(diffPath, git(workDir, ...DIFF_COMMAND, '--cached'));
    return { workDir, diffPath };
  } catch (error) {
    rmSync(workDir, { recursive: true, force: true });
    throw error;
  }
}

export function reviewerPrompt(diffPath, intent) {
  return `Round 1. Review the diff at ${diffPath}.\nWhat the author wanted: ${intent}\nReturn JSON only.`;
}

function runClaude({ cwd, prompt, agent, model, timeoutSeconds }) {
  const definition = { description: agent.description ?? 'Code reviewer', prompt: agent.prompt, tools: agent.tools };
  if (agent.model) definition.model = agent.model;
  const args = [
    '-p', prompt,
    '--agents', JSON.stringify({ reviewer: definition }),
    '--agent', 'reviewer',
    '--tools', agent.tools.join(','),
    '--setting-sources', '',
    '--strict-mcp-config',
    '--permission-mode', 'dontAsk',
    '--no-session-persistence',
    '--output-format', 'json',
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

const linesIn = (workDir) => (file) => {
  try {
    return readFileSync(path.join(workDir, file), 'utf8').split('\n');
  } catch {
    return null;
  }
};

export async function runOne({ name, caseDir, expected, agent, options }) {
  let prepared;
  try {
    prepared = prepareCase(caseDir, expected);
  } catch (error) {
    return { case: name, result: 'error', error: `could not prepare the case: ${String(error.stderr || error.message).trim().slice(0, 500)}` };
  }
  const { workDir, diffPath } = prepared;
  const prompt = reviewerPrompt(diffPath, expected.intent);
  const record = { case: name, workDir: options.keep ? workDir : undefined };
  try {
    if (options.dryRun) return { ...record, result: 'prepared', prompt };
    const run = await runClaude({ cwd: workDir, prompt, agent, model: options.model, timeoutSeconds: options.timeout });
    record.wallMs = run.wallMs;
    let output;
    try {
      output = JSON.parse(run.stdout);
    } catch {
      return { ...record, result: 'error', error: `claude exited with ${run.signal ?? run.code}: ${(run.stderr || run.stdout).slice(-500)}` };
    }
    Object.assign(record, {
      model: mainModel(output),
      tokens: tokenUsage(output),
      costUsd: output.total_cost_usd,
      apiMs: output.duration_api_ms,
      turns: output.num_turns,
    });
    if (output.is_error) return { ...record, result: 'error', error: String(output.result ?? output.subtype).slice(0, 500) };
    const parsed = parseReviewerOutput(String(output.result ?? ''));
    if (parsed.error) return { ...record, result: 'error', error: parsed.error, raw: String(output.result ?? '').slice(0, 2000) };
    return { ...record, strictJson: parsed.strict, ...scoreCase(expected, parsed.review, linesIn(workDir)), review: parsed.review };
  } finally {
    if (!options.keep) rmSync(workDir, { recursive: true, force: true });
  }
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
  const bugs = scored.filter((run) => run.kind === 'bug');
  const clean = scored.filter((run) => run.kind === 'clean');
  const withTokens = runs.filter((run) => run.tokens);
  const totalTokens = withTokens.reduce((sum, run) => sum + run.tokens.total, 0);
  const totalWall = runs.reduce((sum, run) => sum + (run.wallMs ?? 0), 0);
  return {
    runs: runs.length,
    errors: runs.length - scored.length,
    bugRuns: bugs.length,
    found: bugs.filter((run) => run.result.startsWith('found')).length,
    lowSeverity: bugs.filter((run) => run.result === 'low-severity').length,
    missed: bugs.filter((run) => run.result === 'missed').length,
    cleanRuns: clean.length,
    cleanWithFalseHigh: clean.filter((run) => run.result === 'false-alarm').length,
    falseHighFindings: clean.reduce((sum, run) => sum + run.forbidden.length, 0),
    otherHighOnBugRuns: bugs.reduce((sum, run) => sum + run.otherHigh, 0),
    otherLowFindings: scored.reduce((sum, run) => sum + run.otherLow, 0),
    totalTokens,
    averageTokens: withTokens.length ? Math.round(totalTokens / withTokens.length) : 0,
    totalCostUsd: Number(withTokens.reduce((sum, run) => sum + (run.costUsd ?? 0), 0).toFixed(4)),
    totalWallSeconds: Math.round(totalWall / 1000),
    averageWallSeconds: runs.length ? Math.round(totalWall / runs.length / 1000) : 0,
  };
}

export function rescoreRuns(runs, casesDir) {
  const workDirs = new Map();
  try {
    return runs.map((run) => {
      if (!run.review) return run;
      const caseDir = path.join(casesDir, run.case);
      const expected = JSON.parse(readFileSync(path.join(caseDir, 'expected.json'), 'utf8'));
      if (!workDirs.has(run.case)) workDirs.set(run.case, prepareCase(caseDir, expected).workDir);
      return { ...run, ...scoreCase(expected, run.review, linesIn(workDirs.get(run.case))) };
    });
  } finally {
    for (const workDir of workDirs.values()) rmSync(workDir, { recursive: true, force: true });
  }
}

export function casesDirFor(option, results) {
  if (option) return path.resolve(option);
  return results?.cases ? path.resolve(repoRoot, results.cases) : path.join(here, 'detection');
}

export function rescoreResults(results, casesDir, note) {
  const { runs, scoredWith, ...rest } = results;
  const rescored = rescoreRuns(runs, casesDir);
  return {
    ...rest,
    summary: summarize(rescored),
    scoredWith: {
      date: new Date().toISOString(),
      note,
      originalSummary: scoredWith?.originalSummary ?? results.summary,
    },
    runs: rescored,
  };
}

function table(runs) {
  const rows = [['case', 'kind', 'result', 'severity', 'other P1/P2', 'other P3-P5', 'tokens', 'seconds']];
  for (const run of runs) {
    const severity = run.expect?.map((entry) => entry.finding?.severity ?? '-').join(',') || run.forbidden?.map((finding) => finding.severity).join(',') || '-';
    rows.push([run.case, run.kind ?? '-', run.result, severity, String(run.otherHigh ?? '-'), String(run.otherLow ?? '-'),
      run.tokens ? String(run.tokens.total) : '-', run.wallMs ? (run.wallMs / 1000).toFixed(0) : '-']);
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

function report(runs, summary, out) {
  process.stdout.write(`${table(runs)}\n\n`);
  process.stdout.write(`seeded bugs found at P1/P2: ${summary.found}/${summary.bugRuns} (found below P2: ${summary.lowSeverity}, missed: ${summary.missed})\n`);
  process.stdout.write(`clean changes with a false P1/P2: ${summary.cleanWithFalseHigh}/${summary.cleanRuns} (${summary.falseHighFindings} findings)\n`);
  process.stdout.write(`other P1/P2 on seeded runs: ${summary.otherHighOnBugRuns}, other P3-P5: ${summary.otherLowFindings}, errors: ${summary.errors}\n`);
  process.stdout.write(`tokens: ${summary.totalTokens} total, ${summary.averageTokens} per run; cost: $${summary.totalCostUsd}; wall: ${summary.totalWallSeconds} s total, ${summary.averageWallSeconds} s per run\n`);
  process.stdout.write(`results: ${out}\n`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      cases: { type: 'string' },
      case: { type: 'string', multiple: true },
      reviewer: { type: 'string', default: path.join(repoRoot, 'plugins/review-loop/agents/reviewer.md') },
      model: { type: 'string' },
      runs: { type: 'string', default: '1' },
      concurrency: { type: 'string', short: 'j', default: '1' },
      label: { type: 'string' },
      out: { type: 'string' },
      timeout: { type: 'string', default: '600' },
      'dry-run': { type: 'boolean', default: false },
      keep: { type: 'boolean', default: false },
      rescore: { type: 'string' },
      note: { type: 'string', default: DEFAULT_RESCORE_NOTE },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    process.stdout.write(usage);
    return;
  }
  if (values.rescore) {
    const source = path.resolve(values.rescore);
    const stored = JSON.parse(readFileSync(source, 'utf8'));
    const results = rescoreResults(stored, casesDirFor(values.cases, stored), values.note);
    const out = values.out ? path.resolve(values.out) : source;
    writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
    report(results.runs, results.summary, out);
    return;
  }
  const options = {
    model: values.model,
    timeout: Number(values.timeout),
    dryRun: values['dry-run'],
    keep: values.keep,
  };
  const reviewerText = readFileSync(values.reviewer, 'utf8');
  const agent = parseAgentFile(reviewerText);
  const casesDir = casesDirFor(values.cases);
  const names = readdirSync(casesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(casesDir, entry.name, 'expected.json')))
    .map((entry) => entry.name)
    .filter((name) => !values.case || values.case.includes(name))
    .sort();
  if (!names.length) throw new Error(`no cases found in ${casesDir}`);
  const tasks = [];
  for (const name of names) {
    const caseDir = path.join(casesDir, name);
    const expected = JSON.parse(readFileSync(path.join(caseDir, 'expected.json'), 'utf8'));
    for (let run = 0; run < Number(values.runs); run += 1) {
      tasks.push(async () => {
        const result = await runOne({ name, caseDir, expected, agent, options });
        process.stderr.write(`${name}: ${result.result}${result.error ? ` (${result.error.split('\n')[0]})` : ''}\n`);
        return result;
      });
    }
  }
  const started = Date.now();
  const runs = await pool(tasks, Number(values.concurrency));
  if (options.dryRun) {
    const prepared = runs.find((run) => run.prompt);
    if (prepared) process.stdout.write(`${prepared.prompt}\n`);
    if (runs.some((run) => run.result === 'error')) process.exitCode = 1;
    return;
  }
  const model = values.model ?? runs.find((run) => run.model)?.model;
  const results = {
    date: new Date().toISOString(),
    model,
    claudeVersion: execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(),
    reviewer: {
      path: path.relative(repoRoot, path.resolve(values.reviewer)),
      sha256: createHash('sha256').update(reviewerText).digest('hex'),
    },
    label: values.label ?? null,
    cases: path.relative(repoRoot, casesDir),
    runsPerCase: Number(values.runs),
    concurrency: Number(values.concurrency),
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
    summary: summarize(runs),
    runs,
  };
  const out = values.out ? path.resolve(values.out) : defaultOut(model, values.label);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
  report(runs, results.summary, out);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
