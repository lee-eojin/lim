#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmdirSync,
  rmSync, statSync, symlinkSync, utimesSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const DEFAULT_MAX_ROUNDS = 3;
const MAX_ROUNDS_LIMIT = 5;
const REPEAT_AFTER = 3;
const MOST_REPEATED_LIMIT = 5;
// Only categories that name one kind of mistake repeat; a broad label such as correctness would add up unrelated findings.
export const NAMED_KINDS = new Set(['speculative-guard', 'history-comment', 'shortcut-marker', 'second-way']);
const CHECK_TIMEOUT_MS = Number(process.env.LIM_CHECK_TIMEOUT_MS) || 5 * 60 * 1000;
const CHECKS_BUDGET_MS = 9 * 60 * 1000;
const SEVERITIES = ['P1', 'P2', 'P3', 'P4', 'P5'];
const BLOCKING = new Set(['P1', 'P2']);
const EVIDENCE_FIELDS = ['quote', 'scenario', 'whyNotPrevented'];
const ASK_FLAGS = ['multipleFixes', 'behaviorChange', 'removesFeature', 'touchesTests'];
const CONFIRM_LEVELS = { off: [], P2: ['P2'], all: ['P1', 'P2'] };
const REVIEWER_MODELS = ['inherit', 'opus', 'sonnet', 'haiku', 'fable'];
const BASES = ['measured', 'inferred', 'guessed'];
const REVIEWER_FIELDS = [
  'severity', 'file', 'line', 'category', 'title', ...EVIDENCE_FIELDS, 'basis', 'measuredBy', ...ASK_FLAGS, 'ruleCandidate',
];
const DECISION_CHOICES = ['keep', 'once', 'rule'];
const REVIEW_FOLDER = '.lim-review';
const DIFF_COMMAND = ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'];
const CHECK_SCRIPTS = [
  ['typecheck', ['typecheck', 'type-check', 'tsc']],
  ['lint', ['lint']],
  ['test', ['test']],
];
const MANIFEST_READ = 'read package.json';
const LOCKFILE_RUNNERS = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
];
const WEAKENING_LINES = [
  [/^\+\s*(?:it|test|describe)(?:\.\w+)*\.(?:skip|only|skipIf|runIf)\b/, 'test skipped or focused'],
  [/^\+\s*(?:it|test)(?:\.\w+)*\.(?:todo|fails)\b/, 'test turned into a todo or an expected failure'],
  [/^\+\s*x(?:it|test|describe)\(/, 'test skipped'],
  [/^\+\s*(?:\/\/|\/\*)\s*eslint-disable/, 'lint rule disabled'],
  [/^\+\s*(?:\/\/|\/\*)\s*@ts-(?:ignore|expect-error|nocheck)/, 'type check suppressed'],
];
const WEAKENING_PATHS = [
  [/(^|\/)__snapshots__\//, 'snapshot changed'],
  [/^\.github\/workflows\//, 'CI config changed'],
];
const TEST_FILE = /(^|\/)__tests__\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;
const RUNNING_TEST_CASE = /^\s*(?:it|test)(?:\.(?:only|each|concurrent|sequential))*\(/;
const ANY_TEST_CASE = /^\s*x?(?:it|test)(?:\.\w+)*\(/;
const INLINE_LINT_DISABLE = /(?:\/\/|\/\*)\s*eslint-disable/g;
const JS_SOURCE = /\.[cm]?[jt]sx?$/;
const STOP_REASONS = {
  clean: 'no P1 or P2 left in this change',
  'max-rounds': 'round limit reached with P1 or P2 still open',
  stalled: 'P1 + P2 stopped decreasing',
  stuck: 'a finding is still open after two fix attempts',
  regression: 'a resolved finding came back',
  integrity: 'a fix weakened tests or checks',
  waiting: 'nothing left to fix without you',
};
const SUMMARY_FIELDS = {
  record: ['round', 'decision', 'reason', 'counts', 'resolved', 'open', 'deferred', 'cards'],
  decision: ['id', 'severity', 'title', 'choice'],
  rule: ['id', 'severity', 'title', 'drafts', 'proof', 'reason'],
  regression: ['id', 'severity', 'title', 'drafts', 'proof', 'reason'],
  note: ['phase', 'decision', 'why', 'evidence'],
  next: ['round', 'reason', 'integrity'],
};

const normalize = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const now = () => new Date().toISOString();
const summarize = ({ id, severity, file, line, title }) => ({ id, severity, file, line, title });
const severityOf = (finding) => (SEVERITIES.includes(finding.severity) ? finding.severity : 'P3');

export function fingerprint(finding) {
  const anchor = normalize(finding.quote) || normalize(finding.title);
  return createHash('sha1')
    .update(`${finding.file ?? ''}|${finding.category ?? ''}|${anchor}`)
    .digest('hex')
    .slice(0, 12);
}

export function hasEvidence(finding, sources) {
  if (finding.basis === 'guessed') return false;
  if (EVIDENCE_FIELDS.some((field) => !normalize(finding[field]))) return false;
  const quote = normalize(finding.quote);
  return sources.some((source) => normalize(source).includes(quote));
}

export function classify(findings, sourcesFor = () => [], confirmSeverities = []) {
  const fix = [];
  const ask = [];
  const cards = [];
  for (const finding of findings) {
    const severity = severityOf(finding);
    const item = { ...finding, severity, fingerprint: finding.fingerprint ?? fingerprint(finding) };
    if (!BLOCKING.has(severity)) {
      cards.push(item);
    } else if (!item.fromChecks && !hasEvidence(item, sourcesFor(item))) {
      cards.push({ ...item, unproven: true });
    } else if (ASK_FLAGS.some((flag) => item[flag] === true) || confirmSeverities.includes(severity)) {
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

export function decideNext({ round, maxRounds, counts, open, waiting = 0, stuck = [], regressions = [] }) {
  if (regressions.length) return { decision: 'stop', reason: 'regression' };
  if (stuck.length) return { decision: 'stop', reason: 'stuck' };
  if (open === 0) return { decision: 'stop', reason: waiting ? 'waiting' : 'clean' };
  if (isStalled(counts)) return { decision: 'stop', reason: 'stalled' };
  if (round >= maxRounds) return { decision: 'stop', reason: 'max-rounds' };
  return { decision: 'continue', reason: 'fix' };
}

function outsideString(code) {
  let quote = null;
  for (let index = 0; index < code.length; index += 1) {
    const char = code[index];
    if (char === '\\') index += 1;
    else if (quote) { if (char === quote) quote = null; }
    else if (`'"\``.includes(char)) quote = char;
  }
  return quote === null;
}

function disablesLintAtLineEnd(code) {
  for (const match of code.matchAll(INLINE_LINT_DISABLE)) {
    const before = code.slice(0, match.index);
    if (before.trim() && outsideString(before)) return true;
  }
  return false;
}

function diffHeaderPath(header) {
  let name = header.slice(4).replace(/\t.*$/, '');
  if (name.length > 1 && name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1).replace(/\\(.)/g, '$1');
  return name.replace(/^b\//, '');
}

export function findWeakening(diffText, nameStatusText = '') {
  const issues = [];
  const testCases = new Map();
  let file = '';
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = diffHeaderPath(line);
      continue;
    }
    if (line.startsWith('--- ')) continue;
    for (const [pattern, reason] of WEAKENING_LINES) {
      if (JS_SOURCE.test(file) && pattern.test(line)) issues.push({ file, reason, line: line.slice(1).trim() });
    }
    if (line.startsWith('+') && JS_SOURCE.test(file) && disablesLintAtLineEnd(line.slice(1))) {
      issues.push({ file, reason: 'lint rule disabled', line: line.slice(1).trim() });
    }
    const added = line.startsWith('+') && ANY_TEST_CASE.test(line.slice(1));
    const removed = line.startsWith('-') && RUNNING_TEST_CASE.test(line.slice(1));
    if (TEST_FILE.test(file) && (added || removed)) {
      const counts = testCases.get(file) ?? { added: 0, removed: 0 };
      counts[added ? 'added' : 'removed'] += 1;
      testCases.set(file, counts);
    }
  }
  for (const [testFile, { added, removed }] of testCases) {
    if (removed > added) issues.push({ file: testFile, reason: 'test case removed' });
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
  review.findings.forEach((finding, index) => {
    const basis = finding?.basis;
    if (basis === undefined || basis === null) return;
    if (!BASES.includes(basis)) {
      throw new Error(`finding ${index + 1} has basis ${JSON.stringify(basis)}, use measured, inferred, or guessed`);
    }
    if (basis === 'measured' && !normalize(finding.measuredBy)) {
      throw new Error(
        `finding ${index + 1} is measured but has no measuredBy, give the search or check and the output that shows it`,
      );
    }
  });
  return review;
}

export function renderReport(view) {
  const {
    round, maxRounds, checks = [], resolved = [], fix = [], ask = [], stillOpen = [], regressions = [],
    integrity = [], cards = [], kept = [], counts = [], looped = [], deferred = [], decision, reason, reviewerModel,
  } = view;
  const reviewerLabel = reviewerModel ? ` (reviewer: ${reviewerModel === 'inherit' ? 'session model' : reviewerModel})` : '';
  const lines = [`Review round ${round} of ${maxRounds}${reviewerLabel}`, `Checks: ${describeChecks(checks)}`];
  const section = (title, items, describe) => {
    if (items.length) lines.push('', title, ...items.flatMap(describe));
  };
  const outOfScope = cards.filter((card) => card.outOfScope && card.round === round);
  section('Resolved since last round:', resolved, (item) => [
    `- ${item.id} [${item.severity}] ${item.title} ${fixBasis(item)}`,
    ...repeatLines(item),
    ...describeRegressionTest(item, checks),
  ]);
  section('Fixing next:', fix, describeFinding);
  section('Needs your call on how to fix:', ask, describeFinding);
  section('Still open (P1 or P2):', stillOpen, describeFinding);
  section('Waiting for you (not fixed in an unattended run):', deferred, (item) => [
    ...describeFinding(item), `  waiting because: ${item.deferredReason}`,
  ]);
  section('Came back after being resolved:', regressions, describeFinding);
  section('Fixes that weakened tests or checks:', integrity, (issue) => [`- ${issue.file}: ${issue.reason}`]);
  section("Noticed outside this round's diff (not looped, decided at the end):", outOfScope, (item) => [
    `- ${item.id} [${item.severity}] ${location(item)} ${item.title}${item.basis ? ` (basis: ${item.basis})` : ''}`,
  ]);
  if (kept.length) {
    const keptBlocking = kept.filter((item) => BLOCKING.has(item.severity));
    const count = kept.length === 1 ? '1 finding you kept before was' : `${kept.length} findings you kept before were`;
    lines.push('', `${count} raised again${keptBlocking.length ? ', including:' : ''}`);
    lines.push(...keptBlocking.map((item) => `- [${item.severity}] ${location(item)} ${item.title}`));
  }
  lines.push('', `Trend (P1 + P2): ${counts.length ? counts.join(' -> ') : '-'}`);
  if (decision === 'continue') {
    lines.push(`Next: fix, then re-review in round ${round + 1} of ${maxRounds}`);
  } else {
    let stopText = STOP_REASONS[reason] ?? reason;
    if (reason === 'clean' && kept.some((item) => BLOCKING.has(item.severity))) {
      stopText = 'no P1 or P2 left to fix; the kept ones are listed above';
    } else if (reason === 'waiting') {
      stopText = `${stopText}; ${deferred.length} P1 or P2 waiting for you`;
    }
    lines.push(`Stopped: ${stopText}`, `Left for you: ${tally(cards, looped)}`);
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
  if (item.basis) {
    const measuredBy = item.basis === 'measured' && item.measuredBy ? ` (${normalize(item.measuredBy)})` : '';
    lines.push(`  basis: ${item.basis}${measuredBy}`);
  }
  if (item.note) lines.push(`  note: ${item.note}`);
  return [...lines, ...repeatLines(item)];
}

function repeatLines(item) {
  return item.repeat ? [`  repeat: ${item.repeat.category}, seen ${item.repeat.seenBefore} times before`] : [];
}

function fixBasis(item) {
  return item.fromChecks ? `(fixed, measured: ${item.quote} no longer fails)` : '(fixed, inferred: the re-review read the fix)';
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

function tally(cards, looped) {
  const inside = cards.filter((card) => !card.outOfScope);
  const outside = cards.filter((card) => card.outOfScope);
  const parts = ['P3', 'P4', 'P5'].map(
    (severity) => `${severity} ${inside.filter((card) => card.severity === severity).length}`,
  );
  const unproven = inside.filter((card) => card.unproven).length;
  if (unproven) parts.push(`unproven P1/P2 ${unproven}`);
  const ruleCandidates = cards.filter((card) => card.ruleCandidate === true).length;
  if (ruleCandidates) parts.push(`rule candidates ${ruleCandidates}`);
  const repeats = [...cards, ...looped].filter((item) => item.repeat).length;
  if (repeats) parts.push(`repeats ${repeats}`);
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
  if (problem) return { name, command: MANIFEST_READ, exitCode: 1, timedOut: false, output: problem };
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

function runChecks(root, logPath, { deadline = Date.now() + CHECKS_BUDGET_MS, only } = {}) {
  const selected = detectChecks(root).filter((check) => !only || only.includes(check.name));
  const results = selected.map((check) => (
    runCheck(root, check, Math.min(CHECK_TIMEOUT_MS, deadline - Date.now()))
  ));
  writeFileSync(logPath, results.map((result) => `$ ${result.command}\n${result.output}`).join('\n\n'));
  return results.map(({ output, ...result }) => ({ ...result, tail: output.split('\n').slice(-15).join('\n') }));
}

function checkFingerprint(check) {
  return fingerprint({ file: check.command, category: 'checks', quote: check.command });
}

function passedCheckPrints(root, checks) {
  const passed = checks.filter((check) => check.exitCode === 0);
  const manifestRead = existsSync(path.join(root, 'package.json')) && !checks.some((check) => check.command === MANIFEST_READ);
  return new Set([...passed, ...(manifestRead ? [{ command: MANIFEST_READ }] : [])].map(checkFingerprint));
}

function carriedNote(item, checks, unverifiedPrints) {
  if (!item.fromChecks) return 'the first fix did not resolve it';
  if (unverifiedPrints.has(item.fingerprint)) return 'its check timed out, so the fix is not verified';
  if (!checks.some((check) => checkFingerprint(check) === item.fingerprint)) return 'its check did not run, so the fix is not verified';
  return 'the first fix did not resolve it';
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
      basis: 'measured',
      fromChecks: true,
    }));
}

function currentContent(root, file) {
  const target = path.resolve(root, String(file ?? ''));
  const insideRoot = target.startsWith(root + path.sep);
  const readable = insideRoot && existsSync(target) && statSync(target).isFile();
  return readable ? readFileSync(target, 'utf8') : null;
}

function evidenceSources(root, finding, diffText) {
  const content = currentContent(root, finding.file);
  return content === null ? [diffText] : [content, diffText];
}

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
}

function openRepository(cwd, { create = true } = {}) {
  const root = git(['rev-parse', '--show-toplevel'], { cwd }).trim();
  const gitDir = git(['rev-parse', '--absolute-git-dir'], { cwd }).trim();
  const stateDir = path.join(gitDir, 'lim', 'review-loop');
  const sharedDir = path.join(commonGitDir(gitDir), 'lim', 'review-loop');
  if (create) {
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(sharedDir, { recursive: true });
  }
  return { root, file: (name) => path.join(stateDir, name), shared: (name) => path.join(sharedDir, name) };
}

function commonGitDir(gitDir) {
  try {
    return path.resolve(gitDir, readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim());
  } catch {
    return gitDir;
  }
}

function findRepository(directory) {
  try {
    return openRepository(directory, { create: false });
  } catch {
    return null;
  }
}

function headTree(root) {
  try {
    return git(['rev-parse', 'HEAD^{tree}'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return EMPTY_TREE;
  }
}

function headCommit(root) {
  try {
    return git(['rev-parse', '--verify', '-q', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function headReflog(root) {
  try {
    const output = git(['reflog', 'show', '--format=%H%x09%gd%x09%gs', '--date=unix', 'HEAD', '--'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
    return output.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function reflogMarker(root) {
  const entries = headReflog(root);
  return { count: entries.length, newest: entries[0] ?? null };
}

function commitLandedSince(root, skip) {
  if (!skip.reflog) return true;
  const entries = headReflog(root);
  const newer = entries.length - skip.reflog.count;
  if (newer < 0 || (skip.reflog.count > 0 && entries[newer] !== skip.reflog.newest)) return true;
  // With core.logAllRefUpdates off there is no reflog, and a moved HEAD is the only sign left.
  if (entries.length === 0) return headCommit(root) !== skip.head;
  return entries.slice(0, newer).some((entry) => entry.split('\t')[2]?.startsWith('commit'));
}

function copyRealIndex(repository, target) {
  try {
    const realIndex = path.resolve(repository.root, git(['rev-parse', '--git-path', 'index'], { cwd: repository.root }).trim());
    copyFileSync(realIndex, target);
    const { atime, mtime } = statSync(realIndex);
    utimesSync(target, atime, mtime);
    return true;
  } catch {
    return false;
  }
}

function snapshotTree(repository) {
  const index = repository.file('snapshot.index');
  const env = { ...process.env, GIT_INDEX_FILE: index };
  if (!copyRealIndex(repository, index)) {
    const baseTree = headTree(repository.root);
    git(['read-tree', ...(baseTree === EMPTY_TREE ? ['--empty'] : [baseTree])], { cwd: repository.root, env });
  }
  git(['add', '-A'], { cwd: repository.root, env });
  git(['rm', '-r', '--cached', '--ignore-unmatch', '-q', '--', REVIEW_FOLDER], { cwd: repository.root, env });
  return git(['write-tree'], { cwd: repository.root, env }).trim();
}

function excludeReviewFolder(repository) {
  const line = `${REVIEW_FOLDER}/`;
  const excludePath = path.resolve(repository.root, git(['rev-parse', '--git-path', 'info/exclude'], { cwd: repository.root }).trim());
  const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
  if (current.split(/\r?\n/).some((entry) => entry.trim() === line)) return;
  mkdirSync(path.dirname(excludePath), { recursive: true });
  appendFileSync(excludePath, `${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`);
}

function reviewPathFor(repository, round) {
  excludeReviewFolder(repository);
  const file = path.join(repository.root, REVIEW_FOLDER, `round-${round}.json`);
  // A file left by an earlier session would make Claude's Write tool refuse to overwrite it unread.
  rmSync(file, { force: true });
  return file;
}

function readReviewFile(cwd, file) {
  if (typeof file !== 'string') throw new Error('give the path after --file');
  try {
    return readFileSync(path.resolve(cwd, file), 'utf8');
  } catch (error) {
    throw new Error(`could not read ${file}: ${error.code ?? error.message}`);
  }
}

function removeReviewFile(repository, cwd, file) {
  const folder = path.join(repository.root, REVIEW_FOLDER);
  const target = realpathSync(path.resolve(cwd, file));
  if (!existsSync(folder) || path.dirname(target) !== realpathSync(folder)) return;
  rmSync(target, { force: true });
  if (!readdirSync(folder).length) rmdirSync(folder);
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

function readJsonLines(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').flatMap((line) => {
    try {
      const entry = JSON.parse(line);
      return entry && typeof entry === 'object' ? [entry] : [];
    } catch {
      return [];
    }
  });
}

function ledgerEvents(repository) {
  return readJsonLines(repository.file('ledger.jsonl')).filter((entry) => entry.event);
}

function keptSeverities(repository) {
  const choices = new Map();
  for (const entry of ledgerEvents(repository)) {
    if (entry.event === 'decision' && entry.fingerprint) choices.set(entry.fingerprint, entry);
  }
  const kept = [...choices].filter(([, entry]) => entry.choice === 'keep');
  return new Map(kept.map(([print, entry]) => [print, severityOf(entry)]));
}

function kindOf(finding) {
  return finding.fromChecks ? '' : normalize(finding.category).toLowerCase();
}

function recordKinds(repository, run, findings) {
  const kinds = findings.filter(kindOf).map((finding) => ({ category: kindOf(finding), fingerprint: finding.fingerprint }));
  if (kinds.length) appendFileSync(repository.shared('kinds.jsonl'), `${JSON.stringify({ at: now(), run, kinds })}\n`);
}

function kindCounts(repository, { except } = {}) {
  const printsByKind = new Map();
  for (const review of readJsonLines(repository.shared('kinds.jsonl'))) {
    if (except && review.run === except) continue;
    for (const { category, fingerprint: print } of review.kinds ?? []) {
      if (!printsByKind.has(category)) printsByKind.set(category, new Set());
      printsByKind.get(category).add(print);
    }
  }
  return new Map([...printsByKind].map(([category, prints]) => [category, prints.size]));
}

function repeatOf(seenBefore, finding) {
  const category = kindOf(finding);
  const count = NAMED_KINDS.has(category) ? seenBefore.get(category) ?? 0 : 0;
  return count >= REPEAT_AFTER ? { repeat: { category, seenBefore: count } } : {};
}

function mostRepeatedKinds(repository) {
  return [...kindCounts(repository)]
    .filter(([category, count]) => NAMED_KINDS.has(category) && count > 1)
    .sort(([firstKind, first], [secondKind, second]) => second - first || firstKind.localeCompare(secondKind))
    .slice(0, MOST_REPEATED_LIMIT)
    .map(([category, count]) => ({ category, count }));
}

function isKept(root, keptBefore, finding, print) {
  const keptSeverity = keptBefore.get(print);
  if (!keptSeverity) return false;
  if (SEVERITIES.indexOf(severityOf(finding)) < SEVERITIES.indexOf(keptSeverity)) return false;
  const quote = normalize(finding.quote);
  const content = currentContent(root, finding.file);
  // With a second copy of the quoted text, the keep cannot tell which copy the user saw.
  return Boolean(quote) && content !== null && normalize(content).split(quote).length <= 2;
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

function decidableFindings(state) {
  return [...state.cards, ...state.open, ...(state.deferred ?? [])];
}

function pendingDecisionIds(state) {
  return decidableFindings(state).filter((item) => !item.decision).map((item) => item.id);
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

function deferredReason(item, confirmSetting) {
  if (item.attempts > 0) return item.note ?? 'the first fix did not resolve it';
  const flags = ASK_FLAGS.filter((flag) => item[flag] === true);
  if (flags.length) return flags.join(', ');
  if (confirmSetting.severities.includes(item.severity)) return `confirm --severity ${confirmSetting.severity}`;
  return 'it needs your call before fixing';
}

function defer(item, confirmSetting) {
  const { note, ...finding } = item;
  return { ...finding, deferredReason: deferredReason(item, confirmSetting) };
}

function readUnattended(repository) {
  return { enabled: readSetting(repository, 'unattended.json', {}).enabled === true };
}

function makeUnattended(repository, state) {
  const moved = state.awaiting === 'fix' ? state.open.filter((item) => routeOf(item) === 'ask') : [];
  const confirmSetting = readConfirm(repository);
  state.unattended = true;
  state.open = state.open.filter((item) => !moved.includes(item));
  state.deferred = [...(state.deferred ?? []), ...moved.map((item) => defer(item, confirmSetting))];
  saveState(repository, state);
  return moved.map((item) => item.id);
}

function isInProgress(state) {
  return ['review', 'fix'].includes(state.awaiting) || pendingDecisionIds(state).length > 0;
}

function resumeView(repository, state) {
  const openPath = repository.file(`round-${state.round}.open.json`);
  const fixing = state.awaiting === 'fix';
  const deciding = state.awaiting === 'decisions';
  const deferred = (state.deferred ?? []).filter((item) => !item.decision);
  return {
    report: state.lastReport ?? null,
    status: 'in-progress',
    round: state.round,
    maxRounds: state.maxRounds,
    awaiting: state.awaiting,
    unattended: state.unattended === true,
    reviewerModel: state.reviewerModel ?? 'inherit',
    diffPath: repository.file(`round-${state.round}.diff`),
    openPath: existsSync(openPath) ? openPath : null,
    reviewPath: state.awaiting === 'review' ? reviewPathFor(repository, state.round) : null,
    checksFinished: state.checks !== null,
    fix: fixing ? state.open.filter((item) => routeOf(item) === 'fix') : [],
    ask: fixing ? state.open.filter((item) => routeOf(item) === 'ask') : [],
    stillOpen: deciding ? [...state.open.filter((item) => !item.decision), ...deferred] : [],
    deferred,
    cards: deciding ? state.cards.filter((card) => !card.decision) : [],
    treeMatchesReview: snapshotTree(repository) === state.reviewedTree,
  };
}

function start(cwd, options) {
  const repository = openRepository(cwd);
  const existing = options.fresh ? null : readSavedState(repository);
  const unattended = options.unattended === true || readUnattended(repository).enabled;
  if (existing && isInProgress(existing)) {
    if (unattended) {
      makeUnattended(repository, existing);
    } else {
      existing.unattended = false;
      saveState(repository, existing);
    }
    return resumeView(repository, existing);
  }
  const maxRounds = clampRounds(options['max-rounds']);
  const baseTree = headTree(repository.root);
  const reviewedTree = snapshotTree(repository);
  const diff = diffTrees(repository, baseTree, reviewedTree);
  if (!diff.trim()) return { status: 'nothing-to-review' };
  writeFileSync(repository.file('round-1.diff'), diff);
  const files = filesBetween(repository, baseTree, reviewedTree);
  const reviewerModel = readReviewerModel(repository);
  const state = {
    version: 1, runId: randomUUID(), startedAt: now(), round: 1, maxRounds, baseTree, reviewedTree, nextId: 1,
    files, reviewedFiles: files, unattended, reviewerModel,
    open: [], resolved: [], cards: [], deferred: [], kept: [], counts: [], checks: null, awaiting: 'review', stopped: null,
  };
  saveState(repository, state);
  const checks = runRoundChecks(repository, state);
  logEvent(repository, {
    event: 'start', reviewedTree, unattended, checks: checks.map(({ name, exitCode }) => ({ name, exitCode })),
  });
  return {
    status: 'review', round: 1, maxRounds, unattended, reviewerModel, diffPath: repository.file('round-1.diff'),
    reviewPath: reviewPathFor(repository, 1), checks,
  };
}

function record(cwd, options, input) {
  const repository = openRepository(cwd);
  if (options.file === undefined) return recordReview(repository, input);
  const result = recordReview(repository, readReviewFile(cwd, options.file));
  removeReviewFile(repository, cwd, options.file);
  return result;
}

function recordReview(repository, input) {
  const state = loadState(repository);
  if (state.awaiting !== 'review') throw new Error(`expected ${state.awaiting}, not a review`);
  if (state.checks === null) throw new Error('checks did not finish, run the checks command, then record again');
  const review = parseReview(input);
  const diffText = readFileSync(repository.file(`round-${state.round}.diff`), 'utf8');
  const filesInRound = new Set(state.files);
  const failingChecks = checkFindings(state.checks);
  const passedPrints = passedCheckPrints(repository.root, state.checks);
  const unverifiedPrints = new Set(state.checks.filter((check) => check.timedOut).map(checkFingerprint));
  const resolvedIds = new Set(review.resolved ?? []);

  const resolved = [];
  const carried = [];
  for (const item of state.open) {
    const isResolved = item.fromChecks ? passedPrints.has(item.fingerprint) : resolvedIds.has(item.id);
    if (isResolved) {
      resolved.push(item);
    } else {
      carried.push({ ...item, attempts: item.attempts + 1, note: carriedNote(item, state.checks, unverifiedPrints) });
    }
  }
  const stuck = carried.filter((item) => item.attempts >= 2);
  const retried = carried.filter((item) => item.attempts < 2);

  const sourcesFor = (finding) => evidenceSources(repository.root, finding, diffText);
  const keptBefore = keptSeverities(repository);
  const seenBefore = kindCounts(repository, { except: state.runId });
  const previouslyKept = state.kept ?? [];
  const previouslyDeferred = state.deferred ?? [];
  const knownPrints = new Set([...state.open, ...previouslyDeferred, ...previouslyKept].map((item) => item.fingerprint));
  const reported = [];
  const kept = [];
  for (const finding of review.findings.map((entry) => reviewerFinding(repository.root, entry))) {
    const print = fingerprint(finding);
    if (knownPrints.has(print)) continue;
    knownPrints.add(print);
    if (isKept(repository.root, keptBefore, finding, print)) {
      const { file, line, title } = finding;
      kept.push({ severity: severityOf(finding), file, line, title, fingerprint: print });
    } else {
      reported.push(finding);
    }
  }
  const allKept = [...previouslyKept, ...kept];
  const newChecks = failingChecks.filter((finding) => !state.open.some((item) => item.fingerprint === fingerprint(finding)));
  const confirmSetting = readConfirm(repository);
  const inRound = [...newChecks, ...reported.filter((finding) => filesInRound.has(finding.file))];
  const classified = classify(inRound, sourcesFor, confirmSetting.severities);
  const outside = classify(reported.filter((finding) => !filesInRound.has(finding.file)), sourcesFor);
  const outsideCards = [...outside.fix, ...outside.ask, ...outside.cards].map((item) => ({ ...item, outOfScope: true }));

  const assignIds = (items, route) => items.map((item) => ({
    ...item, id: `F-${state.nextId++}`, round: state.round, attempts: 0, ...(route ? { route } : {}),
    ...repeatOf(seenBefore, item),
  }));
  const fix = assignIds(classified.fix, 'fix');
  const newAsk = assignIds(classified.ask, 'ask');
  const needsYou = [...newAsk, ...retried.map((item) => ({ ...item, route: 'ask' }))];
  const ask = state.unattended ? [] : needsYou;
  const deferred = state.unattended ? needsYou.map((item) => defer(item, confirmSetting)) : [];
  const allDeferred = [...previouslyDeferred, ...deferred];
  const cards = assignIds([...classified.cards, ...outsideCards]);
  const resolvedPrints = new Set(state.resolved.map((item) => item.fingerprint));
  const regressions = [...fix, ...newAsk].filter((item) => resolvedPrints.has(item.fingerprint));
  const open = [...fix, ...ask, ...stuck];
  const counts = [...state.counts, open.length];
  const { decision, reason } = decideNext({
    round: state.round, maxRounds: state.maxRounds, counts, open: open.length, waiting: allDeferred.length, stuck, regressions,
  });
  const stopped = decision === 'stop';

  const allCards = [...state.cards, ...cards];
  const reviewerModel = state.reviewerModel ?? 'inherit';
  const view = {
    round: state.round, maxRounds: state.maxRounds, reviewerModel, checks: state.checks, resolved,
    fix: stopped ? [] : fix, ask: stopped ? [] : ask, stillOpen: stopped ? open : [],
    deferred: stopped ? allDeferred : deferred,
    regressions, cards: allCards, kept: allKept, counts, decision, reason,
    looped: [...state.resolved, ...resolved, ...open, ...allDeferred],
  };
  const report = renderReport(view);
  Object.assign(state, {
    open,
    resolved: [...state.resolved, ...resolved],
    cards: allCards,
    deferred: allDeferred,
    kept: allKept,
    counts,
    awaiting: stopped ? 'decisions' : 'fix',
    stopped: stopped ? { reason, at: now() } : null,
    lastReport: report,
  });
  saveState(repository, state);
  logEvent(repository, {
    event: 'record', round: state.round, reviewerModel, decision, reason, counts,
    resolved: resolved.map(summarize), open: open.map(summarize),
    deferred: deferred.map((item) => ({ ...summarize(item), reason: item.deferredReason })), cards: cards.map(summarize), kept,
  });
  recordKinds(repository, state.runId, [...fix, ...newAsk, ...cards]);
  return {
    report,
    decision, reason, round: state.round,
    fix: view.fix, ask: view.ask, stillOpen: view.stillOpen, deferred,
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
      integrity, cards: state.cards, kept: state.kept, counts: state.counts, decision: 'stop', reason: 'integrity',
      deferred: state.deferred ?? [], looped: [...state.resolved, ...state.open, ...(state.deferred ?? [])],
    });
    Object.assign(state, {
      checks: null, awaiting: 'decisions', stopped: { reason: 'integrity', at: now() }, lastReport: report,
    });
    saveState(repository, state);
    logEvent(repository, { event: 'next', round: state.round, decision: 'stop', reason: 'integrity', integrity });
    return { report, status: 'stopped', reason: 'integrity', integrity, stillOpen: state.open, cards: state.cards };
  }

  const fixedFiles = filesBetween(repository, state.reviewedTree, fixedTree);
  const reviewedFiles = [...new Set([...(state.reviewedFiles ?? state.files ?? []), ...fixedFiles])];
  Object.assign(state, {
    reviewedTree: fixedTree, files: fixedFiles, reviewedFiles, checks: null, awaiting: 'review',
    reviewerModel: readReviewerModel(repository),
  });
  saveState(repository, state);
  const checks = runRoundChecks(repository, state);
  logEvent(repository, { event: 'next', round: state.round, fixedTree, changedFiles: state.files });
  return {
    status: 'review', round: state.round, maxRounds: state.maxRounds, reviewerModel: state.reviewerModel, diffPath, openPath,
    reviewPath: reviewPathFor(repository, state.round), checks,
  };
}

function decide(cwd, options) {
  const repository = openRepository(cwd);
  const state = loadState(repository);
  const item = decidableFindings(state).find((candidate) => candidate.id === options.id);
  if (!item) throw new Error(`no finding with id ${options.id}`);
  if (!DECISION_CHOICES.includes(options.choice)) throw new Error(`choice must be one of ${DECISION_CHOICES.join(', ')}`);
  const nothingRunsRules = options.choice === 'rule' && !detectChecks(repository.root).some((check) => check.command);
  const choice = nothingRunsRules ? 'once' : options.choice;
  item.decision = choice;
  if (choice === 'rule') item.rule = { beforeTree: state.reviewedTree };
  saveState(repository, state);
  const ruleFields = choice === 'rule' ? { category: item.category, quote: item.quote, scenario: item.scenario } : {};
  logEvent(repository, { event: 'decision', ...summarize(item), choice, fingerprint: item.fingerprint, ...ruleFields });
  const result = { recorded: true, id: item.id, choice, pending: pendingDecisionIds(state) };
  if (nothingRunsRules) result.ruleSkipped = 'package.json has no typecheck, lint, or test script, so nothing would run a rule';
  return result;
}

function checkoutTree(repository, tree, folder) {
  const index = repository.file('rule.index');
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    git(['read-tree', tree], { cwd: repository.root, env });
    git(['checkout-index', '-a', `--prefix=${folder}${path.sep}`], { cwd: repository.root, env });
  } finally {
    rmSync(index, { force: true });
  }
}

function copyDrafts(fromRoot, toRoot, drafts) {
  for (const draft of drafts) {
    mkdirSync(path.dirname(path.join(toRoot, draft)), { recursive: true });
    copyFileSync(path.join(fromRoot, draft), path.join(toRoot, draft));
  }
}

function restoreDrafts(repository, tree, folder, drafts) {
  for (const draft of drafts) {
    const target = path.join(folder, draft);
    try {
      writeFileSync(target, execFileSync('git', ['cat-file', 'blob', `${tree}:${draft}`], {
        cwd: repository.root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
      }));
    } catch {
      rmSync(target, { force: true });
    }
  }
}

function isIgnored(repository, file) {
  if (file === 'node_modules' || file.startsWith('node_modules/')) return true;
  try {
    git(['check-ignore', '-q', '--', file], { cwd: repository.root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function hashFile(repository, file) {
  try {
    return git(['hash-object', '--', file], { cwd: repository.root, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function checkedRuleDrafts(repository, state) {
  return [...decidableFindings(state), ...state.resolved]
    .flatMap((item) => [item.rule, item.regression].flatMap((proven) => Object.entries(proven?.hashes ?? {})))
    .filter(([draft, hash]) => hash && hashFile(repository, draft) === hash)
    .map(([draft]) => draft);
}

function checkRule(repository, beforeTree, drafts) {
  const folder = mkdtempSync(path.join(tmpdir(), 'review-loop-rule-'));
  const deadline = Date.now() + CHECKS_BUDGET_MS;
  try {
    checkoutTree(repository, beforeTree, folder);
    const modules = path.join(repository.root, 'node_modules');
    if (existsSync(modules) && !existsSync(path.join(folder, 'node_modules'))) {
      symlinkSync(modules, path.join(folder, 'node_modules'), 'dir');
    }
    copyDrafts(repository.root, folder, drafts);
    const withDrafts = runChecks(folder, repository.file('rule.checks.log'), { deadline });
    const failing = withDrafts.filter((check) => !check.timedOut && check.exitCode !== 0).map((check) => check.name);
    if (!failing.length) {
      return { proof: withDrafts.some((check) => check.timedOut) ? 'unproven' : 'missed', caughtBy: [], withDrafts, withoutDrafts: [] };
    }
    restoreDrafts(repository, beforeTree, folder, drafts);
    const withoutDrafts = runChecks(folder, repository.file('rule.baseline.log'), { deadline, only: failing });
    const passedWithout = (name) => {
      const check = withoutDrafts.find((candidate) => candidate.name === name);
      return !check || (!check.timedOut && check.exitCode === 0);
    };
    const caughtBy = failing.filter(passedWithout);
    return { proof: caughtBy.length ? 'caught' : 'unproven', caughtBy, withDrafts, withoutDrafts };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function isBeingFixed(state, item) {
  if (!BLOCKING.has(item.severity) || item.fromChecks || !normalize(item.scenario)) return false;
  return (state.awaiting === 'fix' && state.open.includes(item)) || item.decision === 'once';
}

function proveRegression({ proof, caughtBy }) {
  if (proof !== 'caught' || caughtBy.includes('test')) return { proof };
  return { proof: 'unproven', reason: `only ${caughtBy.join(' and ')} failed with the draft on the code before the fix, the test check did not fail` };
}

function describeRegressionTest(item, checks) {
  if (!BLOCKING.has(item.severity) || item.fromChecks) return [];
  const { drafts, proof, reason } = item.regression ?? {};
  if (drafts) {
    const test = checks?.find((check) => check.name === 'test');
    const before = reason ? `${proof}, ${reason}` : proof;
    return [`  test: ${drafts.join(', ')} (before the fix: ${before}, after: ${test ? checkOutcome(test) : 'not run'})`];
  }
  const hasTestScript = (checks ?? []).some((check) => check.name === 'test');
  return [`  no test: ${reason ?? (hasTestScript ? 'none written and no reason given' : 'the project has no test script')}`];
}

function recordNoTest(repository, state, item, reason) {
  if (typeof reason !== 'string' || !normalize(reason)) throw new Error('give the reason after --no-test');
  item.regression = { reason: normalize(reason) };
  saveState(repository, state);
  logEvent(repository, { event: 'regression', ...summarize(item), fingerprint: item.fingerprint, reason: item.regression.reason });
  return { id: item.id, kind: 'regression', noTest: item.regression.reason };
}

function rule(cwd, options) {
  const repository = openRepository(cwd);
  const state = loadState(repository);
  const item = decidableFindings(state).find((candidate) => candidate.id === options.id);
  if (!item) throw new Error(`no finding with id ${options.id}`);
  const kind = item.decision === 'rule' ? 'rule' : 'regression';
  if (kind === 'regression' && !isBeingFixed(state, item)) {
    throw new Error(`${item.id} is not marked as a rule, and it is not a P1 or P2 with a scenario that is being fixed, run decide --choice rule first`);
  }
  if (options['no-test'] !== undefined) {
    if (kind === 'rule') throw new Error(`${item.id} is marked as a rule, --no-test is for a P1 or P2 fixed without a regression test`);
    return recordNoTest(repository, state, item, options['no-test']);
  }
  if (kind === 'regression' && !detectChecks(repository.root).some((check) => check.name === 'test')) {
    throw new Error('package.json has no test script, so a regression test would not run, record that with --no-test');
  }
  const drafts = [options.draft].flat().filter((draft) => typeof draft === 'string').map((draft) => repositoryPath(repository.root, draft));
  if (!drafts.length) throw new Error('name the rule draft files with --draft <path>');
  for (const draft of drafts) {
    if (draft.startsWith('../') || draft === '..') throw new Error(`${draft} is outside the repository`);
    if (draft === item.file) throw new Error(`${draft} is the file the finding is in, a draft is a lint config, a lint rule, or a test`);
    if (!existsSync(path.join(repository.root, draft))) throw new Error(`${draft} does not exist`);
    if (isIgnored(repository, draft)) throw new Error(`${draft} is ignored by git, so it would not be committed with the rule`);
  }
  const beforeTree = item[kind]?.beforeTree ?? state.reviewedTree;
  const checked = checkRule(repository, beforeTree, drafts);
  const { caughtBy, withDrafts, withoutDrafts } = checked;
  const { proof, reason } = kind === 'regression' ? proveRegression(checked) : checked;
  const hashes = Object.fromEntries(drafts.map((draft) => [draft, hashFile(repository, draft)]));
  item[kind] = { beforeTree, drafts, hashes, proof, caughtBy, reason };
  saveState(repository, state);
  logEvent(repository, {
    event: kind, ...summarize(item), category: item.category, quote: item.quote, scenario: item.scenario,
    fingerprint: item.fingerprint, drafts, proof, caughtBy, reason,
  });
  return { id: item.id, kind, proof, reason, caughtBy, withDrafts, withoutDrafts };
}

function rerunChecks(cwd) {
  const repository = openRepository(cwd);
  const state = readJson(repository.file('state.json'), null);
  const tree = snapshotTree(repository);
  let checks;
  if (state?.awaiting === 'review') {
    checks = runRoundChecks(repository, state);
  } else {
    checks = runChecks(repository.root, repository.file('final.checks.log'));
    if (state) saveState(repository, { ...state, latestChecks: checks });
  }
  logEvent(repository, { event: 'checks', tree, checks: checks.map(({ name, exitCode }) => ({ name, exitCode })) });
  return {
    checks,
    passed: checks.every((check) => check.exitCode === 0),
    notVerified: checks.filter((check) => check.timedOut).map((check) => check.name),
  };
}

function readConfirm(repository) {
  const { severity = 'off' } = readSetting(repository, 'confirm.json', {});
  const known = Object.hasOwn(CONFIRM_LEVELS, severity) ? severity : 'off';
  return { severity: known, severities: CONFIRM_LEVELS[known] };
}

function confirm(cwd, options) {
  const repository = openRepository(cwd);
  const severity = options.off ? 'off' : options.severity;
  if (severity === undefined) return readConfirm(repository);
  if (!Object.hasOwn(CONFIRM_LEVELS, severity)) throw new Error('severity must be P2, all, or off');
  writeFileSync(repository.shared('confirm.json'), JSON.stringify({ severity, updatedAt: now() }, null, 2));
  logEvent(repository, { event: 'confirm', severity });
  const rerouted = [];
  const state = readSavedState(repository);
  if (state?.awaiting === 'fix') {
    state.open = state.open.map((item) => {
      if (routeOf(item) !== 'fix' || !CONFIRM_LEVELS[severity].includes(item.severity)) return item;
      rerouted.push(item.id);
      return { ...item, route: 'ask' };
    });
    if (rerouted.length) saveState(repository, state);
  }
  return { ...readConfirm(repository), rerouted };
}

function readReviewerModel(repository) {
  const { model } = readSetting(repository, 'reviewer.json', {});
  return REVIEWER_MODELS.includes(model) ? model : 'inherit';
}

function reviewer(cwd, options) {
  const repository = openRepository(cwd);
  if (options.model === undefined) return { model: readReviewerModel(repository) };
  if (!REVIEWER_MODELS.includes(options.model)) throw new Error('model must be inherit, opus, sonnet, haiku, or fable');
  writeFileSync(repository.shared('reviewer.json'), JSON.stringify({ model: options.model, updatedAt: now() }, null, 2));
  logEvent(repository, { event: 'reviewer', model: options.model });
  return { model: options.model };
}

function setUnattended(cwd, options) {
  const repository = openRepository(cwd);
  if (!options.on && !options.off) return readUnattended(repository);
  const enabled = Boolean(options.on);
  writeFileSync(repository.shared('unattended.json'), JSON.stringify({ enabled, updatedAt: now() }, null, 2));
  const state = readSavedState(repository);
  let deferred = [];
  if (state && enabled) {
    deferred = makeUnattended(repository, state);
  } else if (state) {
    saveState(repository, { ...state, unattended: false });
  }
  logEvent(repository, { event: 'unattended', enabled, deferred });
  return { enabled, deferred };
}

function delegate(cwd, options) {
  const repository = openRepository(cwd);
  if (!['repo', 'off'].includes(options.scope)) throw new Error('scope must be repo or off');
  const delegation = options.scope === 'repo' ? { scope: 'repo', grantedAt: now() } : { scope: 'off', revokedAt: now() };
  writeFileSync(repository.shared('delegation.json'), JSON.stringify(delegation, null, 2));
  logEvent(repository, { event: 'delegation', ...delegation });
  return delegation;
}

function readSetting(repository, name, fallback) {
  const shared = repository.shared(name);
  return readJson(existsSync(shared) ? shared : repository.file(name), fallback);
}

function readGate(repository) {
  const { enabled = false, configured = false, updatedAt = '' } = readSetting(repository, 'gate.json', {});
  return { enabled, configured, skipOnce: enabled && pendingSkip(repository, updatedAt) };
}

function pendingSkip(repository, gateUpdatedAt) {
  const skip = readJson(repository.file('skip-once.json'), null);
  if (!skip) return false;
  if (skip.requestedAt >= gateUpdatedAt && !commitLandedSince(repository.root, skip)) return true;
  rmSync(repository.file('skip-once.json'), { force: true });
  return false;
}

function gate(cwd, options) {
  const repository = openRepository(cwd);
  const current = readGate(repository);
  if (options['skip-once']) {
    if (!current.enabled) throw new Error('the commit gate is off in this repository');
    const skip = { requestedAt: now(), head: headCommit(repository.root), reflog: reflogMarker(repository.root) };
    writeFileSync(repository.file('skip-once.json'), JSON.stringify(skip, null, 2));
    logEvent(repository, { event: 'gate', enabled: true, skipOnce: true });
    return { ...current, skipOnce: true };
  }
  if (!options.on && !options.off) return current;
  const settings = { enabled: Boolean(options.on), configured: true, updatedAt: now() };
  writeFileSync(repository.shared('gate.json'), JSON.stringify(settings, null, 2));
  if (options.off) rmSync(repository.file('skip-once.json'), { force: true });
  logEvent(repository, { event: 'gate', enabled: settings.enabled, skipOnce: false });
  return readGate(repository);
}

const QUOTED_HEREDOC_TO_CAT = /\$\(\s*cat\s+<<(-?)[ \t]*(['"])([A-Za-z_][A-Za-z0-9_]*)\2[ \t]*\n([\s\S]*?)\n(\t*)\3\n\s*\)/y;
const DOUBLE_QUOTE_ESCAPES = '$`"\\';

function readQuotedHeredoc(command, index) {
  QUOTED_HEREDOC_TO_CAT.lastIndex = index;
  const match = QUOTED_HEREDOC_TO_CAT.exec(command);
  if (!match) return null;
  const [text, stripsTabs, , delimiter, body, tabs] = match;
  const lines = body.split('\n').map((line) => (stripsTabs ? line.replace(/^\t+/, '') : line));
  if ((tabs && !stripsTabs) || lines.includes(delimiter) || body.includes(')')) return null;
  return { length: text.length, output: lines.join('\n').replace(/\n+$/, '') };
}

function startsSubstitution(char, next) {
  return char === '`' || (char === '$' && next === '(');
}

function scanShell(command) {
  const segments = [];
  let words = [];
  let word = '';
  let started = false;
  let quote = null;
  let substitution = false;
  let grouped = false;
  const endWord = () => {
    if (started) words.push(word);
    word = '';
    started = false;
  };
  const endSegment = () => {
    endWord();
    if (words.length) segments.push(words);
    words = [];
  };
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const next = command[index + 1] ?? '';
    if (quote === "'") {
      if (char === "'") quote = null;
      else word += char;
    } else if (quote === "$'") {
      if (char === "'") {
        quote = null;
      } else if (char === '\\') {
        word += next;
        index += 1;
      } else {
        word += char;
      }
    } else if (quote === '"') {
      const heredoc = char === '$' ? readQuotedHeredoc(command, index) : null;
      if (char === '"') {
        quote = null;
      } else if (char === '\\') {
        if (next !== '\n') word += DOUBLE_QUOTE_ESCAPES.includes(next) ? next : char + next;
        index += 1;
      } else if (heredoc) {
        word += heredoc.output;
        index += heredoc.length - 1;
      } else {
        if (startsSubstitution(char, next)) substitution = true;
        word += char;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (char === '$' && next === "'") {
      quote = "$'";
      started = true;
      index += 1;
    } else if (char === '\\') {
      if (next !== '\n') {
        word += next;
        started = true;
      }
      index += 1;
    } else if (';&|\n()'.includes(char)) {
      if ('()'.includes(char)) grouped = true;
      endSegment();
    } else if (/\s/.test(char)) {
      endWord();
    } else {
      if (startsSubstitution(char, next)) substitution = true;
      word += char;
      started = true;
    }
  }
  endSegment();
  return { segments, substitution, grouped };
}

const MAX_LOCATIONS = 16;

function limitLocations(locations) {
  const unique = [...new Set(locations)];
  return unique.length > MAX_LOCATIONS ? [...unique.slice(0, MAX_LOCATIONS - 1), null] : unique;
}

function resolveDirectory(base, target) {
  if (target === '-') return null;
  const expanded = target.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, homedir());
  if (/[$`*?]/.test(expanded)) return null;
  if (path.isAbsolute(expanded)) return path.resolve(expanded);
  return base === null ? null : path.resolve(base, expanded);
}

export function gitInvocations(command, cwd = process.cwd()) {
  const invocations = [];
  let locations = [cwd];
  const { segments, grouped } = scanShell(String(command ?? ''));
  for (const words of segments) {
    if (words[0] === 'cd') {
      const targets = locations.map((base) => resolveDirectory(base, words[1] ?? '~'));
      locations = limitLocations(grouped ? [...locations, ...targets] : targets);
      continue;
    }
    let index = 0;
    let directories = locations;
    let pointedElsewhere = false;
    while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])) {
      if (/^GIT_(?:DIR|WORK_TREE)=/.test(words[index])) pointedElsewhere = true;
      index += 1;
    }
    if (path.basename(words[index] ?? '') !== 'git') continue;
    index += 1;
    while (index < words.length && words[index].startsWith('-')) {
      const option = words[index];
      if (option === '-C') {
        directories = limitLocations(directories.map((base) => resolveDirectory(base, words[index + 1] ?? '.')));
        index += 2;
      } else if (['--git-dir', '--work-tree'].includes(option)) {
        pointedElsewhere = true;
        index += 2;
      } else if (/^--(?:git-dir|work-tree)=/.test(option)) {
        pointedElsewhere = true;
        index += 1;
      } else if (['-c', '--namespace'].includes(option)) {
        index += 2;
      } else {
        index += 1;
      }
    }
    if (pointedElsewhere) directories = [null];
    if (words[index]) invocations.push({ subcommand: words[index], args: words.slice(index + 1), directories });
  }
  return invocations;
}

const VERDICT_RANK = { allow: 1, ask: 2, deny: 3 };
const REVIEW_COMMAND = '/review-loop:review-loop';

function verdict(decision, reason) {
  return { decision, reason };
}

function pushVerdict({ args }) {
  const forced = args.some((arg) => ['--force', '-f', '--force-with-lease', '--force-if-includes'].includes(arg) || arg.startsWith('+'));
  if (forced) return verdict('ask', 'review-loop: a force push rewrites history on the remote. Confirm before Claude runs it.');
  return verdict('ask', 'review-loop: pushing publishes commits. review-loop asks before every push.');
}

const REQUIRED_VALUE_LETTERS = new Set(['m', 'F', 'C', 'c', 't']);
const ATTACHED_VALUE_LETTERS = new Set(['u', 'S']);

function readCluster(arg) {
  const letters = [...arg.slice(1)];
  for (const [position, letter] of letters.entries()) {
    if (letter === 'n') return { skipsHooks: true, takesNextWord: false };
    if (REQUIRED_VALUE_LETTERS.has(letter)) return { skipsHooks: false, takesNextWord: position === letters.length - 1 };
    if (ATTACHED_VALUE_LETTERS.has(letter)) break;
  }
  return { skipsHooks: false, takesNextWord: false };
}

function skipsHooks(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') return false;
    if (arg === '--no-verify') return true;
    if (!/^-[A-Za-z]/.test(arg)) continue;
    const cluster = readCluster(arg);
    if (cluster.skipsHooks) return true;
    if (cluster.takesNextWord) index += 1;
  }
  return false;
}

function commitVerdict(repository, { args }, gateSettings) {
  const result = reviewVerdict(repository, gateSettings);
  if (!skipsHooks(args) || result.decision === 'deny') return result;
  return verdict('ask', `${result.reason} The commit also skips git hooks with --no-verify. Confirm before Claude runs it.`);
}

function reviewVerdict(repository, gateSettings) {
  const delegated = readSetting(repository, 'delegation.json', { scope: 'off' }).scope === 'repo';
  if (gateSettings.skipOnce) {
    logEvent(repository, { event: 'gate-skip' });
    return delegated
      ? verdict('allow', 'review-loop: review skipped once at your request.')
      : verdict('ask', 'review-loop: review skipped once at your request. Commit without a review?');
  }
  const state = readSavedState(repository);
  const reviewFirst = `Run ${REVIEW_COMMAND} before committing, or ask to skip the review once.`;
  if (!state) return verdict('deny', `review-loop: this change has not been reviewed. ${reviewFirst}`);
  if (['review', 'fix'].includes(state.awaiting)) {
    return verdict('deny', `review-loop: a review loop is in progress (round ${state.round}, waiting for ${state.awaiting}). Finish it with ${REVIEW_COMMAND} before committing.`);
  }
  if (headTree(repository.root) !== state.baseTree) {
    return verdict('deny', `review-loop: HEAD moved after the last review started (for example the review was already committed, or you pulled or switched branches), so these changes have not been reviewed. ${reviewFirst}`);
  }
  const pending = pendingDecisionIds(state);
  if (pending.length) return verdict('deny', `review-loop: decide ${pending.join(', ')} before committing. Run ${REVIEW_COMMAND} to continue.`);
  const currentTree = snapshotTree(repository);
  if (currentTree !== state.reviewedTree) {
    const knownFiles = new Set([...(state.reviewedFiles ?? state.files ?? []), ...checkedRuleDrafts(repository, state)]);
    const unreviewed = filesBetween(repository, state.reviewedTree, currentTree).filter((file) => !knownFiles.has(file));
    if (unreviewed.length) return verdict('deny', `review-loop: ${unreviewed.join(', ')} changed after the last review and were not reviewed. ${reviewFirst}`);
    return verdict('ask', 'review-loop: reviewed files or checked rule drafts changed after the last review, for example fixes and rules chosen in the decision step. Commit them without another review?');
  }
  if (delegated) return verdict('allow', 'review-loop: the review passed and commits are delegated in this repository.');
  return verdict('ask', 'review-loop: the review passed with no open P1 or P2. Commit now?');
}

const SAFE_GIT_SUBCOMMANDS = new Set(['add', 'commit', 'status', 'diff', 'log', 'show']);

export function gateDecision({ cwd, command, projectDir }) {
  const invocations = gitInvocations(command, cwd);
  const sessionFolders = [...new Set([cwd, projectDir].filter(Boolean))];
  const strictest = gateVerdicts(invocations, sessionFolders)[0] ?? null;
  if (strictest?.decision !== 'allow') return strictest;
  const scan = scanShell(String(command ?? ''));
  const segments = scan.segments.filter((words) => words[0] !== 'cd');
  const onlySafeGit = segments.length === invocations.length
    && invocations.every((invocation) => SAFE_GIT_SUBCOMMANDS.has(invocation.subcommand))
    && !scan.substitution;
  if (onlySafeGit) return strictest;
  return verdict('ask', `${strictest.reason} The command also runs other commands, so review-loop does not approve it on its own.`);
}

function ambiguousVerdict(result, ambiguous, skipPending) {
  if (!ambiguous) return result;
  if (result.decision === 'allow') {
    return verdict('ask', `${result.reason} The commit may run in more than one place, so review-loop does not approve it on its own.`);
  }
  if (result.decision === 'deny' && skipPending) {
    return verdict('deny', `review-loop: the one-time skip does not apply to a commit that may run in more than one place. Commit from the repository itself, without a cd in parentheses, or run ${REVIEW_COMMAND}.`);
  }
  return result;
}

function locateTargets(directories) {
  return directories.map((directory) => {
    const repository = directory === null ? null : findRepository(directory);
    const unknown = !repository && (directory === null || !existsSync(directory));
    return { directory, repository, place: repository?.root ?? (unknown ? 'unknown' : `folder:${directory}`) };
  });
}

function gateVerdicts(invocations, sessionFolders) {
  const verdicts = [];
  const skipped = new Set();
  for (const invocation of invocations) {
    if (!['commit', 'push'].includes(invocation.subcommand)) continue;
    const targets = locateTargets(invocation.directories);
    const ambiguous = new Set(targets.map((target) => target.place)).size > 1;
    const checkedRepositories = new Set();
    for (const { repository, place } of targets) {
      if (!repository) {
        const sessionGated = place === 'unknown' && sessionFolders.some((folder) => {
          const sessionRepository = findRepository(folder);
          return sessionRepository && readGate(sessionRepository).enabled;
        });
        if (sessionGated) {
          verdicts.push(verdict('ask', `review-loop: could not tell which repository this git ${invocation.subcommand} runs in, so the commit gate cannot check it. Confirm before Claude runs it.`));
        }
        continue;
      }
      if (checkedRepositories.has(repository.root)) continue;
      checkedRepositories.add(repository.root);
      const gateSettings = readGate(repository);
      if (!gateSettings.enabled) continue;
      // The skip stays until a commit lands, so a second commit in the same command must not reuse it.
      const skipOnce = invocation.subcommand === 'commit' && gateSettings.skipOnce && !ambiguous && !skipped.has(repository.root);
      if (skipOnce) skipped.add(repository.root);
      const result = invocation.subcommand === 'push'
        ? pushVerdict(invocation)
        : commitVerdict(repository, invocation, { ...gateSettings, skipOnce });
      verdicts.push(ambiguousVerdict(result, ambiguous, gateSettings.skipOnce));
    }
  }
  return verdicts.sort((first, second) => VERDICT_RANK[second.decision] - VERDICT_RANK[first.decision]);
}

function eventsSinceStart(repository) {
  const events = ledgerEvents(repository);
  return events.slice(Math.max(events.findLastIndex((entry) => entry.event === 'start'), 0));
}

function doneSteps(repository, state, currentTree) {
  const lastChecks = eventsSinceStart(repository).findLast((entry) => entry.event === 'checks');
  const items = decidableFindings(state);
  const rules = items.filter((item) => item.decision === 'rule');
  const reviews = state.counts.length;
  const steps = {
    start: true,
    review: reviews > 0,
    record: reviews > 0,
    fix: state.round > 1,
    're-review': reviews > 1,
    decide: items.some((item) => item.decision) && pendingDecisionIds(state).length === 0,
    rules: rules.length > 0 && rules.every((item) => item.rule?.proof),
    checks: reviews > 0 && lastChecks?.tree === currentTree,
  };
  return Object.keys(steps).filter((step) => steps[step]);
}

function status(cwd) {
  const repository = openRepository(cwd);
  const state = readJson(repository.file('state.json'), null);
  const delegation = readSetting(repository, 'delegation.json', { scope: 'off' });
  const gateSettings = readGate(repository);
  const confirmSettings = readConfirm(repository);
  const repeatedKinds = mostRepeatedKinds(repository);
  const unattended = state?.unattended === true || readUnattended(repository).enabled;
  const reviewerModel = readReviewerModel(repository);
  if (!state) {
    return { review: null, unattended, reviewerModel, delegation, gate: gateSettings, confirm: confirmSettings, repeatedKinds };
  }
  const currentTree = snapshotTree(repository);
  return {
    review: {
      round: state.round,
      maxRounds: state.maxRounds,
      awaiting: state.awaiting,
      stopped: state.stopped,
      counts: state.counts,
      open: state.open.map(summarize),
      deferred: (state.deferred ?? []).map(describeDeferred),
      pendingDecisions: pendingDecisionIds(state),
      rules: decidableFindings(state)
        .filter((item) => item.decision === 'rule')
        .map((item) => ({ id: item.id, drafts: item.rule?.drafts ?? [], proof: item.rule?.proof ?? null })),
      notVerifiedChecks: (state.latestChecks ?? state.checks ?? []).filter((check) => check.timedOut).map((check) => check.name),
      doneSteps: doneSteps(repository, state, currentTree),
      resolvedRepeats: state.resolved
        .filter((item) => item.repeat)
        .map(({ id, severity, repeat }) => ({ id, severity, category: repeat.category, seenBefore: repeat.seenBefore })),
    },
    treeMatchesReview: currentTree === state.reviewedTree,
    unattended,
    reviewerModel,
    delegation,
    gate: gateSettings,
    confirm: confirmSettings,
    repeatedKinds,
  };
}

function describeDeferred(item) {
  return { ...summarize(item), reason: item.deferredReason };
}

function note(cwd, options) {
  const repository = openRepository(cwd);
  const entry = { event: 'note' };
  for (const field of ['phase', 'decision', 'why', 'evidence']) {
    const value = options[field];
    if (field === 'evidence' && value === undefined) continue;
    if (typeof value !== 'string' || !normalize(value)) throw new Error(`give --${field} <text>`);
    entry[field] = normalize(value);
  }
  logEvent(repository, entry);
  return { recorded: true, ...entry };
}

function summaryStart(repository, state, requested) {
  if (requested === undefined) {
    return state?.startedAt ?? ledgerEvents(repository).findLast((entry) => entry.event === 'start')?.at ?? null;
  }
  const time = typeof requested === 'string' ? Date.parse(requested) : Number.NaN;
  if (Number.isNaN(time)) throw new Error('--since needs an ISO time such as 2026-10-25T09:00:00Z');
  return new Date(time).toISOString();
}

function summaryEvent(entry) {
  const fields = ['at', 'event', ...SUMMARY_FIELDS[entry.event]].filter((field) => entry[field] !== undefined);
  return Object.fromEntries(fields.map((field) => [field, entry[field]]));
}

function waitingFor(repository, state) {
  const undecided = (items = []) => items.filter((item) => !item.decision);
  const unfinished = state && ['review', 'fix'].includes(state.awaiting);
  return {
    unfinished: unfinished ? { round: state.round, awaiting: state.awaiting } : null,
    deferred: undecided(state?.deferred).map(describeDeferred),
    pendingDecisions: undecided(state?.cards).map(summarize),
    stillOpen: undecided(state?.open).map(summarize),
    notVerifiedChecks: (state?.latestChecks ?? state?.checks ?? []).filter((check) => check.timedOut).map((check) => check.name),
    gateNotConfigured: !readGate(repository).configured,
  };
}

function describeEvent(entry) {
  const finding = `${entry.id} [${entry.severity}] ${entry.title}`;
  if (entry.event === 'record') {
    const outcome = entry.decision === 'continue' ? 'continued' : `stopped: ${STOP_REASONS[entry.reason] ?? entry.reason}`;
    const tally = `P1 or P2 open ${entry.open?.length ?? 0}, waiting for you ${entry.deferred?.length ?? 0}, new cards ${entry.cards?.length ?? 0}`;
    return [
      `- Round ${entry.round}: ${tally}; ${outcome}`,
      ...(entry.resolved ?? []).map((item) => `- Resolved ${item.id} [${item.severity}] ${item.title}`),
    ];
  }
  if (entry.event === 'next') {
    return [
      `- Round ${entry.round}: stopped: ${STOP_REASONS[entry.reason] ?? entry.reason}`,
      ...(entry.integrity ?? []).map((issue) => `  - ${issue.file}: ${issue.reason}`),
    ];
  }
  if (entry.event === 'decision') return [`- Decided ${finding}: ${entry.choice}`];
  if (entry.event === 'note') {
    return [`- Note (${entry.phase}): ${entry.decision}. Why: ${entry.why}${entry.evidence ? `. Evidence: ${entry.evidence}` : ''}`];
  }
  const label = entry.event === 'rule' ? 'Rule' : 'Regression test';
  const outcome = entry.proof ? `${entry.proof} (${(entry.drafts ?? []).join(', ')})` : `no test, ${entry.reason}`;
  return [`- ${label} for ${finding}: ${outcome}`];
}

function renderSummary(since, events, waiting) {
  const lines = [`Since ${since ?? 'the first entry in the ledger'}`, '', 'What happened:'];
  lines.push(...(events.length ? events.flatMap(describeEvent) : ['- nothing recorded']));
  const waitingLines = [
    ...(waiting.unfinished ? [`- The loop is not finished: round ${waiting.unfinished.round} waits for ${waiting.unfinished.awaiting}`] : []),
    ...waiting.deferred.map((item) => `- ${item.id} [${item.severity}] ${location(item)} ${item.title} (not fixed: ${item.reason})`),
    ...waiting.stillOpen.map((item) => `- Still open: ${item.id} [${item.severity}] ${location(item)} ${item.title}`),
    ...waiting.pendingDecisions.map((item) => `- Decide ${item.id} [${item.severity}] ${location(item)} ${item.title}`),
    ...(waiting.notVerifiedChecks.length ? [`- Checks not verified: ${waiting.notVerifiedChecks.join(', ')}`] : []),
    ...(waiting.gateNotConfigured ? ['- The commit gate is not configured in this repository'] : []),
  ];
  lines.push('', 'Waiting for you:', ...(waitingLines.length ? waitingLines : ['- nothing']));
  return lines.join('\n');
}

function summary(cwd, options) {
  const repository = openRepository(cwd);
  const state = readSavedState(repository);
  const since = summaryStart(repository, state, options.since);
  const events = ledgerEvents(repository)
    .filter((entry) => Object.hasOwn(SUMMARY_FIELDS, entry.event) && (entry.event !== 'next' || entry.decision === 'stop'))
    .filter((entry) => since === null || entry.at >= since)
    .map(summaryEvent);
  const waiting = waitingFor(repository, state);
  return { report: renderSummary(since, events, waiting), since, events, waiting };
}

const COMMANDS = {
  start, record, next, decide, rule, checks: rerunChecks, delegate, gate, confirm, reviewer, unattended: setUnattended, note,
  summary, status,
};

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const match = args[index].match(/^--([\w-]+)$/);
    if (!match) continue;
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      options[match[1]] = true;
    } else {
      options[match[1]] = Object.hasOwn(options, match[1]) ? [options[match[1]], value].flat() : value;
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
    const options = parseOptions(args);
    const input = command === 'record' && options.file === undefined ? readFileSync(0, 'utf8') : '';
    console.log(JSON.stringify(handler(process.cwd(), options, input), null, 2));
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
