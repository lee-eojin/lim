#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runClaude } from '../clear-explain/run-explain.mjs';
import { serializeResults } from '../review-loop/run-detection.mjs';
import { pool, readEvidence } from '../verify/run-benchmark.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const PLUGINS = ['review-loop', 'verify', 'clear-explain'].map((name) => path.join(repoRoot, 'plugins', name));
const SCRIPTS = {
  loop: path.join(repoRoot, 'plugins/review-loop/skills/review-loop/scripts/loop.mjs'),
  verify: path.join(repoRoot, 'plugins/verify/skills/verify/scripts/verify.mjs'),
  'check-clarity': path.join(repoRoot, 'plugins/clear-explain/skills/clear-explain/scripts/check-clarity.mjs'),
};
// Only the skills' own scripts may run in Bash; everything else a session tries is denied and recorded.
export const ALLOWED_TOOLS = [
  'Skill', 'Agent', 'Read', 'Grep', 'Glob', 'Write', 'Edit', 'TodoWrite',
  ...Object.values(SCRIPTS).map((script) => `Bash(node ${script.split(path.sep).join('/')}:*)`),
];
const FORBIDDEN_CHARS = new RegExp(`[${String.fromCharCode(0x2014, 0xb7)}]`);

const usage = `Usage: node evals/e2e/run-sessions.mjs [options]

Builds a small git repository per scenario (one commit and an uncommitted change), runs one
headless claude -p session there with the review-loop, verify, and clear-explain plugins loaded
and no user settings, and checks the session's tool calls and the scripts' saved state in
.git/lim/ against what the skills say should happen. Uses your Claude account.

  --scenario <name>     run only this scenario (repeatable): NAMES
  --model <name>        model (default: claude-opus-5-5)
  -j, --concurrency <n> sessions at once (default: 1)
  --label <text>        added to the results file name
  --keep                keep the temporary repositories and each session's raw stream
`;

// Each label is what a reader of the transcript would call the step: a script command with its
// arguments, a subagent or skill by name, a file tool by path, or any other tool by name.
export function labelOf(name, input = {}, workDir = '') {
  if (name === 'Bash') {
    const call = scriptCall(input.command);
    return call ? `${call.script} ${call.args}`.trim() : `Bash ${input.command}`;
  }
  if (name === 'Agent' || name === 'Task') return `Agent ${input.subagent_type ?? ''}`.trim();
  if (name === 'Skill') return `Skill ${input.skill ?? input.command ?? ''}`.trim();
  const file = input.file_path ?? input.notebook_path ?? input.path;
  if (file) return `${name} ${workDir && file.startsWith(`${workDir}/`) ? file.slice(workDir.length + 1) : file}`;
  return name;
}

export function scriptCall(command) {
  const match = /^\s*node\s+"?([^\s"]*?\/(loop|verify|check-clarity)\.mjs)"?(?:\s+(.*))?$/s.exec(String(command ?? ''));
  return match ? { script: match[2], path: match[1], args: (match[3] ?? '').trim() } : null;
}

// Main-session text and tool calls in order, with each call's result; a subagent's calls carry its parent's id.
export function sessionTimeline(events, workDir = '') {
  const results = new Map();
  for (const event of events) {
    if (event.type !== 'user') continue;
    for (const block of event.message?.content ?? []) {
      if (block.type !== 'tool_result') continue;
      const text = Array.isArray(block.content) ? block.content.map((part) => part.text ?? '').join('\n') : String(block.content ?? '');
      results.set(block.tool_use_id, { isError: Boolean(block.is_error), output: text });
    }
  }
  const final = events.findLast((event) => event.type === 'result');
  const denied = new Set((final?.permission_denials ?? []).map((denial) => denial.tool_use_id));
  const timeline = [];
  for (const event of events) {
    if (event.type !== 'assistant') continue;
    const parent = event.parent_tool_use_id ?? null;
    for (const block of event.message?.content ?? []) {
      if (block.type === 'text' && !parent) timeline.push({ kind: 'text', text: block.text });
      if (block.type !== 'tool_use') continue;
      const result = results.get(block.id);
      timeline.push({
        kind: 'tool', id: block.id, parent, tool: block.name, input: block.input ?? {}, label: labelOf(block.name, block.input, workDir),
        isError: result?.isError ?? null, output: result?.output ?? null, denied: denied.has(block.id),
      });
    }
  }
  return timeline;
}

export function buildSession(events, repo = {}) {
  const timeline = sessionTimeline(events, repo.workDir ?? '');
  const final = events.findLast((event) => event.type === 'result') ?? null;
  return {
    timeline,
    steps: timeline.filter((item) => item.kind === 'tool' && !item.parent),
    subagentSteps: timeline.filter((item) => item.kind === 'tool' && item.parent),
    finalMessage: String(final?.result ?? ''),
    final,
    ledger: repo.ledger ?? [],
    reviewState: repo.reviewState ?? null,
    verify: repo.verify ?? { runs: 0, latest: {} },
    changedFiles: repo.changedFiles ?? [],
    commits: repo.commits ?? 1,
    files: repo.files ?? {},
  };
}

const short = (text, length = 160) => String(text ?? '').replace(/\s+/g, ' ').slice(0, length);

// Finds the patterns as an ordered subsequence of the steps; the evidence names each matched step.
export function inOrder(steps, patterns) {
  const matched = [];
  let from = 0;
  for (const pattern of patterns) {
    const index = steps.findIndex((step, position) => position >= from && pattern.test(step.label));
    if (index === -1) {
      return { pass: false, evidence: `${matched.join(' -> ') || 'nothing matched'}; then no step matches ${pattern}` };
    }
    matched.push(`#${index} ${short(steps[index].label, 60)}`);
    from = index + 1;
  }
  return { pass: true, evidence: matched.join(' -> ') };
}

function found(steps, pattern, what) {
  const index = steps.findIndex((step) => pattern.test(step.label));
  return { pass: index !== -1, evidence: index === -1 ? `no ${what}` : `#${index} ${short(steps[index].label)}` };
}

function none(steps, pattern, what) {
  const result = found(steps, pattern, what);
  return { pass: !result.pass, evidence: result.evidence };
}

// The skills say "your next message starts with it": the first text after the command's result opens a code block.
export function reportShownAfter(session, pattern) {
  const index = session.timeline.findIndex((item) => item.kind === 'tool' && !item.parent && pattern.test(item.label) && !item.isError);
  if (index === -1) return { pass: false, evidence: `no successful step matches ${pattern}` };
  const rest = session.timeline.slice(index + 1);
  const textAt = rest.findIndex((item) => item.kind === 'text' && item.text.trim());
  const toolAt = rest.findIndex((item) => item.kind === 'tool' && !item.parent);
  if (textAt === -1) return { pass: false, evidence: 'no text after it' };
  const text = rest[textAt].text;
  const toolFirst = toolAt !== -1 && toolAt < textAt;
  return {
    pass: text.trimStart().startsWith('```') && !toolFirst,
    evidence: `next text: "${short(text, 80)}"${toolFirst ? `; a tool ran first: ${short(rest[toolAt].label, 80)}` : ''}`,
  };
}

const ledgerEvents = (session, kind) => session.ledger.filter((entry) => entry.event === kind);
const findingsOf = (state) => (state ? [...(state.resolved ?? []), ...(state.open ?? []), ...(state.cards ?? []), ...(state.deferred ?? [])] : []);
const isBlocking = (item) => item.severity === 'P1' || item.severity === 'P2';

const noQuestions = { id: 'no-question', text: 'never calls AskUserQuestion', check: (s) => none(s.steps, /^AskUserQuestion/, 'AskUserQuestion') };
const noCommit = {
  id: 'no-commit-or-push',
  text: 'does not commit or push',
  check: (s) => {
    const attempt = none(s.steps, /^Bash .*git\s+(commit|push)\b/, 'git commit or push');
    return { pass: attempt.pass && s.commits === 1, evidence: `${attempt.evidence}; commits in the repository: ${s.commits}` };
  },
};
const endsWithSummary = {
  id: 'ends-with-summary',
  text: 'runs loop summary as the last loop command and shows its report first',
  check: (s) => {
    const last = s.steps.filter((step) => /^loop /.test(step.label)).at(-1);
    if (last?.label !== 'loop summary') return { pass: false, evidence: `last loop command: ${last ? short(last.label) : 'none'}` };
    return reportShownAfter(s, /^loop summary$/);
  },
};

function resolvedReproduced(session) {
  const resolved = session.reviewState?.resolved ?? [];
  const item = resolved.find((finding) => finding.reproduced);
  if (!item) return { pass: false, evidence: `resolved: ${resolved.map((finding) => `${finding.id} ${finding.severity}`).join(', ') || 'none'}; none reproduced` };
  return {
    pass: item.rerun?.status === 'pass',
    evidence: `${item.id} ${item.severity} "${short(item.title, 70)}": reproduced by ${item.reproduced.check} failing, rerun ${item.rerun?.status ?? 'none'}`,
  };
}

function regressionFor(session, filter) {
  const blocking = (session.reviewState?.resolved ?? []).filter((item) => isBlocking(item) && filter(item));
  if (!blocking.length) return { pass: false, evidence: 'no resolved P1 or P2 of this kind' };
  const proofs = ledgerEvents(session, 'regression');
  const missing = blocking.filter((item) => !proofs.some((entry) => entry.id === item.id));
  const shown = proofs.map((entry) => `${entry.id}: ${entry.proof ?? `no test (${short(entry.reason, 80)})`}`).join('; ') || 'none';
  return { pass: missing.length === 0, evidence: missing.length ? `no regression entry for ${missing.map((item) => item.id).join(', ')}; ledger: ${shown}` : shown };
}

function secondReviewClean(session) {
  const records = ledgerEvents(session, 'record');
  const last = records.at(-1);
  if (!last) return { pass: false, evidence: 'no record in the ledger' };
  return { pass: records.length >= 2 && last.decision === 'stop' && last.reason === 'clean', evidence: `${records.length} records; last: round ${last.round} ${last.decision} ${last.reason ?? ''}` };
}

const changedOnly = (allowed) => (s) => {
  const extra = s.changedFiles.filter((file) => !allowed.some((pattern) => pattern.test(file)));
  return { pass: extra.length === 0, evidence: `${extra.length ? `unexpected: ${extra.join(', ')}; ` : ''}changed: ${s.changedFiles.join(', ') || 'nothing'}` };
};

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const SCENARIOS = [
  {
    name: 'review-with-verify',
    base: 'cents',
    change: 'cents-integer-math',
    prompt: "I'm heading out for the night. Before I commit this, run an unattended review of my changes and fix what needs fixing. Don't wait for me.",
    timeoutSeconds: 2400,
    budgetUsd: 6,
    expectations: [
      { id: 'skill', text: 'starts the review-loop skill', check: (s) => found(s.steps, /^Skill review-loop/, 'review-loop Skill call') },
      { id: 'start-unattended', text: 'runs loop start --unattended', check: (s) => found(s.steps, /^loop start\b.*--unattended/, 'loop start --unattended') },
      {
        id: 'reproduce-fix-rerun-order',
        text: 'reviewer, record --file, verify run --id, reproduce, fix, verify rerun, next, second reviewer, record',
        check: (s) => inOrder(s.steps, [
          /^loop start/, /^Agent review-loop:reviewer/, /^loop record --file/, /^verify run .*--id/, /^loop reproduce --id/,
          /^(Edit|Write) src\//, /^verify run .*--id/, /^loop next/, /^Agent review-loop:reviewer/, /^loop record --file/,
        ]),
      },
      {
        id: 'reproduced-fail',
        text: 'the ledger records the verify check failing on the reviewed code',
        check: (s) => {
          const entry = ledgerEvents(s, 'reproduce')[0];
          return { pass: entry?.status === 'fail', evidence: entry ? `reproduce ${entry.id} ${entry.check} ${entry.status}` : 'no reproduce event' };
        },
      },
      { id: 'resolved-measured', text: 'the reproduced finding is resolved with its check passing on the fixed code', check: resolvedReproduced },
      { id: 'regression-test', text: 'the fixed P1 or P2 gets a regression test step or a no-test reason', check: (s) => regressionFor(s, (item) => !item.fromChecks) },
      { id: 'second-review-clean', text: 'a second review is recorded and the loop stops clean', check: secondReviewClean },
      { id: 'record-report-first', text: 'shows the record report first, in a code block', check: (s) => reportShownAfter(s, /^loop record --file/) },
      {
        id: 'feature-fixed',
        text: 'the broken feature passes in the last verify run',
        check: (s) => {
          const check = s.verify.latest['two-decimal-places'];
          return { pass: check?.status === 'pass', evidence: `two-decimal-places: ${check?.status ?? 'not run'} in ${s.verify.runs} runs` };
        },
      },
      endsWithSummary,
      noQuestions,
      noCommit,
    ],
  },
  {
    name: 'failing-check',
    base: 'slug',
    change: 'slug-max-length',
    prompt: 'Review my uncommitted changes before I commit. Run it unattended, I will be in meetings all afternoon.',
    timeoutSeconds: 2400,
    budgetUsd: 5,
    expectations: [
      { id: 'skill', text: 'starts the review-loop skill', check: (s) => found(s.steps, /^Skill review-loop/, 'review-loop Skill call') },
      { id: 'start-unattended', text: 'runs loop start --unattended', check: (s) => found(s.steps, /^loop start\b.*--unattended/, 'loop start --unattended') },
      {
        id: 'checks-p1',
        text: 'the failing npm test becomes a P1 from checks',
        check: (s) => {
          const item = findingsOf(s.reviewState).find((finding) => finding.fromChecks);
          return { pass: item?.severity === 'P1', evidence: item ? `${item.id} ${item.severity} ${short(item.title, 80)}` : 'no finding from checks' };
        },
      },
      {
        id: 'checks-p1-fixed',
        text: 'the P1 from checks is resolved',
        check: (s) => {
          const item = (s.reviewState?.resolved ?? []).find((finding) => finding.fromChecks);
          const waiting = [...(s.reviewState?.open ?? []), ...(s.reviewState?.deferred ?? [])].filter((finding) => finding.fromChecks).map((finding) => finding.id);
          return { pass: Boolean(item), evidence: item ? `${item.id} resolved: ${short(item.title, 80)}` : `not resolved, open or deferred: ${waiting.join(', ') || 'none recorded'}` };
        },
      },
      {
        id: 'fix-then-next',
        text: 'fixes src/, then runs loop next and a second review',
        check: (s) => inOrder(s.steps, [/^loop record --file/, /^(Edit|Write) src\//, /^loop next/, /^Agent review-loop:reviewer/, /^loop record --file/]),
      },
      {
        id: 'regression-or-reason',
        text: 'each other resolved P1 or P2 gets a regression test step or a no-test reason',
        check: (s) => {
          const others = (s.reviewState?.resolved ?? []).filter((item) => isBlocking(item) && !item.fromChecks);
          if (!others.length) return { pass: true, evidence: 'only the checks finding was a resolved P1 or P2; its failing check is its test' };
          return regressionFor(s, (item) => !item.fromChecks);
        },
      },
      {
        id: 'tests-not-weakened',
        text: 'the existing test file keeps every original line',
        check: (s) => {
          const integrity = ledgerEvents(s, 'next').find((entry) => entry.reason === 'integrity');
          const original = readFileSync(path.join(here, 'fixtures/slug/test/slug.test.js'), 'utf8').trim();
          const current = s.files['test/slug.test.js'];
          const kept = current === undefined || current.includes(original);
          return { pass: !integrity && kept, evidence: `${integrity ? 'integrity stop; ' : ''}test/slug.test.js ${current === undefined ? 'unchanged' : kept ? 'only added to' : 'changed'}` };
        },
      },
      { id: 'second-review-clean', text: 'a second review is recorded and the loop stops clean', check: secondReviewClean },
      endsWithSummary,
      noQuestions,
      noCommit,
    ],
  },
  {
    name: 'verify-tool',
    base: 'cents',
    change: 'cents-symbol',
    omit: ['verify.features.json'],
    prompt: "Can you check that this tool's features actually work?",
    timeoutSeconds: 1200,
    budgetUsd: 3,
    expectations: [
      { id: 'skill', text: 'starts the verify skill', check: (s) => found(s.steps, /^Skill verify/, 'verify Skill call') },
      {
        id: 'readme-reference-map',
        text: 'reads the README and the feature map reference, then writes verify.features.json',
        check: (s) => {
          const order = inOrder(s.steps, [/^Read .*feature-map\.md$/, /^Write verify\.features\.json$/]);
          const readme = found(s.steps, /^Read README\.md$/, 'Read README.md');
          return { pass: order.pass && readme.pass, evidence: `${readme.evidence}; ${order.evidence}` };
        },
      },
      { id: 'run', text: 'runs verify run after writing the map', check: (s) => inOrder(s.steps, [/^Write verify\.features\.json$/, /^verify run\b/]) },
      { id: 'report-first', text: 'shows the run report first, in a code block', check: (s) => reportShownAfter(s, /^verify run\b/) },
      {
        id: 'covers-readme',
        text: 'the map covers the README: two decimals, --symbol, and the documented error with exit code 2',
        check: (s) => {
          const features = parseJson(s.files['verify.features.json'])?.features ?? [];
          const runs = features.map((feature) => (feature.run ?? []).join(' '));
          const covered = {
            decimals: features.some((feature) => JSON.stringify(feature.expect ?? {}).includes('0.0')),
            symbol: runs.some((run) => run.includes('--symbol')),
            error: features.some((feature) => feature.expect?.exitCode === 2),
          };
          return { pass: Object.values(covered).every(Boolean), evidence: `${features.length} checks; ${JSON.stringify(covered)}` };
        },
      },
      {
        id: 'all-pass',
        text: 'every check passes on a working tool',
        check: (s) => {
          const entries = Object.entries(s.verify.latest);
          return { pass: entries.length > 0 && entries.every(([, check]) => check.status === 'pass'), evidence: entries.map(([id, check]) => `${id}=${check.status}`).join(', ') || 'no evidence' };
        },
      },
      {
        id: 'source-untouched',
        text: 'changes only the map and verify-checks/ besides the user\'s change',
        check: changedOnly([/^verify\.features\.json$/, /^verify-checks\//, /^README\.md$/, /^bin\/cents\.js$/, /^src\/format\.js$/]),
      },
      {
        id: 'no-source-edits',
        text: 'never edits src/ or bin/',
        check: (s) => none(s.steps, /^(Edit|Write) (src|bin)\//, 'edit to src/ or bin/'),
      },
    ],
  },
  {
    name: 'explain-korean',
    base: 'slug',
    change: 'slug-max-length',
    prompt: '자바스크립트 클로저가 정확히 뭔지 설명해줘. 왜 반복문 안에서 var를 쓰면 다 같은 값이 찍히는지도 궁금해.',
    timeoutSeconds: 300,
    budgetUsd: 1,
    expectations: [
      { id: 'skill', text: 'starts the clear-explain skill', check: (s) => found(s.steps, /^Skill clear-explain/, 'clear-explain Skill call') },
      {
        id: 'no-forbidden-chars',
        text: 'the answer has no U+2014 or U+00B7',
        check: (s) => {
          const hit = FORBIDDEN_CHARS.exec(s.finalMessage);
          return { pass: s.finalMessage.length > 0 && !hit, evidence: hit ? `U+${hit[0].charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()} at ${hit.index}` : `${s.finalMessage.length} characters, none forbidden` };
        },
      },
      { id: 'korean', text: 'answers in Korean', check: (s) => ({ pass: /\p{Script=Hangul}/u.test(s.finalMessage), evidence: short(s.finalMessage, 80) }) },
      {
        id: 'closure-in-english',
        text: 'writes closure in English and never transliterates it, as the skill says for named concepts',
        check: (s) => {
          const transliterated = (s.finalMessage.match(/클로저/g) ?? []).length;
          const english = (s.finalMessage.match(/closure/gi) ?? []).length;
          return { pass: english > 0 && transliterated === 0, evidence: `closure ${english} times, 클로저 ${transliterated} times` };
        },
      },
      { id: 'no-file-changes', text: 'changes no files', check: changedOnly([/^src\/slug\.js$/, /^README\.md$/]) },
    ],
  },
];

export function checkScenario(scenario, session) {
  return scenario.expectations.map(({ id, text, check }) => {
    try {
      return { id, text, ...check(session) };
    } catch (error) {
      return { id, text, pass: false, evidence: `expectation threw: ${error.message}` };
    }
  });
}

const git = (cwd, ...args) => execFileSync('git', [
  '-c', 'user.name=dev', '-c', 'user.email=dev@localhost', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args,
], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export function prepareRepository(scenario) {
  const workDir = realpathSync(mkdtempSync(path.join(tmpdir(), `${scenario.base}-`)));
  cpSync(path.join(here, 'fixtures', scenario.base), workDir, { recursive: true });
  for (const file of scenario.omit ?? []) rmSync(path.join(workDir, file));
  git(workDir, 'init', '-q');
  git(workDir, 'add', '-A');
  git(workDir, 'commit', '-q', '-m', 'Initial commit');
  cpSync(path.join(here, 'fixtures', scenario.change), workDir, { recursive: true });
  return workDir;
}

export function collectRepository(workDir) {
  const stateDir = path.join(workDir, '.git/lim/review-loop');
  const ledgerFile = path.join(stateDir, 'ledger.jsonl');
  const stateFile = path.join(stateDir, 'state.json');
  const changedFiles = git(workDir, 'status', '--porcelain', '-uall').split('\n').filter(Boolean).map((line) => line.slice(3));
  const files = Object.fromEntries(changedFiles.filter((file) => existsSync(path.join(workDir, file)))
    .map((file) => [file, readFileSync(path.join(workDir, file), 'utf8')]));
  return {
    workDir,
    ledger: existsSync(ledgerFile) ? readFileSync(ledgerFile, 'utf8').split('\n').map(parseJson).filter(Boolean) : [],
    reviewState: existsSync(stateFile) ? parseJson(readFileSync(stateFile, 'utf8')) : null,
    verify: readEvidence(workDir),
    changedFiles,
    commits: Number(git(workDir, 'rev-list', '--count', 'HEAD').trim()),
    files,
  };
}

export function sessionArgs(scenario, model) {
  return [
    '-p', scenario.prompt,
    ...PLUGINS.flatMap((plugin) => ['--plugin-dir', plugin]),
    '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence',
    '--permission-mode', 'dontAsk', '--allowedTools', ALLOWED_TOOLS.join(','),
    '--max-budget-usd', String(scenario.budgetUsd),
    '--output-format', 'stream-json', '--verbose', '--model', model,
  ];
}

export const parseEvents = (stdout) => stdout.split('\n').flatMap((line) => {
  const event = line.trim() ? parseJson(line) : null;
  return event ? [event] : [];
});

function compactStep(step) {
  return {
    label: short(step.label, 300),
    ...(step.isError && { isError: true, output: short(step.output, 300) }),
    ...(step.denied && { denied: true }),
  };
}

async function runScenario(scenario, options) {
  const workDir = prepareRepository(scenario);
  const record = { scenario: scenario.name, prompt: scenario.prompt };
  try {
    const run = await runClaude(sessionArgs(scenario, options.model), scenario.timeoutSeconds, { workDir });
    if (options.keep) {
      writeFileSync(`${workDir}.stream.jsonl`, run.stdout);
      record.workDir = workDir;
    }
    const session = buildSession(parseEvents(run.stdout), collectRepository(workDir));
    const { final } = session;
    Object.assign(record, {
      exit: final ? final.subtype : `claude exited with ${run.signal ?? run.code}: ${short(run.stderr || run.stdout.slice(-500), 500)}`,
      wallSeconds: Math.round(run.wallMs / 1000),
      costUsd: final?.total_cost_usd ?? null,
      turns: final?.num_turns ?? null,
      expectations: checkScenario(scenario, session),
      steps: session.steps.map(compactStep),
      subagentSteps: session.subagentSteps.length,
      permissionDenials: (final?.permission_denials ?? []).map((denial) => ({
        tool: denial.tool_name, input: short(denial.tool_input?.command ?? JSON.stringify(denial.tool_input), 300),
      })),
      ledger: session.ledger.map(({ at, ...entry }) => entry),
      verifyRuns: session.verify.runs,
      changedFiles: session.changedFiles,
      finalMessage: session.finalMessage.slice(0, 6000),
    });
    record.passed = record.expectations.filter((item) => item.pass).length;
    return record;
  } finally {
    if (!options.keep) rmSync(workDir, { recursive: true, force: true });
  }
}

function defaultOut(model, label) {
  const base = [new Date().toISOString().slice(0, 10), model.replace(/[^\w.-]/g, '-'), label].filter(Boolean).join('-');
  let file = path.join(here, 'results', `${base}.json`);
  for (let suffix = 2; existsSync(file); suffix += 1) file = path.join(here, 'results', `${base}-${suffix}.json`);
  return file;
}

async function main() {
  const { values } = parseArgs({
    options: {
      scenario: { type: 'string', multiple: true },
      model: { type: 'string', default: 'claude-opus-5-5' },
      concurrency: { type: 'string', short: 'j', default: '1' },
      label: { type: 'string' },
      keep: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    process.stdout.write(usage.replace('NAMES', SCENARIOS.map((scenario) => scenario.name).join(', ')));
    return;
  }
  const unknown = (values.scenario ?? []).filter((name) => !SCENARIOS.some((scenario) => scenario.name === name));
  if (unknown.length) throw new Error(`unknown scenario: ${unknown.join(', ')}`);
  const chosen = SCENARIOS.filter((scenario) => !values.scenario || values.scenario.includes(scenario.name));
  const runs = await pool(chosen.map((scenario) => async () => {
    const record = await runScenario(scenario, { model: values.model, keep: values.keep });
    process.stderr.write(`${scenario.name}: ${record.passed}/${record.expectations.length} expectations, ${record.exit}, $${(record.costUsd ?? 0).toFixed(2)}\n`);
    return record;
  }), Number(values.concurrency));
  const totalCostUsd = Number(runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0).toFixed(4));
  const results = {
    date: new Date().toISOString(),
    model: values.model,
    claudeVersion: execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(),
    commit: git(repoRoot, 'rev-parse', '--short', 'HEAD').trim(),
    uncommittedPluginFiles: git(repoRoot, 'status', '--porcelain', '--', 'plugins').split('\n').filter(Boolean).map((line) => line.slice(3)),
    allowedTools: ALLOWED_TOOLS,
    totalCostUsd,
    runs,
  };
  const out = defaultOut(values.model, values.label);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, serializeResults(results).replaceAll(repoRoot, '<repo>'));
  for (const run of runs) {
    process.stdout.write(`\n${run.scenario} (${run.exit}, $${(run.costUsd ?? 0).toFixed(2)}, ${run.wallSeconds} s)\n`);
    for (const item of run.expectations) process.stdout.write(`  ${item.pass ? 'pass' : 'FAIL'} ${item.id}: ${item.evidence}\n`);
  }
  process.stdout.write(`\ntotal cost: $${totalCostUsd}\nresults: ${path.relative(repoRoot, out)}\n`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
