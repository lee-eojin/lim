import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decide, judge, lineCount, loadMap, within } from '../../plugins/gap-map/skills/gap-map/scripts/gapmap.mjs';
import { rank as rankStages, renderSvg, wrap } from '../../plugins/gap-map/skills/gap-map/scripts/render.mjs';

const script = fileURLToPath(new URL('../../plugins/gap-map/skills/gap-map/scripts/gapmap.mjs', import.meta.url));

const PRINT_TAIL = `import { readFileSync } from 'node:fs';
const lines = readFileSync(process.argv[2], 'utf8').split('\\n').filter((line) => line.startsWith('#|'));
console.log(lines.map((line) => line.slice(2)).join('\\n'));
if (process.argv[3] === 'extra') console.log('extra line');
`;

function project(overrides = {}, files = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'gap-map-'));
  const all = {
    'print.mjs': PRINT_TAIL,
    'sleep.mjs': 'setTimeout(() => {}, 60000);\n',
    'src/check.ts': 'export function check() {\n  return true;\n}\n',
    'docs/guide.md': '# Guide\nA Nat where a Bool is expected is refused.\n',
    'tests/ok.bend': 'def main() -> Nat:\n  2\n#|2\n',
    'tests/refuse.bend': 'def main() -> Bool:\n  1\n#|Error: type mismatch\n',
    ...files,
  };
  for (const [file, text] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  }
  const map = {
    target: 'Toy',
    goal: 'Refuse ill-typed programs and print the right value',
    groups: [{ id: 'check', label: 'Check' }, { id: 'done', label: 'Wrote output' }],
    regions: [{ id: 'checker', label: 'In the checker' }],
    stages: [
      { id: 'check', label: 'Checking every type', group: 'check', region: 'checker' },
      { id: 'ok', label: 'Printed the result', group: 'done', kind: 'end' },
    ],
    edges: [{ from: 'check', to: 'ok', label: 'every term checks' }],
    verifiers: {
      tail: { run: [process.execPath, 'print.mjs', '{fixture}'], authority: 'run', pass: { exitCode: 0, fixtureLines: { prefix: '#|' } } },
      noisy: { run: [process.execPath, 'print.mjs', '{fixture}', 'extra'], authority: 'run', pass: { exitCode: 0, fixtureLines: { prefix: '#|' } } },
      reads: { run: [process.execPath, 'print.mjs', '{fixture}'], authority: 'read', pass: { exitCode: 0 } },
      slow: { run: [process.execPath, 'sleep.mjs', '{fixture}'], authority: 'run', pass: { exitCode: 0 }, timeoutMs: 500 },
    },
    obligations: [
      {
        id: 'check.mismatch', stage: 'check', claim: 'A Nat where a Bool is expected is refused',
        source: 'docs/guide.md:2', owner: 'src/check.ts:1', cases: ['positive', 'negative'], authority: 'run',
        fixtures: [
          { case: 'positive', path: 'tests/ok.bend', verifier: 'tail' },
          { case: 'negative', path: 'tests/refuse.bend', verifier: 'tail' },
        ],
      },
    ],
    ...overrides,
  };
  writeFileSync(path.join(dir, 'gap-map.json'), JSON.stringify(map, null, 2));
  return { dir, map };
}

const gapmap = (dir, ...args) => spawnSync(process.execPath, [script, ...args, '--map', path.join(dir, 'gap-map.json')], { encoding: 'utf8' });
const status = (dir) => JSON.parse(readFileSync(path.join(dir, 'gap-map', 'status.json'), 'utf8'));
const withObligation = (change) => {
  const base = project().map.obligations[0];
  return { obligations: [{ ...base, ...change(base) }] };
};

test('an obligation closes when its source and owner resolve and every case passed a run', () => {
  const { dir } = project();
  const result = gapmap(dir, 'run');
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /ran 2 fixture\(s\): 2 passed, 0 failed/);
  assert.equal(status(dir).obligations['check.mismatch'].status, 'closed');
  assert.match(result.stdout, /1 of 1 proven/);
});

test('check alone never runs a fixture so an obligation with no run stays open', () => {
  const { dir } = project();
  gapmap(dir, 'check');
  const decision = status(dir).obligations['check.mismatch'];
  assert.equal(decision.status, 'open');
  assert.ok(decision.reasons.includes('positive: tests/ok.bend has not been run'));
});

test('a required case with no fixture keeps the obligation open', () => {
  const { dir } = project(withObligation((base) => ({ cases: [...base.cases, 'malformed'] })));
  gapmap(dir, 'run');
  const decision = status(dir).obligations['check.mismatch'];
  assert.equal(decision.status, 'open');
  assert.deepEqual(decision.reasons, ['malformed: no fixture']);
});

test('a verifier that only reads cannot close a claim that needs a run', () => {
  const { dir } = project(withObligation((base) => ({ fixtures: base.fixtures.map((fixture) => ({ ...fixture, verifier: 'reads' })) })));
  gapmap(dir, 'run');
  const decision = status(dir).obligations['check.mismatch'];
  assert.equal(decision.status, 'open');
  assert.ok(decision.reasons.includes('positive: verifier reads only reads, the claim needs a run'));
});

test('a fixture edited after its run is stale and the obligation reopens', () => {
  const { dir } = project();
  gapmap(dir, 'run');
  writeFileSync(path.join(dir, 'tests/ok.bend'), 'def main() -> Nat:\n  3\n#|3\n');
  gapmap(dir, 'check');
  const decision = status(dir).obligations['check.mismatch'];
  assert.equal(decision.status, 'open');
  assert.ok(decision.reasons.includes('positive: tests/ok.bend changed after its last run'));
});

test('a verifier edited after the run reopens the obligation', () => {
  const { dir, map } = project();
  gapmap(dir, 'run');
  map.verifiers.tail.pass.exitCode = 1;
  writeFileSync(path.join(dir, 'gap-map.json'), JSON.stringify(map));
  gapmap(dir, 'check');
  assert.ok(status(dir).obligations['check.mismatch'].reasons.includes('positive: verifier tail or a file it runs changed after the last run'));
});

test('extra output after the expected lines fails the fixture with the line that differs', () => {
  const { dir } = project(withObligation((base) => ({ fixtures: base.fixtures.map((fixture) => ({ ...fixture, verifier: 'noisy' })) })));
  const result = gapmap(dir, 'run');
  assert.match(result.stdout, /line 2: expected "\(end\)", got "extra line"/);
  assert.equal(status(dir).obligations['check.mismatch'].status, 'open');
});

test('judge compares stdout with the #| lines and nothing else', () => {
  const verifier = { pass: { exitCode: 0, fixtureLines: { prefix: '#|' } } };
  assert.equal(judge(verifier, 'x\n#|2\n#| b\n', 0, '2\n b  \n\n', false).passed, true);
  assert.equal(judge(verifier, '#|2\n', 0, '3\n', false).why, 'line 1: expected "2", got "3"');
  assert.equal(judge(verifier, '#|2\n', 1, '2\n', false).why, 'exit code 1, expected 0');
  assert.equal(judge(verifier, 'no lines\n', 0, '', false).why, 'the fixture has no #| lines to compare');
  const tail = { pass: { fixtureLines: { prefix: '#|', exitLine: 'exit {code}' } } };
  assert.equal(judge(tail, '#|Error: no\n#|exit 1\n', 1, 'Error: no\n', false).passed, true);
  assert.equal(judge(tail, '#|Error: no\n', 1, 'Error: no\n', false).why, 'line 2: expected "(end)", got "exit 1"');
});

test('stdout+stderr keeps the order the program wrote them in', () => {
  const { dir } = project({
    verifiers: { both: { run: [process.execPath, 'both.mjs', '{fixture}'], authority: 'run', pass: { fixtureLines: { prefix: '#|', streams: 'stdout+stderr', exitLine: 'exit {code}' } } } },
  }, { 'both.mjs': "process.stdout.write('one\\n');\nprocess.stderr.write('two\\n');\nprocess.stdout.write('three\\n');\nprocess.exitCode = 1;\n", 'tests/both.bend': '#|one\n#|two\n#|three\n#|exit 1\n' });
  const map = JSON.parse(readFileSync(path.join(dir, 'gap-map.json'), 'utf8'));
  map.obligations[0].cases = ['positive'];
  map.obligations[0].fixtures = [{ case: 'positive', path: 'tests/both.bend', verifier: 'both' }];
  writeFileSync(path.join(dir, 'gap-map.json'), JSON.stringify(map));
  const result = gapmap(dir, 'run');
  assert.match(result.stdout, /1 passed, 0 failed/, result.stdout);
});

test('a verifier past its time limit fails with the limit as the reason', () => {
  const { dir } = project(withObligation((base) => ({ cases: ['positive'], fixtures: [{ ...base.fixtures[0], verifier: 'slow' }] })));
  const started = Date.now();
  const result = gapmap(dir, 'run');
  assert.ok(Date.now() - started < 20000, 'the run stopped at the limit');
  assert.match(result.stdout, /timed out after 500 ms/);
});

test('a contradiction marks the obligation contradicted even when every case passed', () => {
  const { dir } = project(withObligation(() => ({ contradictions: ['the guide says refused, the changelog says coerced'] })));
  gapmap(dir, 'run');
  const decision = status(dir).obligations['check.mismatch'];
  assert.equal(decision.status, 'contradicted');
  assert.deepEqual(decision.reasons, ['contradiction: the guide says refused, the changelog says coerced']);
});

test('an open unknown keeps a passing obligation open', () => {
  const { dir } = project(withObligation(() => ({ unknowns: ['whether the JS lane refuses it too'] })));
  gapmap(dir, 'run');
  assert.deepEqual(status(dir).obligations['check.mismatch'].reasons, ['unknown: whether the JS lane refuses it too']);
});

test("a won't-fix obligation is shown but never counted as proven", () => {
  const { dir, map } = project();
  map.obligations.push({ id: 'emit.gcc', stage: 'ok', claim: 'gcc builds the C output', source: 'docs/guide.md:1', owner: 'src/check.ts:1', cases: ['positive'], authority: 'run', disposition: 'wontfix' });
  writeFileSync(path.join(dir, 'gap-map.json'), JSON.stringify(map));
  const result = gapmap(dir, 'run');
  assert.match(result.stdout, /1 of 1 proven; 0 open, 0 contradicted, 0 blocked, 1 won't fix/);
  assert.match(readFileSync(path.join(dir, 'gap-map', 'gaps.md'), 'utf8'), /\| `emit.gcc` \| wontfix \|/);
});

test('a source or owner pointer past the end of its file does not resolve', () => {
  const { dir } = project(withObligation(() => ({ owner: 'src/check.ts:99', source: 'docs/missing.md:1' })));
  gapmap(dir, 'run');
  const { reasons } = status(dir).obligations['check.mismatch'];
  assert.ok(reasons.includes('owner src/check.ts:99 does not resolve to a file and line'));
  assert.ok(reasons.includes('source docs/missing.md:1 does not resolve to a file and line'));
});

test('a map with problems writes nothing and lists every problem and exits 2', () => {
  const { dir } = project({
    stages: [{ id: 'check', label: 'Checking', group: 'nope' }],
    edges: [{ from: 'check', to: 'gone', label: 'x' }],
    obligations: [{ id: 'Bad Id', stage: 'check', claim: 'c', cases: ['sideways'], authority: 'guess', fixtures: [{ case: 'positive', path: '../outside.bend', verifier: 'missing' }] }],
  });
  const result = gapmap(dir, 'check');
  assert.equal(result.status, 2);
  for (const problem of [
    'stage check names group nope, which is not in groups',
    'edge check -> gone names stage gone, which is not in stages',
    'case sideways is not one of',
    'authority must be one of read, run',
    'fixture path ../outside.bend leaves the root',
    'names verifier missing, which is not in verifiers',
  ]) assert.ok(result.stdout.includes(problem), `${problem}\n${result.stdout}`);
  assert.equal(existsSync(path.join(dir, 'gap-map', 'map.svg')), false);
});

test('run --id runs only the named obligation and refuses an unknown id', () => {
  const { dir, map } = project();
  map.obligations.push({ ...map.obligations[0], id: 'check.other' });
  writeFileSync(path.join(dir, 'gap-map.json'), JSON.stringify(map));
  assert.match(gapmap(dir, 'run', '--id', 'check.other').stdout, /ran 2 fixture\(s\)/);
  const statuses = status(dir).obligations;
  assert.equal(statuses['check.other'].status, 'closed');
  assert.equal(statuses['check.mismatch'].status, 'open');
  const unknown = gapmap(dir, 'run', '--id', 'nope');
  assert.equal(unknown.status, 2);
  assert.match(unknown.stdout, /unknown obligation id: nope/);
});

test('the map draws a legend chip per group and a box per stage and the region title and every transition label', () => {
  const { dir } = project();
  gapmap(dir, 'run');
  const svg = readFileSync(path.join(dir, 'gap-map', 'map.svg'), 'utf8');
  for (const text of ['Toy, design map and gaps', 'Legend', 'Check', 'Wrote output', "Won't fix or stopped", 'Checking every type', 'Printed the result', 'In the checker', 'every term checks', '1/1 proven']) {
    assert.ok(svg.includes(`>${text}<`), text);
  }
  const before = readFileSync(path.join(dir, 'gap-map', 'map.svg'), 'utf8');
  gapmap(dir, 'check');
  assert.equal(readFileSync(path.join(dir, 'gap-map', 'map.svg'), 'utf8'), before, 'the same map draws the same bytes');
});

test('a transition back to an earlier stage does not change the ranks and is drawn dashed', () => {
  const stages = ['a', 'b', 'c'].map((id) => ({ id, label: id, group: 'g' }));
  const edges = [{ from: 'a', to: 'b', label: 'x' }, { from: 'b', to: 'c', label: 'y' }, { from: 'c', to: 'a', label: 'back' }];
  const { ranks, forward } = rankStages(stages, edges);
  assert.deepEqual([...ranks.values()], [0, 1, 2]);
  assert.equal(forward.has(edges[2]), false);
  const svg = renderSvg({ target: 'T', groups: [{ id: 'g', label: 'G' }], stages, edges }, { byStage: new Map() });
  assert.match(svg, /stroke-dasharray="4 3" marker-end/);
});

test('labels wrap at word boundaries', () => {
  assert.deepEqual(wrap('the regions would mislead the reader', 12), ['the regions', 'would', 'mislead the', 'reader']);
});

test('decide reads only the results it is given', () => {
  const { dir } = project();
  const loaded = loadMap(path.join(dir, 'gap-map.json'));
  assert.deepEqual(loaded.problems, []);
  const decision = decide(loaded.map.obligations[0], { root: loaded.root, verifiers: loaded.map.verifiers, results: {} });
  assert.deepEqual(decision.reasons, ['positive: tests/ok.bend has not been run', 'negative: tests/refuse.bend has not been run']);
});

test('a script the verifier runs edited after the run reopens the obligation', () => {
  const { dir } = project();
  gapmap(dir, 'run');
  writeFileSync(path.join(dir, 'print.mjs'), `${PRINT_TAIL}// edited\n`);
  gapmap(dir, 'check');
  assert.ok(status(dir).obligations['check.mismatch'].reasons.includes('positive: verifier tail or a file it runs changed after the last run'));
});

test('a pointer to a folder does not resolve', () => {
  const { dir } = project(withObligation(() => ({ owner: 'src' })));
  gapmap(dir, 'run');
  assert.ok(status(dir).obligations['check.mismatch'].reasons.includes('owner src does not resolve to a file and line'));
});

test('a verifier whose program does not exist fails the fixture instead of crashing the run', () => {
  const { dir } = project({
    verifiers: { gone: { run: [path.join(tmpdir(), 'no-such-program-gap-map'), '{fixture}'], authority: 'run', pass: { exitCode: 0, fixtureLines: { prefix: '#|', streams: 'stdout+stderr' } } } },
  });
  const map = JSON.parse(readFileSync(path.join(dir, 'gap-map.json'), 'utf8'));
  map.obligations[0].fixtures = map.obligations[0].fixtures.map((fixture) => ({ ...fixture, verifier: 'gone' }));
  writeFileSync(path.join(dir, 'gap-map.json'), JSON.stringify(map));
  const result = gapmap(dir, 'run');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 passed, 2 failed/);
  assert.match(result.stdout, /could not start/);
});

test('an owner file changed after the run reopens the obligation', () => {
  const { dir } = project();
  gapmap(dir, 'run');
  writeFileSync(path.join(dir, 'src/check.ts'), 'export function check() {\n  return false;\n}\n');
  gapmap(dir, 'check');
  assert.ok(status(dir).obligations['check.mismatch'].reasons.includes('positive: owner src/check.ts:1 changed after its last run'.replace('its last run', 'the last run')));
});

test('one fixture checked by two verifiers keeps both results', () => {
  const { dir, map } = project();
  map.obligations[0].cases = ['positive'];
  map.obligations[0].fixtures = [
    { case: 'positive', path: 'tests/ok.bend', verifier: 'tail' },
    { case: 'positive', path: 'tests/ok.bend', verifier: 'reads' },
  ];
  map.obligations[0].authority = 'read';
  writeFileSync(path.join(dir, 'gap-map.json'), JSON.stringify(map));
  assert.match(gapmap(dir, 'run').stdout, /ran 2 fixture\(s\): 2 passed/);
  gapmap(dir, 'check');
  assert.equal(status(dir).obligations['check.mismatch'].status, 'closed');
});

test('a character split across output chunks is decoded whole', () => {
  const { dir, map } = project({}, {
    'split.mjs': "const bytes = Buffer.from([0xed, 0x95, 0x9c, 0x0a]);\nprocess.stdout.write(bytes.subarray(0, 1));\nsetTimeout(() => process.stdout.write(bytes.subarray(1)), 50);\n",
    'tests/han.bend': '#|\uD55C\n',
  });
  map.verifiers.split = { run: [process.execPath, 'split.mjs', '{fixture}'], authority: 'run', pass: { exitCode: 0, fixtureLines: { prefix: '#|' } } };
  map.obligations[0].cases = ['positive'];
  map.obligations[0].fixtures = [{ case: 'positive', path: 'tests/han.bend', verifier: 'split' }];
  writeFileSync(path.join(dir, 'gap-map.json'), JSON.stringify(map));
  assert.match(gapmap(dir, 'run').stdout, /1 passed, 0 failed/);
});

test('a fixture with CRLF line endings compares like one with LF', () => {
  const verifier = { pass: { exitCode: 0, fixtureLines: { prefix: '#|' } } };
  assert.equal(judge(verifier, '#|one\r\n#|two\r\n', 0, 'one\r\ntwo\r\n', false).passed, true);
});

test('a stage whose id looks like an internal routing id still renders', () => {
  const stages = ['a', 'b', 'c', 'edge-0-1'].map((id) => ({ id, label: id, group: 'g' }));
  const edges = [{ from: 'a', to: 'c', label: 'skip' }, { from: 'a', to: 'b', label: 'x' }, { from: 'b', to: 'c', label: 'y' }, { from: 'c', to: 'edge-0-1', label: 'z' }];
  const svg = renderSvg({ target: 'T', groups: [{ id: 'g', label: 'G' }], stages, edges }, { byStage: new Map() });
  assert.ok(svg.includes('>edge-0-1<'));
});

test('a pointer one line past the last newline does not resolve', () => {
  const { dir } = project(withObligation(() => ({ owner: 'src/check.ts:4' })));
  gapmap(dir, 'run');
  assert.ok(status(dir).obligations['check.mismatch'].reasons.includes('owner src/check.ts:4 does not resolve to a file and line'));
  assert.deepEqual([lineCount(''), lineCount('x\n'), lineCount('x\ny')], [0, 1, 2]);
});

test('a path under a root that ends in a separator is inside it', () => {
  const top = path.parse(process.cwd()).root;
  assert.equal(within(top, path.join(top, 'src', 'a.bend')), true);
  assert.equal(within(path.join(tmpdir(), 'a'), path.join(tmpdir(), 'ab')), false);
});

test('a question without a basis is refused', () => {
  const { dir } = project(withObligation(() => ({ question: 'Should the guide name the order?' })));
  const result = gapmap(dir, 'check');
  assert.equal(result.status, 2);
  assert.match(result.stdout, /has a question, so basis must list the file lines or searches it rests on/);
});

test('a question whose search basis no longer holds is marked stale and keeps the obligation open', () => {
  const question = { question: 'The guide never says which values are refused; decide whether it should.', basis: [{ search: 'is refused', scope: 'docs', hits: 0 }] };
  const { dir } = project(withObligation(() => question));
  gapmap(dir, 'run');
  const decision = status(dir).obligations['check.mismatch'];
  assert.equal(decision.status, 'open');
  assert.ok(decision.reasons.includes('basis: searching docs for "is refused" now finds 1, the question says 0'));
  const gaps = readFileSync(path.join(dir, 'gap-map', 'gaps.md'), 'utf8');
  assert.match(gaps, /`check.mismatch` \(stale, recheck before deciding\)/);
  assert.match(gaps, /basis: 0 hit\(s\) for "is refused" within docs/);
});

test('a question whose basis holds does not keep a proven obligation open', () => {
  const { dir } = project(withObligation(() => ({ question: 'Should Bool coerce?', basis: [{ file: 'docs/guide.md:2' }, { search: 'coerce', scope: 'docs', hits: 0 }] })));
  gapmap(dir, 'run');
  assert.equal(status(dir).obligations['check.mismatch'].status, 'closed');
});

test('a basis line past the end of its file keeps the obligation open', () => {
  const { dir } = project(withObligation(() => ({ question: 'q', basis: [{ file: 'docs/guide.md:9' }] })));
  gapmap(dir, 'run');
  assert.ok(status(dir).obligations['check.mismatch'].reasons.includes('basis: docs/guide.md:9 does not resolve to a file and line'));
});

test('a basis search over the root does not count the map that cites it or its outputs', () => {
  const { dir } = project(withObligation(() => ({ question: 'Should the guide list every refusal?', basis: [{ search: 'is refused', scope: '.', hits: 1 }] })));
  gapmap(dir, 'run');
  gapmap(dir, 'check');
  assert.equal(status(dir).obligations['check.mismatch'].status, 'closed', JSON.stringify(status(dir).obligations['check.mismatch'].reasons));
});
