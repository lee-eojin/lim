#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { checkText } from '../../plugins/clear-explain/skills/clear-explain/scripts/check-clarity.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const pluginDir = path.join(repoRoot, 'plugins/clear-explain');
const ARMS = ['with', 'without'];

const usage = `Usage: node evals/clear-explain/run-explain.mjs [options]

Asks Claude each question twice, once with the clear-explain plugin loaded and once without,
with no user settings. Scores both answers with check-clarity.mjs, then asks a judge on a
different model, which sees the two answers in random order, to pick the clearer one.

  --questions <file>      questions file (default: evals/clear-explain/questions.json)
  --question <id>         run only this question (repeatable)
  --model <name>          model that answers (default: opus)
  --judge-model <name>    model that judges (default: sonnet)
  -j, --concurrency <n>   model runs at once (default: 4)
  --label <text>          added to the results file name
  --out <file>            results file (default: evals/clear-explain/results/<date>-<model>[-<label>].json)
  --timeout <seconds>     per model run (default: 300)
  --rescore <file>        score the answers stored in a results file again with the current
                          check-clarity.mjs, without a model, and write it back (or to --out)
  --rejudge <file>        judge the answers stored in a results file a second time, with each
                          pair in the opposite order from the first judge run, and store that
                          pass next to the first one (or write to --out); no new answers
  --triggers              send each question and each request in --trigger-prompts once, with the
                          plugin loaded and the tools of a normal session, and record whether the
                          skill started; no judge
  --trigger-prompts <file>  requests that should not start the skill
                          (default: evals/clear-explain/triggers.json)
  --held-out <file>       like --triggers, but send only the requests in this file, each marked
                          with "explain": true or false, instead of the questions and
                          --trigger-prompts (evals/clear-explain/triggers-held-out.json)
  --max-turns <n>         turns per trigger run (default: 6)
`;

// Each runner lists the flags each of its modes reads. A flag the chosen mode would ignore, or a
// count that is not a whole number above 0, stops the run before it starts.
export function parseRunnerArgs(args, { options, modes, modeOf, counts, allowPositionals = false }) {
  const { values, positionals, tokens } = parseArgs({ args, options, allowPositionals, tokens: true });
  if (values.help) return { mode: 'help', values, positionals };
  const mode = modeOf(values);
  const ignored = [...new Set(tokens.filter((token) => token.kind === 'option' && !modes[mode].includes(token.name)).map((token) => token.rawName))];
  if (ignored.length) throw new Error(`${ignored.join(', ')} ${ignored.length === 1 ? 'is' : 'are'} not used by ${mode}`);
  for (const name of counts) {
    if (!/^[1-9]\d*$/.test(values[name])) throw new Error(`--${name} must be a whole number above 0, not ${values[name]}`);
  }
  return { mode, values, positionals };
}

const MODES = {
  '--rescore': ['rescore', 'out'],
  '--rejudge': ['rejudge', 'judge-model', 'concurrency', 'out', 'timeout'],
  '--held-out': ['held-out', 'triggers', 'model', 'concurrency', 'label', 'out', 'timeout', 'max-turns'],
  '--triggers': ['triggers', 'questions', 'question', 'trigger-prompts', 'model', 'concurrency', 'label', 'out', 'timeout', 'max-turns'],
  'a judged run': ['questions', 'question', 'model', 'judge-model', 'concurrency', 'label', 'out', 'timeout'],
};

export function parseOptions(args) {
  return parseRunnerArgs(args, {
    options: {
      questions: { type: 'string', default: path.join(here, 'questions.json') },
      question: { type: 'string', multiple: true },
      model: { type: 'string', default: 'opus' },
      'judge-model': { type: 'string', default: 'sonnet' },
      concurrency: { type: 'string', short: 'j', default: '4' },
      label: { type: 'string' },
      out: { type: 'string' },
      timeout: { type: 'string', default: '300' },
      rescore: { type: 'string' },
      rejudge: { type: 'string' },
      triggers: { type: 'boolean', default: false },
      'trigger-prompts': { type: 'string', default: path.join(here, 'triggers.json') },
      'max-turns': { type: 'string', default: '6' },
      'held-out': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    modes: MODES,
    modeOf: (values) => ['--rescore', '--rejudge', '--held-out', '--triggers'].find((mode) => values[mode.slice(2)]) ?? 'a judged run',
    counts: ['concurrency', 'timeout', 'max-turns'],
  });
}

export function selectQuestions(questions, ids) {
  const unknown = (ids ?? []).filter((id) => !questions.some((question) => question.id === id));
  if (unknown.length) throw new Error(`unknown question: ${unknown.join(', ')}`);
  return questions.filter((question) => !ids || ids.includes(question.id));
}

const PREAMBLE = /^(?:great question|good question|sure\b|certainly\b|let me\b|let's\b|i'll\b|here(?:'s| is) (?:a|an|the) (?:explanation|overview|breakdown)|좋은 질문|설명해 ?드릴게요|설명해 ?드리겠습니다|알겠습니다)/i;
const BLOCK_START = /^(?:#|\||```|~~~|>|[-*+]\s|\d+[.)]\s)/;

// A structural check only: the answer opens with a prose paragraph rather than a heading,
// a list, a table, code, or a preamble. The judge decides whether that paragraph answers.
export function opensWithAnswer(text) {
  const first = text.split('\n').map((line) => line.trim()).find(Boolean);
  if (!first || BLOCK_START.test(first)) return false;
  const withoutLabel = first.replace(/^\*\*[^*]{1,40}\*\*:?\s*/, '');
  return withoutLabel.length > 0 && !PREAMBLE.test(withoutLabel);
}

export function scoreAnswer(text) {
  const { summary } = checkText(text);
  return {
    characters: summary.characters,
    issues: summary.fix + summary.review,
    issuesPer1000: summary.issuesPer1000,
    longSentences: summary.longSentences,
    mustFix: summary.fix,
    opensWithAnswer: opensWithAnswer(text),
  };
}

export function redact(text) {
  return text.replace(/clear-explain/gi, 'a guide');
}

export function judgePrompt(question, first, second) {
  return `You are judging two answers to a question that a developer asked a coding assistant. You do not know how either answer was produced.

<question>
${question}
</question>

<answer id="A">
${redact(first)}
</answer>

<answer id="B">
${redact(second)}
</answer>

Which answer would the person who asked understand correctly after one read? Consider, in this order: whether it is correct, whether it answers the question directly, and whether a reader would take each sentence the way the writer meant it. Length is not a merit in itself. Pick "tie" only if you cannot choose.

Also say, for each answer, whether its first two sentences answer the question, and whether it contains a factual error.

Return JSON only, with the reason in English:
{"clearer": "A" | "B" | "tie", "reason": "<one or two sentences>", "answerFirst": {"A": true | false, "B": true | false}, "factualError": {"A": true | false, "B": true | false}}`;
}

export function parseJudgeOutput(text) {
  const attempts = [text.trim()];
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(text);
  if (fenced) attempts.push(fenced[1]);
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) attempts.push(text.slice(first, last + 1));
  for (const attempt of attempts) {
    try {
      const verdict = JSON.parse(attempt);
      if (['A', 'B', 'tie'].includes(verdict?.clearer)) return { verdict };
    } catch {
      continue;
    }
  }
  return { error: 'judge output is not JSON with clearer set to A, B, or tie' };
}

// order lists the arms in the order the judge saw them, so A is order[0].
export function unblind(verdict, order) {
  const armOf = (letter) => order[letter === 'A' ? 0 : 1];
  const perArm = (field) => Object.fromEntries(['A', 'B'].map((letter) => [armOf(letter), verdict[field]?.[letter] ?? null]));
  return {
    winner: verdict.clearer === 'tie' ? 'tie' : armOf(verdict.clearer),
    reason: verdict.reason ?? '',
    answerFirst: perArm('answerFirst'),
    factualError: perArm('factualError'),
  };
}

export function parseStream(stdout) {
  const events = stdout.split('\n').flatMap((line) => {
    try {
      return line.trim() ? [JSON.parse(line)] : [];
    } catch {
      return [];
    }
  });
  const skills = events
    .filter((event) => event.type === 'assistant')
    .flatMap((event) => event.message?.content ?? [])
    .filter((block) => block.type === 'tool_use' && block.name === 'Skill')
    .map((block) => block.input?.skill ?? block.input?.command ?? '');
  const reads = events
    .filter((event) => event.type === 'assistant')
    .flatMap((event) => event.message?.content ?? [])
    .filter((block) => block.type === 'tool_use' && block.name === 'Read')
    .map((block) => path.basename(String(block.input?.file_path ?? '')));
  return { result: events.findLast((event) => event.type === 'result'), skills, reads };
}

function tokenUsage(output) {
  const usage = output?.usage ?? {};
  const input = usage.input_tokens ?? 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  return { input, cacheCreation, cacheRead, output: outputTokens, total: input + cacheCreation + cacheRead + outputTokens };
}

function mainModel(output) {
  const entries = Object.entries(output?.modelUsage ?? {});
  entries.sort((a, b) => (b[1].outputTokens ?? 0) - (a[1].outputTokens ?? 0));
  return entries[0]?.[0];
}

export function runClaude(args, timeoutSeconds, { workDir } = {}) {
  const cwd = workDir ?? realpathSync(mkdtempSync(path.join(tmpdir(), 'notes-')));
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
      if (!workDir) rmSync(cwd, { recursive: true, force: true });
      resolve({ code, signal, stdout, stderr, wallMs: Date.now() - started });
    });
  });
}

export const startedSkill = (entry) => Boolean(entry?.skills?.some((skill) => skill.includes('clear-explain')));

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// The body hash leaves out the frontmatter, so a change to the description alone keeps it.
export function skillVersion(text) {
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text);
  return {
    path: 'plugins/clear-explain/skills/clear-explain/SKILL.md',
    sha256: sha256(text),
    bodySha256: sha256(frontmatter ? text.slice(frontmatter[0].length) : text),
    description: /^description:\s*(.*)$/m.exec(frontmatter?.[1] ?? '')?.[1] ?? null,
  };
}

const ISOLATION = ['--setting-sources', '', '--strict-mcp-config', '--no-session-persistence', '--permission-mode', 'dontAsk'];

export function answerArgs(question, arm, model) {
  const args = ['-p', question, ...ISOLATION, '--tools', 'Skill,Read', '--output-format', 'stream-json', '--verbose', '--model', model];
  return arm === 'with' ? [...args, '--plugin-dir', pluginDir] : args;
}

async function answer(question, arm, options) {
  const run = await runClaude(answerArgs(question.question, arm, options.model), options.timeout);
  const { result, skills, reads } = parseStream(run.stdout);
  const record = { arm, wallMs: run.wallMs, skills, reads };
  if (!result) return { ...record, error: `claude exited with ${run.signal ?? run.code}: ${(run.stderr || run.stdout).slice(-500)}` };
  Object.assign(record, { model: mainModel(result), tokens: tokenUsage(result), costUsd: result.total_cost_usd, turns: result.num_turns });
  if (result.is_error) return { ...record, error: String(result.result ?? result.subtype).slice(0, 500) };
  const text = String(result.result ?? '');
  return { ...record, answer: text, score: scoreAnswer(text) };
}

export const swapOrder = (order) => [order[1], order[0]];

async function judge(question, answers, options, order = randomInt(2) === 0 ? [...ARMS] : swapOrder(ARMS)) {
  const prompt = judgePrompt(question.question, answers[order[0]].answer, answers[order[1]].answer);
  const run = await runClaude(['-p', prompt, ...ISOLATION, '--tools', '', '--output-format', 'json', '--model', options.judgeModel], options.timeout);
  const record = { order, wallMs: run.wallMs };
  let output;
  try {
    output = JSON.parse(run.stdout);
  } catch {
    return { ...record, error: `claude exited with ${run.signal ?? run.code}: ${(run.stderr || run.stdout).slice(-500)}` };
  }
  Object.assign(record, { model: mainModel(output), tokens: tokenUsage(output), costUsd: output.total_cost_usd });
  const parsed = parseJudgeOutput(String(output.result ?? ''));
  if (parsed.error) return { ...record, error: parsed.error, raw: String(output.result ?? '').slice(0, 1000) };
  return { ...record, raw: parsed.verdict, ...unblind(parsed.verdict, order) };
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

const mean = (values) => (values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : null);
const sum = (values) => values.reduce((total, value) => total + (value ?? 0), 0);

function armSummary(items, arm) {
  const answers = items.map((item) => item.answers[arm]).filter((entry) => entry && !entry.error);
  const judged = items.map((item) => item.judge).filter((entry) => entry && !entry.error);
  return {
    answered: answers.length,
    skillInvoked: answers.filter(startedSkill).length,
    issuesPer1000: mean(answers.map((entry) => entry.score.issuesPer1000)),
    longSentences: sum(answers.map((entry) => entry.score.longSentences)),
    mustFix: sum(answers.map((entry) => entry.score.mustFix)),
    characters: mean(answers.map((entry) => entry.score.characters)),
    opensWithAnswer: answers.filter((entry) => entry.score.opensWithAnswer).length,
    judgeAnswerFirst: judged.filter((entry) => entry.answerFirst[arm] === true).length,
    judgeFactualError: judged.filter((entry) => entry.factualError[arm] === true).length,
    wins: judged.filter((entry) => entry.winner === arm).length,
  };
}

export function summarize(items) {
  const runs = items.flatMap((item) => [...ARMS.map((arm) => item.answers[arm]), item.judge]).filter(Boolean);
  const byLanguage = (lang) => items.filter((item) => item.lang === lang);
  const section = (subset) => ({
    questions: subset.length,
    ties: subset.filter((item) => item.judge?.winner === 'tie').length,
    with: armSummary(subset, 'with'),
    without: armSummary(subset, 'without'),
  });
  const judged = items.map((item) => item.judge).filter((entry) => entry && !entry.error);
  return {
    ...section(items),
    position: {
      withShownSecond: judged.filter((entry) => entry.order[1] === 'with').length,
      judgePickedSecond: judged.filter((entry) => entry.winner === entry.order[1]).length,
      withWinsShownSecond: judged.filter((entry) => entry.order[1] === 'with' && entry.winner === 'with').length,
      withWinsShownFirst: judged.filter((entry) => entry.order[0] === 'with' && entry.winner === 'with').length,
    },
    en: section(byLanguage('en')),
    ko: section(byLanguage('ko')),
    errors: runs.filter((run) => run.error).length,
    costUsd: {
      with: Number(sum(items.map((item) => item.answers.with?.costUsd)).toFixed(4)),
      without: Number(sum(items.map((item) => item.answers.without?.costUsd)).toFixed(4)),
      judge: Number(sum(items.map((item) => item.judge?.costUsd)).toFixed(4)),
      total: Number(sum(runs.map((run) => run.costUsd)).toFixed(4)),
    },
    tokens: {
      with: sum(items.map((item) => item.answers.with?.tokens?.total)),
      without: sum(items.map((item) => item.answers.without?.tokens?.total)),
      judge: sum(items.map((item) => item.judge?.tokens?.total)),
    },
    wallSeconds: Math.round(sum(runs.map((run) => run.wallMs)) / 1000),
  };
}

// No --tools: the run gets the same tools as a normal session, so the skill competes with
// editing, searching, and the shell, as it does when a person uses it.
export function triggerArgs(prompt, model, maxTurns) {
  return ['-p', prompt, ...ISOLATION, '--max-turns', String(maxTurns), '--output-format', 'stream-json', '--verbose',
    '--model', model, '--plugin-dir', pluginDir];
}

async function triggerRun(entry, options) {
  const run = await runClaude(triggerArgs(entry.prompt, options.model, options.maxTurns), options.timeout);
  const { result, skills } = parseStream(run.stdout);
  const record = { id: entry.id, lang: entry.lang, kind: entry.kind ?? 'explain', explain: entry.explain, prompt: entry.prompt, skills, started: startedSkill({ skills }), wallMs: run.wallMs };
  if (!result) return { ...record, error: `claude exited with ${run.signal ?? run.code}: ${(run.stderr || run.stdout).slice(-500)}` };
  return { ...record, stop: result.subtype, turns: result.num_turns, model: mainModel(result), costUsd: result.total_cost_usd };
}

// The tuning set is the questions plus the other requests. A held-out set is one file that
// marks each request itself, so it can be run without the requests the description was written against.
export function triggerRequests(questions, others) {
  return [
    ...questions.map((question) => ({ id: question.id, lang: question.lang, prompt: question.question, explain: true })),
    ...others.map((request) => ({ ...request, explain: false })),
  ];
}

export const heldOutRequests = (entries) => entries.map((entry) => ({ ...entry, explain: entry.explain === true }));

export function summarizeTriggers(items) {
  const counted = items.filter((item) => !item.error);
  const group = (explain) => {
    const subset = counted.filter((item) => item.explain === explain);
    return { prompts: subset.length, started: subset.filter((item) => item.started).length };
  };
  const explain = group(true);
  const other = group(false);
  const rate = ({ prompts, started }) => (prompts ? Number((started / prompts).toFixed(2)) : null);
  return {
    explain,
    other,
    trueTriggerRate: rate(explain),
    falseTriggerRate: rate(other),
    errors: items.length - counted.length,
    costUsd: Number(sum(items.map((item) => item.costUsd)).toFixed(4)),
    wallSeconds: Math.round(sum(items.map((item) => item.wallMs)) / 1000),
  };
}

function triggerReport(results, out) {
  const rows = [['request', 'explain', 'skill started']];
  for (const item of results.items) rows.push([item.id, item.explain ? 'yes' : 'no', item.error ? 'error' : item.started ? 'yes' : 'no']);
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  process.stdout.write(`${rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd()).join('\n')}\n\n`);
  const { summary } = results;
  process.stdout.write(`started for ${summary.explain.started} of ${summary.explain.prompts} questions to explain and ` +
    `${summary.other.started} of ${summary.other.prompts} other requests; cost $${summary.costUsd}; errors: ${summary.errors}\n`);
  process.stdout.write(`results: ${out}\n`);
}

export function rescore(results) {
  const items = results.items.map((item) => ({
    ...item,
    answers: Object.fromEntries(ARMS.map((arm) => {
      const entry = item.answers[arm];
      return [arm, entry?.answer === undefined ? entry : { ...entry, score: scoreAnswer(entry.answer) }];
    })),
  }));
  return { ...results, rescoredAt: new Date().toISOString(), items, summary: summarize(items) };
}

// Compares the first judge pass with the second, which saw every pair in the opposite order.
// A question where the two passes disagree was decided by the order, not by the answers.
export function compareJudgePasses(items) {
  const pairs = items.filter((item) => item.judge?.winner && item.judgeSwapped?.winner);
  const runs = items.map((item) => item.judgeSwapped).filter(Boolean);
  const both = (winner) => pairs.filter((item) => item.judge.winner === winner && item.judgeSwapped.winner === winner).length;
  return {
    questions: pairs.length,
    withWinsFirstPass: pairs.filter((item) => item.judge.winner === 'with').length,
    withWinsSecondPass: pairs.filter((item) => item.judgeSwapped.winner === 'with').length,
    bothWith: both('with'),
    bothWithout: both('without'),
    bothTie: both('tie'),
    split: pairs.filter((item) => item.judge.winner !== item.judgeSwapped.winner).length,
    secondPassPickedSecond: pairs.filter((item) => item.judgeSwapped.winner === item.judgeSwapped.order[1]).length,
    errors: runs.filter((run) => run.error).length,
    costUsd: Number(sum(runs.map((run) => run.costUsd)).toFixed(4)),
    tokens: sum(runs.map((run) => run.tokens?.total)),
    wallSeconds: Math.round(sum(runs.map((run) => run.wallMs)) / 1000),
  };
}

export async function rejudge(results, options, judgeRun = judge) {
  const started = Date.now();
  const items = results.items.map((item) => ({ ...item }));
  const tasks = items.map((item) => async () => {
    if (!item.judge?.order || ARMS.some((arm) => item.answers[arm]?.answer === undefined)) return;
    if (item.judgeSwapped && !item.judgeSwapped.error) return;
    item.judgeSwapped = await judgeRun(item, item.answers, options, swapOrder(item.judge.order));
    options.log?.(`${item.id} second judge: ${item.judgeSwapped.error ? `error (${item.judgeSwapped.error})` : item.judgeSwapped.winner}`);
  });
  await pool(tasks, options.concurrency ?? 4);
  return {
    ...results,
    swappedJudge: {
      date: new Date().toISOString(),
      judgeModel: options.judgeModel,
      claudeVersion: options.claudeVersion ?? null,
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      summary: compareJudgePasses(items),
    },
    items,
  };
}

function rejudgeReport(results, out) {
  const rows = [['question', 'first order', 'first pick', 'second order', 'second pick']];
  const shown = (order) => (order ? order.join(' then ') : '-');
  for (const item of results.items) {
    rows.push([item.id, shown(item.judge?.order), item.judge?.winner ?? 'error', shown(item.judgeSwapped?.order), item.judgeSwapped?.winner ?? 'error']);
  }
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  process.stdout.write(`${rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd()).join('\n')}\n\n`);
  const { summary } = results.swappedJudge;
  process.stdout.write(`with-skill answer picked: first pass ${summary.withWinsFirstPass}, second pass ${summary.withWinsSecondPass} of ${summary.questions}\n`);
  process.stdout.write(`both passes picked with ${summary.bothWith}, without ${summary.bothWithout}, tie ${summary.bothTie}; the passes disagreed ${summary.split}\n`);
  process.stdout.write(`second pass: picked the second answer ${summary.secondPassPickedSecond} times, ${summary.tokens} tokens, $${summary.costUsd}, ` +
    `${summary.wallSeconds} s of judge time, ${results.swappedJudge.elapsedSeconds} s elapsed; errors: ${summary.errors}\n`);
  process.stdout.write(`results: ${out}\n`);
}

function table(items) {
  const rows = [['question', 'winner', 'issues/1k with', 'without', 'long with', 'without', 'skill used']];
  for (const item of items) {
    const score = (arm, field) => String(item.answers[arm]?.score?.[field] ?? '-');
    const used = startedSkill(item.answers.with) ? 'yes' : 'no';
    rows.push([item.id, item.judge?.winner ?? 'error', score('with', 'issuesPer1000'), score('without', 'issuesPer1000'),
      score('with', 'longSentences'), score('without', 'longSentences'), used]);
  }
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd()).join('\n');
}

function report(results, out) {
  const { summary } = results;
  process.stdout.write(`${table(results.items)}\n\n`);
  process.stdout.write(`judge picked: with ${summary.with.wins}, without ${summary.without.wins}, tie ${summary.ties} of ${summary.questions}\n`);
  process.stdout.write(`order: the with-skill answer was shown second ${summary.position.withShownSecond} times and won ${summary.position.withWinsShownSecond} of them; ` +
    `shown first it won ${summary.position.withWinsShownFirst}; the judge picked the second answer ${summary.position.judgePickedSecond} times\n`);
  process.stdout.write(`skill invoked: ${summary.with.skillInvoked} of ${summary.with.answered}\n`);
  for (const arm of ARMS) {
    const entry = summary[arm];
    process.stdout.write(`${arm}: ${entry.issuesPer1000} issues per 1,000 characters, ${entry.longSentences} long sentences, ` +
      `opens with the answer ${entry.opensWithAnswer}/${entry.answered}, judge says answer first ${entry.judgeAnswerFirst}, factual errors ${entry.judgeFactualError}\n`);
  }
  process.stdout.write(`cost: $${summary.costUsd.total} (with $${summary.costUsd.with}, without $${summary.costUsd.without}, judge $${summary.costUsd.judge}); errors: ${summary.errors}\n`);
  process.stdout.write(`results: ${out}\n`);
}

// Answers are stored verbatim, but the repository keeps these two characters out of every file,
// so they are written as JSON escapes, which read back as the same text.
export function serialize(results) {
  return `${JSON.stringify(results, null, 2)}\n`.replace(/[\u2014\u00b7]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function defaultOut(model, label) {
  const now = new Date();
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, '0')).join('-');
  const base = [date, model.replace(/[^\w.-]/g, '-'), label].filter(Boolean).join('-');
  let file = path.join(here, 'results', `${base}.json`);
  for (let suffix = 2; existsSync(file); suffix += 1) file = path.join(here, 'results', `${base}-${suffix}.json`);
  return file;
}

async function main() {
  const { values } = parseOptions(process.argv.slice(2));
  if (values.help) {
    process.stdout.write(usage);
    return;
  }
  if (values.rescore) {
    const source = path.resolve(values.rescore);
    const results = rescore(JSON.parse(readFileSync(source, 'utf8')));
    const out = values.out ? path.resolve(values.out) : source;
    writeFileSync(out, serialize(results));
    report(results, out);
    return;
  }
  if (values.rejudge) {
    const source = path.resolve(values.rejudge);
    const stored = JSON.parse(readFileSync(source, 'utf8'));
    const results = await rejudge(stored, {
      judgeModel: stored.judgeModel ?? values['judge-model'],
      timeout: Number(values.timeout),
      concurrency: Number(values.concurrency),
      claudeVersion: execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(),
      log: (line) => process.stderr.write(`${line}\n`),
    });
    const out = values.out ? path.resolve(values.out) : source;
    writeFileSync(out, serialize(results));
    rejudgeReport(results, out);
    return;
  }
  const options = { model: values.model, judgeModel: values['judge-model'], timeout: Number(values.timeout) };
  const questions = selectQuestions(JSON.parse(readFileSync(values.questions, 'utf8')), values.question);
  if (!questions.length) throw new Error('no questions to run');
  const skill = skillVersion(readFileSync(path.join(pluginDir, 'skills/clear-explain/SKILL.md'), 'utf8'));
  if (values.triggers || values['held-out']) {
    const heldOut = values['held-out'];
    const requestsFile = path.relative(repoRoot, path.resolve(heldOut ?? values['trigger-prompts']));
    const requests = heldOut
      ? heldOutRequests(JSON.parse(readFileSync(heldOut, 'utf8')))
      : triggerRequests(questions, JSON.parse(readFileSync(values['trigger-prompts'], 'utf8')));
    const started = Date.now();
    const triggerOptions = { ...options, maxTurns: Number(values['max-turns']) };
    const items = await pool(requests.map((request) => async () => {
      const result = await triggerRun(request, triggerOptions);
      process.stderr.write(`${request.id}: ${result.error ? `error (${result.error.split('\n')[0]})` : result.started ? 'skill started' : 'no skill'}\n`);
      return result;
    }), Number(values.concurrency));
    const results = {
      date: new Date().toISOString(),
      model: values.model,
      claudeVersion: execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(),
      skill,
      set: heldOut ? 'held-out' : 'tuning',
      requestsFile,
      maxTurns: triggerOptions.maxTurns,
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      summary: summarizeTriggers(items),
      items,
    };
    const out = values.out ? path.resolve(values.out) : defaultOut(values.model, values.label ?? (heldOut ? 'held-out-triggers' : 'triggers'));
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, serialize(results));
    triggerReport(results, out);
    return;
  }
  const started = Date.now();
  const answerTasks = questions.flatMap((question) => ARMS.map((arm) => async () => {
    const result = await answer(question, arm, options);
    process.stderr.write(`${question.id} ${arm}: ${result.error ? `error (${result.error.split('\n')[0]})` : 'answered'}\n`);
    return { id: question.id, arm, result };
  }));
  const answered = await pool(answerTasks, Number(values.concurrency));
  const items = questions.map((question) => ({
    ...question,
    answers: Object.fromEntries(answered.filter((entry) => entry.id === question.id).map((entry) => [entry.arm, entry.result])),
  }));
  const judgeTasks = items.map((item) => async () => {
    if (ARMS.some((arm) => item.answers[arm]?.answer === undefined)) return;
    item.judge = await judge(item, item.answers, options);
    process.stderr.write(`${item.id} judge: ${item.judge.error ? `error (${item.judge.error})` : item.judge.winner}\n`);
  });
  await pool(judgeTasks, Number(values.concurrency));
  const results = {
    date: new Date().toISOString(),
    model: values.model,
    judgeModel: values['judge-model'],
    claudeVersion: execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(),
    skill,
    label: values.label ?? null,
    runsPerArm: 1,
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
    summary: summarize(items),
    items,
  };
  const out = values.out ? path.resolve(values.out) : defaultOut(values.model, values.label);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, serialize(results));
  report(results, out);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
