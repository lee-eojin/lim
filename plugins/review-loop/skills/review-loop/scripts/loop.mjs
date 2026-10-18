#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const DEFAULT_MAX_ROUNDS = 3;
const MAX_ROUNDS_LIMIT = 5;
const CHECK_TIMEOUT_MS = Number(process.env.LIM_CHECK_TIMEOUT_MS) || 5 * 60 * 1000;
const CHECKS_BUDGET_MS = 9 * 60 * 1000;
const SEVERITIES = ['P1', 'P2', 'P3', 'P4', 'P5'];
const BLOCKING = new Set(['P1', 'P2']);
const EVIDENCE_FIELDS = ['quote', 'scenario', 'whyNotPrevented'];
const ASK_FLAGS = ['multipleFixes', 'behaviorChange', 'removesFeature', 'touchesTests'];
const REVIEWER_FIELDS = ['severity', 'file', 'line', 'category', 'title', ...EVIDENCE_FIELDS, ...ASK_FLAGS];
const DECISION_CHOICES = ['keep', 'once', 'rule'];
const DIFF_COMMAND = ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'];
const CHECK_SCRIPTS = [
  ['typecheck', ['typecheck', 'type-check', 'tsc']],
  ['lint', ['lint']],
  ['test', ['test']],
];
const LOCKFILE_RUNNERS = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
];
const WEAKENING_LINES = [
  [/^\+\s*(?:it|test|describe)\.(?:skip|only)\(/, 'test skipped or focused'],
  [/^\+\s*x(?:it|test|describe)\(/, 'test skipped'],
  [/^\+\s*(?:\/\/|\/\*)\s*eslint-disable/, 'lint rule disabled'],
  [/^\+\s*(?:\/\/|\/\*)\s*@ts-(?:ignore|expect-error|nocheck)/, 'type check suppressed'],
];
const WEAKENING_PATHS = [
  [/(^|\/)__snapshots__\//, 'snapshot changed'],
  [/^\.github\/workflows\//, 'CI config changed'],
];
const TEST_FILE = /(^|\/)__tests__\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;
const STOP_REASONS = {
  clean: 'no P1 or P2 left in this change',
  'max-rounds': 'round limit reached with P1 or P2 still open',
  stalled: 'P1 + P2 stopped decreasing',
  stuck: 'a finding is still open after two fix attempts',
  regression: 'a resolved finding came back',
  integrity: 'a fix weakened tests or checks',
};

const normalize = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const now = () => new Date().toISOString();
const summarize = ({ id, severity, file, line, title }) => ({ id, severity, file, line, title });

export function fingerprint(finding) {
  const anchor = normalize(finding.quote) || normalize(finding.title);
  return createHash('sha1')
    .update(`${finding.file ?? ''}|${finding.category ?? ''}|${anchor}`)
    .digest('hex')
    .slice(0, 12);
}

export function hasEvidence(finding, sources) {
  if (EVIDENCE_FIELDS.some((field) => !normalize(finding[field]))) return false;
  const quote = normalize(finding.quote);
  return sources.some((source) => normalize(source).includes(quote));
}

export function classify(findings, sourcesFor = () => []) {
  const fix = [];
  const ask = [];
  const cards = [];
  for (const finding of findings) {
    const severity = SEVERITIES.includes(finding.severity) ? finding.severity : 'P3';
    const item = { ...finding, severity, fingerprint: finding.fingerprint ?? fingerprint(finding) };
    if (!BLOCKING.has(severity)) {
      cards.push(item);
    } else if (!item.fromChecks && !hasEvidence(item, sourcesFor(item))) {
      cards.push({ ...item, unproven: true });
    } else if (ASK_FLAGS.some((flag) => item[flag] === true)) {
      ask.push(item);
    } else {
      fix.push(item);
    }
  }
  return { fix, ask, cards };
}

export function isStalled(counts) {
  if (counts.length < 3) return false;
  const [first, second, third] = counts.slice(-3);
  return second >= first && third >= second;
}

export function decideNext({ round, maxRounds, counts, open, stuck = [], regressions = [] }) {
  if (regressions.length) return { decision: 'stop', reason: 'regression' };
  if (stuck.length) return { decision: 'stop', reason: 'stuck' };
  if (open === 0) return { decision: 'stop', reason: 'clean' };
  if (isStalled(counts)) return { decision: 'stop', reason: 'stalled' };
  if (round >= maxRounds) return { decision: 'stop', reason: 'max-rounds' };
  return { decision: 'continue', reason: 'fix' };
}

export function findWeakening(diffText, nameStatusText = '') {
  const issues = [];
  let file = '';
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.slice(4).replace(/^b\//, '');
      continue;
    }
    for (const [pattern, reason] of WEAKENING_LINES) {
      if (pattern.test(line)) issues.push({ file, reason, line: line.slice(1).trim() });
    }
  }
  for (const entry of nameStatusText.split('\n').filter(Boolean)) {
    const [status, ...paths] = entry.split('\t');
    const target = paths.at(-1);
    if (status.startsWith('D') && TEST_FILE.test(target)) issues.push({ file: target, reason: 'test file deleted' });
    for (const [pattern, reason] of WEAKENING_PATHS) {
      if (pattern.test(target)) issues.push({ file: target, reason });
    }
  }
  return issues;
}

export function reviewerFinding(root, finding) {
  const picked = Object.fromEntries(REVIEWER_FIELDS.filter((field) => field in finding).map((field) => [field, finding[field]]));
  return { ...picked, file: repositoryPath(root, finding.file) };
}

export function repositoryPath(root, file) {
  const absolute = path.resolve(root, String(file ?? ''));
  return path.relative(root, absolute).split(path.sep).join('/');
}

export function parseReview(input) {
  const text = String(input).trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  let review;
  try {
    review = JSON.parse(text);
  } catch (error) {
    throw new Error(`reviewer output is not JSON: ${error.message}`);
  }
  if (!Array.isArray(review?.findings)) {
    throw new Error('reviewer output needs a "findings" array, use [] when there is nothing to report');
  }
  return review;
}

export function renderReport(view) {
  const {
    round, maxRounds, checks = [], resolved = [], fix = [], ask = [], stillOpen = [], regressions = [],
    integrity = [], cards = [], counts = [], decision, reason,
  } = view;
  const lines = [`Review round ${round} of ${maxRounds}`, `Checks: ${describeChecks(checks)}`];
  const section = (title, items, describe) => {
    if (items.length) lines.push('', title, ...items.flatMap(describe));
  };
  const outOfScope = cards.filter((card) => card.outOfScope && card.round === round);
  section('Resolved since last round:', resolved, (item) => [`- ${item.id} [${item.severity}] ${item.title}`]);
  section('Fixing next:', fix, describeFinding);
  section('Needs your call on how to fix:', ask, describeFinding);
  section('Still open (P1 or P2):', stillOpen, describeFinding);
  section('Came back after being resolved:', regressions, describeFinding);
  section('Fixes that weakened tests or checks:', integrity, (issue) => [`- ${issue.file}: ${issue.reason}`]);
  section("Noticed outside this round's diff (not looped, decided at the end):", outOfScope, (item) => [
    `- ${item.id} [${item.severity}] ${location(item)} ${item.title}`,
  ]);
  lines.push('', `Trend (P1 + P2): ${counts.length ? counts.join(' -> ') : '-'}`);
  if (decision === 'continue') {
    lines.push(`Next: fix, then re-review in round ${round + 1} of ${maxRounds}`);
  } else {
    lines.push(`Stopped: ${STOP_REASONS[reason] ?? reason}`, `Left for you: ${tally(cards)}`);
  }
  return lines.join('\n');
}

function location(item) {
  return item.line ? `${item.file}:${item.line}` : String(item.file);
}

function describeFinding(item) {
  const lines = [
    `- ${item.id} [${item.severity}] ${location(item)} ${item.title}`,
    `  was: ${normalize(item.quote)}`,
    `  why: ${normalize(item.scenario)}`,
  ];
  if (item.note) lines.push(`  note: ${item.note}`);
  return lines;
}

function describeChecks(checks) {
  if (checks === null) return 'not run';
  if (!checks.length) return 'none detected, reviewing the diff only';
  return checks.map((check) => `${check.name} ${checkOutcome(check)}`).join(', ');
}

function checkOutcome(check) {
  if (check.timedOut) return 'timed out (not verified)';
  return check.exitCode === 0 ? 'passed' : 'failed';
}

function tally(cards) {
  const inside = cards.filter((card) => !card.outOfScope);
  const outside = cards.filter((card) => card.outOfScope);
  const parts = ['P3', 'P4', 'P5'].map(
    (severity) => `${severity} ${inside.filter((card) => card.severity === severity).length}`,
  );
  const unproven = inside.filter((card) => card.unproven).length;
  if (unproven) parts.push(`unproven P1/P2 ${unproven}`);
  if (outside.length) {
    const outsideBlocking = outside.filter((card) => BLOCKING.has(card.severity) && !card.unproven).length;
    parts.push(`outside the round's diff ${outside.length} (P1/P2 ${outsideBlocking})`);
  }
  return parts.join(', ');
}

export function detectChecks(root) {
  const manifestPath = path.join(root, 'package.json');
  if (!existsSync(manifestPath)) return [];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return [{ name: 'package.json', problem: `package.json is not valid JSON: ${error.message}` }];
  }
  const scripts = manifest.scripts ?? {};
  const runner = LOCKFILE_RUNNERS.find(([lockfile]) => existsSync(path.join(root, lockfile)))?.[1] ?? 'npm';
  return CHECK_SCRIPTS.flatMap(([name, candidates]) => {
    const script = candidates.find((candidate) => scripts[candidate] && !scripts[candidate].includes('no test specified'));
    return script ? [{ name, command: [runner, 'run', script] }] : [];
  });
}

function runCheck(root, { name, command, problem }, timeout) {
  if (problem) return { name, command: 'read package.json', exitCode: 1, timedOut: false, output: problem };
  const label = command.join(' ');
  if (timeout <= 0) return { name, command: label, exitCode: null, timedOut: true, output: 'not run: the time budget for checks was used up' };
  try {
    const output = execFileSync(command[0], command.slice(1), {
      cwd: root,
      env: { ...process.env, CI: '1' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { name, command: label, exitCode: 0, timedOut: false, output };
  } catch (error) {
    const timedOut = error.code === 'ETIMEDOUT';
    const cause = typeof error.status === 'number' ? '' : `\n${error.message}`;
    return {
      name,
      command: label,
      exitCode: timedOut ? null : (error.status ?? 1),
      timedOut,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}${cause}`,
    };
  }
}

function runChecks(root, logPath) {
  const deadline = Date.now() + CHECKS_BUDGET_MS;
  const results = detectChecks(root).map((check) => (
    runCheck(root, check, Math.min(CHECK_TIMEOUT_MS, deadline - Date.now()))
  ));
  writeFileSync(logPath, results.map((result) => `$ ${result.command}\n${result.output}`).join('\n\n'));
  return results.map(({ output, ...result }) => ({ ...result, tail: output.split('\n').slice(-15).join('\n') }));
}

function checkFingerprint(check) {
  return fingerprint({ file: check.command, category: 'checks', quote: check.command });
}

function checkFindings(checks) {
  return checks
    .filter((check) => !check.timedOut && check.exitCode !== 0)
    .map((check) => ({
      severity: 'P1',
      category: 'checks',
      file: check.command,
      title: `${check.name} fails`,
      quote: check.command,
      scenario: `exit code ${check.exitCode}: ${normalize(check.tail).slice(-200)}`,
      whyNotPrevented: 'the check fails on the current tree',
      fromChecks: true,
    }));
}

function evidenceSources(root, finding, diffText) {
  const target = path.resolve(root, String(finding.file ?? ''));
  const insideRoot = target.startsWith(root + path.sep);
  const readable = insideRoot && existsSync(target) && statSync(target).isFile();
  return readable ? [readFileSync(target, 'utf8'), diffText] : [diffText];
}

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
}

function openRepository(cwd) {
  const root = git(['rev-parse', '--show-toplevel'], { cwd }).trim();
  const gitDir = git(['rev-parse', '--absolute-git-dir'], { cwd }).trim();
  const stateDir = path.join(gitDir, 'lim', 'review-loop');
  mkdirSync(stateDir, { recursive: true });
  return { root, file: (name) => path.join(stateDir, name) };
}

function headTree(root) {
  try {
    return git(['rev-parse', 'HEAD^{tree}'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return EMPTY_TREE;
  }
}

function snapshotTree(repository) {
  const env = { ...process.env, GIT_INDEX_FILE: repository.file('snapshot.index') };
  const baseTree = headTree(repository.root);
  git(['read-tree', ...(baseTree === EMPTY_TREE ? ['--empty'] : [baseTree])], { cwd: repository.root, env });
  git(['add', '-A'], { cwd: repository.root, env });
  return git(['write-tree'], { cwd: repository.root, env }).trim();
}

function diffTrees(repository, fromTree, toTree, ...options) {
  return git([...DIFF_COMMAND, ...options, fromTree, toTree], { cwd: repository.root });
}

function filesBetween(repository, fromTree, toTree) {
  return diffTrees(repository, fromTree, toTree, '--name-only', '--no-renames', '-z').split('\0').filter(Boolean);
}

function readJson(filePath, fallback) {
  return existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) : fallback;
}

function loadState(repository) {
  const state = readJson(repository.file('state.json'), null);
  if (!state) throw new Error('no review in progress, run start first');
  return state;
}

function saveState(repository, state) {
  writeFileSync(repository.file('state.json'), JSON.stringify(state, null, 2));
}

function logEvent(repository, event) {
  appendFileSync(repository.file('ledger.jsonl'), `${JSON.stringify({ at: now(), ...event })}\n`);
}

function clampRounds(value) {
  const rounds = Number.parseInt(value ?? DEFAULT_MAX_ROUNDS, 10);
  return Number.isNaN(rounds) ? DEFAULT_MAX_ROUNDS : Math.min(Math.max(rounds, 1), MAX_ROUNDS_LIMIT);
}

function runRoundChecks(repository, state) {
  state.checks = runChecks(repository.root, repository.file(`round-${state.round}.checks.log`));
  state.latestChecks = state.checks;
  saveState(repository, state);
  return state.checks;
}

function pendingDecisionIds(state) {
  return [...state.cards, ...state.open].filter((item) => !item.decision).map((item) => item.id);
}

function readSavedState(repository) {
  try {
    return readJson(repository.file('state.json'), null);
  } catch {
    return null;
  }
}

function routeOf(item) {
  if (item.route) return item.route;
  return ASK_FLAGS.some((flag) => item[flag] === true) || item.attempts > 0 ? 'ask' : 'fix';
}

function isInProgress(state) {
  return ['review', 'fix'].includes(state.awaiting) || pendingDecisionIds(state).length > 0;
}

function resumeView(repository, state) {
  const openPath = repository.file(`round-${state.round}.open.json`);
  const fixing = state.awaiting === 'fix';
  const deciding = state.awaiting === 'decisions';
  return {
    report: state.lastReport ?? null,
    status: 'in-progress',
    round: state.round,
    maxRounds: state.maxRounds,
    awaiting: state.awaiting,
    diffPath: repository.file(`round-${state.round}.diff`),
    openPath: existsSync(openPath) ? openPath : null,
    checksFinished: state.checks !== null,
    fix: fixing ? state.open.filter((item) => routeOf(item) === 'fix') : [],
    ask: fixing ? state.open.filter((item) => routeOf(item) === 'ask') : [],
    stillOpen: deciding ? state.open.filter((item) => !item.decision) : [],
    cards: deciding ? state.cards.filter((card) => !card.decision) : [],
    treeMatchesReview: snapshotTree(repository) === state.reviewedTree,
  };
}

function start(cwd, options) {
  const repository = openRepository(cwd);
  const existing = options.fresh ? null : readSavedState(repository);
  if (existing && isInProgress(existing)) return resumeView(repository, existing);
  const maxRounds = clampRounds(options['max-rounds']);
  const baseTree = headTree(repository.root);
  const reviewedTree = snapshotTree(repository);
  const diff = diffTrees(repository, baseTree, reviewedTree);
  if (!diff.trim()) return { status: 'nothing-to-review' };
  writeFileSync(repository.file('round-1.diff'), diff);
  const state = {
    version: 1, startedAt: now(), round: 1, maxRounds, baseTree, reviewedTree, nextId: 1,
    files: filesBetween(repository, baseTree, reviewedTree),
    open: [], resolved: [], cards: [], counts: [], checks: null, awaiting: 'review', stopped: null,
  };
  saveState(repository, state);
  const checks = runRoundChecks(repository, state);
  logEvent(repository, { event: 'start', reviewedTree, checks: checks.map(({ name, exitCode }) => ({ name, exitCode })) });
  return { status: 'review', round: 1, maxRounds, diffPath: repository.file('round-1.diff'), checks };
}

function record(cwd, options, input) {
  const repository = openRepository(cwd);
  const state = loadState(repository);
  if (state.awaiting !== 'review') throw new Error(`expected ${state.awaiting}, not a review`);
  if (state.checks === null) throw new Error('checks did not finish, run the checks command, then record again');
  const review = parseReview(input);
  const diffText = readFileSync(repository.file(`round-${state.round}.diff`), 'utf8');
  const filesInRound = new Set(state.files);
  const failingChecks = checkFindings(state.checks);
  const failingPrints = new Set(failingChecks.map(fingerprint));
  const unverifiedPrints = new Set(state.checks.filter((check) => check.timedOut).map(checkFingerprint));
  const resolvedIds = new Set(review.resolved ?? []);

  const resolved = [];
  const carried = [];
  for (const item of state.open) {
    const unverified = item.fromChecks && unverifiedPrints.has(item.fingerprint);
    const isResolved = item.fromChecks
      ? !failingPrints.has(item.fingerprint) && !unverified
      : resolvedIds.has(item.id);
    if (isResolved) {
      resolved.push(item);
    } else {
      const note = unverified ? 'its check timed out, so the fix is not verified' : 'the first fix did not resolve it';
      carried.push({ ...item, attempts: item.attempts + 1, note });
    }
  }
  const stuck = carried.filter((item) => item.attempts >= 2);
  const retried = carried.filter((item) => item.attempts < 2);

  const sourcesFor = (finding) => evidenceSources(repository.root, finding, diffText);
  const knownPrints = new Set(state.open.map((item) => item.fingerprint));
  const reported = [];
  for (const finding of review.findings.map((entry) => reviewerFinding(repository.root, entry))) {
    const print = fingerprint(finding);
    if (knownPrints.has(print)) continue;
    knownPrints.add(print);
    reported.push(finding);
  }
  const newChecks = failingChecks.filter((finding) => !state.open.some((item) => item.fingerprint === fingerprint(finding)));
  const classified = classify([...newChecks, ...reported.filter((finding) => filesInRound.has(finding.file))], sourcesFor);
  const outside = classify(reported.filter((finding) => !filesInRound.has(finding.file)), sourcesFor);
  const outsideCards = [...outside.fix, ...outside.ask, ...outside.cards].map((item) => ({ ...item, outOfScope: true }));

  const assignIds = (items, route) => items.map((item) => ({
    ...item, id: `F-${state.nextId++}`, round: state.round, attempts: 0, ...(route ? { route } : {}),
  }));
  const fix = assignIds(classified.fix, 'fix');
  const ask = [...assignIds(classified.ask, 'ask'), ...retried.map((item) => ({ ...item, route: 'ask' }))];
  const cards = assignIds([...classified.cards, ...outsideCards]);
  const resolvedPrints = new Set(state.resolved.map((item) => item.fingerprint));
  const regressions = [...fix, ...ask].filter((item) => resolvedPrints.has(item.fingerprint));
  const open = [...fix, ...ask, ...stuck];
  const counts = [...state.counts, open.length];
  const { decision, reason } = decideNext({
    round: state.round, maxRounds: state.maxRounds, counts, open: open.length, stuck, regressions,
  });
  const stopped = decision === 'stop';

  const allCards = [...state.cards, ...cards];
  const view = {
    round: state.round, maxRounds: state.maxRounds, checks: state.checks, resolved,
    fix: stopped ? [] : fix, ask: stopped ? [] : ask, stillOpen: stopped ? open : [],
    regressions, cards: allCards, counts, decision, reason,
  };
  const report = renderReport(view);
  Object.assign(state, {
    open,
    resolved: [...state.resolved, ...resolved],
    cards: allCards,
    counts,
    awaiting: stopped ? 'decisions' : 'fix',
    stopped: stopped ? { reason, at: now() } : null,
    lastReport: report,
  });
  saveState(repository, state);
  logEvent(repository, {
    event: 'record', round: state.round, decision, reason, counts,
    open: open.map(summarize), cards: cards.map(summarize),
  });
  return {
    report,
    decision, reason, round: state.round,
    fix: view.fix, ask: view.ask, stillOpen: view.stillOpen,
    cards: stopped ? state.cards : [],
  };
}

function next(cwd) {
  const repository = openRepository(cwd);
  const state = loadState(repository);
  if (state.awaiting !== 'fix') throw new Error(`expected ${state.awaiting}, not a fix`);
  const fixedTree = snapshotTree(repository);
  const fixDiff = diffTrees(repository, state.reviewedTree, fixedTree);
  const nameStatus = diffTrees(repository, state.reviewedTree, fixedTree, '--name-status', '--no-renames');
  const integrity = findWeakening(fixDiff, nameStatus);
  state.round += 1;
  const diffPath = repository.file(`round-${state.round}.diff`);
  const openPath = repository.file(`round-${state.round}.open.json`);
  writeFileSync(diffPath, fixDiff);
  const openForReviewer = state.open
    .filter((item) => !item.fromChecks)
    .map(({ id, severity, file, line, title, quote, scenario }) => ({ id, severity, file, line, title, quote, scenario }));
  writeFileSync(openPath, JSON.stringify(openForReviewer, null, 2));

  if (integrity.length) {
    const report = renderReport({
      round: state.round, maxRounds: state.maxRounds, checks: null, stillOpen: state.open,
      integrity, cards: state.cards, counts: state.counts, decision: 'stop', reason: 'integrity',
    });
    Object.assign(state, {
      checks: null, awaiting: 'decisions', stopped: { reason: 'integrity', at: now() }, lastReport: report,
    });
    saveState(repository, state);
    logEvent(repository, { event: 'next', round: state.round, integrity });
    return { report, status: 'stopped', reason: 'integrity', integrity, stillOpen: state.open, cards: state.cards };
  }

  const fixedFiles = filesBetween(repository, state.reviewedTree, fixedTree);
  Object.assign(state, { reviewedTree: fixedTree, files: fixedFiles, checks: null, awaiting: 'review' });
  saveState(repository, state);
  const checks = runRoundChecks(repository, state);
  logEvent(repository, { event: 'next', round: state.round, fixedTree, changedFiles: state.files });
  return { status: 'review', round: state.round, maxRounds: state.maxRounds, diffPath, openPath, checks };
}

function decide(cwd, options) {
  const repository = openRepository(cwd);
  const state = loadState(repository);
  const item = [...state.cards, ...state.open].find((candidate) => candidate.id === options.id);
  if (!item) throw new Error(`no finding with id ${options.id}`);
  if (!DECISION_CHOICES.includes(options.choice)) throw new Error(`choice must be one of ${DECISION_CHOICES.join(', ')}`);
  item.decision = options.choice;
  saveState(repository, state);
  logEvent(repository, { event: 'decision', ...summarize(item), choice: options.choice, fingerprint: item.fingerprint });
  const pending = [...state.cards, ...state.open].filter((candidate) => !candidate.decision).map((candidate) => candidate.id);
  return { recorded: true, id: item.id, choice: options.choice, pending };
}

function rerunChecks(cwd) {
  const repository = openRepository(cwd);
  const state = readJson(repository.file('state.json'), null);
  let checks;
  if (state?.awaiting === 'review') {
    checks = runRoundChecks(repository, state);
  } else {
    checks = runChecks(repository.root, repository.file('final.checks.log'));
    if (state) saveState(repository, { ...state, latestChecks: checks });
  }
  logEvent(repository, { event: 'checks', checks: checks.map(({ name, exitCode }) => ({ name, exitCode })) });
  return {
    checks,
    passed: checks.every((check) => check.exitCode === 0),
    notVerified: checks.filter((check) => check.timedOut).map((check) => check.name),
  };
}

function delegate(cwd, options) {
  const repository = openRepository(cwd);
  if (!['repo', 'off'].includes(options.scope)) throw new Error('scope must be repo or off');
  const delegation = options.scope === 'repo' ? { scope: 'repo', grantedAt: now() } : { scope: 'off', revokedAt: now() };
  writeFileSync(repository.file('delegation.json'), JSON.stringify(delegation, null, 2));
  logEvent(repository, { event: 'delegation', ...delegation });
  return delegation;
}

function status(cwd) {
  const repository = openRepository(cwd);
  const state = readJson(repository.file('state.json'), null);
  const delegation = readJson(repository.file('delegation.json'), { scope: 'off' });
  if (!state) return { review: null, delegation };
  return {
    review: {
      round: state.round,
      maxRounds: state.maxRounds,
      awaiting: state.awaiting,
      stopped: state.stopped,
      counts: state.counts,
      open: state.open.map(summarize),
      pendingDecisions: pendingDecisionIds(state),
      notVerifiedChecks: (state.latestChecks ?? state.checks ?? []).filter((check) => check.timedOut).map((check) => check.name),
    },
    treeMatchesReview: snapshotTree(repository) === state.reviewedTree,
    delegation,
  };
}

const COMMANDS = { start, record, next, decide, checks: rerunChecks, delegate, status };

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const match = args[index].match(/^--([\w-]+)$/);
    if (!match) continue;
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      options[match[1]] = true;
    } else {
      options[match[1]] = value;
      index += 1;
    }
  }
  return options;
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`usage: loop.mjs <${Object.keys(COMMANDS).join('|')}> [--option value]`);
    process.exit(2);
  }
  try {
    const input = command === 'record' ? readFileSync(0, 'utf8') : '';
    console.log(JSON.stringify(handler(process.cwd(), parseOptions(args), input), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exit(1);
  }
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) main();
