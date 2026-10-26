import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { projectNameOf } from '../../evals/verify/run-benchmark.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const projectsDir = path.join(repoRoot, 'evals/verify/projects');
const pluginDir = path.join(repoRoot, 'plugins/verify');
const allowlistFile = fileURLToPath(new URL('blinding-allowlist.txt', import.meta.url));
const SHORTEST_PHRASE = 6;
const SHORTEST_TOKEN = 5;
const INTERPRETERS = ['node', 'python3'];

function filesUnder(folder) {
  return readdirSync(folder).flatMap((name) => {
    const file = path.join(folder, name);
    return statSync(file).isDirectory() ? filesUnder(file) : [file];
  });
}

const phrasesOf = (text) => String(text).split('\n').map((line) => line.trim()).filter((line) => line.length >= SHORTEST_PHRASE);

// A renamed copy of a benchmark example keeps its inputs and outputs, so their words are matched one by one.
const tokensOf = (text) => String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => [...word].length >= SHORTEST_TOKEN);

function expectedTexts(rule) {
  if (!rule) return [];
  if (Array.isArray(rule)) return rule.flatMap(expectedTexts);
  if ('matches' in rule) return [rule.matches.replace(/^\^|\$$/g, '')].filter((text) => !/[\\[\]()*+?{}|^$]/.test(text));
  return [rule.includes ?? rule.equals];
}

function fencedLines(markdown) {
  const lines = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (line.trimStart().startsWith('```')) inFence = !inFence;
    else if (inFence) lines.push(line.replace(/^\$\s*/, ''));
  }
  return lines;
}

// Common words that a benchmark input or output shares with ordinary plugin prose, one per line as `word: reason`.
export function readAllowlist() {
  return new Map(readFileSync(allowlistFile, 'utf8').split('\n').filter((line) => line.trim() && !line.startsWith('#')).map((line) => {
    const [word, ...reason] = line.split(':');
    return [word.trim(), reason.join(':').trim()];
  }));
}

// Everything that would tell Claude which checks catch the benchmark's breaks.
export function benchmarkTerms() {
  const phrases = new Set();
  const tokens = new Set();
  for (const project of readdirSync(projectsDir)) {
    const projectDir = path.join(projectsDir, project);
    const repo = path.join(projectDir, 'repo');
    phrases.add(project);
    const packageFile = path.join(repo, 'package.json');
    const manifest = existsSync(packageFile) ? JSON.parse(readFileSync(packageFile, 'utf8')) : {};
    phrases.add(projectNameOf(repo));
    for (const [command, file] of Object.entries(typeof manifest.bin === 'object' ? manifest.bin : {})) {
      phrases.add(command);
      phrases.add(path.basename(file));
    }
    for (const file of filesUnder(repo)) {
      const relative = path.relative(repo, file);
      if (['README.md', 'package.json', 'pyproject.toml'].includes(relative)) continue;
      phrases.add(relative);
      if (relative.startsWith(`bin${path.sep}`)) phrases.add(path.basename(relative));
      const source = readFileSync(file, 'utf8');
      const exported = [...source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g), ...source.matchAll(/^(?:async\s+)?def\s+([A-Za-z]\w*)/gm)];
      for (const [, name] of exported) {
        if (name.length >= SHORTEST_PHRASE) phrases.add(name);
      }
    }
    const reference = JSON.parse(readFileSync(path.join(projectDir, 'reference.features.json'), 'utf8'));
    for (const entry of reference.features) {
      phrases.add(entry.id);
      phrases.add(entry.feature);
      phrasesOf(entry.run.join(' ')).forEach((phrase) => phrases.add(phrase));
      // The interpreter is the run form every check uses, which the plugin must name; the script and arguments are the benchmark's own.
      for (const argument of INTERPRETERS.includes(entry.run[0]) ? entry.run.slice(1) : entry.run) {
        phrasesOf(argument).forEach((phrase) => phrases.add(phrase));
        tokensOf(argument).forEach((token) => tokens.add(token));
      }
      const expect = entry.expect;
      for (const text of [expect.stdout, expect.stderr, ...(expect.files ?? [])].flatMap(expectedTexts)) {
        phrasesOf(text).forEach((phrase) => phrases.add(phrase));
        tokensOf(text).forEach((token) => tokens.add(token));
      }
      for (const file of expect.files ?? []) phrases.add(file.path);
    }
    fencedLines(readFileSync(path.join(repo, 'README.md'), 'utf8')).flatMap(phrasesOf).forEach((phrase) => phrases.add(phrase));
  }
  return { phrases: [...phrases].filter(Boolean), tokens: [...tokens] };
}

function phrasePattern(term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${/^\w/.test(term) ? '\\b' : ''}${escaped}${/\w$/.test(term) ? '\\b' : ''}`, 'i');
}

const tokenPattern = (token) => new RegExp(`(?<![\\p{L}\\p{N}])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu');

function matchers() {
  const { phrases, tokens } = benchmarkTerms();
  const allowed = readAllowlist();
  return [
    ...phrases.map((term) => [term, phrasePattern(term)]),
    ...tokens.filter((token) => !allowed.has(token)).map((token) => [token, tokenPattern(token)]),
  ];
}

function hitsIn(text, patterns = matchers()) {
  return text.split('\n').flatMap((line, index) => patterns.filter(([, pattern]) => pattern.test(line)).map(([term]) => `${index + 1}: ${JSON.stringify(term)}`));
}

test('the forbidden list is built from every benchmark project', () => {
  const { phrases, tokens } = benchmarkTerms();
  for (const project of readdirSync(projectsDir)) assert.ok(phrases.includes(project), project);
  assert.ok(phrases.includes('Turns accented letters into plain letters'), 'feature sentences');
  assert.ok(phrases.length > 40, `only ${phrases.length} phrases`);
  for (const token of ['brûlée', 'creme', '500ms', 'todos', 'sales', 'proofing', 'allocate']) assert.ok(tokens.includes(token), token);
  for (const phrase of ['logsift', 'centshare', 'to_cents', 'logfilter.py']) assert.ok(phrases.includes(phrase), phrase);
  assert.ok(!tokens.includes('python3'), 'the interpreter is not a benchmark term');
});

test('each allowlisted word is a benchmark token, has a reason, and would otherwise hit a plugin file', () => {
  const { tokens } = benchmarkTerms();
  const pluginText = filesUnder(pluginDir).map((file) => readFileSync(file, 'utf8')).join('\n');
  for (const [word, reason] of readAllowlist()) {
    assert.ok(tokens.includes(word), `${word} is not a benchmark token`);
    assert.ok(reason.length > 20, `${word} needs a reason`);
    assert.ok(tokenPattern(word).test(pluginText), `${word} no longer appears in the plugin, so it does not need an exception`);
  }
});

test('renamed copies of benchmark examples are caught', () => {
  const samples = [
    '{ "run": ["node", "cli/url.mjs", "Crème brûlée"], "expect": { "exitCode": 0, "stdout": { "equals": "creme-brulee" } } }',
    '{ "run": ["node", "tools/stats.mjs", "data/sales.csv", "--column", "amount"], "expect": { "exitCode": 0, "stdout": { "equals": "mean: 20" } } }',
    '{ "run": ["node", "lib/time-check.mjs", "1m 30s 500ms"], "expect": { "exitCode": 0, "stdout": { "equals": "90500" } } }',
    '{ "run": ["node", "cli/notes.js", "--file", "notes.json", "list"], "expect": { "exitCode": 0, "stdout": { "equals": "No todos." } } }',
    '{ "run": ["node", "demo/format.mjs", "90061000"], "expect": { "exitCode": 0, "stdout": { "equals": "1d 1h 1m 1s" } } }',
    '{ "run": ["python3", "tools/filter.py", "--min", "wrn", "data/bakery.log"], "expect": { "exitCode": 0, "stdout": { "matches": "ERR proofing drawer" } } }',
    '{ "run": ["python3", "checks/money.py", "allocate", "5.00", "3"], "expect": { "exitCode": 0, "stdout": { "equals": "[1.67, 1.67, 1.66]" } } }',
  ];
  const patterns = matchers();
  for (const sample of samples) assert.notDeepEqual(hitsIn(sample, patterns), [], sample);
});

test('no plugin file names a benchmark project or uses its checks or commands or expected text', () => {
  const patterns = matchers();
  const hits = filesUnder(pluginDir).flatMap((file) => hitsIn(readFileSync(file, 'utf8'), patterns).map((hit) => `${path.relative(repoRoot, file)}:${hit}`));
  assert.deepEqual(hits, []);
});
