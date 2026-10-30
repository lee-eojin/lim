import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../plugins/ledger/skills/ledger/scripts/ledger.mjs', import.meta.url));

function workspace(ledger, files = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ledger-'));
  const all = {
    'src/cache.js': 'export function evict(entry) {\n  if (entry.dead) return true;\n  return false;\n}\n',
    'src/server.js': 'import { evict } from "./cache.js";\nexport const port = 8080;\n',
    'print.mjs': "console.log('evicted 3 dead entries');\n",
    ...files,
  };
  for (const [file, text] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  }
  write(dir, {
    subject: 'Does evict drop only dead cache entries?',
    questions: [{ id: 'q.dead-only', question: 'Does evict drop only dead entries?', needs: 'static' }],
    claims: [{ id: 'c.guard', question: 'q.dead-only', statement: 'evict returns true only when entry.dead is set', kind: 'observed', evidence: [{ file: 'src/cache.js:2' }] }],
    ...ledger,
  });
  return dir;
}

const write = (dir, ledger) => writeFileSync(path.join(dir, 'ledger.json'), JSON.stringify(ledger, null, 2));
const read = (dir) => JSON.parse(readFileSync(path.join(dir, 'ledger.json'), 'utf8'));
const ledger = (dir, ...args) => spawnSync(process.execPath, [script, ...args.slice(0, 1), '--ledger', path.join(dir, 'ledger.json'), ...args.slice(1)], { encoding: 'utf8' });

test('an observed claim with a file line that exists answers a static question', () => {
  const dir = workspace({});
  const result = ledger(dir, 'check');
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /1 of 1 questions answered/);
  assert.match(result.stdout, /- \[x\] `q.dead-only`/);
  assert.match(readFileSync(path.join(dir, 'ledger.md'), 'utf8'), /observed, holds: evict returns true only when entry.dead is set/);
});

test('an inference never answers a question', () => {
  const dir = workspace({ claims: [{ id: 'c.guess', question: 'q.dead-only', statement: 'the name suggests it is safe', kind: 'inferred', evidence: [{ file: 'src/cache.js:1' }] }] });
  const result = ledger(dir, 'check');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\[~\] `q.dead-only`.*\(partial\)/);
  assert.match(result.stdout, /not answered because only inferred claims; an inference never answers a question/);
});

test('a runtime question needs a saved command output and not a file line', () => {
  const dir = workspace({ questions: [{ id: 'q.dead-only', question: 'Does a run evict only dead entries?', needs: 'runtime' }] });
  assert.match(ledger(dir, 'check').stdout, /needs runtime evidence; the observed claims cite only static evidence/);
  const saved = ledger(dir, 'save', '--', process.execPath, 'print.mjs');
  assert.equal(saved.status, 0, saved.stdout);
  const cite = JSON.parse(/cite it as (\{.*\})/.exec(saved.stdout)[1]);
  const current = read(dir);
  current.claims[0].evidence.push(cite);
  write(dir, current);
  assert.equal(ledger(dir, 'check').status, 0);
  const record = JSON.parse(readFileSync(path.join(dir, cite.output), 'utf8'));
  assert.equal(record.stdout, 'evicted 3 dead entries\n');
  assert.equal(record.exitCode, 0);
});

test('a saved output edited after it was saved breaks the claim', () => {
  const dir = workspace({ questions: [{ id: 'q.dead-only', question: 'Does a run evict only dead entries?', needs: 'runtime' }] });
  const cite = JSON.parse(/cite it as (\{.*\})/.exec(ledger(dir, 'save', '--', process.execPath, 'print.mjs').stdout)[1]);
  const current = read(dir);
  current.claims[0].evidence = [cite];
  write(dir, current);
  const file = path.join(dir, cite.output);
  writeFileSync(file, readFileSync(file, 'utf8').replace('evicted 3', 'evicted 0'));
  const result = ledger(dir, 'check');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /was edited after it was saved/);
});

test('a file line past the end of the file breaks the claim', () => {
  const dir = workspace({ claims: [{ id: 'c.guard', question: 'q.dead-only', statement: 's', kind: 'observed', evidence: [{ file: 'src/cache.js:40' }] }] });
  assert.match(ledger(dir, 'check').stdout, /src\/cache.js:40 is past the end of src\/cache.js \(5 lines\)/);
});

test('a pinned file that changes afterwards breaks the claim', () => {
  const dir = workspace({});
  assert.match(ledger(dir, 'pin').stdout, /pinned 1 file/);
  assert.equal(ledger(dir, 'check').status, 0);
  writeFileSync(path.join(dir, 'src/cache.js'), 'export function evict() {\n  return true;\n}\n');
  const result = ledger(dir, 'check');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /src\/cache.js changed after the claim was pinned/);
});

test('a bounded search is rerun and its scope is reported', () => {
  const claim = { id: 'c.callers', question: 'q.dead-only', statement: 'only server.js calls evict', kind: 'observed', evidence: [{ search: 'evict(', scope: 'src', hits: 1 }] };
  const dir = workspace({ claims: [claim] });
  const result = ledger(dir, 'check');
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /bounded search: 1 hit\(s\) for "evict\(" within src/);
  writeFileSync(path.join(dir, 'src/worker.js'), 'evict(job);\n');
  assert.match(ledger(dir, 'check').stdout, /now finds 2, the claim says 1/);
});

test('an open unknown keeps the question partial and names the next probe', () => {
  const dir = workspace({ unknowns: [{ id: 'u.ttl', question: 'q.dead-only', revision: 1, state: 'open', text: 'whether a TTL marks entries dead', probe: 'read src/ttl.js' }] });
  const result = ledger(dir, 'check');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /unknown u.ttl: whether a TTL marks entries dead \(next: read src\/ttl.js\)/);
});

test('the latest revision of an unknown decides so a resolved unknown no longer blocks', () => {
  const dir = workspace({
    unknowns: [
      { id: 'u.ttl', question: 'q.dead-only', revision: 1, state: 'open', text: 'TTL', probe: 'read src/ttl.js' },
      { id: 'u.ttl', question: 'q.dead-only', revision: 2, state: 'resolved', resolvedBy: 'c.guard' },
    ],
  });
  assert.equal(ledger(dir, 'check').status, 0);
});

test('two holding claims that contradict each other mark the question contradicted', () => {
  const dir = workspace({
    claims: [
      { id: 'c.guard', question: 'q.dead-only', statement: 'only dead entries', kind: 'observed', evidence: [{ file: 'src/cache.js:2' }] },
      { id: 'c.always', question: 'q.dead-only', statement: 'every entry', kind: 'observed', evidence: [{ file: 'src/cache.js:3' }], contradicts: 'c.guard' },
    ],
  });
  const result = ledger(dir, 'check');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\[!\] `q.dead-only`.*\(contradicted\)/);
  assert.match(result.stdout, /c.always contradicts c.guard/);
});

test('a claim that supersedes another replaces it without deleting it', () => {
  const dir = workspace({
    claims: [
      { id: 'c.old', question: 'q.dead-only', statement: 'wrong line', kind: 'observed', evidence: [{ file: 'src/cache.js:99' }] },
      { id: 'c.new', question: 'q.dead-only', statement: 'the guard is on line 2', kind: 'observed', evidence: [{ file: 'src/cache.js:2' }], supersedes: 'c.old' },
    ],
  });
  const result = ledger(dir, 'check');
  assert.equal(result.status, 0, result.stdout);
  assert.doesNotMatch(result.stdout, /wrong line/);
});

test('a question with no claims is unresolved', () => {
  const dir = workspace({ questions: [{ id: 'q.dead-only', question: 'q', needs: 'static' }, { id: 'q.port', question: 'Which port does it use?', needs: 'static' }] });
  assert.match(ledger(dir, 'check').stdout, /- \[ \] `q.port` Which port does it use\? \(unresolved\)/);
});

test('REA evidence resolves only when its id is in the exported bundle', () => {
  const id = `ev_${'a'.repeat(64)}`;
  const claim = { id: 'c.rea', question: 'q.dead-only', statement: 'the shipped build has the same guard', kind: 'observed', evidence: [{ rea: id, bundle: 'evidence.json' }] };
  const dir = workspace({ claims: [claim] }, { 'evidence.json': JSON.stringify({ records: [{ evidence_id: id }] }) });
  assert.equal(ledger(dir, 'check').status, 0);
  writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify({ records: [] }));
  assert.match(ledger(dir, 'check').stdout, new RegExp(`${id} is not in evidence.json`));
});

test('a ledger with problems lists every problem and exits 2', () => {
  const dir = workspace({
    questions: [{ id: 'Q', question: '', needs: 'maybe' }],
    claims: [{ id: 'c.x', question: 'q.none', statement: 's', kind: 'guess', evidence: [{ file: '../outside.js:1' }, { file: 'a', search: 'b' }] }],
    unknowns: [{ id: 'u.x', question: 'q.none', revision: 0, state: 'open' }],
  });
  const result = ledger(dir, 'check');
  assert.equal(result.status, 2);
  for (const problem of [
    'question id "Q" must match',
    'needs must be one of static, runtime',
    'answers question q.none, which is not in questions',
    'kind must be one of observed, inferred',
    'evidence path ../outside.js:1 leaves the root',
    'must have exactly one of file, output, search, rea',
    'revision must be a whole number from 1',
    'probe must say what evidence would resolve it',
  ]) assert.ok(result.stdout.includes(problem), `${problem}\n${result.stdout}`);
});

test('save runs the command without a shell from the ledger root', () => {
  const dir = workspace({});
  const saved = ledger(dir, 'save', '--', process.execPath, '-e', 'console.log(process.cwd()); console.log(process.argv[1])', '$HOME; echo hi');
  const record = JSON.parse(readFileSync(path.join(dir, JSON.parse(/cite it as (\{.*\})/.exec(saved.stdout)[1]).output), 'utf8'));
  assert.equal(record.stdout.split('\n')[1], '$HOME; echo hi');
  assert.equal(realpathSync.native(record.stdout.split('\n')[0].trim()), realpathSync.native(dir));
});

test('saved outputs are read from the ledger folder when root is another folder', () => {
  const dir = workspace({});
  const ledgerDir = path.join(dir, 'notes');
  mkdirSync(ledgerDir);
  const file = path.join(ledgerDir, 'ledger.json');
  writeFileSync(file, JSON.stringify({ ...read(dir), root: '..', questions: [{ id: 'q.dead-only', question: 'q', needs: 'runtime' }] }));
  const saved = spawnSync(process.execPath, [script, 'save', '--ledger', file, '--', process.execPath, 'print.mjs'], { encoding: 'utf8' });
  const cite = JSON.parse(/cite it as (\{.*\})/.exec(saved.stdout)[1]);
  assert.equal(cite.output, 'ledger-evidence/1.json');
  const current = JSON.parse(readFileSync(file, 'utf8'));
  current.claims[0].evidence.push(cite);
  writeFileSync(file, JSON.stringify(current));
  const checked = spawnSync(process.execPath, [script, 'check', '--ledger', file], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stdout);
});
