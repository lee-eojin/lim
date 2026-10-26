import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { definitionOf, judge, satisfies, validateMap } from '../../plugins/verify/skills/verify/scripts/verify.mjs';

const script = fileURLToPath(new URL('../../plugins/verify/skills/verify/scripts/verify.mjs', import.meta.url));

const cli = `const fs = require('node:fs');
const [command, value] = process.argv.slice(2);
if (command === 'upper') console.log(value.toUpperCase());
else if (command === 'color') console.log('\\u001b[32mgreen\\u001b[39m');
else if (command === 'save') fs.writeFileSync('saved.txt', 'saved ' + value);
else if (command === 'touch') fs.utimesSync(value, new Date(), new Date(Date.now() + 60000));
else if (command === 'wait') setTimeout(() => console.log('done waiting'), 60000);
else if (command === 'loud') process.stdout.write('x'.repeat(10000) + 'END');
else if (command === 'half') { console.log('HALF'); process.exit(3); }
else if (command === 'read') {
  let text = '';
  process.stdin.setEncoding('utf8').on('data', (chunk) => { text += chunk; }).on('end', () => console.log(text.trim().toUpperCase()));
}
else if (command === 'env') console.log(process.env[value]);
else if (command === 'bump') {
  const count = Number(fs.readFileSync(value, 'utf8')) + 1;
  fs.writeFileSync(value, String(count));
  console.log(count);
}
else if (command === 'fork') {
  const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
  fs.writeFileSync('grandchild.pid', String(child.pid));
  setTimeout(() => {}, 60000);
}
else { console.error('Unknown command: ' + command); process.exit(2); }
`;

const upper = {
  id: 'upper',
  feature: 'Uppercases a word',
  run: ['node', 'cli.js', 'upper', 'abc'],
  expect: { exitCode: 0, stdout: { equals: 'ABC' } },
};

function createRepository(features, extraFiles = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'verify-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  const files = { 'cli.js': cli, ...extraFiles };
  if (features !== undefined) files['verify.features.json'] = typeof features === 'string' ? features : JSON.stringify({ features });
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return root;
}

function verifyWith(env, root, ...args) {
  const result = spawnSync('node', [script, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
  const text = result.stdout.trim() || result.stderr.trim();
  return { exit: result.status, ...JSON.parse(text) };
}

const verify = (root, ...args) => verifyWith({}, root, ...args);

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeMap(root, features) {
  writeFileSync(path.join(root, 'verify.features.json'), JSON.stringify({ features }));
}

const evidenceFiles = (root) => readdirSync(path.join(root, '.git', 'lim', 'verify', 'runs'));

describe('run', () => {
  test('a check whose output matches passes and exits 0', () => {
    const root = createRepository([upper]);
    const result = verify(root, 'run');
    assert.equal(result.exit, 0);
    assert.equal(result.status, 'passed');
    assert.deepEqual(result.counts, { pass: 1, fail: 0, notVerified: 0 });
    assert.match(result.report, /^verify: 1 passed, 0 failed, 0 not verified/);
  });

  test('a wrong output fails with the reason and exits 1', () => {
    const root = createRepository([{ ...upper, expect: { exitCode: 0, stdout: { equals: 'ABD' } } }]);
    const result = verify(root, 'run');
    assert.equal(result.exit, 1);
    assert.equal(result.checks[0].status, 'fail');
    assert.deepEqual(result.checks[0].reasons, ['stdout does not equal "ABD"']);
    assert.match(result.report, /FAIL upper: Uppercases a word\n {2}\$ node cli\.js upper abc\n {2}- stdout does not equal "ABD"\n {2}stdout: ABC/);
  });

  test('a wrong exit code fails', () => {
    const root = createRepository([{
      id: 'unknown', feature: 'Rejects an unknown command', run: ['node', 'cli.js', 'nope'], expect: { exitCode: 1, stderr: { includes: 'Unknown command: nope' } },
    }]);
    assert.deepEqual(verify(root, 'run').checks[0].reasons, ['exit code 2, expected 1']);
  });

  test('a documented error with its exit code and message passes', () => {
    const root = createRepository([{
      id: 'unknown', feature: 'Rejects an unknown command', run: ['node', 'cli.js', 'nope'], expect: { exitCode: 2, stderr: { includes: 'Unknown command: nope' } },
    }]);
    assert.equal(verify(root, 'run').status, 'passed');
  });

  test('a check past its time limit is not verified and its process is killed', () => {
    const root = createRepository([{ ...upper, id: 'wait', run: ['node', 'cli.js', 'wait'], timeoutMs: 300, expect: { exitCode: 0, stdout: { includes: 'done waiting' } } }]);
    const started = Date.now();
    const result = verify(root, 'run');
    assert.ok(Date.now() - started < 10000);
    assert.equal(result.exit, 1);
    assert.equal(result.status, 'not-verified');
    assert.deepEqual(result.checks[0].reasons, ['timed out after 300 ms']);
    assert.match(result.report, /NOT VERIFIED wait/);
  });

  test('a background process the check started is killed at the time limit', () => {
    const root = createRepository([{ ...upper, id: 'fork', run: ['node', 'cli.js', 'fork'], timeoutMs: 1000, expect: { exitCode: 0, stdout: { includes: 'forked' } } }]);
    const result = verify(root, 'run');
    const pid = Number(readFileSync(path.join(root, 'grandchild.pid'), 'utf8'));
    try {
      assert.equal(result.checks[0].status, 'not-verified');
      const deadline = Date.now() + 3000;
      while (isRunning(pid) && Date.now() < deadline) spawnSync('sleep', ['0.1']);
      assert.equal(isRunning(pid), false, `grandchild ${pid} is still running`);
    } finally {
      if (isRunning(pid)) process.kill(pid, 'SIGKILL');
    }
  });

  test('LIM_VERIFY_TIMEOUT_MS sets the default time limit', () => {
    const root = createRepository([{ ...upper, id: 'wait', run: ['node', 'cli.js', 'wait'], expect: { exitCode: 0, stdout: { includes: 'done waiting' } } }]);
    assert.deepEqual(verifyWith({ LIM_VERIFY_TIMEOUT_MS: '300' }, root, 'run').checks[0].reasons, ['timed out after 300 ms']);
  });

  test('an invalid LIM_VERIFY_TIMEOUT_MS is refused with the reason', () => {
    const root = createRepository([upper]);
    for (const value of ['-5', '0', 'abc', '1.5', '600001']) {
      const result = verifyWith({ LIM_VERIFY_TIMEOUT_MS: value }, root, 'run');
      assert.equal(result.exit, 2, value);
      assert.equal(result.error, `LIM_VERIFY_TIMEOUT_MS must be a whole number of milliseconds from 1 to 600000, not "${value}"`);
    }
    assert.equal(existsSync(path.join(root, '.git', 'lim', 'verify', 'runs')), false);
  });

  test('a program that exits non-zero fails even when its output matches', () => {
    const root = createRepository([{ ...upper, id: 'half', run: ['node', 'cli.js', 'half'], expect: { exitCode: 0, stdout: { equals: 'HALF' } } }]);
    const result = verify(root, 'run');
    assert.equal(result.checks[0].status, 'fail');
    assert.deepEqual(result.checks[0].reasons, ['exit code 3, expected 0']);
  });

  test('a missing program is not verified instead of failed or passed', () => {
    const root = createRepository([{ ...upper, run: ['./bin/no-such-tool', 'upper', 'abc'] }, { ...upper, id: 'no-script', run: ['node', 'no-such-script.js'] }]);
    const result = verify(root, 'run');
    assert.equal(result.exit, 1);
    assert.deepEqual(result.checks.map((check) => check.status), ['not-verified', 'not-verified']);
    assert.deepEqual(result.checks.map((check) => check.reasons), [['not run: bin/no-such-tool does not exist'], ['not run: no-such-script.js does not exist']]);
  });

  test('an executable file in the repository runs with its arguments as they are and its exit code is the result', () => {
    const tool = '#!/usr/bin/env node\nconsole.log(process.argv.slice(2).join(" ")); process.exit(4);\n';
    const entries = [
      { ...upper, id: 'tool', run: ['./bin/tool', '-c', 'exit 0'], expect: { exitCode: 4, stdout: { equals: '-c exit 0' } } },
      { ...upper, id: 'option-after-script', run: ['node', 'cli.js', 'upper', '--import'], expect: { exitCode: 0, stdout: { equals: '--IMPORT' } } },
    ];
    const root = createRepository(entries, { 'bin/tool': tool });
    execFileSync('chmod', ['755', path.join(root, 'bin/tool')]);
    const result = verify(root, 'run');
    assert.deepEqual(result.checks.map((check) => [check.status, check.reasons]), [['pass', []], ['pass', []]]);
  });

  test('stdin text reaches the program', () => {
    const root = createRepository([{ ...upper, id: 'read', run: ['node', 'cli.js', 'read'], stdin: 'quiet words\n', expect: { exitCode: 0, stdout: { equals: 'QUIET WORDS' } } }]);
    assert.equal(verify(root, 'run').status, 'passed');
  });

  test('stdin from a file reaches the program', () => {
    const entry = { ...upper, id: 'read', run: ['node', 'cli.js', 'read'], stdin: { file: 'input/words.txt' }, expect: { exitCode: 0, stdout: { equals: 'FROM A FILE' } } };
    const root = createRepository([entry], { 'input/words.txt': 'from a file\n' });
    const result = verify(root, 'run');
    assert.equal(result.status, 'passed');
    assert.deepEqual(JSON.parse(readFileSync(result.evidencePath, 'utf8')).checks[0].stdin, { file: 'input/words.txt' });
  });

  test('a missing stdin file is not verified', () => {
    const root = createRepository([{ ...upper, id: 'read', run: ['node', 'cli.js', 'read'], stdin: { file: 'input/none.txt' }, expect: { exitCode: 0, stdout: { equals: 'NOTHING' } } }]);
    const result = verify(root, 'run');
    assert.equal(result.checks[0].status, 'not-verified');
    assert.deepEqual(result.checks[0].reasons, ['not run: the stdin file input/none.txt does not exist']);
    assert.match(result.report, /\$ node cli\.js read\n {2}stdin: from input\/none\.txt/);
  });

  test('env reaches the program', () => {
    const root = createRepository([{ ...upper, id: 'env', run: ['node', 'cli.js', 'env', 'GREETING'], env: { GREETING: 'good morning' }, expect: { exitCode: 0, stdout: { equals: 'good morning' } } }]);
    assert.equal(verify(root, 'run').status, 'passed');
  });

  test('color codes are removed before matching', () => {
    const root = createRepository([{ ...upper, id: 'color', run: ['node', 'cli.js', 'color'], expect: { exitCode: 0, stdout: { equals: 'green' } } }]);
    assert.equal(verify(root, 'run').status, 'passed');
  });

  test('every rule in a list must hold', () => {
    const root = createRepository([{ ...upper, expect: { exitCode: 0, stdout: [{ includes: 'AB' }, { matches: '^ABX$' }] } }]);
    assert.deepEqual(verify(root, 'run').checks[0].reasons, ['stdout does not match "^ABX$"']);
  });

  test('run --id runs only the named check', () => {
    const root = createRepository([upper, { ...upper, id: 'upper-wrong', expect: { exitCode: 0, stdout: { equals: 'ABD' } } }]);
    const result = verify(root, 'run', '--id', 'upper');
    assert.equal(result.status, 'passed');
    assert.deepEqual(result.checks.map((check) => check.id), ['upper']);
  });

  test('run --id with an unknown id is refused', () => {
    const root = createRepository([upper]);
    const result = verify(root, 'run', '--id', 'nope');
    assert.equal(result.exit, 2);
    assert.match(result.error, /no check with id nope/);
  });

  test('run --map reads another file', () => {
    const root = createRepository(undefined, { 'checks/map.json': JSON.stringify({ features: [upper] }) });
    assert.equal(verify(root, 'run', '--map', 'checks/map.json').status, 'passed');
  });
});

describe('files', () => {
  const save = {
    id: 'save', feature: 'Saves a value to a file', run: ['node', 'cli.js', 'save', 'abc'], expect: { exitCode: 0, files: [{ path: 'saved.txt', includes: 'saved abc' }] },
  };

  test('a file the command writes passes', () => {
    const root = createRepository([save]);
    const result = verify(root, 'run');
    assert.equal(result.status, 'passed');
    const evidence = JSON.parse(readFileSync(result.evidencePath, 'utf8'));
    assert.deepEqual(evidence.checks[0].files[0], { path: 'saved.txt', existedBefore: false, exists: true, written: true, content: 'saved abc' });
  });

  test('a file that existed before and was not written by this run fails', () => {
    const root = createRepository([{ ...save, run: ['node', 'cli.js', 'upper', 'abc'] }], { 'saved.txt': 'saved xyz' });
    assert.deepEqual(verify(root, 'run').checks[0].reasons, ['saved.txt was not written by this run']);
  });

  test('a file whose content before the run already satisfies its rule is not verified', () => {
    const root = createRepository([save], { 'saved.txt': 'saved abc' });
    const result = verify(root, 'run');
    assert.equal(result.status, 'not-verified');
    assert.deepEqual(result.checks[0].reasons, [
      'not run: saved.txt already satisfies its rule (include "saved abc") before the run, so the check cannot fail; write its starting content again, or write it empty, before running this check',
    ]);
    const fresh = createRepository([save]);
    assert.equal(verify(fresh, 'run').status, 'passed');
    assert.equal(verify(fresh, 'run').checks[0].status, 'not-verified');
    writeFileSync(path.join(fresh, 'saved.txt'), '');
    assert.equal(verify(fresh, 'run').status, 'passed');
  });

  test('a file whose modification time changed but content did not is not counted as written', () => {
    const root = createRepository([{ ...save, run: ['node', 'cli.js', 'touch', 'saved.txt'] }], { 'saved.txt': 'saved xyz' });
    const result = verify(root, 'run');
    assert.deepEqual(result.checks[0].reasons, ['saved.txt was not written by this run']);
    assert.equal(JSON.parse(readFileSync(result.evidencePath, 'utf8')).checks[0].files[0].written, false);
  });

  test('a missing file fails', () => {
    const root = createRepository([{ ...save, run: ['node', 'cli.js', 'upper', 'abc'] }]);
    assert.deepEqual(verify(root, 'run').checks[0].reasons, ['saved.txt was not created']);
  });

  test('a file expectation without a content rule is refused', () => {
    const root = createRepository([{ ...save, expect: { exitCode: 0, files: [{ path: 'saved.txt' }] } }]);
    const result = verify(root, 'run');
    assert.equal(result.exit, 2);
    assert.deepEqual(result.problems, [
      "features[0] (save).expect.files[0] needs one of includes, matches, equals, because a file that was written does not show the feature's result",
    ]);
    assert.equal(existsSync(path.join(root, 'saved.txt')), false);
  });

  test('a file whose content before the run satisfies its rule once whitespace is ignored is not verified', () => {
    const pretty = "const fs = require('node:fs');\nconst file = process.argv[2];\nfs.writeFileSync(file, JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')), null, 2));\n";
    const finish = {
      id: 'finish', feature: 'Marks the first item done', run: ['node', 'tools/pretty.js', 'verify-checks/items.json'],
      expect: { exitCode: 0, files: [{ path: 'verify-checks/items.json', includes: '"done": true' }] },
    };
    const root = createRepository([finish], { 'tools/pretty.js': pretty, 'verify-checks/items.json': '[{"text":"first","done":false},{"text":"second","done":true}]\n' });
    const result = verify(root, 'run');
    assert.equal(result.status, 'not-verified');
    assert.deepEqual(result.checks[0].reasons, [
      'not run: verify-checks/items.json already satisfies its rule (include "\\"done\\": true") before the run once whitespace is ignored, so a command that only rewrites its layout would pass; write a starting content that does not hold the expected text, or write it empty, before running this check',
    ]);
  });

  test('a file with the wrong content fails', () => {
    const root = createRepository([{ ...save, expect: { exitCode: 0, files: [{ path: 'saved.txt', includes: 'saved xyz' }] } }]);
    assert.deepEqual(verify(root, 'run').checks[0].reasons, ['saved.txt does not include "saved xyz"']);
  });
});

describe('malformed map', () => {
  test('a missing map is refused with its path', () => {
    const root = createRepository();
    const result = verify(root, 'run');
    assert.equal(result.exit, 2);
    assert.equal(result.error, 'no feature map at verify.features.json');
  });

  test('a map that is not JSON is refused', () => {
    const root = createRepository('{ "features": [');
    const result = verify(root, 'run');
    assert.equal(result.exit, 2);
    assert.match(result.error, /not valid JSON/);
  });

  test('a map with problems runs nothing and lists every problem', () => {
    const root = createRepository([{ ...upper, expect: { exitCode: 0 } }, { ...upper, stdOut: 1 }]);
    const result = verify(root, 'run');
    assert.equal(result.exit, 2);
    assert.deepEqual(result.problems, [
      "features[0] (upper).expect needs stdout, stderr, or files, because an exit code alone does not show the feature's result",
      'features[1] (upper) has an unknown key "stdOut"',
      'features[1] (upper).id is used twice',
    ]);
    assert.equal(existsSync(path.join(root, '.git', 'lim', 'verify', 'runs')), false);
  });

  test('outside a git repository the script says why it needs one', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'verify-plain-'));
    const result = spawnSync('node', [script, 'run'], { cwd: folder, encoding: 'utf8', env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(folder) } });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /verify needs a git repository/);
  });
});

describe('checks that cannot fail are refused', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'verify-validate-'));
  const problemsFor = (entry) => validateMap({ features: [{ ...upper, ...entry }] }, root);

  test('a pattern that matches empty output is refused', () => {
    for (const matches of ['.*', '^', '', '\\s*', 'x?']) {
      assert.match(problemsFor({ expect: { exitCode: 0, stdout: { matches } } })[0], /satisfied by empty output, so the check cannot fail/);
    }
  });

  test('a pattern that a crash satisfies is refused', () => {
    assert.match(problemsFor({ expect: { exitCode: 1, stderr: { includes: 'Error' } } })[0], /satisfied by a crash/);
    assert.match(problemsFor({ expect: { exitCode: 0, stdout: { matches: '.' } } })[0], /satisfied by undefined/);
  });

  test('expected text that is already in the command is refused', () => {
    assert.match(problemsFor({ run: ['node', 'cli.js', 'echo', 'HELLO-THERE'], expect: { exitCode: 0, stdout: { includes: 'HELLO-THERE' } } })[0], /satisfied by the command text itself/);
  });

  test('a string run is refused with the list form to use', () => {
    for (const run of ['node cli.js upper abc', '! node cli.js half', 'echo $(node cli.js half)', 'node cli.js half || true']) {
      assert.deepEqual(problemsFor({ run }), [
        'features[0] (upper).run is a string; write it as a list of the program and each argument, such as ["node", "cli.js", "--help"], because verify runs the program without a shell',
      ], run);
    }
  });

  test('a run that is not a list of strings is refused', () => {
    for (const run of [[], [''], ['node', 3], { program: 'node' }]) {
      assert.match(problemsFor({ run })[0], /\.run must be a list of strings: the program, then each argument$/, JSON.stringify(run));
    }
  });

  test('bad stdin and env are refused', () => {
    assert.match(problemsFor({ stdin: 5 })[0], /stdin must be a string or \{ "file": "<path>" \}/);
    assert.match(problemsFor({ stdin: { file: '../outside.txt' } })[0], /stdin\.file "\.\.\/outside\.txt" resolves to .+outside\.txt, outside the repository/);
    assert.match(problemsFor({ stdin: { path: 'a.txt' } })[0], /stdin has an unknown key "path"/);
    assert.match(problemsFor({ env: { 'NOT-A-NAME': '1' } })[0], /env has "NOT-A-NAME", which is not a variable name/);
    assert.match(problemsFor({ env: { '1ST': '1' } })[0], /not a variable name/);
    assert.match(problemsFor({ env: { PATH: '/tmp' } })[0], /env cannot set PATH/);
    assert.match(problemsFor({ env: { COUNT: 3 } })[0], /env\.COUNT must be a string/);
    assert.match(problemsFor({ env: ['A=1'] })[0], /env must be an object/);
  });

  test('expected text that is the stdin text is refused', () => {
    assert.match(problemsFor({ run: ['node', 'cli.js', 'read'], stdin: 'Plain Words', expect: { exitCode: 0, stdout: { includes: 'Plain Words' } } })[0], /satisfied by the stdin text/);
  });

  test('expected text that the stdin file holds is refused or not verified when the file appears during the run', () => {
    const read = { ...upper, id: 'read', run: ['node', 'cli.js', 'read'], stdin: { file: 'input/words.txt' }, expect: { exitCode: 0, stdout: { includes: 'QUIET WORDS' } } };
    const refused = verify(createRepository([read], { 'input/words.txt': 'QUIET WORDS\n' }), 'run');
    assert.equal(refused.exit, 2);
    assert.deepEqual(refused.problems, ['features[0] (read).expect.stdout.includes "QUIET WORDS" is also satisfied by the stdin file text, so the check cannot fail']);
    const save = { ...upper, id: 'save', run: ['node', 'cli.js', 'save', 'abc'], expect: { exitCode: 0, files: [{ path: 'saved.txt', equals: 'saved abc' }] } };
    const later = verify(createRepository([save, { ...read, stdin: { file: 'saved.txt' }, expect: { exitCode: 0, stdout: { matches: 'saved abc' } } }]), 'run');
    assert.deepEqual(later.checks.map((check) => check.status), ['pass', 'not-verified']);
    assert.deepEqual(later.checks[1].reasons, ['not run: the stdin file text satisfies the stdout rule (match "saved abc"), so the check cannot fail']);
  });

  test('expected text that a file named in run already holds is refused or not verified when the file appears during the run', () => {
    const echo = "process.stdout.write(require('node:fs').readFileSync(process.argv[2], 'utf8'));\n";
    const show = { id: 'show', feature: 'Shows a report', run: ['node', 'tools/show.js', 'verify-checks/report.txt'], expect: { exitCode: 0, stdout: { includes: 'total: 42' } } };
    const showHere = { ...show, id: 'show-here', cwd: 'verify-checks', run: ['node', 'tools/show.js', 'report.txt'] };
    const refused = verify(createRepository([show, showHere], { 'tools/show.js': echo, 'verify-checks/report.txt': 'total: 42\n' }), 'run');
    assert.equal(refused.exit, 2);
    assert.deepEqual(refused.problems, [
      'features[0] (show).expect.stdout.includes "total: 42" is also satisfied by the text of the file verify-checks/report.txt named in run, so the check cannot fail',
      'features[1] (show-here).expect.stdout.includes "total: 42" is also satisfied by the text of the file verify-checks/report.txt named in run, so the check cannot fail',
    ]);
    const save = { ...upper, id: 'save', run: ['node', 'cli.js', 'save', 'abc'], expect: { exitCode: 0, files: [{ path: 'saved.txt', equals: 'saved abc' }] } };
    const copy = { ...show, id: 'copy', run: ['node', 'tools/show.js', 'saved.txt'], expect: { exitCode: 0, stdout: { matches: 'saved abc' } } };
    const later = verify(createRepository([save, copy], { 'tools/show.js': echo }), 'run');
    assert.deepEqual(later.checks.map((check) => check.status), ['pass', 'not-verified']);
    assert.deepEqual(later.checks[1].reasons, ['not run: the text of the file saved.txt named in run satisfies the stdout rule (match "saved abc"), so the check cannot fail']);
  });

  test('an input file named in run that holds the expected text once whitespace is ignored is refused or not verified', () => {
    const pretty = "const fs = require('node:fs');\nfs.writeFileSync(process.argv[3], JSON.stringify(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), null, 2));\n";
    const show = "process.stdout.write(JSON.stringify(JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8')), null, 2));\n";
    const files = { 'tools/pretty.js': pretty, 'tools/show.js': show, 'verify-checks/items.json': '[{"text":"a","done":true}]' };
    const copy = { id: 'copy', feature: 'Marks an item done', run: ['node', 'tools/pretty.js', 'verify-checks/items.json', 'verify-checks/out.json'], expect: { exitCode: 0, files: [{ path: 'verify-checks/out.json', includes: '"done": true' }] } };
    const copied = verify(createRepository([copy], files), 'run');
    assert.equal(copied.exit, 2);
    assert.match(copied.problems[0], /files\[0\]\.includes .* also satisfied by the text of the file verify-checks\/items\.json named in run/);
    const print = { id: 'print', feature: 'Shows the list', run: ['node', 'tools/show.js', 'verify-checks/items.json'], expect: { exitCode: 0, stdout: { includes: '"done": true' } } };
    const printed = verify(createRepository([print], files), 'run');
    assert.equal(printed.exit, 2);
    assert.match(printed.problems[0], /also satisfied by the text of the file verify-checks\/items\.json named in run/);
  });

  test('an exit code alone is refused', () => {
    assert.match(problemsFor({ expect: { exitCode: 0 } })[0], /exit code alone does not show/);
  });

  test('bad fields are refused', () => {
    assert.deepEqual(validateMap({ features: [] }, root), ['"features" must be a non-empty list']);
    assert.match(problemsFor({ id: 'Upper Case' })[0], /id must be lowercase/);
    assert.match(problemsFor({ expect: { exitCode: '0', stdout: { equals: 'ABC' } } })[0], /exitCode must be a whole number/);
    assert.match(problemsFor({ expect: { exitCode: 0, stdout: { equals: 'ABC', includes: 'A' } } })[0], /exactly one of/);
    assert.match(problemsFor({ expect: { exitCode: 0, stdout: { matches: '(' } } })[0], /not a valid regular expression/);
    assert.match(problemsFor({ timeoutMs: 0 })[0], /timeoutMs must be/);
    assert.match(problemsFor({ cwd: '../elsewhere' })[0], /cwd "\.\.\/elsewhere" resolves to .+elsewhere, outside the repository/);
    assert.match(problemsFor({ cwd: 'missing' })[0], /cwd "missing" resolves to missing, which is not a folder in the repository$/);
    assert.match(problemsFor({ expect: { exitCode: 0, files: [{ path: '/etc/hosts' }] } })[0], /path "\/etc\/hosts" is an absolute path; paths in an entry are relative to the repository root$/);
  });

  test('a specific expectation is accepted', () => {
    assert.deepEqual(problemsFor({}), []);
  });
});

describe('only the project\'s own scripts and executables run', () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'verify-forms-')));
  for (const file of ['bin/tool', 'node_modules/.bin/eslint', 'node_modules/eslint/bin/eslint.js', '.git/hooks/check.js']) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), '#!/usr/bin/env node\n', { mode: 0o755 });
  }
  mkdirSync(path.join(root, 'verify-checks'));
  symlinkSync('/bin/sh', path.join(root, 'verify-checks/shell'));
  const problemsFor = (entry) => validateMap({ features: [{ ...upper, ...entry }] }, root);
  const allowedForms = '; a check runs only node with a script file in the repository, as ["node", "<script>", ...arguments], or a script file in the repository whose first line is #!/usr/bin/env node or #!/<path>/node with no option, as ["./bin/<tool>", ...arguments]';

  test('wrappers and package runners and shells and other interpreters are refused with the two allowed forms', () => {
    for (const run of [
      ['timeout', '20', 'sh', '-c', 'node cli.js half; exit 0'], ['nice', 'node', 'cli.js', 'half'], ['xargs', 'node', 'cli.js'],
      ['pnpm', 'exec', 'node', 'cli.js'], ['yarn', 'exec', 'node', 'cli.js'], ['bunx', 'tool'], ['bun', 'x', 'tool'], ['npm', 'run', 'check'],
      ['npx', 'tool'], ['env', 'node', 'cli.js'], ['sh', '-c', 'true'], ['bash', 'check.sh'], ['python3', '-W', 'ignore', '-c', 'print(1)'],
      ['/bin/sh', '-c', 'true'], ['/usr/bin/env', 'node', 'cli.js'],
    ]) {
      const [problem] = problemsFor({ run });
      assert.match(problem ?? '', /^features\[0\] \(upper\)\.run starts "[^"]+", (a program found on PATH|which resolves to \/)/, run.join(' '));
      assert.ok(problem.endsWith(allowedForms), problem);
    }
  });

  test('node options before the script are refused', () => {
    for (const run of [
      ['node', '--import', 'data:text/javascript,process.on("exit",()=>{process.exitCode=0})', 'cli.js', 'half'], ['node', '-e', 'console.log(1)'],
      ['node', '-p', '1'], ['node', '-r', './setup.js', 'cli.js'], ['node', '--require=./setup.js', 'cli.js'], ['node', '-W', 'ignore', 'cli.js'],
      ['node', '-'], ['node', '--', 'cli.js'],
    ]) {
      assert.equal(problemsFor({ run })[0], `features[0] (upper).run gives "node" the option ${JSON.stringify(run[1])} before the script${allowedForms}`, run.join(' '));
    }
    assert.equal(problemsFor({ run: ['node'], stdin: 'console.log(1)' })[0], `features[0] (upper).run runs "node" without a script file${allowedForms}`);
    assert.match(problemsFor({ run: ['node', 'inspect', 'cli.js'] })[0], /\.run runs "node inspect", the debugger, instead of a script file;/);
  });

  test('a script or program outside the repository or in node_modules or .git is refused', () => {
    for (const run of [
      ['node', '../elsewhere/cli.js'], ['node', '/tmp/cli.js'], ['node', 'node_modules/eslint/bin/eslint.js'], ['./node_modules/.bin/eslint'],
      ['node', '.git/hooks/check.js'], ['verify-checks/shell', '-c', 'exit 0'], ['node', 'bin'],
    ]) {
      assert.match(problemsFor({ run })[0], /, which resolves to [^;]+, not a file in the repository outside node_modules and \.git; a check runs only/, run.join(' '));
    }
    assert.match(problemsFor({ run: ['node', 'node_modules/eslint/bin/eslint.js'] })[0], /on "node_modules\/eslint\/bin\/eslint\.js", which resolves to node_modules\/eslint\/bin\/eslint\.js, not a file/);
    assert.ok(problemsFor({ run: ['verify-checks/shell', '-c', 'exit 0'] })[0]
      .includes(`starts "verify-checks/shell", which resolves to verify-checks/shell, a link to ${realpathSync('/bin/sh')}, not a file`));
  });

  test('env names that change how a program loads or runs code are refused', () => {
    for (const name of [
      'NODE_OPTIONS', 'NODE_PATH', 'NODE_REPL_EXTERNAL_MODULE', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES',
      'BASH_ENV', 'ENV', 'PYTHONSTARTUP', 'PYTHONPATH', 'PERL5OPT', 'RUBYOPT',
    ]) {
      assert.deepEqual(problemsFor({ env: { [name]: '--import=data:text/javascript,0' } }), [`features[0] (upper).env cannot set ${name}, which changes how a program loads or runs code`], name);
    }
    assert.deepEqual(problemsFor({ env: { NODE_ENV: 'test', TZ: 'UTC', LANG: 'C' } }), []);
  });

  test('HOME and USERPROFILE and OPENSSL_CONF in env are refused', () => {
    for (const name of ['HOME', 'USERPROFILE', 'OPENSSL_CONF']) {
      assert.deepEqual(problemsFor({ env: { [name]: '/tmp/elsewhere' } }), [`features[0] (upper).env cannot set ${name}, which changes how a program loads or runs code`], name);
    }
  });

  test('a copy of the node binary in the repository is refused as a program', () => {
    const entry = { ...upper, id: 'copied-node', run: ['verify-checks/n', '-e', "console.log('abc'.toUpperCase())"] };
    const copied = createRepository([entry]);
    mkdirSync(path.join(copied, 'verify-checks'));
    copyFileSync(process.execPath, path.join(copied, 'verify-checks/n'));
    const result = verify(copied, 'run');
    assert.equal(result.exit, 2);
    assert.deepEqual(result.problems, [`features[0] (copied-node).run starts "verify-checks/n", a binary file, not a script that node runs${allowedForms}`]);
  });

  test('an executable whose first line does not run node without options is refused with the two allowed forms', () => {
    const scripts = {
      'verify-checks/sh-script': ['#!/bin/sh\nexit 0\n', 'whose first line "#!/bin/sh" does not run node without options'],
      'verify-checks/env-split': ['#!/usr/bin/env -S node --require ./setup.js\n', 'whose first line "#!/usr/bin/env -S node --require ./setup.js" does not run node without options'],
      'verify-checks/env-option': ['#!/usr/bin/env node --require ./setup.js\n', 'whose first line "#!/usr/bin/env node --require ./setup.js" does not run node without options'],
      'verify-checks/node-option': ['#!/usr/local/bin/node -r ./setup.js\n', 'whose first line "#!/usr/local/bin/node -r ./setup.js" does not run node without options'],
      'verify-checks/python': ['#!/usr/bin/python3\nprint(1)\n', 'whose first line "#!/usr/bin/python3" does not run node without options'],
      'verify-checks/plain.js': ['console.log(1);\n', 'whose first line is not a #! line that runs node'],
      'verify-checks/in-repo': [`#!${root}/verify-checks/node\n`, `whose first line runs "${root}/verify-checks/node", a file in the repository, not an installed node`],
    };
    for (const [file, [content]] of Object.entries(scripts)) writeFileSync(path.join(root, file), content, { mode: 0o755 });
    for (const [file, [, problem]] of Object.entries(scripts)) {
      assert.deepEqual(problemsFor({ run: [file] }), [`features[0] (upper).run starts "${file}", ${problem}${allowedForms}`], file);
    }
  });

  test('an executable whose first line is #!/usr/bin/env node or an absolute path to node is accepted and its exit code judged', () => {
    const tool = '#!/usr/bin/env node  \nconsole.log(process.argv.slice(2).join("+")); process.exit(4);\n';
    const entries = [
      { ...upper, id: 'joined', run: ['./bin/join', 'a', 'b'], expect: { exitCode: 4, stdout: { equals: 'a+b' } } },
      { ...upper, id: 'joined-zero', run: ['./bin/join', 'a', 'b'], expect: { exitCode: 0, stdout: { equals: 'a+b' } } },
    ];
    const repository = createRepository(entries, { 'bin/join': tool });
    execFileSync('chmod', ['755', path.join(repository, 'bin/join')]);
    const result = verify(repository, 'run');
    assert.deepEqual(result.checks.map((check) => [check.status, check.reasons]), [['pass', []], ['fail', ['exit code 4, expected 0']]]);
    for (const line of ['#!/usr/local/bin/node', '#!/opt/node/bin/node \t']) {
      writeFileSync(path.join(root, 'bin/absolute'), `${line}\nconsole.log(1);\n`, { mode: 0o755 });
      assert.deepEqual(problemsFor({ run: ['./bin/absolute'] }), [], line);
    }
  });

  test('node with a script file and the project\'s own executables are accepted with any arguments after them', () => {
    for (const run of [
      ['node', 'cli.js', 'upper', 'abc'], ['node', 'cli.js', '-e', '--import', 'x'], ['node', 'verify-checks/sum.mjs', '2', '3'], ['node', './bin/tool'],
      ['./bin/tool', '--help'], ['bin/tool', 'sh', '-c', 'exit 0'],
    ]) {
      assert.deepEqual(problemsFor({ run }), [], run.join(' '));
    }
    assert.deepEqual(problemsFor({ cwd: 'bin', run: ['./bin/tool'] }), []);
  });
});

describe('paths in an entry are read from the repository root', () => {
  test('a file expectation with a path from the repository root is found when cwd is a subfolder', () => {
    const save = {
      id: 'save', feature: 'Saves a value to a file in the folder it runs in', cwd: 'app', run: ['node', 'cli.js', 'save', 'abc'],
      expect: { exitCode: 0, files: [{ path: 'app/saved.txt', includes: 'saved abc' }] },
    };
    const root = createRepository([save], { 'app/cli.js': cli });
    const result = verify(root, 'run');
    assert.deepEqual(result.checks.map((check) => [check.status, check.reasons]), [['pass', []]]);
    assert.equal(JSON.parse(readFileSync(result.evidencePath, 'utf8')).checks[0].files[0].path, 'app/saved.txt');
  });

  test('stdin.file and the script or executable in run are read from the repository root when cwd is a subfolder', () => {
    const shout = "let text = '';\nprocess.stdin.setEncoding('utf8').on('data', (chunk) => { text += chunk; })\n  .on('end', () => console.log(`${text.trim().toUpperCase()} in ${process.cwd().split('/').pop()}`));\n";
    const where = '#!/usr/bin/env node\nconsole.log(`${process.cwd().split("/").pop()}: ${require("node:fs").readFileSync(process.argv[2], "utf8").trim()}`);\n';
    const entries = [
      { ...upper, id: 'shout', cwd: 'app', run: ['node', 'tools/shout.mjs'], stdin: { file: 'verify-checks/words.txt' }, expect: { exitCode: 0, stdout: { equals: 'QUIET WORDS in app' } } },
      { ...upper, id: 'where', cwd: 'app', run: ['./bin/where', 'note.txt'], expect: { exitCode: 0, stdout: { equals: 'app: from the app folder' } } },
    ];
    const root = createRepository(entries, {
      'tools/shout.mjs': shout, 'bin/where': where, 'verify-checks/words.txt': 'quiet words\n', 'app/note.txt': 'from the app folder\n',
    });
    execFileSync('chmod', ['755', path.join(root, 'bin/where')]);
    const result = verify(root, 'run');
    assert.deepEqual(result.checks.map((check) => [check.status, check.reasons]), [['pass', []], ['pass', []]]);
  });

  test('a path that leaves the repository is refused with the path it resolves to', () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'verify-paths-')));
    mkdirSync(path.join(root, 'app'));
    writeFileSync(path.join(root, 'cli.js'), cli);
    const outside = (name) => path.join(path.dirname(root), name);
    const problems = validateMap({
      features: [{
        ...upper, cwd: 'app', run: ['node', '../cli.js'], stdin: { file: '../words.txt' },
        expect: { exitCode: 0, stdout: { equals: 'ABC' }, files: [{ path: '../saved.txt', includes: 'saved abc' }] },
      }, { ...upper, id: 'elsewhere', cwd: '../app' }],
    }, root);
    assert.deepEqual(problems, [
      `features[0] (upper).run runs "node" on "../cli.js", which resolves to ${outside('cli.js')}, not a file in the repository outside node_modules and .git; a check runs only node with a script file in the repository, as ["node", "<script>", ...arguments], or a script file in the repository whose first line is #!/usr/bin/env node or #!/<path>/node with no option, as ["./bin/<tool>", ...arguments]`,
      `features[0] (upper).stdin.file "../words.txt" resolves to ${outside('words.txt')}, outside the repository; paths in an entry are relative to the repository root`,
      `features[0] (upper).expect.files[0].path "../saved.txt" resolves to ${outside('saved.txt')}, outside the repository; paths in an entry are relative to the repository root`,
      `features[1] (elsewhere).cwd "../app" resolves to ${outside('app')}, outside the repository; paths in an entry are relative to the repository root`,
    ]);
  });
});

describe('fixed rules', () => {
  const outcome = { exitCode: 0, signal: null, timedOut: false, stdout: 'ABC\n', stderr: '' };

  test('judge passes only when exit code and every rule match', () => {
    assert.deepEqual(judge(upper, outcome), { status: 'pass', reasons: [] });
    assert.equal(judge(upper, { ...outcome, exitCode: 3 }).status, 'fail');
    assert.equal(judge(upper, { ...outcome, timedOut: true, timeoutMs: 5 }).status, 'not-verified');
    assert.equal(judge(upper, { ...outcome, exitCode: null, signal: 'SIGSEGV' }).status, 'fail');
  });

  test('equals ignores trailing whitespace and matches works per line', () => {
    assert.equal(satisfies({ equals: 'ABC' }, 'ABC\n\n'), true);
    assert.equal(satisfies({ equals: 'ABC' }, ' ABC'), false);
    assert.equal(satisfies({ matches: '^mean: 20$' }, 'sum: 60\nmean: 20\n'), true);
  });

  test('the definition hash ignores the feature sentence and follows the command and expectation', () => {
    assert.equal(definitionOf(upper), definitionOf({ ...upper, feature: 'Reworded' }));
    assert.notEqual(definitionOf(upper), definitionOf({ ...upper, run: ['node', 'cli.js', 'upper', 'abd'] }));
  });
});

describe('evidence', () => {
  test('each run is recorded under the git dir with command and exit code and output and duration', () => {
    const root = createRepository([upper]);
    const result = verify(root, 'run');
    assert.equal(path.dirname(result.evidencePath), path.join(execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: root, encoding: 'utf8' }).trim(), 'lim', 'verify', 'runs'));
    const evidence = JSON.parse(readFileSync(result.evidencePath, 'utf8'));
    const [check] = evidence.checks;
    assert.deepEqual(check.command, ['node', 'cli.js', 'upper', 'abc']);
    assert.equal(check.exitCode, 0);
    assert.equal(check.stdout, 'ABC\n');
    assert.equal(check.status, 'pass');
    assert.equal(typeof check.durationMs, 'number');
    assert.equal(evidence.map, 'verify.features.json');
    assert.equal(evidence.git.head, null);
    assert.equal(evidence.git.uncommittedFiles, 1);
    assert.match(result.report, /Ran on uncommitted changes to 1 file besides the feature map\./);
  });

  test('long output is kept as a head and tail excerpt', () => {
    const root = createRepository([{ ...upper, id: 'loud', run: ['node', 'cli.js', 'loud'], expect: { exitCode: 0, stdout: { matches: 'END$' } } }]);
    const result = verify(root, 'run');
    assert.equal(result.status, 'passed');
    const { stdout } = JSON.parse(readFileSync(result.evidencePath, 'utf8')).checks[0];
    assert.match(stdout, /\[\.\.\. 6003 characters omitted \.\.\.\]/);
    assert.ok(stdout.endsWith('END'));
  });

  test('last shows the latest run without running anything', () => {
    const root = createRepository([upper]);
    const first = verify(root, 'run');
    writeFileSync(path.join(root, 'cli.js'), 'process.exit(9);\n');
    const result = verify(root, 'last');
    assert.equal(result.exit, 0);
    assert.equal(result.evidencePath, first.evidencePath);
    assert.equal(result.status, 'passed');
    assert.equal(evidenceFiles(root).length, 1);
  });

  test('last before any run says there is no evidence', () => {
    const root = createRepository([upper]);
    assert.match(verify(root, 'last').error, /no evidence yet/);
  });

  test('only the last 20 runs are kept', () => {
    const root = createRepository([upper]);
    for (let index = 0; index < 22; index += 1) verify(root, 'run');
    assert.equal(evidenceFiles(root).length, 20);
  });

  test('last and pruning follow start time when two runs share a start time', () => {
    const root = createRepository([upper]);
    const first = verify(root, 'run');
    const runsDir = path.dirname(first.evidencePath);
    const second = first.evidencePath.replace(/\.json$/, '-2.json');
    writeFileSync(second, JSON.stringify({ ...JSON.parse(readFileSync(first.evidencePath, 'utf8')), status: 'failed' }));
    assert.equal(verify(root, 'last').evidencePath, second);
    const older = '2020-01-01T00-00-00-000Z';
    for (let sequence = 1; sequence <= 19; sequence += 1) {
      writeFileSync(path.join(runsDir, sequence === 1 ? `${older}.json` : `${older}-${sequence}.json`), '{}');
    }
    const latest = verify(root, 'run');
    const kept = evidenceFiles(root);
    assert.equal(kept.length, 20);
    assert.ok(!kept.includes(`${older}.json`) && !kept.includes(`${older}-2.json`), kept.join(' '));
    assert.ok(kept.includes(`${older}-10.json`) && kept.includes(`${older}-19.json`));
    assert.equal(verify(root, 'last').evidencePath, latest.evidencePath);
  });

  test('a check edited after it failed is marked in the report and the evidence', () => {
    const root = createRepository([{ ...upper, expect: { exitCode: 0, stdout: { equals: 'ABD' } } }]);
    assert.equal(verify(root, 'run').status, 'failed');
    writeMap(root, [upper]);
    const result = verify(root, 'run');
    assert.equal(result.status, 'passed');
    assert.equal(result.checks[0].changedAfterFail, true);
    assert.match(result.report, /Changed after it failed: upper/);
    assert.equal(verify(root, 'run').checks[0].changedAfterFail, undefined);
  });

  test('a check that passes after the code is fixed is not marked as changed', () => {
    const root = createRepository([upper]);
    writeFileSync(path.join(root, 'cli.js'), 'console.log("abc");\n');
    assert.equal(verify(root, 'run').status, 'failed');
    writeFileSync(path.join(root, 'cli.js'), cli);
    const result = verify(root, 'run');
    assert.equal(result.status, 'passed');
    assert.equal(result.checks[0].changedAfterFail, undefined);
  });

  test('a helper script in verify-checks/ edited after its check failed is marked as changed', () => {
    const fromRoot = { id: 'shout', feature: 'Shouts a word', run: ['node', 'verify-checks/shout.mjs'], expect: { exitCode: 0, stdout: { equals: 'ABC' } } };
    const fromFolder = { ...fromRoot, id: 'shout-here', cwd: 'verify-checks' };
    const root = createRepository([fromRoot, fromFolder], { 'verify-checks/shout.mjs': "console.log('abc');\n" });
    assert.equal(verify(root, 'run').status, 'failed');
    writeFileSync(path.join(root, 'verify-checks', 'shout.mjs'), "console.log('ABC');\n");
    const result = verify(root, 'run');
    assert.equal(result.status, 'passed');
    assert.deepEqual(result.checks.map((check) => check.changedAfterFail), [true, true]);
    assert.match(result.report, /Changed after it failed: shout \(verify-checks\/shout\.mjs\), shout-here \(verify-checks\/shout\.mjs\)\./);
    const evidence = JSON.parse(readFileSync(result.evidencePath, 'utf8'));
    assert.deepEqual(evidence.checks[0].changedFiles, ['verify-checks/shout.mjs']);
  });

  test('a starting file in verify-checks/ that the check rewrites is not marked as changed', () => {
    const bump = { id: 'bump', feature: 'Adds one to the count in a file', run: ['node', 'cli.js', 'bump', 'verify-checks/count.txt'], expect: { exitCode: 0, stdout: { equals: '5' } } };
    const root = createRepository([bump], { 'verify-checks/count.txt': '1' });
    assert.equal(verify(root, 'run').status, 'failed');
    assert.equal(readFileSync(path.join(root, 'verify-checks', 'count.txt'), 'utf8'), '2');
    const result = verify(root, 'run');
    assert.equal(result.status, 'failed');
    assert.equal(result.checks[0].changedAfterFail, undefined);
  });

  test('restoring a starting file in verify-checks/ to its content before the failed run is not marked as changed', () => {
    const bump = { id: 'bump', feature: 'Adds one to the count in a file', run: ['node', 'cli.js', 'bump', 'verify-checks/count.txt'], expect: { exitCode: 0, stdout: { equals: '5' } } };
    const root = createRepository([bump], { 'verify-checks/count.txt': '1' });
    const countFile = path.join(root, 'verify-checks', 'count.txt');
    assert.equal(verify(root, 'run').status, 'failed');
    writeFileSync(countFile, '1');
    assert.equal(verify(root, 'run').checks[0].changedAfterFail, undefined);
    writeFileSync(countFile, '4');
    const edited = verify(root, 'run');
    assert.equal(edited.status, 'passed');
    assert.equal(edited.checks[0].changedAfterFail, true);
  });

  test('a stdin file in verify-checks/ edited after its check failed is marked as changed', () => {
    const read = { ...upper, id: 'read', run: ['node', 'cli.js', 'read'], stdin: { file: 'verify-checks/words.txt' }, expect: { exitCode: 0, stdout: { equals: 'QUIET WORDS' } } };
    const root = createRepository([read], { 'verify-checks/words.txt': 'loud words\n' });
    assert.equal(verify(root, 'run').status, 'failed');
    writeFileSync(path.join(root, 'verify-checks', 'words.txt'), 'quiet words\n');
    const result = verify(root, 'run');
    assert.equal(result.status, 'passed');
    assert.equal(result.checks[0].changedAfterFail, true);
    assert.match(result.report, /Changed after it failed: read \(verify-checks\/words\.txt\)\./);
  });

  test('a check removed after it failed is reported by the next run whichever ids it runs', () => {
    const wrong = { ...upper, id: 'upper-wrong', expect: { exitCode: 0, stdout: { equals: 'ABD' } } };
    const root = createRepository([upper, wrong]);
    verify(root, 'run');
    writeMap(root, [upper]);
    const result = verify(root, 'run', '--id', 'upper');
    assert.match(result.report, /Removed after it failed: upper-wrong\./);
    assert.deepEqual(JSON.parse(readFileSync(result.evidencePath, 'utf8')).removedAfterFail, ['upper-wrong']);
    assert.doesNotMatch(verify(root, 'run').report, /Removed after it failed/);
  });

  test('a check removed after it failed is reported once', () => {
    const wrong = { ...upper, id: 'upper-wrong', expect: { exitCode: 0, stdout: { equals: 'ABD' } } };
    const root = createRepository([upper, wrong]);
    verify(root, 'run');
    writeMap(root, [upper]);
    const result = verify(root, 'run');
    assert.match(result.report, /Removed after it failed: upper-wrong/);
    assert.doesNotMatch(verify(root, 'run').report, /Removed after it failed/);
  });
});

describe('tree', () => {
  const loopScript = fileURLToPath(new URL('../../plugins/review-loop/skills/review-loop/scripts/loop.mjs', import.meta.url));
  const save = { ...upper, id: 'save', run: ['node', 'cli.js', 'save', 'abc'], expect: { exitCode: 0, files: [{ path: 'saved.txt', equals: 'saved abc' }] } };

  function treeOf(root) {
    const index = path.join(mkdtempSync(path.join(tmpdir(), 'verify-index-')), 'index');
    const env = { ...process.env, GIT_INDEX_FILE: index };
    execFileSync('git', ['add', '-A'], { cwd: root, env });
    execFileSync('git', ['rm', '-r', '--cached', '--ignore-unmatch', '-q', '--', '.lim-review'], { cwd: root, env });
    return execFileSync('git', ['write-tree'], { cwd: root, env, encoding: 'utf8' }).trim();
  }

  test('each run records the tree git add -A would commit before and after its checks and leaves out .lim-review', () => {
    const root = createRepository([upper, save], { '.lim-review/round-1.json': '{}' });
    const before = treeOf(root);
    const result = verify(root, 'run');
    const evidence = JSON.parse(readFileSync(result.evidencePath, 'utf8'));
    assert.equal(evidence.tree, before);
    assert.equal(evidence.treeAfter, treeOf(root));
    assert.notEqual(evidence.treeAfter, evidence.tree);
    const names = (tree) => execFileSync('git', ['ls-tree', '--name-only', tree], { cwd: root, encoding: 'utf8' }).trim().split('\n');
    assert.deepEqual(names(evidence.tree), ['cli.js', 'verify.features.json']);
    assert.deepEqual(names(evidence.treeAfter), ['cli.js', 'saved.txt', 'verify.features.json']);
    assert.deepEqual(readdirSync(path.join(root, '.git', 'lim', 'verify')).filter((name) => name.endsWith('.index')), []);
  });

  test('the tree a verify run records equals the review-loop snapshot of the same working tree', () => {
    const root = createRepository([upper], { 'notes.txt': 'one\n', 'old.txt': 'old\n' });
    const runGit = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    runGit('add', '-A');
    runGit('-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'base');
    writeFileSync(path.join(root, 'notes.txt'), 'two\n');
    runGit('add', 'notes.txt');
    writeFileSync(path.join(root, 'notes.txt'), 'three\n');
    writeFileSync(path.join(root, 'new.txt'), 'new\n');
    mkdirSync(path.join(root, '.lim-review'));
    writeFileSync(path.join(root, '.lim-review', 'round-1.json'), '{}');
    execFileSync('git', ['rm', '-q', 'old.txt'], { cwd: root });
    execFileSync('node', [loopScript, 'start'], { cwd: root, encoding: 'utf8' });
    const { reviewedTree } = JSON.parse(readFileSync(path.join(root, '.git', 'lim', 'review-loop', 'state.json'), 'utf8'));
    const evidence = JSON.parse(readFileSync(verify(root, 'run').evidencePath, 'utf8'));
    assert.equal(evidence.tree, reviewedTree);
    assert.equal(evidence.treeAfter, reviewedTree);
  });
});
