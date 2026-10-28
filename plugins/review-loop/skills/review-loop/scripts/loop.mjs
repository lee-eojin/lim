#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmdirSync,
  rmSync, statSync, lstatSync, symlinkSync, utimesSync, writeFileSync,
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
const MAX_PROJECTS = 4;
const WINDOWS = process.platform === 'win32';
const SKIPPED_FOLDERS = new Set(['node_modules', '.git', '.venv', 'venv', 'vendor', 'target', 'dist', 'build', 'testdata', 'fixtures', '__fixtures__']);
const SEVERITIES = ['P1', 'P2', 'P3', 'P4', 'P5'];
const BLOCKING = new Set(['P1', 'P2']);
const EVIDENCE_FIELDS = ['quote', 'scenario', 'whyNotPrevented'];
const ASK_FLAGS = ['multipleFixes', 'behaviorChange', 'removesFeature', 'touchesTests'];
const CONFIRM_LEVELS = { off: [], P2: ['P2'], all: ['P1', 'P2'] };
const REVIEWER_MODELS = ['inherit', 'opus', 'sonnet', 'haiku', 'fable'];
const BASES = ['measured', 'inferred', 'guessed'];
const REVIEWER_FIELDS = [
  'severity', 'file', 'line', 'category', 'title', ...EVIDENCE_FIELDS, 'basis', 'measuredBy', ...ASK_FLAGS, 'ruleCandidate', 'check',
];
const DECISION_CHOICES = ['keep', 'once', 'rule'];
const REVIEW_FOLDER = '.lim-review';
const FEATURE_MAP = 'verify.features.json';
const VERIFY_RUN_FILE = /^(.+Z)(?:-(\d+))?\.json$/;
const RERUN_OUTCOMES = {
  pass: 'passed', 'changed-after-fail': 'changed after it failed, then passed', fail: 'failed', 'not-verified': 'was not verified', missing: 'was not run',
};
const DIFF_COMMAND = ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'];
const CHECK_NAMES = ['typecheck', 'lint', 'test'];
const CHECK_SCRIPTS = [
  ['typecheck', ['typecheck', 'type-check', 'tsc']],
  ['lint', ['lint']],
  ['test', ['test']],
];
const MAKEFILES = ['GNUmakefile', 'makefile', 'Makefile'];
const MAKE_TARGETS = [
  ['typecheck', ['typecheck', 'check-types', 'types']],
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
  stop: ['round', 'reason'],
};
const UNFINISHED = ['review', 'fix', 'proof'];

const normalize = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const now = () => new Date().toISOString();
const summarize = ({ id, severity, file, line, title }) => ({ id, severity, file, line, title });
const severityOf = (finding) => (SEVERITIES.includes(finding.severity) ? finding.severity : 'P3');
const programOf = (check) => check.missingProgram ?? check.command.split(' ')[0];
const isNotVerified = (check) => Boolean(check.timedOut || check.notInstalled);
const checkId = (check) => (check.folder ? `${check.folder}:${check.name}` : check.name);
const checkTarget = (check) => (check.folder ? `${check.folder}: ${check.command}` : check.command);

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

export function decideNext({ round, maxRounds, counts, open, waiting = 0, unproven = 0, stuck = [], regressions = [] }) {
  if (regressions.length) return { decision: 'stop', reason: 'regression' };
  if (stuck.length) return { decision: 'stop', reason: 'stuck' };
  if (open === 0 && waiting) return { decision: 'stop', reason: 'waiting' };
  if (open === 0) return unproven ? { decision: 'continue', reason: 'proof' } : { decision: 'stop', reason: 'clean' };
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
    if (finding === null || typeof finding !== 'object' || Array.isArray(finding)) {
      throw new Error(`finding ${index + 1} is not an object, give each finding as {"severity": ..., "file": ..., ...}`);
    }
    const { basis, check } = finding;
    if (check !== undefined && check !== null && (typeof check !== 'string' || !normalize(check))) {
      throw new Error(`finding ${index + 1} has check ${JSON.stringify(check)}, use the id of a ${FEATURE_MAP} entry as a string`);
    }
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
    round, maxRounds, checks = [], checksLeftOut = [], resolved = [], fix = [], ask = [], stillOpen = [], regressions = [],
    integrity = [], cards = [], kept = [], counts = [], looped = [], deferred = [], needsProof = [], decision, reason, reviewerModel,
    featureMap,
  } = view;
  const reviewerLabel = reviewerModel ? ` (reviewer: ${reviewerModel === 'inherit' ? 'session model' : reviewerModel})` : '';
  const leftOut = checksLeftOut.length
    ? `; not run: more than ${MAX_PROJECTS} projects to check (${checksLeftOut.join(', ')})`
    : '';
  const lines = [`Review round ${round} of ${maxRounds}${reviewerLabel}`, `Checks: ${describeChecks(checks)}${leftOut}`];
  if (featureMap) {
    lines.push(`Feature map: ${FEATURE_MAP} (${featureMap.ids.length} ${featureMap.ids.length === 1 ? 'entry' : 'entries'})`);
  }
  const section = (title, items, describe) => {
    if (items.length) lines.push('', title, ...reproducedFirst(items).flatMap(describe));
  };
  const outOfScope = cards.filter((card) => card.outOfScope && card.round === round);
  // Findings kept during this run keep their id; ones kept in an earlier review were matched by fingerprint and have none.
  const keptInLoop = kept.filter((item) => item.id);
  const keptBefore = kept.filter((item) => !item.id);
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
  section('Needs a regression test or a no-test reason before the loop stops clean:', needsProof, (item) => [
    `- ${item.id} [${item.severity}] ${location(item)} ${item.title}`,
    `  why: ${normalize(item.scenario)}`,
    `  run: loop rule --id ${item.id} --draft <test file>, or loop rule --id ${item.id} --no-test "<reason>"`,
  ]);
  section('Fixes that weakened tests or checks:', integrity, (issue) => [`- ${issue.file}: ${issue.reason}`]);
  section("Noticed outside this round's diff (not looped, decided at the end):", outOfScope, (item) => [
    `- ${item.id} [${item.severity}] ${location(item)} ${item.title}${item.basis ? ` (basis: ${item.basis})` : ''}`,
  ]);
  section('Kept as is at your request:', keptInLoop, (item) => [`- ${item.id} [${item.severity}] ${location(item)} ${item.title}`]);
  if (keptBefore.length) {
    const keptBlocking = keptBefore.filter((item) => BLOCKING.has(item.severity));
    const count = keptBefore.length === 1 ? '1 finding you kept before was' : `${keptBefore.length} findings you kept before were`;
    lines.push('', `${count} raised again${keptBlocking.length ? ', including:' : ''}`);
    lines.push(...keptBlocking.map((item) => `- [${item.severity}] ${location(item)} ${item.title}`));
  }
  lines.push('', `Trend (P1 + P2): ${counts.length ? counts.join(' -> ') : '-'}`);
  if (reason === 'proof') {
    lines.push('Next: record a regression test or a no-test reason with loop rule; the last one stops the loop clean without another review');
  } else if (decision === 'continue') {
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

function reproducedFirst(items) {
  const rank = (item) => SEVERITIES.indexOf(severityOf(item)) * 2 + (item.reproduced ? 0 : 1);
  return [...items].sort((first, second) => rank(first) - rank(second));
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
  lines.push(...verifyLines(item));
  if (item.note) lines.push(`  note: ${item.note}`);
  return [...lines, ...repeatLines(item)];
}

function verifyLines(item) {
  const lines = [];
  if (item.reproduced) {
    lines.push(`  reproduced: verify check ${item.reproduced.check} failed (${item.reproduced.evidencePath})`);
  } else if (item.notReproduced) {
    lines.push(`  not reproduced: verify check ${item.notReproduced.check} passed`);
  }
  if (item.reproduced && item.rerun) lines.push(`  rerun on the fix: ${describeRerun(item)}`);
  return lines;
}

function describeRerun(item) {
  const { status, evidencePath } = item.rerun;
  return `verify check ${item.reproduced.check} ${RERUN_OUTCOMES[status] ?? status}${evidencePath ? ` (${evidencePath})` : ' on the fixed code'}`;
}

function repeatLines(item) {
  return item.repeat ? [`  repeat: ${item.repeat.category}, seen ${item.repeat.seenBefore} times before`] : [];
}

function fixBasis(item) {
  if (item.reproduced && item.rerun?.status === 'pass') {
    return `(fixed, measured: verify check ${item.reproduced.check} passed on the fixed code, ${item.rerun.evidencePath})`;
  }
  return item.fromChecks ? `(fixed, measured: ${item.quote} no longer fails)` : '(fixed, inferred: the re-review read the fix)';
}

function describeChecks(checks) {
  if (checks === null) return 'not run';
  if (!checks.length) return 'none detected, reviewing the diff only';
  return checks.map((check) => `${check.folder ? `${check.folder}: ` : ''}${check.name} (${check.command}) ${checkOutcome(check)}`).join(', ');
}

function checkOutcome(check) {
  if (check.timedOut) return 'timed out (not verified)';
  if (check.notInstalled) return `not run because ${programOf(check)} is not installed (not verified)`;
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

function readProjectFile(root, file) {
  const filePath = path.join(root, file);
  return existsSync(filePath) && statSync(filePath).isFile() ? readFileSync(filePath, 'utf8') : '';
}

function lockfileRunner(directory, root) {
  for (let folder = directory; ; folder = path.dirname(folder)) {
    const runner = LOCKFILE_RUNNERS.find(([lockfile]) => existsSync(path.join(folder, lockfile)))?.[1];
    if (runner) return runner;
    if (folder === root || path.dirname(folder) === folder) return 'npm';
  }
}

const isJsonObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

function packageScripts(directory, root = directory) {
  const manifestPath = path.join(directory, 'package.json');
  if (!existsSync(manifestPath)) return [];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return [{ name: 'package.json', problem: `package.json is not valid JSON: ${error.message}` }];
  }
  if (!isJsonObject(manifest)) return [{ name: 'package.json', problem: 'package.json is not a JSON object' }];
  const scripts = manifest.scripts ?? {};
  const candidates = CHECK_SCRIPTS.flatMap(([, names]) => names).filter((name) => name in Object(scripts));
  if (!isJsonObject(scripts) || candidates.some((name) => typeof scripts[name] !== 'string')) {
    return [{ name: 'package.json', problem: 'package.json "scripts" is not an object of strings' }];
  }
  const runner = lockfileRunner(directory, root);
  return CHECK_SCRIPTS.flatMap(([name, candidates]) => {
    const script = candidates.find((candidate) => scripts[candidate] && !scripts[candidate].includes('no test specified'));
    return script ? [{ name, command: [runner, 'run', script] }] : [];
  });
}

function makeTargets(root) {
  const makefile = MAKEFILES.map((file) => readProjectFile(root, file)).find(Boolean);
  if (!makefile) return [];
  const declares = (target) => new RegExp(`^${target}\\s*::?(?![:=])`, 'm').test(makefile);
  return MAKE_TARGETS.flatMap(([name, candidates]) => {
    const target = candidates.find(declares);
    return target ? [{ name, command: ['make', target] }] : [];
  });
}

function goChecks(root) {
  if (!existsSync(path.join(root, 'go.mod'))) return [];
  return [{ name: 'lint', command: ['go', 'vet', './...'] }, { name: 'test', command: ['go', 'test', './...'] }];
}

function rustChecks(root) {
  if (!existsSync(path.join(root, 'Cargo.toml'))) return [];
  return [{ name: 'typecheck', command: ['cargo', 'check'] }, { name: 'test', command: ['cargo', 'test'] }];
}

const GRADLE_FILES = ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'];
const GRADLE_SETTINGS = ['settings.gradle', 'settings.gradle.kts'];
const JVM_TOOLS = new Set(['gradle', 'mvn', './gradlew', './mvnw', './gradlew.bat', './mvnw.cmd', 'sh']);
// Windows has no executable bit; Gradle and Maven projects ship these wrappers for it.
const WINDOWS_WRAPPERS = { gradlew: 'gradlew.bat', mvnw: 'mvnw.cmd' };

function ancestorsOf(folder, repositoryRoot) {
  const ancestors = [];
  for (let parent = path.dirname(folder); parent.length >= repositoryRoot.length; parent = path.dirname(parent)) {
    ancestors.push(parent);
    if (parent === repositoryRoot) break;
  }
  return ancestors;
}

// A Gradle subproject has build files but no settings file of its own, under a folder that has one; that build runs its tests.
function isGradleSubproject(folder, repositoryRoot) {
  if (GRADLE_SETTINGS.some((file) => existsSync(path.join(folder, file)))) return false;
  return ancestorsOf(folder, repositoryRoot).some((parent) => GRADLE_SETTINGS.some((file) => existsSync(path.join(parent, file))));
}

// A Maven module is listed in a parent pom's <module> entries outside comments and profiles; that parent's build runs its tests.
function listedModules(pom) {
  const active = pom.replace(/<!--[\s\S]*?-->/g, '').replace(/<profiles>[\s\S]*?<\/profiles>/g, '');
  return [...active.matchAll(/<module>\s*([^<]+?)\s*<\/module>/g)].map(([, module]) => module);
}

function isMavenModule(folder, repositoryRoot) {
  return ancestorsOf(folder, repositoryRoot).some((parent) => listedModules(readProjectFile(parent, 'pom.xml'))
    .some((module) => path.resolve(parent, module) === path.resolve(folder)));
}

function wrapperCommand(folder, wrapper) {
  if (WINDOWS && existsSync(path.join(folder, WINDOWS_WRAPPERS[wrapper]))) return [`./${WINDOWS_WRAPPERS[wrapper]}`];
  try {
    return (statSync(path.join(folder, wrapper)).mode & 0o111) ? [`./${wrapper}`] : ['sh', wrapper];
  } catch {
    return null;
  }
}

function jvmChecks(folder, repositoryRoot = folder) {
  const has = (file) => existsSync(path.join(folder, file));
  if (GRADLE_FILES.some(has)) {
    if (isGradleSubproject(folder, repositoryRoot)) return [];
    return [{ name: 'test', command: [...(wrapperCommand(folder, 'gradlew') ?? ['gradle']), 'test'] }];
  }
  if (has('pom.xml')) {
    if (isMavenModule(folder, repositoryRoot)) return [];
    return [{ name: 'test', command: [...(wrapperCommand(folder, 'mvnw') ?? ['mvn']), '-B', '-q', 'test'] }];
  }
  return [];
}

const DOTNET_SOLUTION_EXTENSIONS = ['.sln', '.slnx'];
const DOTNET_PROJECT_EXTENSIONS = ['.csproj', '.fsproj'];

function filesEndingWith(folder, extensions) {
  try {
    return readdirSync(folder).filter((file) => extensions.some((extension) => file.endsWith(extension))).sort();
  } catch {
    return [];
  }
}

// A project without a solution of its own under a folder that has one is built and tested by that solution.
// dotnet test needs a target when a folder holds more than one solution or project file.
function dotnetChecks(folder, repositoryRoot = folder) {
  const solutions = filesEndingWith(folder, DOTNET_SOLUTION_EXTENSIONS);
  const projects = filesEndingWith(folder, DOTNET_PROJECT_EXTENSIONS);
  if (solutions.length) return [{ name: 'test', command: ['dotnet', 'test', ...(solutions.length + projects.length > 1 ? [solutions[0]] : [])] }];
  if (!projects.length) return [];
  if (ancestorsOf(folder, repositoryRoot).some((parent) => filesEndingWith(parent, DOTNET_SOLUTION_EXTENSIONS).length)) return [];
  return [{ name: 'test', command: ['dotnet', 'test', ...(projects.length > 1 ? [projects[0]] : [])] }];
}

function existsHereOrAbove(folder, repositoryRoot, file) {
  return [folder, ...ancestorsOf(folder, repositoryRoot)].some((parent) => existsSync(path.join(parent, file)));
}

function rubyChecks(folder, repositoryRoot = folder) {
  const has = (file) => existsSync(path.join(folder, file));
  const hasFolder = (name) => has(name) && statSync(path.join(folder, name)).isDirectory();
  const viaBundler = existsHereOrAbove(folder, repositoryRoot, 'Gemfile');
  const tool = (...command) => (viaBundler ? ['bundle', 'exec', ...command] : command);
  const checks = [];
  if (has('.rubocop.yml')) checks.push({ name: 'lint', command: tool('rubocop') });
  // A spec/ folder alone is common outside Ruby (OpenAPI specs, Jasmine), so it counts only next to a Gemfile or Rakefile.
  if (has('.rspec') || (hasFolder('spec') && (has('Gemfile') || has('Rakefile')))) checks.push({ name: 'test', command: tool('rspec') });
  else if (has('Rakefile') && hasFolder('test')) checks.push({ name: 'test', command: tool('rake', 'test') });
  return checks;
}

function sectionLines(lines, header) {
  const start = lines.indexOf(header);
  if (start === -1) return [];
  const end = lines.findIndex((line, index) => index > start && line.startsWith('['));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

function pythonChecks(root) {
  const pyproject = readProjectFile(root, 'pyproject.toml').split('\n').map((line) => line.trim());
  const pyprojectHas = (section) => pyproject.some((line) => line.startsWith(section));
  const hasFile = (file) => existsSync(path.join(root, file));
  const viaUv = hasFile('uv.lock');
  const tool = (program) => (viaUv ? ['uv', 'run', '--frozen', '--no-sync', program] : [program]);
  const checks = [];
  if (pyprojectHas('[tool.mypy') || hasFile('mypy.ini')) {
    const mypyConfig = hasFile('mypy.ini')
      ? sectionLines(readProjectFile(root, 'mypy.ini').split('\n').map((line) => line.trim()), '[mypy]')
      : sectionLines(pyproject, '[tool.mypy]');
    const configuresFiles = mypyConfig.some((line) => /^files\s*=/.test(line));
    checks.push({ name: 'typecheck', command: configuresFiles ? tool('mypy') : [...tool('mypy'), '.'] });
  }
  if (pyprojectHas('[tool.ruff') || hasFile('ruff.toml') || hasFile('.ruff.toml')) {
    checks.push({ name: 'lint', command: [...tool('ruff'), 'check', '.'] });
  }
  const setupCfg = readProjectFile(root, 'setup.cfg').split('\n').map((line) => line.trim());
  if (pyprojectHas('[tool.pytest.ini_options]') || hasFile('pytest.ini') || setupCfg.includes('[tool:pytest]')) {
    checks.push({ name: 'test', command: viaUv ? tool('pytest') : ['python3', '-m', 'pytest'] });
  }
  return checks;
}

const CHECK_SOURCES = [packageScripts, makeTargets, goChecks, rustChecks, pythonChecks, jvmChecks, dotnetChecks, rubyChecks];

function declaredChecks(root, folder) {
  return CHECK_SOURCES.flatMap((source) => source(path.join(root, folder), root));
}

export function detectFolderChecks(root, folder) {
  const declared = declaredChecks(root, folder);
  const problems = declared.filter((check) => check.problem);
  const chosen = CHECK_NAMES.flatMap((name) => declared.find((check) => check.name === name) ?? []);
  return [...problems, ...chosen].map((check) => (folder ? { ...check, folder } : check));
}

export function detectChecks(root) {
  return detectFolderChecks(root, '');
}

export function changedProjects(root, files) {
  const declares = new Map();
  const declaresChecks = (folder) => {
    if (!declares.has(folder)) declares.set(folder, declaredChecks(root, folder).length > 0);
    return declares.get(folder);
  };
  const projects = new Set();
  for (const file of files) {
    for (let folder = path.posix.dirname(file); folder !== '.'; folder = path.posix.dirname(folder)) {
      if (folder.split('/').some((part) => SKIPPED_FOLDERS.has(part))) continue;
      if (declaresChecks(folder)) {
        projects.add(folder);
        break;
      }
    }
  }
  return [...projects].sort();
}

// A check finding's file is a label such as "web: npm run test", so its project is the folder it ran in.
const projectFileOf = (item) => (item.fromChecks ? `${item.folder || '.'}/.` : item.file);

function checkedFolders(root, files) {
  return ['', ...changedProjects(root, files).slice(0, MAX_PROJECTS)];
}

// Projects of `files` come first, so a cap never drops them for projects that are only rechecked.
function selectChecks(root, files, recheckedFiles = []) {
  const changed = changedProjects(root, files);
  const projects = [...changed, ...changedProjects(root, recheckedFiles).filter((project) => !changed.includes(project))];
  const seen = new Set();
  const checks = ['', ...projects.slice(0, MAX_PROJECTS)].flatMap((folder) => detectFolderChecks(root, folder)).filter((check) => {
    if (!check.command) return true;
    const key = `${realpathSync.native(path.join(root, check.folder ?? ''))}\0${check.command.join(' ')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { checks, leftOut: projects.slice(MAX_PROJECTS) };
}

export function missingProgram(command, stderr) {
  if (JVM_TOOLS.has(command[0]) && /JAVA_HOME is not set and no 'java' command could be found|Unable to locate a Java Runtime|JAVA_HOME (?:environment variable )?is not defined correctly|java\/javac command does not exist in PATH nor is JAVA_HOME set/.test(stderr)) return 'java';
  if (command[0] === 'uv') return /Failed to spawn: `([^`]+)`[\s\S]*No such file or directory/.exec(stderr)?.[1] ?? null;
  if (command[0] === 'bundle' && command[1] === 'exec') {
    const notFound = /^bundler: command not found: (\S+)/m.exec(stderr)?.[1];
    if (notFound) return notFound;
    const missingGems = /Could not find ([^\n]+?) in locally installed gems/.exec(stderr)?.[1];
    if (missingGems) return missingGems.split(', ')[0].replace(/^gem '([^' ]+)[^']*'$/, '$1').replace(/-\d.*$/, '');
    return /^Run `bundle install` to install missing gems/m.test(stderr) ? command[2] : null;
  }
  if (command[1] === '-m') return new RegExp(`No module named '?${command[2]}'?\\s*$`, 'm').test(stderr) ? command[2] : null;
  return null;
}

function runCheck(root, check, timeout) {
  const { name, folder } = check;
  const result = runCommand(root, check, timeout);
  return folder ? { name, folder, ...result } : { name, ...result };
}

// cmd.exe reads these characters itself, so each is escaped with ^ to reach the program unchanged.
const CMD_SPECIAL = /([()\][%!^"`<>&|;, *?])/g;

// A Microsoft Store app execution alias (WindowsApps\python3.exe) is a reparse point that stat cannot open, so any
// entry that is not a folder counts.
const isFile = (target) => {
  try {
    return !lstatSync(target).isDirectory();
  } catch {
    return false;
  }
};

// Windows finds a program by the extensions in PATHEXT, not by an executable bit. A bare name is looked up on PATH
// alone: Windows would try the working folder first, where a git.exe in the repository would run instead.
function windowsProgram(program, cwd) {
  const extensions = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').toLowerCase().split(';').filter(Boolean);
  const names = extensions.includes(path.extname(program).toLowerCase()) ? [program] : extensions.map((extension) => program + extension);
  const folders = /[\\/]/.test(program) ? [cwd] : (process.env.PATH ?? '').split(path.delimiter).filter((folder) => path.isAbsolute(folder));
  for (const folder of folders) {
    const found = names.map((name) => path.resolve(folder, name)).find(isFile);
    if (found) return found;
  }
  return null;
}

const cmdArgument = (argument) => `"${argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`.replace(CMD_SPECIAL, '^$1');

// Node starts a .cmd or .bat file, such as npm.cmd, only through cmd.exe.
function launchOf(command, cwd) {
  if (!WINDOWS) return { file: command[0], args: command.slice(1) };
  const program = windowsProgram(command[0], cwd);
  if (!program) return null;
  if (!/\.(?:cmd|bat)$/i.test(program)) return { file: program, args: command.slice(1) };
  const line = [program.replace(CMD_SPECIAL, '^$1'), ...command.slice(1).map(cmdArgument)].join(' ');
  return { file: process.env.ComSpec || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'), args: ['/d', '/s', '/c', `"${line}"`], windowsVerbatimArguments: true };
}

function notInstalled(label, missing) {
  return { command: label, exitCode: null, timedOut: false, notInstalled: true, missingProgram: missing, output: `not run: ${missing} is not installed` };
}

function runCommand(root, { command, problem, folder }, timeout) {
  if (problem) return { command: MANIFEST_READ, exitCode: 1, timedOut: false, output: problem };
  const label = command.join(' ');
  if (timeout <= 0) return { command: label, exitCode: null, timedOut: true, output: 'not run: the time budget for checks was used up' };
  const cwd = path.join(root, folder ?? '');
  try {
    const launch = launchOf(command, cwd);
    if (!launch) return notInstalled(label, command[0]);
    const output = execFileSync(launch.file, launch.args, {
      cwd,
      env: { ...process.env, CI: '1' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      maxBuffer: 64 * 1024 * 1024,
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
    });
    return { command: label, exitCode: 0, timedOut: false, output };
  } catch (error) {
    const missing = error.code === 'ENOENT' ? command[0] : missingProgram(command, `${error.stdout ?? ''}${error.stderr ?? ''}`);
    if (missing) return notInstalled(label, missing);
    const timedOut = error.code === 'ETIMEDOUT';
    const cause = typeof error.status === 'number' ? '' : `\n${error.message}`;
    return {
      command: label,
      exitCode: timedOut ? null : (error.status ?? 1),
      timedOut,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}${cause}`,
    };
  }
}

function runChecks(root, logPath, selected, deadline = Date.now() + CHECKS_BUDGET_MS) {
  const results = selected.map((check) => (
    runCheck(root, check, Math.min(CHECK_TIMEOUT_MS, deadline - Date.now()))
  ));
  writeFileSync(logPath, results.map((result) => `$ ${checkTarget(result)}\n${result.output}`).join('\n\n'));
  return results.map(({ output, ...result }) => ({ ...result, tail: output.split('\n').slice(-15).join('\n') }));
}

function checkFingerprint(check) {
  return fingerprint({ file: checkTarget(check), category: 'checks', quote: checkTarget(check) });
}

function passedCheckPrints(root, checks, files) {
  const passed = checks.filter((check) => check.exitCode === 0);
  const manifestReads = checkedFolders(root, files)
    .filter((folder) => existsSync(path.join(root, folder, 'package.json')))
    .filter((folder) => !checks.some((check) => check.command === MANIFEST_READ && (check.folder ?? '') === folder))
    .map((folder) => (folder ? { folder, command: MANIFEST_READ } : { command: MANIFEST_READ }));
  return new Set([...passed, ...manifestReads].map(checkFingerprint));
}

function rerunBlocks(item) {
  return Boolean(item.reproduced) && item.rerun?.status !== 'pass';
}

function carriedNote(item, checks, unverified, resolvedIds) {
  if (rerunBlocks(item)) {
    const outcome = `verify check ${item.reproduced.check} ${RERUN_OUTCOMES[item.rerun?.status ?? 'missing']} on the fixed code`;
    return resolvedIds.has(item.id) ? `the re-review marked it resolved, but ${outcome}` : `the first fix did not resolve it, and ${outcome}`;
  }
  if (!item.fromChecks) return 'the first fix did not resolve it';
  const unverifiedCheck = unverified.get(item.fingerprint);
  if (unverifiedCheck?.notInstalled) return `its check did not run because ${programOf(unverifiedCheck)} is not installed, so the fix is not verified`;
  if (unverifiedCheck) return 'its check timed out, so the fix is not verified';
  if (!checks.some((check) => checkFingerprint(check) === item.fingerprint)) return 'its check did not run, so the fix is not verified';
  return 'the first fix did not resolve it';
}

function checkFindings(checks) {
  return checks
    .filter((check) => !isNotVerified(check) && check.exitCode !== 0)
    .map((check) => ({
      severity: 'P1',
      category: 'checks',
      file: checkTarget(check),
      title: `${check.folder ? `${check.folder}: ` : ''}${check.name} fails`,
      quote: checkTarget(check),
      scenario: `exit code ${check.exitCode}: ${normalize(check.tail).slice(-200)}`,
      whyNotPrevented: 'the check fails on the current tree',
      basis: 'measured',
      fromChecks: true,
      ...(check.folder ? { folder: check.folder } : {}),
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
  const launch = launchOf(['git', ...args], options.cwd ?? process.cwd());
  if (!launch) throw Object.assign(new Error('git was not found on PATH'), { code: 'ENOENT' });
  return execFileSync(launch.file, launch.args, {
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsVerbatimArguments: launch.windowsVerbatimArguments, ...options,
  });
}

function openRepository(cwd, { create = true } = {}) {
  // git prints C:/ paths on Windows; resolving gives the form path.join and path.relative produce.
  const root = path.resolve(git(['rev-parse', '--show-toplevel'], { cwd }).trim());
  const gitDir = path.resolve(git(['rev-parse', '--absolute-git-dir'], { cwd }).trim());
  const stateDir = path.join(gitDir, 'lim', 'review-loop');
  const sharedDir = path.join(commonGitDir(gitDir), 'lim', 'review-loop');
  if (create) {
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(sharedDir, { recursive: true });
  }
  return {
    root,
    file: (name) => path.join(stateDir, name),
    shared: (name) => path.join(sharedDir, name),
    verifyRuns: path.join(gitDir, 'lim', 'verify', 'runs'),
  };
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

// Each call gets its own index file, since two gate calls can run at once.
function stagedTree(repository) {
  const index = repository.file(`staged-${process.pid}-${randomUUID()}.index`);
  try {
    if (!copyRealIndex(repository, index)) return EMPTY_TREE;
    return git(['write-tree'], { cwd: repository.root, env: { ...process.env, GIT_INDEX_FILE: index }, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  } finally {
    rmSync(index, { force: true });
  }
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
  const target = realpathSync.native(path.resolve(cwd, file));
  if (!existsSync(folder) || path.dirname(target) !== realpathSync.native(folder)) return;
  rmSync(target, { force: true });
  if (!readdirSync(folder).length) rmdirSync(folder);
}

function diffTrees(repository, fromTree, toTree, ...options) {
  return git([...DIFF_COMMAND, ...options, fromTree, toTree], { cwd: repository.root });
}

function filesBetween(repository, fromTree, toTree) {
  return diffTrees(repository, fromTree, toTree, '--name-only', '--no-renames', '-z').split('\0').filter(Boolean);
}

function readFeatureMap(root) {
  try {
    const map = JSON.parse(readFileSync(path.join(root, FEATURE_MAP), 'utf8'));
    return Array.isArray(map?.features) ? { ids: map.features.map((entry) => entry?.id) } : null;
  } catch {
    return null;
  }
}

function featureMapFields(root) {
  return readFeatureMap(root) ? { featureMapPath: path.join(root, FEATURE_MAP) } : {};
}

// The same order verify keeps its runs in: two runs that start in the same millisecond get -2, -3, ...
function verifyRunOrder(name) {
  const match = VERIFY_RUN_FILE.exec(name);
  return match ? [match[1], Number(match[2] ?? 1)] : [name, 0];
}

function compareVerifyRuns(left, right) {
  const [leftTime, leftSequence] = verifyRunOrder(left);
  const [rightTime, rightSequence] = verifyRunOrder(right);
  if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
  return leftSequence - rightSequence;
}

function shownPath(root, file) {
  const relative = path.relative(root, file);
  return relative.startsWith('..') || path.isAbsolute(relative) ? file : relative.split(path.sep).join('/');
}

function verifyEvidence(repository, check, tree) {
  if (!existsSync(repository.verifyRuns)) return null;
  const newestFirst = readdirSync(repository.verifyRuns).filter((name) => name.endsWith('.json')).sort(compareVerifyRuns).reverse();
  for (const name of newestFirst) {
    const evidencePath = path.join(repository.verifyRuns, name);
    let run;
    try {
      run = JSON.parse(readFileSync(evidencePath, 'utf8'));
    } catch {
      continue;
    }
    if (run?.tree !== tree && run?.treeAfter !== tree) continue;
    const result = (run.checks ?? []).find((candidate) => candidate.id === check);
    if (result) {
      return {
        status: result.status, changedAfterFail: result.changedAfterFail === true, reasons: result.reasons ?? [], evidencePath: shownPath(repository.root, evidencePath),
      };
    }
  }
  return null;
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
  const failingChecks = [...state.open, ...(state.deferred ?? []), ...(state.kept ?? [])].filter((item) => item.fromChecks).map(projectFileOf);
  const { checks, leftOut } = selectChecks(repository.root, state.files ?? [], failingChecks);
  state.checks = runChecks(repository.root, repository.file(`round-${state.round}.checks.log`), checks);
  state.checksLeftOut = leftOut;
  state.latestChecks = state.checks;
  saveState(repository, state);
  return state.checks;
}

function leftOutField(leftOut) {
  return leftOut?.length ? { checksLeftOut: leftOut } : {};
}

function checkEvents(checks) {
  return checks.map(({ name, folder, exitCode }) => ({ name, folder, exitCode }));
}

function decidableFindings(state) {
  return [...state.cards, ...state.open, ...(state.deferred ?? []), ...(state.kept ?? []).filter((item) => item.id)];
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

// Unattended, a finding whose only open question is which of several fixes to use gets the smallest one;
// a choice the user would see (behavior, a removed feature, a changed test) still waits.
function unattendedFixable(item, confirmSetting) {
  const flags = ASK_FLAGS.filter((flag) => item[flag] === true);
  return !(item.attempts > 0) && flags.length === 1 && flags[0] === 'multipleFixes' && !confirmSetting.severities.includes(item.severity);
}

const UNATTENDED_FIX_NOTE = 'unattended: use the fix that changes the least, and record the choice with loop note';

function defer(item, confirmSetting) {
  const { note, ...finding } = item;
  return { ...finding, deferredReason: deferredReason(item, confirmSetting) };
}

function readUnattended(repository) {
  return { enabled: readSetting(repository, 'unattended.json', {}).enabled === true };
}

function makeUnattended(repository, state) {
  const confirmSetting = readConfirm(repository);
  const asking = state.awaiting === 'fix' ? state.open.filter((item) => routeOf(item) === 'ask') : [];
  const moved = asking.filter((item) => !unattendedFixable(item, confirmSetting));
  for (const item of asking.filter((candidate) => !moved.includes(candidate))) {
    Object.assign(item, { route: 'fix', note: UNATTENDED_FIX_NOTE });
  }
  state.unattended = true;
  state.open = state.open.filter((item) => !moved.includes(item));
  state.deferred = [...(state.deferred ?? []), ...moved.map((item) => defer(item, confirmSetting))];
  if (state.awaiting === 'fix' && !state.open.length) stopWaiting(state);
  saveState(repository, state);
  return moved.map((item) => item.id);
}

function stopWaiting(state) {
  const deferred = state.deferred ?? [];
  state.lastReport = renderReport({
    round: state.round, maxRounds: state.maxRounds, reviewerModel: state.reviewerModel ?? 'inherit', checks: state.checks,
    checksLeftOut: state.checksLeftOut, deferred, cards: state.cards, kept: state.kept, counts: state.counts,
    decision: 'stop', reason: 'waiting', looped: [...state.resolved, ...deferred],
  });
  Object.assign(state, { awaiting: 'decisions', stopped: { reason: 'waiting', at: now() } });
}

function makeAttended(repository, state) {
  state.unattended = false;
  for (const item of state.open.filter((candidate) => candidate.note === UNATTENDED_FIX_NOTE)) {
    delete item.note;
    item.route = 'ask';
  }
  saveState(repository, state);
}

function isInProgress(state) {
  return UNFINISHED.includes(state.awaiting) || pendingDecisionIds(state).length > 0;
}

function resumeView(repository, state) {
  const openPath = repository.file(`round-${state.round}.open.json`);
  const fixing = state.awaiting === 'fix';
  const deciding = state.awaiting === 'decisions';
  const deferred = (state.deferred ?? []).filter((item) => !item.decision);
  const looping = state.open.filter((item) => item.decision !== 'keep');
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
    fix: fixing ? looping.filter((item) => routeOf(item) === 'fix') : [],
    ask: fixing ? looping.filter((item) => routeOf(item) === 'ask') : [],
    stillOpen: deciding ? [...state.open.filter((item) => !item.decision), ...deferred] : [],
    deferred,
    cards: deciding ? state.cards.filter((card) => !card.decision) : [],
    needsProof: state.awaiting === 'proof' ? needsProof(repository.root, state.resolved).map(proofTarget) : [],
    treeMatchesReview: snapshotTree(repository) === state.reviewedTree,
    ...featureMapFields(repository.root),
  };
}

function start(cwd, options) {
  const repository = openRepository(cwd);
  if (options.fresh) rmSync(repository.file('state.json'), { force: true });
  const existing = readSavedState(repository);
  const unattended = options.unattended === true || readUnattended(repository).enabled;
  if (existing && isInProgress(existing)) {
    stopIfProven(repository, existing);
    if (unattended) {
      makeUnattended(repository, existing);
    } else {
      makeAttended(repository, existing);
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
  logEvent(repository, { event: 'start', reviewedTree, unattended, checks: checkEvents(checks) });
  return {
    status: 'review', round: 1, maxRounds, unattended, reviewerModel, diffPath: repository.file('round-1.diff'),
    reviewPath: reviewPathFor(repository, 1), checks, ...leftOutField(state.checksLeftOut), ...featureMapFields(repository.root),
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
  const passedPrints = passedCheckPrints(repository.root, state.checks, state.files ?? []);
  const unverified = new Map(state.checks.filter(isNotVerified).map((check) => [checkFingerprint(check), check]));
  const resolvedIds = new Set(review.resolved ?? []);
  const isResolved = (item) => (item.fromChecks ? passedPrints.has(item.fingerprint) : resolvedIds.has(item.id) && !rerunBlocks(item));

  const previouslyDeferred = state.deferred ?? [];
  const resolved = previouslyDeferred.filter(isResolved);
  const carried = [];
  const keptInLoop = [];
  for (const item of state.open) {
    if (isResolved(item)) {
      resolved.push(item);
    } else if (item.decision === 'keep') {
      keptInLoop.push(item);
    } else {
      carried.push({ ...item, attempts: item.attempts + 1, note: carriedNote(item, state.checks, unverified, resolvedIds) });
    }
  }
  const stuck = carried.filter((item) => item.attempts >= 2);
  const retried = carried.filter((item) => item.attempts < 2);

  const sourcesFor = (finding) => evidenceSources(repository.root, finding, diffText);
  const keptBefore = keptSeverities(repository);
  const seenBefore = kindCounts(repository, { except: state.runId });
  const previouslyKept = state.kept ?? [];
  const undecidedCards = new Map(state.cards.filter((card) => !card.decision).map((card) => [card.fingerprint, card]));
  const decidedCards = state.cards.filter((card) => card.decision);
  const knownPrints = new Set([...state.open, ...previouslyDeferred, ...previouslyKept, ...decidedCards].map((item) => item.fingerprint));
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
  const allKept = [...previouslyKept, ...keptInLoop, ...kept];
  const trackedPrints = new Set([...state.open, ...previouslyDeferred, ...allKept].map((item) => item.fingerprint));
  const newChecks = failingChecks.filter((finding) => !trackedPrints.has(fingerprint(finding)));
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
  const unattendedFix = state.unattended
    ? needsYou.filter((item) => unattendedFixable(item, confirmSetting)).map((item) => ({ ...item, route: 'fix', note: UNATTENDED_FIX_NOTE }))
    : [];
  const fixedUnattended = new Set(unattendedFix.map((item) => item.id));
  const ask = state.unattended ? [] : needsYou;
  const deferred = state.unattended ? needsYou.filter((item) => !fixedUnattended.has(item.id)).map((item) => defer(item, confirmSetting)) : [];
  const allDeferred = [...previouslyDeferred.filter((item) => !resolved.includes(item)), ...deferred];
  // A card raised again stays as it is unless it is now blocking, in scope, or more severe; then the new finding replaces it.
  const repeatsCard = (item) => {
    const card = undecidedCards.get(item.fingerprint);
    return Boolean(card) && SEVERITIES.indexOf(item.severity) >= SEVERITIES.indexOf(card.severity) && (!card.outOfScope || Boolean(item.outOfScope));
  };
  const newCards = [...classified.cards, ...outsideCards];
  const cards = assignIds(newCards.filter((item) => !repeatsCard(item)));
  const keptCardPrints = new Set(newCards.filter(repeatsCard).map((item) => item.fingerprint));
  const replacedPrints = new Set(reported.map(fingerprint).filter((print) => undecidedCards.has(print) && !keptCardPrints.has(print)));
  const resolvedPrints = new Set(state.resolved.map((item) => item.fingerprint));
  const regressions = [...fix, ...newAsk].filter((item) => resolvedPrints.has(item.fingerprint));
  const open = [...fix, ...unattendedFix, ...ask, ...stuck];
  const counts = [...state.counts, open.length];
  // A regression test written after this review must fail on the code the fix started from.
  for (const item of resolved) item.beforeFixTree = state.beforeFixTree;
  const unproven = needsProof(repository.root, [...state.resolved, ...resolved]);
  const { decision, reason } = decideNext({
    round: state.round, maxRounds: state.maxRounds, counts, open: open.length, waiting: allDeferred.length,
    unproven: unproven.length, stuck, regressions,
  });
  const stopped = decision === 'stop';

  const allCards = [...state.cards.filter((card) => !replacedPrints.has(card.fingerprint)), ...cards];
  const reviewerModel = state.reviewerModel ?? 'inherit';
  const view = {
    round: state.round, maxRounds: state.maxRounds, reviewerModel, checks: state.checks, checksLeftOut: state.checksLeftOut, resolved,
    fix: stopped ? [] : [...fix, ...unattendedFix], ask: stopped ? [] : ask, stillOpen: stopped ? open : [],
    deferred: stopped ? allDeferred : deferred,
    regressions, cards: allCards, kept: allKept, counts, decision, reason, needsProof: reason === 'proof' ? unproven : [],
    looped: [...state.resolved, ...resolved, ...open, ...allDeferred], featureMap: readFeatureMap(repository.root),
  };
  const report = renderReport(view);
  Object.assign(state, {
    open,
    resolved: [...state.resolved, ...resolved],
    cards: allCards,
    deferred: allDeferred,
    kept: allKept,
    counts,
    resolvedInRound: resolved.map((item) => item.id),
    awaiting: { stop: 'decisions', continue: reason === 'proof' ? 'proof' : 'fix' }[decision],
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
    fix: view.fix, ask: view.ask, stillOpen: view.stillOpen, deferred, needsProof: view.needsProof.map(proofTarget),
    cards: stopped ? state.cards : [],
    reproducible: [...state.cards, ...state.open, ...(state.deferred ?? [])]
      .filter((item) => item.check && BLOCKING.has(item.severity) && !item.reproduced)
      .map((item) => item.id),
  };
}

function next(cwd, options = {}) {
  const repository = openRepository(cwd);
  const state = loadState(repository);
  if (state.awaiting === 'proof') {
    const stopped = stopIfProven(repository, state);
    if (stopped.decision === 'stop') return { status: 'stopped', ...stopped };
    if (state.awaiting === 'proof') {
      const ids = needsProof(repository.root, state.resolved).map((item) => item.id).join(', ');
      throw new Error(`record a regression test or a no-test reason for ${ids} with loop rule; the last one stops the loop`);
    }
  }
  if (state.awaiting !== 'fix') throw new Error(`expected ${state.awaiting}, not a fix`);
  const fixedTree = snapshotTree(repository);
  const unchanged = fixedTree === state.reviewedTree;
  if (unchanged && (typeof options.unchanged !== 'string' || !options.unchanged.trim())) {
    throw new Error(
      `nothing changed since round ${state.round}'s review; fix the findings, then run next, or run next --unchanged "<why>" when nothing should change`,
    );
  }
  const unchangedReason = unchanged ? { unchanged: options.unchanged } : {};
  const rechecked = [...state.open, ...(state.deferred ?? [])];
  for (const item of rechecked.filter((candidate) => candidate.reproduced)) {
    const rerun = verifyEvidence(repository, item.reproduced.check, fixedTree);
    const status = rerun?.status === 'pass' && rerun.changedAfterFail ? 'changed-after-fail' : rerun?.status;
    item.rerun = rerun ? { status, evidencePath: rerun.evidencePath } : { status: 'missing' };
  }
  const fixDiff = diffTrees(repository, state.reviewedTree, fixedTree);
  const nameStatus = diffTrees(repository, state.reviewedTree, fixedTree, '--name-status', '--no-renames');
  const integrity = findWeakening(fixDiff, nameStatus);
  state.round += 1;
  const diffPath = repository.file(`round-${state.round}.diff`);
  const openPath = repository.file(`round-${state.round}.open.json`);
  writeFileSync(diffPath, fixDiff);
  const openForReviewer = rechecked
    .filter((item) => !item.fromChecks && item.decision !== 'keep')
    .map(({ id, severity, file, line, title, quote, scenario }) => ({ id, severity, file, line, title, quote, scenario }));
  writeFileSync(openPath, JSON.stringify(openForReviewer, null, 2));

  if (integrity.length) {
    const report = renderReport({
      round: state.round, maxRounds: state.maxRounds, checks: null, stillOpen: state.open,
      integrity, cards: state.cards, kept: state.kept, counts: state.counts, decision: 'stop', reason: 'integrity',
      deferred: state.deferred ?? [], looped: [...state.resolved, ...state.open, ...(state.deferred ?? [])],
    });
    Object.assign(state, {
      checks: null, latestChecks: null, awaiting: 'decisions', stopped: { reason: 'integrity', at: now() }, lastReport: report,
    });
    saveState(repository, state);
    logEvent(repository, { event: 'next', round: state.round, decision: 'stop', reason: 'integrity', integrity, ...unchangedReason });
    return { report, status: 'stopped', reason: 'integrity', integrity, stillOpen: state.open, cards: state.cards };
  }

  const fixedFiles = filesBetween(repository, state.reviewedTree, fixedTree);
  const reviewedFiles = [...new Set([...(state.reviewedFiles ?? state.files ?? []), ...fixedFiles])];
  Object.assign(state, {
    beforeFixTree: state.reviewedTree, reviewedTree: fixedTree, files: fixedFiles, reviewedFiles, checks: null, awaiting: 'review',
    reviewerModel: readReviewerModel(repository),
  });
  saveState(repository, state);
  const checks = runRoundChecks(repository, state);
  logEvent(repository, { event: 'next', round: state.round, fixedTree, changedFiles: state.files, ...unchangedReason });
  return {
    status: 'review', round: state.round, maxRounds: state.maxRounds, reviewerModel: state.reviewerModel, diffPath, openPath,
    reviewPath: reviewPathFor(repository, state.round), checks, ...leftOutField(state.checksLeftOut),
    ...featureMapFields(repository.root),
  };
}

function decide(cwd, options) {
  const repository = openRepository(cwd);
  const state = loadState(repository);
  const item = decidableFindings(state).find((candidate) => candidate.id === options.id);
  if (!item) throw new Error(`no finding with id ${options.id}`);
  if (!DECISION_CHOICES.includes(options.choice)) throw new Error(`choice must be one of ${DECISION_CHOICES.join(', ')}`);
  const nothingRunsRules = options.choice === 'rule'
    && !selectChecks(repository.root, [projectFileOf(item)]).checks.some((check) => check.command);
  const choice = nothingRunsRules ? 'once' : options.choice;
  item.decision = choice;
  if (choice === 'rule') item.rule = { beforeTree: state.reviewedTree };
  saveState(repository, state);
  const ruleFields = choice === 'rule' ? { category: item.category, quote: item.quote, scenario: item.scenario } : {};
  logEvent(repository, { event: 'decision', ...summarize(item), choice, fingerprint: item.fingerprint, ...ruleFields });
  const result = { recorded: true, id: item.id, choice, pending: pendingDecisionIds(state) };
  if (nothingRunsRules) result.ruleSkipped = 'the project has no typecheck, lint, or test script or target, so nothing would run a rule';
  return result;
}

function reproduce(cwd, options) {
  const repository = openRepository(cwd);
  const state = loadState(repository);
  const item = decidableFindings(state).find((candidate) => candidate.id === options.id);
  if (!item) throw new Error(`no finding with id ${options.id}`);
  const { check } = item;
  if (!check) throw new Error(`${item.id} has no check: the reviewer names one only for a P1 or P2 that breaks a feature in ${FEATURE_MAP}`);
  if (!readFeatureMap(repository.root)?.ids.includes(check)) throw new Error(`${item.id} names check ${check}, which is not an id in ${FEATURE_MAP}`);
  const run = verifyEvidence(repository, check, state.reviewedTree);
  if (!run) {
    throw new Error(`no verify run of ${check} on the reviewed code: run the verify skill's \`run --id ${check}\` before changing any file, then run reproduce again`);
  }
  const { status, reasons, evidencePath } = run;
  const lines = [`${item.id} [${item.severity}] ${location(item)} ${item.title}`];
  if (status === 'fail') {
    item.reproduced = { check, evidencePath, reasons, tree: state.reviewedTree };
    delete item.notReproduced;
    delete item.unproven;
    lines.push(`  reproduced: verify check ${check} failed (${evidencePath})`, ...reasons.map((line) => `  - ${line}`));
  } else if (status === 'pass' && item.reproduced) {
    const where = item.reproduced.tree === state.reviewedTree ? 'on the same code' : 'on code that changed since';
    lines.push(`  verify check ${check} passed (${evidencePath}) ${where} an earlier run failed on (${item.reproduced.evidencePath}); the failure stays recorded`);
  } else if (status === 'pass') {
    item.notReproduced = { check, evidencePath };
    lines.push(`  not reproduced: verify check ${check} passed (${evidencePath}); the finding stays as it is, the check may not cover its scenario`);
  } else {
    lines.push(`  not checked: verify check ${check} was not verified (${evidencePath}), nothing recorded`, ...reasons.map((line) => `  - ${line}`));
  }
  saveState(repository, state);
  logEvent(repository, { event: 'reproduce', ...summarize(item), check, status, evidencePath });
  return { report: lines.join('\n'), id: item.id, check, status, reasons, evidencePath };
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
      writeFileSync(target, git(['cat-file', 'blob', `${tree}:${draft}`], {
        cwd: repository.root, encoding: 'buffer', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
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

function inTreeCopy(repository, tree, files, run) {
  const folder = mkdtempSync(path.join(tmpdir(), 'review-loop-rule-'));
  try {
    checkoutTree(repository, tree, folder);
    for (const project of checkedFolders(repository.root, files)) {
      const modules = path.join(repository.root, project, 'node_modules');
      const target = path.join(folder, project, 'node_modules');
      if (existsSync(modules) && existsSync(path.dirname(target)) && !existsSync(target)) symlinkSync(modules, target, 'junction');
    }
    return run(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function checkRule(repository, beforeTree, drafts, files) {
  const deadline = Date.now() + CHECKS_BUDGET_MS;
  return inTreeCopy(repository, beforeTree, files, (folder) => {
    copyDrafts(repository.root, folder, drafts);
    const withDrafts = runChecks(folder, repository.file('rule.checks.log'), selectChecks(folder, files).checks, deadline);
    const failing = withDrafts.filter((check) => !isNotVerified(check) && check.exitCode !== 0).map(checkId);
    if (!failing.length) {
      return { proof: withDrafts.some(isNotVerified) ? 'unproven' : 'missed', caughtBy: [], withDrafts, withoutDrafts: [] };
    }
    restoreDrafts(repository, beforeTree, folder, drafts);
    const baseline = selectChecks(folder, files).checks.filter((check) => failing.includes(checkId(check)));
    const withoutDrafts = runChecks(folder, repository.file('rule.baseline.log'), baseline, deadline);
    const passedWithout = (id) => {
      const check = withoutDrafts.find((candidate) => checkId(candidate) === id);
      return !check || (!isNotVerified(check) && check.exitCode === 0);
    };
    const caughtBy = failing.filter(passedWithout);
    return { proof: caughtBy.length ? 'caught' : 'unproven', caughtBy, withDrafts, withoutDrafts };
  });
}

// True when every failing check passes on the same tree with the new drafts taken back out, so the drafts broke it.
function failsOnlyWithDrafts(repository, tree, { reviewedTree, drafts, files, failing }) {
  return inTreeCopy(repository, tree, files, (folder) => {
    restoreDrafts(repository, reviewedTree, folder, drafts);
    const ids = failing.map(checkId);
    const selected = selectChecks(folder, files).checks.filter((check) => ids.includes(checkId(check)));
    const withoutDrafts = runChecks(folder, repository.file('final.baseline.log'), selected);
    return ids.every((id) => {
      const check = withoutDrafts.find((candidate) => checkId(candidate) === id);
      return !check || (!isNotVerified(check) && check.exitCode === 0);
    });
  });
}

function isBeingFixed(state, item) {
  if (!BLOCKING.has(item.severity) || item.fromChecks) return false;
  // A fix can also resolve a deferred finding, which then needs the same proof as the findings it was meant for.
  return (state.awaiting === 'fix' && [...state.open, ...(state.deferred ?? [])].includes(item))
    || item.decision === 'once' || (state.awaiting === 'proof' && state.resolved.includes(item));
}

// A draft proves the fix only when the test check fails with it on the code before the fix and passes on the code after.
function hasRegressionProof({ regression }) {
  if (!regression) return false;
  if (!regression.drafts) return true;
  const onlyOtherChecksCaught = regression.proof === 'unproven' && regression.caughtBy?.length > 0;
  return regression.proof !== 'missed' && !onlyOtherChecksCaught && !regression.failedOnFixedCode;
}

function needsProof(root, resolved) {
  return resolved.filter((item) => BLOCKING.has(item.severity) && !item.fromChecks && !hasRegressionProof(item)
    && selectChecks(root, [item.file]).checks.some((check) => check.name === 'test'));
}

const proofTarget = ({ id, severity, file, line, title, quote, scenario }) => ({ id, severity, file, line, title, quote, scenario });

function stopIfProven(repository, state) {
  if (state.awaiting !== 'proof' || needsProof(repository.root, state.resolved).length) return {};
  const tree = snapshotTree(repository);
  const drafts = state.resolved.flatMap((item) => item.regression?.drafts ?? []);
  const files = [...(state.reviewedFiles ?? state.files ?? []), ...drafts];
  const { checks, leftOut } = runFinalChecks(repository, state, files);
  logEvent(repository, { event: 'checks', tree, checks: checkEvents(checks) });
  const failing = checks.filter((check) => !isNotVerified(check) && check.exitCode !== 0);
  if (failing.length) {
    const unreviewed = new Set(filesBetween(repository, state.reviewedTree, tree));
    const newDrafts = drafts.filter((draft) => unreviewed.has(draft));
    const failedOnFixedCode = failing.map(checkId);
    const blamed = newDrafts.some((draft) => failing.some((check) => coversDraft(check, draft)))
      && failsOnlyWithDrafts(repository, tree, { reviewedTree: state.reviewedTree, drafts: newDrafts, files, failing });
    const failed = blamed ? state.resolved.filter((item) => (item.regression?.drafts ?? [])
      .some((draft) => newDrafts.includes(draft) && failing.some((check) => coversDraft(check, draft)))) : [];
    for (const item of failed) item.regression.failedOnFixedCode = failedOnFixedCode;
    // A failure no new test explains comes from other changes, so the next round reviews them and turns it into a finding.
    if (!failed.length) state.awaiting = 'fix';
    saveState(repository, state);
    return {
      decision: 'continue', reason: state.awaiting, checks, failedOnFixedCode,
      needsProof: needsProof(repository.root, state.resolved).map(proofTarget),
    };
  }
  const resolvedInRound = new Set(state.resolvedInRound);
  const report = renderReport({
    round: state.round, maxRounds: state.maxRounds, reviewerModel: state.reviewerModel ?? 'inherit', checks,
    checksLeftOut: leftOut, resolved: state.resolved.filter((item) => resolvedInRound.has(item.id)), cards: state.cards,
    kept: state.kept, counts: state.counts, decision: 'stop', reason: 'clean', looped: state.resolved,
    featureMap: readFeatureMap(repository.root),
  });
  Object.assign(state, { awaiting: 'decisions', stopped: { reason: 'clean', at: now() }, lastReport: report });
  saveState(repository, state);
  logEvent(repository, { event: 'stop', round: state.round, decision: 'stop', reason: 'clean' });
  return { decision: 'stop', reason: 'clean', report, cards: state.cards, checks };
}

function isTestCheck(id) {
  return id === 'test' || id.endsWith(':test');
}

function proveRegression({ proof, caughtBy }) {
  if (proof !== 'caught' || caughtBy.some(isTestCheck)) return { proof };
  return { proof: 'unproven', reason: `only ${caughtBy.join(' and ')} failed with the draft on the code before the fix, the test check did not fail` };
}

const coversDraft = (check, draft) => !check.folder || draft.startsWith(`${check.folder}/`);

function describeRegressionTest(item, checks) {
  if (!BLOCKING.has(item.severity) || item.fromChecks) return [];
  const { drafts, proof, reason } = item.regression ?? {};
  if (drafts) {
    const test = checks?.findLast((check) => check.name === 'test' && drafts.some((draft) => coversDraft(check, draft)));
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

// A finding resolved before the loop kept the code before the fix still has the code it was raised on.
function raisedOnTree(repository, round) {
  const entry = eventsSinceStart(repository)
    .find((candidate) => (round === 1 ? candidate.event === 'start' : candidate.event === 'next' && candidate.round === round));
  return entry?.reviewedTree ?? entry?.fixedTree ?? null;
}

function rule(cwd, options) {
  const repository = openRepository(cwd);
  const state = loadState(repository);
  const item = [...decidableFindings(state), ...state.resolved].find((candidate) => candidate.id === options.id);
  if (!item) throw new Error(`no finding with id ${options.id}`);
  const kind = item.decision === 'rule' ? 'rule' : 'regression';
  if (kind === 'regression' && !isBeingFixed(state, item)) {
    if (state.stopped && state.resolved.includes(item)) throw new Error(`${item.id} was resolved and the loop has stopped, its regression test can no longer change`);
    throw new Error(`${item.id} is not marked as a rule, and it is not a P1 or P2 that is being fixed, run decide --choice rule first`);
  }
  if (options['no-test'] !== undefined) {
    if (kind === 'rule') throw new Error(`${item.id} is marked as a rule, --no-test is for a P1 or P2 fixed without a regression test`);
    return { ...recordNoTest(repository, state, item, options['no-test']), ...stopIfProven(repository, state) };
  }
  if (kind === 'regression' && !normalize(item.scenario)) {
    throw new Error(`${item.id} has no scenario to write a regression test from, record why with --no-test "<reason>"`);
  }
  const drafts = [options.draft].flat().filter((draft) => typeof draft === 'string').map((draft) => repositoryPath(repository.root, draft));
  const files = [projectFileOf(item), ...drafts];
  if (kind === 'regression' && !selectChecks(repository.root, files).checks.some((check) => check.name === 'test')) {
    throw new Error('the project has no test script or target, so a regression test would not run, record that with --no-test');
  }
  if (!drafts.length) throw new Error('name the rule draft files with --draft <path>');
  for (const draft of drafts) {
    if (draft.startsWith('../') || draft === '..') throw new Error(`${draft} is outside the repository`);
    if (draft === item.file) throw new Error(`${draft} is the file the finding is in, a draft is a lint config, a lint rule, or a test`);
    if (!existsSync(path.join(repository.root, draft))) throw new Error(`${draft} does not exist`);
    if (isIgnored(repository, draft)) throw new Error(`${draft} is ignored by git, so it would not be committed with the rule`);
  }
  const beforeTree = item[kind]?.beforeTree ?? item.beforeFixTree
    ?? (state.resolved.includes(item) ? raisedOnTree(repository, item.round) : null) ?? state.reviewedTree;
  const checked = checkRule(repository, beforeTree, drafts, files);
  const { caughtBy, withDrafts, withoutDrafts } = checked;
  const { proof, reason } = kind === 'regression' ? proveRegression(checked) : checked;
  const hashes = Object.fromEntries(drafts.map((draft) => [draft, hashFile(repository, draft)]));
  item[kind] = { beforeTree, drafts, hashes, proof, caughtBy, reason };
  saveState(repository, state);
  logEvent(repository, {
    event: kind, ...summarize(item), category: item.category, quote: item.quote, scenario: item.scenario,
    fingerprint: item.fingerprint, drafts, proof, caughtBy, reason,
  });
  return { id: item.id, kind, proof, reason, caughtBy, withDrafts, withoutDrafts, ...stopIfProven(repository, state) };
}

function runFinalChecks(repository, state, files) {
  const selected = selectChecks(repository.root, files);
  const checks = runChecks(repository.root, repository.file('final.checks.log'), selected.checks);
  if (state) saveState(repository, Object.assign(state, { latestChecks: checks }));
  return { checks, leftOut: selected.leftOut };
}

function rerunChecks(cwd) {
  const repository = openRepository(cwd);
  const state = readJson(repository.file('state.json'), null);
  const tree = snapshotTree(repository);
  let checks;
  let leftOut;
  if (state?.awaiting === 'review') {
    checks = runRoundChecks(repository, state);
    leftOut = state.checksLeftOut;
  } else {
    ({ checks, leftOut } = runFinalChecks(repository, state, state?.reviewedFiles ?? state?.files ?? []));
  }
  logEvent(repository, { event: 'checks', tree, checks: checkEvents(checks) });
  return {
    checks,
    ...leftOutField(leftOut),
    passed: checks.every((check) => check.exitCode === 0),
    notVerified: checks.filter(isNotVerified).map(checkId),
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
  if (state?.awaiting !== 'fix') return { ...readConfirm(repository), rerouted };
  state.open = state.open.map((item) => {
    if (routeOf(item) !== 'fix' || !CONFIRM_LEVELS[severity].includes(item.severity)) return item;
    rerouted.push(item.id);
    return { ...item, route: 'ask' };
  });
  if (state.unattended) return { ...readConfirm(repository), rerouted: [], deferred: makeUnattended(repository, state) };
  if (rerouted.length) saveState(repository, state);
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
    makeAttended(repository, state);
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

function readHeredocStart(command, start) {
  let index = start;
  const stripsTabs = command[index] === '-';
  if (stripsTabs) index += 1;
  while (' \t'.includes(command[index] ?? '\n')) index += 1;
  let delimiter = '';
  let quote = null;
  for (; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) quote = null;
      else delimiter += char;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === '\\') {
      delimiter += command[index + 1] ?? '';
      index += 1;
    } else if (/[\s;&|<>()]/.test(char)) {
      break;
    } else {
      delimiter += char;
    }
  }
  return { delimiter, stripsTabs, end: index };
}

function heredocEnd(command, start, { delimiter, stripsTabs }) {
  for (let index = start; index < command.length;) {
    const lineEnd = command.includes('\n', index) ? command.indexOf('\n', index) : command.length;
    const line = command.slice(index, lineEnd).replace(stripsTabs ? /^\t+/ : /^$/, '');
    if (line === delimiter) return lineEnd;
    index = lineEnd + 1;
  }
  return command.length;
}

// The shell reads (( or $(( as arithmetic only when the paren that closes it is followed by a second ); otherwise
// the parens open subshells, as in $((git commit); true).
function arithmeticEnd(command, start) {
  const open = command[start] === '$' ? start + 1 : start;
  if (!command.startsWith('((', open)) return -1;
  let depth = 0;
  for (let index = open; index < command.length; index += 1) {
    if (command[index] === '(') depth += 1;
    else if (command[index] === ')' && --depth === 1) return command[index + 1] === ')' ? index + 1 : -1;
  }
  return -1;
}

function scanShell(command) {
  const segments = [];
  let pending = [];
  let words = [];
  let word = '';
  let started = false;
  let quote = null;
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
    } else if (char === '#' && !started) {
      const lineEnd = command.indexOf('\n', index);
      index = (lineEnd === -1 ? command.length : lineEnd) - 1;
    } else if ((char === '$' || !started) && arithmeticEnd(command, index) !== -1) {
      const end = arithmeticEnd(command, index);
      word += command.slice(index, end + 1);
      started = true;
      index = end;
    } else if (';&|\n()'.includes(char)) {
      if ('()'.includes(char)) grouped = true;
      endSegment();
      // A heredoc body starts on the line after its << and is text for the command, not commands of its own.
      if (char === '\n' && pending.length) {
        index = pending.reduce((end, start) => heredocEnd(command, end + 1, start), index) - 1;
        pending = [];
      }
    } else if (/\s/.test(char)) {
      endWord();
    } else if (char === '<' && next === '<' && command[index + 2] !== '<') {
      endWord();
      const start = readHeredocStart(command, index + 2);
      pending.push(start);
      index = start.end - 1;
    } else if (char === '<' && next === '<') {
      word += '<<<';
      started = true;
      index += 2;
    } else {
      word += char;
      started = true;
    }
  }
  endSegment();
  return { segments, grouped };
}

const MAX_LOCATIONS = 16;

function limitLocations(locations) {
  const unique = [...new Set(locations)];
  return unique.length > MAX_LOCATIONS ? [...unique.slice(0, MAX_LOCATIONS - 1), null] : unique;
}

// Git Bash, the shell Claude Code uses on Windows, names drive C: as /c.
const fromShell = (target) => (WINDOWS ? target.replace(/^\/([A-Za-z])(?=\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`) : target);

function resolveDirectory(base, target) {
  if (target === '-') return null;
  const expanded = fromShell(target.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, process.env.HOME || homedir()));
  if (/[$`*?]/.test(expanded)) return null;
  if (path.isAbsolute(expanded)) return path.resolve(expanded);
  return base === null ? null : path.resolve(base, expanded);
}

const SHELL_KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', 'time', 'function']);
const DIRECTORY_COMMANDS = new Set(['cd', 'pushd', 'popd']);
// Programs that print or search text, so a git commit or push named in them is only text, unless an option below
// makes them run a program. gh runs any name outside its own commands as an alias, which can be a shell command.
const INERT_COMMANDS = new Set(['echo', 'printf', 'cat', 'grep', 'rg', 'man', 'gh']);
const RUNS_PROGRAM = { man: /^(?:-[A-Za-z]*[PH]|--pager|--html)/, rg: /^--pre(?:=|$)/ };
const GH_COMMANDS = new Set(['pr', 'issue', 'repo', 'release', 'api', 'run', 'workflow', 'search', 'browse', 'gist', 'label', 'status', 'project']);

function isInert([program, ...args]) {
  if (!INERT_COMMANDS.has(program)) return false;
  if (program === 'gh') return GH_COMMANDS.has(args[0]);
  return !args.some((arg) => RUNS_PROGRAM[program]?.test(arg));
}

function commandStart(words) {
  let index = 0;
  while (SHELL_KEYWORDS.has(words[index])) {
    const keyword = words[index];
    index += keyword === 'function' ? 2 : 1;
    if (keyword === 'time') while (words[index]?.startsWith('-')) index += 1;
  }
  return index;
}

const GLOBAL_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix', '--attr-source']);

function directoryTarget([name, ...operands]) {
  if (name === 'popd') return null;
  while (/^-[LPe@]+$/.test(operands[0] ?? '')) operands.shift();
  if (operands[0] === '--') operands.shift();
  if (!operands.length) return name === 'cd' ? '~' : null;
  if (operands.length > 1 || /^[-+]./.test(operands[0])) return null;
  return operands[0];
}

// A git dir named .git belongs to the folder around it; the null keeps a commit pointed this way from being approved.
function pointedLocations(targets, directories) {
  const folders = targets.flatMap((target) => directories.map((base) => {
    const folder = base === null ? null : resolveDirectory(base, target);
    return folder && path.basename(folder) === '.git' ? path.dirname(folder) : folder;
  }));
  return limitLocations([...folders, null]);
}

function readGitWords(words, gitIndex, locations) {
  const pointedAt = words.slice(0, gitIndex).flatMap((word) => word.match(/^GIT_(?:DIR|WORK_TREE)=(.*)$/s)?.[1] ?? []);
  const globals = [];
  let directories = locations;
  let index = gitIndex + 1;
  while (index < words.length && words[index].startsWith('-')) {
    const option = words[index];
    const [name, attached] = option.split(/=(.*)/s);
    const width = GLOBAL_OPTIONS_WITH_VALUE.has(option) ? 2 : 1;
    const value = width === 2 ? words[index + 1] : attached;
    if (option === '-C') {
      directories = limitLocations(directories.map((base) => resolveDirectory(base, value ?? '.')));
    } else {
      globals.push(...words.slice(index, index + width));
      if (['--git-dir', '--work-tree'].includes(name)) pointedAt.push(value ?? '');
    }
    index += width;
  }
  if (pointedAt.length) directories = pointedLocations(pointedAt, directories);
  return words[index] ? { subcommand: words[index], args: words.slice(index + 1), directories, globals } : null;
}

// Finds git where the shell runs a program: after shell keywords and variable assignments. A git word anywhere
// else, as in `echo git commit` or `sudo git commit`, is left to the text check in gateDecision.
function readCommand(command, cwd) {
  const invocations = [];
  let locations = [cwd];
  const folders = new Set(locations);
  const { segments, grouped } = scanShell(command);
  const branching = grouped || segments.some((words) => SHELL_KEYWORDS.has(words[0]));
  for (const words of segments) {
    let index = commandStart(words);
    if (DIRECTORY_COMMANDS.has(words[index])) {
      const target = directoryTarget(words.slice(index));
      const targets = locations.map((base) => (target === null ? null : resolveDirectory(base, target)));
      locations = limitLocations(branching ? [...locations, ...targets] : targets);
      locations.forEach((location) => folders.add(location));
      continue;
    }
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] ?? '')) index += 1;
    const invocation = path.basename(words[index] ?? '') === 'git' ? readGitWords(words, index, locations) : null;
    if (invocation) {
      invocations.push(invocation);
      invocation.directories.forEach((directory) => folders.add(directory));
    }
  }
  return { invocations, folders: [...folders] };
}

export function gitInvocations(command, cwd = process.cwd()) {
  return readCommand(String(command ?? ''), cwd).invocations;
}

// The only commands review-loop may approve on its own: git and cd steps joined by &&, ;, or a newline, every word
// plain or quoted text. A redirect, pipe, variable, glob, or substitution is outside it, so it can never be approved.
const PLAIN_GAP = /[ \t]+|&&|;|\n/y;
const PLAIN_TEXT = /[\w./:=@%+,^~-]+/y;
const SINGLE_QUOTED = /'[^']*'/y;
const ANSI_C_QUOTED = /\$'(?:[^'\\]|\\['\\])*'/y;

function readDoubleQuoted(command, start) {
  let text = '';
  for (let index = start + 1; index < command.length; index += 1) {
    const char = command[index];
    const heredoc = char === '$' ? readQuotedHeredoc(command, index) : null;
    if (char === '"') return { text, end: index + 1 };
    if (char === '\\' && (command[index + 1] === '\n' || DOUBLE_QUOTE_ESCAPES.includes(command[index + 1]))) {
      if (command[index + 1] !== '\n') text += command[index + 1];
      index += 1;
    } else if (heredoc) {
      text += heredoc.output;
      index += heredoc.length - 1;
    } else if ('$`'.includes(char)) {
      return null;
    } else {
      text += char;
    }
  }
  return null;
}

function plainSteps(command) {
  const steps = [[]];
  let word = null;
  let index = 0;
  const take = (pattern) => {
    pattern.lastIndex = index;
    const match = pattern.exec(command)?.[0] ?? null;
    if (match !== null) index = pattern.lastIndex;
    return match;
  };
  while (index < command.length) {
    const gap = take(PLAIN_GAP);
    if (gap !== null) {
      if (word !== null) steps.at(-1).push(word);
      word = null;
      if (!/^[ \t]/.test(gap)) steps.push([]);
      continue;
    }
    // The shell expands ~ and, in zsh, = at the start of a word.
    if (word === null && '~='.includes(command[index])) return null;
    const quoted = command[index] === '"' ? readDoubleQuoted(command, index) : null;
    if (quoted) index = quoted.end;
    const piece = quoted?.text
      ?? take(SINGLE_QUOTED)?.slice(1, -1)
      ?? take(ANSI_C_QUOTED)?.slice(2, -1).replace(/\\(.)/g, '$1')
      ?? take(PLAIN_TEXT);
    if (piece === null) return null;
    word = (word ?? '') + piece;
  }
  if (word !== null) steps.at(-1).push(word);
  return steps.filter((step) => step.length);
}

function readPlainCommand(command, cwd) {
  const steps = plainSteps(command);
  if (!steps?.length) return null;
  const invocations = [];
  let location = cwd;
  for (const [program, ...words] of steps) {
    if (program === 'cd' && words.length === 1 && !words[0].startsWith('-')) {
      location = path.resolve(location, fromShell(words[0]));
      continue;
    }
    if (program !== 'git') return null;
    const pointed = words[0] === '-C';
    const directory = pointed ? path.resolve(location, fromShell(words[1] ?? '')) : location;
    const [subcommand, ...args] = pointed ? words.slice(2) : words;
    if (!subcommand || subcommand.startsWith('-')) return null;
    invocations.push({ subcommand, args, directories: [directory], globals: [] });
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

// A commit records the index as it is, unless -a or paths without --include take the content from the working files.
// A word after a long option without = may be its value, so it is not read as a path and the index stays checked.
function commitsIndex(args) {
  let all = false;
  let include = false;
  let paths = false;
  let valueNext = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      paths ||= index + 1 < args.length;
      break;
    }
    const wasValue = valueNext;
    valueNext = false;
    if (arg === '--all') all = true;
    else if (arg === '--include') include = true;
    else if (arg.startsWith('--pathspec-from-file')) paths = true;
    else if (arg.startsWith('--')) valueNext = !arg.includes('=');
    else if (/^-[A-Za-z]/.test(arg)) {
      for (const letter of arg.slice(1)) {
        if (REQUIRED_VALUE_LETTERS.has(letter) || ATTACHED_VALUE_LETTERS.has(letter)) break;
        if (letter === 'a') all = true;
        if (letter === 'i') include = true;
      }
      valueNext = readCluster(arg).takesNextWord;
    } else if (!wasValue) paths = true;
  }
  return !all && (include || !paths);
}

function commitVerdict(repository, { args }, gateSettings, stagedInCommand = 'none') {
  const result = reviewVerdict(repository, gateSettings, commitsIndex(args) ? stagedInCommand : 'all');
  if (!skipsHooks(args) || result.decision === 'deny') return result;
  return verdict('ask', `${result.reason} The commit also skips git hooks with --no-verify. Confirm before Claude runs it.`);
}

function reviewVerdict(repository, gateSettings, stagedInCommand) {
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
  const unproven = state.awaiting === 'proof' ? needsProof(repository.root, state.resolved) : [];
  if (unproven.length) {
    const ids = unproven.map((item) => item.id).join(', ');
    return verdict('deny', `review-loop: ${ids} were resolved without a regression test or a no-test reason. Record one with loop rule as ${REVIEW_COMMAND} says before committing.`);
  }
  if (UNFINISHED.includes(state.awaiting)) {
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
  const staged = stagedInCommand === 'all' ? state.reviewedTree : stagedTree(repository);
  if (staged !== state.reviewedTree) {
    // The index after a partial git add is unknown here, since the gate runs before the command.
    if (stagedInCommand === 'some') {
      return verdict('ask', 'review-loop: a git add earlier in this command stages only some paths, so the commit may record only part of the reviewed change. Stage everything with git add -A, or confirm before Claude runs it.');
    }
    if (staged === null) {
      return verdict('deny', `review-loop: could not read the staged content, and git commit records it. If a merge or rebase left conflicts, resolve the conflicts and stage the result, then commit again, or run ${REVIEW_COMMAND} again.`);
    }
    // With nothing staged, git commit records nothing, so only a staged tree with changes can differ from the review.
    if (staged !== state.baseTree) {
      const files = filesBetween(repository, state.reviewedTree, staged);
      const named = files.length ? ` (${files.join(', ')})` : '';
      return verdict('deny', `review-loop: the staged content${named} differs from what was reviewed, and git commit records the staged content. Stage everything with git add -A, or run ${REVIEW_COMMAND} again.`);
    }
  }
  if (delegated) return verdict('allow', 'review-loop: the review passed and commits are delegated in this repository.');
  return verdict('ask', 'review-loop: the review passed with no open P1 or P2. Commit now?');
}

const SAFE_GIT_SUBCOMMANDS = new Set(['add', 'commit', 'status', 'diff', 'log', 'show']);

// git accepts any unambiguous prefix of a long option, so --out works like --output.
function writesFile(arg) {
  const name = /^--([^=]+)/.exec(arg)?.[1];
  return Boolean(name) && name.length > 1 && 'output'.startsWith(name);
}

const approvable = ({ subcommand, globals, args }) => SAFE_GIT_SUBCOMMANDS.has(subcommand) && !globals.length && !args.some(writesFile);
const GIT_WORD = /(?<![\w.-])git(?![\w-])/;
const GATED_WORD = /(?<![\w./-])(?:commit|push)(?![\w./-])/;
const GIT_AND_FOLLOWING_WORDS = /(?<![\w.-])(["']?)git\1(?![\w-])((?:[ \t]+[^\s;&|()<>`]+)*)/g;
// Git ignores an alias that shares a command's name, so these words never need an alias lookup.
const GIT_COMMANDS = new Set([
  'add', 'am', 'apply', 'archive', 'bisect', 'blame', 'branch', 'cat-file', 'checkout', 'cherry-pick', 'clean', 'clone',
  'commit', 'config', 'describe', 'diff', 'fetch', 'for-each-ref', 'format-patch', 'gc', 'grep', 'help', 'init', 'log',
  'ls-files', 'ls-remote', 'ls-tree', 'merge', 'merge-base', 'mv', 'notes', 'pull', 'push', 'rebase', 'reflog', 'remote',
  'reset', 'restore', 'rev-list', 'rev-parse', 'revert', 'rm', 'shortlog', 'show', 'show-ref', 'stash', 'status',
  'submodule', 'switch', 'symbolic-ref', 'tag', 'version', 'worktree',
]);

function inGatedRepository(folder) {
  const repository = folder && findRepository(folder);
  return Boolean(repository && readGate(repository).enabled);
}

function aliasCandidates(command) {
  // Quotes become spaces, so a word that closes a quoted command, as in sh -c "git ci", is still a word.
  const unquoted = command.replace(/["']/g, ' ');
  const names = [...unquoted.matchAll(GIT_AND_FOLLOWING_WORDS)].map(([, , following]) => {
    const words = following.trim().split(/\s+/);
    let index = 0;
    while (words[index]?.startsWith('-')) index += GLOBAL_OPTIONS_WITH_VALUE.has(words[index]) ? 2 : 1;
    return words[index];
  });
  return [...new Set(names)].filter((name) => /^[\w-]+$/.test(name ?? '') && !GIT_COMMANDS.has(name));
}

function runsGatedAlias(name, folder) {
  const expanded = expandAlias({ subcommand: name, args: [], directories: ['.'], globals: [] }, (alias) => aliasOf(folder, alias));
  return GATED_SUBCOMMANDS.includes(expanded.subcommand) || Boolean(expanded.shellAlias);
}

// Reads the raw text, not the parse, so a shell form the parser misreads still reaches the question. Only cd steps
// and programs that print text, with plain or quoted words, are left alone.
function unreadVerdict(command, folders) {
  if (!GIT_WORD.test(command)) return null;
  const namesGated = GATED_WORD.test(command);
  const aliases = namesGated ? [] : aliasCandidates(command);
  if (!namesGated && !aliases.length) return null;
  if (plainSteps(command)?.every((step) => step[0] === 'cd' || isInert(step))) return null;
  const gated = [...new Set(folders)].filter(inGatedRepository);
  if (!gated.length) return null;
  if (!namesGated && !gated.some((folder) => aliases.some((name) => runsGatedAlias(name, folder)))) return null;
  return verdict('ask', 'review-loop: this command names git and commit or push, or an alias for them, in a form the commit gate cannot read, so it cannot check it. Confirm before Claude runs it.');
}

// An allow skips Claude Code's own permission prompt, so only a command readPlainCommand reads in full can get one.
// A deny needs a commit found where the shell runs git. Anything else that names git and commit or push is asked about.
export function gateDecision({ cwd, command, projectDir }) {
  const text = String(command ?? '');
  const sessionFolders = [...new Set([cwd, projectDir].filter(Boolean))];
  const plain = readPlainCommand(text, cwd);
  const read = readCommand(text, cwd);
  const invocations = (plain ?? read.invocations).map(resolveInvocation);
  const strictest = gateVerdicts(invocations, sessionFolders)[0] ?? null;
  if (plain && invocations.every(approvable)) return strictest;
  if (!strictest) return unreadVerdict(text, [...sessionFolders, ...read.folders]);
  if (strictest.decision !== 'allow') return strictest;
  return verdict('ask', `${strictest.reason} The command does more than plain git add, commit, status, diff, log, or show and cd steps, so review-loop does not approve it on its own.`);
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

const GATED_SUBCOMMANDS = ['commit', 'push'];
const ALIAS_DEPTH = 5;

function aliasOf(directory, name) {
  try {
    return git(['config', '--get', `alias.${name}`], { cwd: directory, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function expandAlias(invocation, lookup, depth = 0) {
  let { subcommand, args, directories } = invocation;
  const aliasGlobals = [];
  const seen = new Set();
  while (depth < ALIAS_DEPTH && !GATED_SUBCOMMANDS.includes(subcommand) && !seen.has(subcommand)) {
    seen.add(subcommand);
    depth += 1;
    const expansion = lookup(subcommand);
    if (!expansion) break;
    if (expansion.startsWith('!')) {
      const body = expansion.slice(1);
      const named = GATED_SUBCOMMANDS.find((name) => new RegExp(`\\b${name}\\b`).test(body));
      const throughAlias = gitInvocations(body, '.')
        .map((inner) => expandAlias(inner, lookup, depth))
        .find((inner) => GATED_SUBCOMMANDS.includes(inner.subcommand) || inner.shellAlias);
      const mentions = named ?? throughAlias?.subcommand ?? throughAlias?.shellAlias?.mentions;
      return mentions ? { ...invocation, shellAlias: { name: invocation.subcommand, expansion, mentions } } : invocation;
    }
    const [expanded] = gitInvocations(`git ${expansion}`, '.');
    if (!expanded) break;
    if (expanded.directories.length !== 1 || expanded.directories[0] !== '.') directories = [null];
    subcommand = expanded.subcommand;
    args = [...expanded.args, ...args];
    aliasGlobals.push(...expanded.globals);
  }
  if (!GATED_SUBCOMMANDS.includes(subcommand)) return invocation;
  const result = { ...invocation, subcommand, args, directories, alias: invocation.subcommand };
  if (aliasGlobals.length) result.globals = [...invocation.globals, ...aliasGlobals];
  return result;
}

function resolveInvocation(invocation) {
  if (GATED_SUBCOMMANDS.includes(invocation.subcommand)) return invocation;
  const directory = invocation.directories.find((candidate) => candidate && existsSync(candidate));
  const repository = directory && findRepository(directory);
  if (!repository || !readGate(repository).enabled) return invocation;
  return expandAlias(invocation, (name) => aliasOf(directory, name));
}

// --force is left out: it stages ignored files, which the reviewed git add -A snapshot never contained.
const ADD_ALL_LETTERS = new Set(['A', 'v']);
const ADD_ALL_OPTIONS = new Set(['--all', '--verbose', '--ignore-errors', '--sparse']);

function isFolder(location, folder) {
  try {
    return realpathSync.native(location) === realpathSync.native(folder);
  } catch {
    return false;
  }
}

// What a git add stages: null for a dry run, 'all' when it matches git add -A at the repository root, otherwise 'some'.
function addStaging(args, directory, root) {
  const paths = [];
  let all = false;
  let onlyAllOptions = true;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      paths.push(...args.slice(index + 1));
      break;
    }
    const name = arg.startsWith('--') ? arg.slice(2).split('=')[0] : null;
    const letters = !name && /^-[A-Za-z]/.test(arg) ? [...arg.slice(1)] : [];
    if ((name && 'dry-run'.startsWith(name)) || letters.includes('n')) return null;
    if (name !== null) {
      all ||= arg === '--all';
      onlyAllOptions &&= ADD_ALL_OPTIONS.has(arg) || arg.startsWith('--chmod=');
    } else if (letters.length) {
      all ||= letters.includes('A');
      onlyAllOptions &&= letters.every((letter) => ADD_ALL_LETTERS.has(letter));
    } else paths.push(arg);
  }
  const wholeRepository = paths.length ? paths.every((pathspec) => isFolder(path.resolve(directory, pathspec), root)) : all;
  return onlyAllOptions && wholeRepository ? 'all' : 'some';
}

function gateVerdicts(invocations, sessionFolders) {
  const verdicts = [];
  const skipped = new Set();
  const stagedInCommand = new Map();
  for (const invocation of invocations) {
    if (invocation.subcommand === 'add') {
      for (const { directory, repository } of locateTargets(invocation.directories)) {
        const staging = repository && addStaging(invocation.args, directory, repository.root);
        if (staging && stagedInCommand.get(repository.root) !== 'all') stagedInCommand.set(repository.root, staging);
      }
    }
    if (invocation.shellAlias) {
      const gated = locateTargets(invocation.directories).some(({ repository }) => repository && readGate(repository).enabled);
      if (gated) {
        const { name, mentions } = invocation.shellAlias;
        verdicts.push(verdict('ask', `review-loop: git ${name} is a shell alias that runs git ${mentions}, so the commit gate cannot check it. Confirm before Claude runs it.`));
      }
      continue;
    }
    if (!GATED_SUBCOMMANDS.includes(invocation.subcommand)) continue;
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
        : commitVerdict(repository, invocation, { ...gateSettings, skipOnce }, stagedInCommand.get(repository.root));
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
    reproduce: eventsSinceStart(repository).some((entry) => entry.event === 'reproduce'),
    fix: state.round > 1 && state.awaiting !== 'proof',
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
      notVerifiedChecks: (state.latestChecks ?? state.checks ?? []).filter(isNotVerified).map(checkId),
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
  const unfinished = state && UNFINISHED.includes(state.awaiting);
  return {
    unfinished: unfinished ? { round: state.round, awaiting: state.awaiting } : null,
    deferred: undecided(state?.deferred).map(describeDeferred),
    pendingDecisions: undecided(state?.cards).map(summarize),
    stillOpen: undecided(state?.open).map(summarize),
    needsProof: state?.awaiting === 'proof' ? needsProof(repository.root, state.resolved).map(summarize) : [],
    notVerifiedChecks: (state?.latestChecks ?? state?.checks ?? []).filter(isNotVerified).map(checkId),
    gateNotConfigured: !readGate(repository).configured,
  };
}

function describeEvent(entry) {
  const finding = `${entry.id} [${entry.severity}] ${entry.title}`;
  if (entry.event === 'record') {
    let outcome = entry.decision === 'continue' ? 'continued' : `stopped: ${STOP_REASONS[entry.reason] ?? entry.reason}`;
    if (entry.reason === 'proof') outcome = 'continued for a regression test or a no-test reason';
    const tally = `P1 or P2 open ${entry.open?.length ?? 0}, waiting for you ${entry.deferred?.length ?? 0}, new cards ${entry.cards?.length ?? 0}`;
    return [
      `- Round ${entry.round}: ${tally}; ${outcome}`,
      ...(entry.resolved ?? []).map((item) => `- Resolved ${item.id} [${item.severity}] ${item.title}`),
    ];
  }
  if (entry.event === 'stop') return [`- Round ${entry.round}: stopped: ${STOP_REASONS[entry.reason]}, once each resolved P1 or P2 had a regression test or a no-test reason`];
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
    ...waiting.needsProof.map((item) => `- Needs a regression test or a no-test reason: ${item.id} [${item.severity}] ${location(item)} ${item.title}`),
    ...waiting.pendingDecisions.map((item) => `- Decide ${item.id} [${item.severity}] ${location(item)} ${item.title}`),
    ...(waiting.notVerifiedChecks.length ? [`- Checks not verified: ${waiting.notVerifiedChecks.join(', ')}`] : []),
    ...(waiting.gateNotConfigured ? ['- The commit gate is not configured in this repository'] : []),
  ];
  lines.push('', 'Waiting for you:', ...(waitingLines.length ? waitingLines : ['- nothing']));
  return lines.join('\n');
}

const DECISION_LABELS = {
  fix: 'Fix', once: 'Fix this time', rule: 'Make it a rule', keep: 'Keep', deferred: 'Deferred', waiting: 'Waiting for you',
};
const OUTCOME_LABELS = { resolved: 'Resolved', unreviewed: 'Not re-reviewed', kept: 'Kept as is', open: 'Open' };
const findingNumber = (row) => Number(row.id.slice(2));

function proofOf(item, outcome) {
  const drafted = (label, { drafts, proof, reason }) => `${label} ${drafts.join(', ')} (${reason ? `${proof}, ${reason}` : proof})`;
  const proof = [];
  if (item.regression?.drafts) proof.push(drafted('regression test', item.regression));
  else if (item.regression) proof.push(`no test: ${item.regression.reason}`);
  if (item.rule?.drafts) proof.push(drafted('rule', item.rule));
  if (item.reproduced && item.rerun) proof.push(`verify check ${item.reproduced.check} ${RERUN_OUTCOMES[item.rerun.status] ?? item.rerun.status}`);
  if (item.fromChecks && outcome === 'resolved') proof.push(`${item.quote} no longer fails`);
  return proof;
}

function findingRows(state) {
  const row = (item, decision, settled) => {
    const outcome = settled ?? ({ once: 'unreviewed', rule: 'unreviewed', keep: 'kept' }[decision] ?? 'open');
    let note;
    if (decision === 'deferred') note = `not fixed: ${item.deferredReason}`;
    else if (item.outOfScope) note = 'outside the reviewed diff';
    return { round: item.round, id: item.id, title: item.title, severity: item.severity, decision, outcome, note, proof: proofOf(item, outcome) };
  };
  const waitingOrFix = state.stopped ? 'waiting' : 'fix';
  return [
    ...state.resolved.map((item) => row(item, item.decision ?? 'fix', 'resolved')),
    ...state.open.map((item) => row(item, item.decision ?? waitingOrFix)),
    ...(state.deferred ?? []).map((item) => row(item, item.decision ?? 'deferred')),
    ...state.cards.map((item) => row(item, item.decision ?? 'waiting')),
    ...(state.kept ?? []).filter((item) => item.id).map((item) => row(item, item.decision ?? 'keep')),
  ].sort((first, second) => first.round - second.round || findingNumber(first) - findingNumber(second));
}

function runFacts(state) {
  return {
    rounds: state.counts.length,
    stopReason: state.stopped?.reason ?? null,
    awaiting: state.awaiting,
    checks: state.latestChecks ?? state.checks,
  };
}

const escapeHtml = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// GitHub shows a code span as typed, so an escaped character there would show up as the entity.
function markdownCell(text) {
  const outsideCode = normalize(text).split(/(`[^`]*`)/).map((part, index) => (index % 2 ? part : escapeHtml(part))).join('');
  return outsideCode.replaceAll('|', '\\|');
}

function renderMarkdown(run, rows) {
  const lines = ['## review-loop', ''];
  if (run.rounds === 0) {
    lines.push('No review has been recorded yet.');
  } else {
    const rounds = `${run.rounds} review ${run.rounds === 1 ? 'round' : 'rounds'}`;
    const status = run.stopReason
      ? `stopped: ${STOP_REASONS[run.stopReason] ?? run.stopReason}`
      : `not finished, waiting for ${run.awaiting}`;
    lines.push(`${rounds}, ${status}.`);
  }
  if (rows.length) {
    lines.push('', '| Round | Finding | Severity | Decision | What happened |', '|---|---|---|---|---|');
    for (const row of rows) {
      const outcome = row.note ? `${OUTCOME_LABELS[row.outcome]} (${row.note})` : OUTCOME_LABELS[row.outcome];
      const happened = [outcome, ...row.proof].join('; ');
      lines.push(`| ${row.round} | ${markdownCell(`${row.id} ${row.title}`)} | ${row.severity} | ${DECISION_LABELS[row.decision]} | ${markdownCell(happened)} |`);
    }
  } else if (run.rounds > 0) {
    lines.push('', 'No findings.');
  }
  const unreviewed = rows.filter((row) => row.outcome === 'unreviewed');
  if (unreviewed.length) {
    lines.push('', '## Not re-reviewed', '', ...unreviewed.map((row) => `- ${markdownCell(`${row.id} ${row.title}`)} (${DECISION_LABELS[row.decision]})`));
  }
  const checkLines = run.checks === null
    ? ['- not run on the code after the last fix']
    : run.checks.map((check) => `- ${check.folder ? `${check.folder}: ` : ''}${check.name} (\`${check.command}\`): ${checkOutcome(check)}`);
  lines.push('', '## Checks', '', ...(checkLines.length ? checkLines : ['- none detected, the review read the diff only']));
  return lines.join('\n');
}

function markdownSummary(state, options) {
  if (options.since !== undefined) throw new Error('--markdown describes the current run, leave out --since');
  if (!state) throw new Error('no review-loop run to summarize, run loop start first');
  return { markdown: renderMarkdown(runFacts(state), findingRows(state)) };
}

function summary(cwd, options) {
  const repository = openRepository(cwd);
  const state = readSavedState(repository);
  if (options.markdown) return markdownSummary(state, options);
  const since = summaryStart(repository, state, options.since);
  const events = ledgerEvents(repository)
    .filter((entry) => Object.hasOwn(SUMMARY_FIELDS, entry.event) && (entry.event !== 'next' || entry.decision === 'stop'))
    .filter((entry) => since === null || entry.at >= since)
    .map(summaryEvent);
  const waiting = waitingFor(repository, state);
  return { report: renderSummary(since, events, waiting), since, events, waiting };
}

const COMMANDS = {
  start, record, next, reproduce, decide, rule, checks: rerunChecks, delegate, gate, confirm, reviewer, unattended: setUnattended, note,
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
    return realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) main();
