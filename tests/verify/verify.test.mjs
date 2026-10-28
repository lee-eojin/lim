import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { definitionOf, judge, satisfies, validateMap } from '../../plugins/verify/skills/verify/scripts/verify.mjs';

const script = fileURLToPath(new URL('../../plugins/verify/skills/verify/scripts/verify.mjs', import.meta.url));
const windows = process.platform === 'win32';
// A #! line names a POSIX path, so on Windows one that names a file by its C:\ path is not a #! line that runs node or python3.
const insideInterpreter = (line, name) => (windows
  ? `whose first line ${JSON.stringify(line)} does not run node or python3 without options`
  : `whose first line runs "${line.slice(2)}", a file in the repository, not an installed ${name}`);

const cli = `const fs = require('node:fs');
const [command, value] = process.argv.slice(2);
if (command === 'upper') console.log(value.toUpperCase());
else if (command === 'color') console.log('\\u001b[32mgreen\\u001b[39m');
else if (command === 'save') fs.writeFileSync('saved.txt', 'saved ' + value);
else if (command === 'touch') fs.utimesSync(value, new Date(), new Date(Date.now() + 60000));
else if (command === 'wait') setTimeout(() => console.log('done waiting'), 60000);
else if (command === 'loud') process.stdout.write('x'.repeat(10000) + 'END');
else if (command === 'flood') {
  for (let count = 0; count < 32; count += 1) fs.writeSync(1, 'a'.repeat(65536));
  fs.writeSync(1, 'FINAL ERROR');
}
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
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
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
  test('a node.exe or git.exe in the repository does not run in place of the installed one', {
    skip: !windows && 'only Windows looks for a bare program name in the working folder before PATH',
  }, () => {
    const root = createRepository([upper]);
    for (const name of ['node.exe', 'git.exe']) copyFileSync(process.env.ComSpec, path.join(root, name));
    const result = verify(root, 'run');
    assert.deepEqual(result.checks.map((check) => [check.status, check.reasons]), [['pass', []]]);
  });

  test('a node or git in a folder named by a relative PATH entry does not run in place of the installed one', {
    skip: windows && 'Windows has its own test above',
  }, () => {
    const fake = '#!/bin/sh\necho FAKE\nexit 0\n';
    const tool = { ...upper, id: 'tool', cwd: 'tools', run: ['./bin/tool', 'xyz'], expect: { exitCode: 0, stdout: { equals: 'XYZ' } } };
    const root = createRepository([{ ...upper, cwd: 'tools' }, tool], {
      'tools/node': fake, 'bin/tool': '#!/usr/bin/env node\nconsole.log(process.argv[2].toUpperCase());\n',
    });
    for (const file of ['tools/node', 'bin/tool']) chmodSync(path.join(root, file), 0o755);
    const statuses = () => verifyWith({ PATH: `.::${process.env.PATH}` }, root, 'run').checks?.map((check) => [check.status, check.reasons]);
    assert.deepEqual(statuses(), [['pass', []], ['pass', []]]);
    writeFileSync(path.join(root, 'git'), fake, { mode: 0o755 });
    assert.deepEqual(statuses(), [['pass', []], ['pass', []]]);
  });

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
    chmodSync(path.join(root, 'bin/tool'), 0o755);
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

  test('an equals or matches rule that only repeats a run argument is refused', () => {
    for (const rule of [{ equals: 'HELLO-THERE' }, { matches: '^HELLO-THERE$' }, { equals: 'HELLO - THERE' }]) {
      assert.match(problemsFor({ run: ['node', 'cli.js', 'echo', 'HELLO-THERE'], expect: { exitCode: 0, stdout: rule } })[0] ?? '', /satisfied by the run argument "HELLO-THERE", so the check cannot fail/, JSON.stringify(rule));
    }
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

  test('a file named in run or a stdin file that cannot be read makes only that check not verified', {
    skip: (windows || process.getuid?.() === 0) && 'mode 000 does not stop Windows or root from reading a file',
  }, () => {
    const show = { id: 'show', feature: 'Shows a report', run: ['node', 'cli.js', 'upper', 'verify-checks/locked.txt'], expect: { exitCode: 0, stdout: { equals: 'VERIFY-CHECKS/LOCKED.TXT' } } };
    const read = { ...upper, id: 'read', run: ['node', 'cli.js', 'read'], stdin: { file: 'verify-checks/locked.txt' }, expect: { exitCode: 0, stdout: { equals: 'QUIET' } } };
    const root = createRepository([upper, show, read], { 'verify-checks/locked.txt': 'quiet\n' });
    chmodSync(path.join(root, 'verify-checks/locked.txt'), 0o000);
    const result = verify(root, 'run');
    assert.equal(result.exit, 1);
    assert.deepEqual(result.checks.map((check) => [check.status, check.reasons]), [
      ['pass', []],
      ['not-verified', ['not run: the file verify-checks/locked.txt named in run cannot be read (EACCES)']],
      ['not-verified', ['not run: the stdin file verify-checks/locked.txt cannot be read (EACCES)']],
    ]);
    assert.equal(JSON.parse(readFileSync(result.evidencePath, 'utf8')).tree, null);
    assert.match(result.report, /git could not record the working tree, so this run records no tree; review-loop cannot use it as evidence/);
  });

  test('a script that cannot be read makes only that check not verified', {
    skip: (windows || process.getuid?.() === 0) && 'mode 000 does not stop Windows or root from reading a file',
  }, () => {
    const scripts = { 'verify-checks/locked.mjs': 'console.log("hi");\n', 'verify-checks/locked.py': 'print("hi")\n', 'verify-checks/locked': '#!/usr/bin/env node\nconsole.log("hi");\n' };
    const locked = [['node', 'verify-checks/locked.mjs'], ['python3', 'verify-checks/locked.py'], ['./verify-checks/locked']]
      .map((run, index) => ({ id: `locked-${index}`, feature: 'Says hi', run, expect: { exitCode: 0, stdout: { equals: 'hi' } } }));
    const root = createRepository([upper, ...locked], scripts);
    for (const file of Object.keys(scripts)) chmodSync(path.join(root, file), 0o000);
    const result = verify(root, 'run');
    assert.equal(result.exit, 1, result.error);
    assert.deepEqual(result.checks.map((check) => [check.status, check.reasons]), [
      ['pass', []],
      ['not-verified', ['not run: verify-checks/locked.mjs cannot be read (EACCES)']],
      ['not-verified', ['not run: verify-checks/locked.py cannot be read (EACCES)']],
      ['not-verified', ['not run: verify-checks/locked cannot be read (EACCES)']],
    ]);
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
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'verify-forms-')));
  for (const file of ['bin/tool', 'node_modules/.bin/eslint', 'node_modules/eslint/bin/eslint.js', '.git/hooks/check.js']) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), '#!/usr/bin/env node\n', { mode: 0o755 });
  }
  mkdirSync(path.join(root, 'verify-checks'));
  symlinkSync(process.execPath, path.join(root, 'verify-checks/shell'));
  const problemsFor = (entry) => validateMap({ features: [{ ...upper, ...entry }] }, root);
  const allowedForms = '; a check runs only node or python3 with a script file in the repository, as ["node", "<script>", ...arguments] or ["python3", "<script>", ...arguments], or a script file in the repository whose first line is #!/usr/bin/env node, #!/usr/bin/env python3, #!/<path>/node, or #!/<path>/python3 with no option, as ["./bin/<tool>", ...arguments]';

  test('wrappers and package runners and shells and other interpreters are refused with the two allowed forms', () => {
    for (const run of [
      ['timeout', '20', 'sh', '-c', 'node cli.js half; exit 0'], ['nice', 'node', 'cli.js', 'half'], ['xargs', 'node', 'cli.js'],
      ['pnpm', 'exec', 'node', 'cli.js'], ['yarn', 'exec', 'node', 'cli.js'], ['bunx', 'tool'], ['bun', 'x', 'tool'], ['npm', 'run', 'check'],
      ['npx', 'tool'], ['env', 'node', 'cli.js'], ['sh', '-c', 'true'], ['bash', 'check.sh'], ['python', 'tool.py'], ['python3.12', 'tool.py'],
      ['/bin/sh', '-c', 'true'], ['/usr/bin/env', 'node', 'cli.js'],
    ]) {
      const [problem] = problemsFor({ run });
      assert.match(problem ?? '', /^features\[0\] \(upper\)\.run starts "[^"]+", (a program found on PATH|which resolves to (\/|[A-Z]:\\))/, run.join(' '));
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
      assert.match(problemsFor({ run })[0], /, which resolves to [^;]+, not a file in the repository outside node_modules, \.git, \.venv, venv, and __pycache__; a check runs only/, run.join(' '));
    }
    assert.match(problemsFor({ run: ['node', 'node_modules/eslint/bin/eslint.js'] })[0], /on "node_modules\/eslint\/bin\/eslint\.js", which resolves to node_modules\/eslint\/bin\/eslint\.js, not a file/);
    assert.ok(problemsFor({ run: ['verify-checks/shell', '-c', 'exit 0'] })[0]
      .includes(`starts "verify-checks/shell", which resolves to verify-checks/shell, a link to ${realpathSync.native(process.execPath)}, not a file`));
  });

  test('a path into node_modules in other letter case is refused as the file it resolves to, not a link', {
    skip: !existsSync(path.join(root, 'NODE_MODULES')) && 'the file system tells letter case apart',
  }, () => {
    const [problem] = problemsFor({ run: ['node', 'Node_Modules/eslint/bin/eslint.js'] });
    assert.match(problem ?? '', /on "Node_Modules\/eslint\/bin\/eslint\.js", which resolves to node_modules\/eslint\/bin\/eslint\.js, not a file in the repository outside node_modules/);
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

  test('env names are refused in any case, because Windows reads a name in any case', () => {
    for (const name of ['node_options', 'Node_Options', 'PythonPath', 'ld_preload', 'Home']) {
      assert.deepEqual(problemsFor({ env: { [name]: 'x' } }), [`features[0] (upper).env cannot set ${name}, which changes how a program loads or runs code`], name);
    }
    for (const name of ['Path', 'path']) {
      assert.deepEqual(problemsFor({ env: { [name]: 'x' } }), ['features[0] (upper).env cannot set PATH, so the program that runs is the one the map names'], name);
    }
    assert.deepEqual(problemsFor({ env: { node_env: 'test' } }), []);
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
    assert.deepEqual(result.problems, [`features[0] (copied-node).run starts "verify-checks/n", a binary file, not a script that node or python3 runs${allowedForms}`]);
  });

  test('a compiled addon or a binary file is refused as the script node runs', () => {
    writeFileSync(path.join(root, 'verify-checks/convert.node'), Buffer.from('\x7fELF\x02\x01\x01\x00\x00\x00', 'latin1'));
    writeFileSync(path.join(root, 'verify-checks/text.node'), 'console.log(1);\n');
    writeFileSync(path.join(root, 'verify-checks/blob.js'), Buffer.from('console.log(1);\x00\x01', 'latin1'));
    symlinkSync('convert.node', path.join(root, 'verify-checks/addon.js'));
    for (const [script, problem] of [
      ['verify-checks/convert.node', 'a compiled addon, not a script that node runs'],
      ['verify-checks/text.node', 'a compiled addon, not a script that node runs'],
      ['verify-checks/addon.js', 'a compiled addon, not a script that node runs'],
      ['verify-checks/blob.js', 'a binary file, not a script that node runs'],
    ]) {
      assert.deepEqual(problemsFor({ run: ['node', script, '212'] }), [`features[0] (upper).run runs "node" on "${script}", ${problem}${allowedForms}`], script);
    }
  });

  test('an executable whose first line does not run node without options is refused with the two allowed forms', () => {
    const scripts = {
      'verify-checks/sh-script': ['#!/bin/sh\nexit 0\n', 'whose first line "#!/bin/sh" does not run node or python3 without options'],
      'verify-checks/env-split': ['#!/usr/bin/env -S node --require ./setup.js\n', 'whose first line "#!/usr/bin/env -S node --require ./setup.js" does not run node or python3 without options'],
      'verify-checks/env-option': ['#!/usr/bin/env node --require ./setup.js\n', 'whose first line "#!/usr/bin/env node --require ./setup.js" does not run node or python3 without options'],
      'verify-checks/node-option': ['#!/usr/local/bin/node -r ./setup.js\n', 'whose first line "#!/usr/local/bin/node -r ./setup.js" does not run node or python3 without options'],
      'verify-checks/python': ['#!/usr/bin/python\nprint(1)\n', 'whose first line "#!/usr/bin/python" does not run node or python3 without options'],
      'verify-checks/plain.js': ['console.log(1);\n', 'whose first line is not a #! line that runs node or python3'],
      'verify-checks/in-repo': [`#!${root}/verify-checks/node\n`, insideInterpreter(`#!${root}/verify-checks/node`, 'node')],
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
    chmodSync(path.join(repository, 'bin/join'), 0o755);
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

describe('python3 scripts', () => {
  const greet = [
    'import sys',
    'name = sys.argv[1]',
    'if not name.isalpha():',
    '    print(f"not a name: {name}", file=sys.stderr)',
    '    sys.exit(3)',
    'print(f"Hello, {name.title()}!")',
    '',
  ].join('\n');
  const stock = 'def restock(levels, minimum):\n    return sorted(name for name, count in levels.items() if count < minimum)\n';
  const rootOnPath = 'sys.path.insert(0, str(Path(__file__).resolve().parent.parent))';
  const lowStock = [
    'import json',
    'import sys',
    'from pathlib import Path',
    rootOnPath,
    'from shelf.stock import restock',
    'print(json.dumps(restock({"bolts": 3, "nuts": 12, "washers": 1}, int(sys.argv[1]))))',
    '',
  ].join('\n');
  const library = { 'shelf/__init__.py': '', 'shelf/stock.py': stock, 'verify-checks/low_stock.py': lowStock };
  const lowStockCheck = {
    id: 'low-stock', feature: 'Lists items below the minimum', run: ['python3', 'verify-checks/low_stock.py', '5'],
    expect: { exitCode: 0, stdout: { equals: '["bolts", "washers"]' } },
  };

  function foldersNamed(folder, name) {
    return readdirSync(folder, { withFileTypes: true }).filter((item) => item.isDirectory() && item.name !== '.git').flatMap((item) => {
      const inner = path.join(folder, item.name);
      return [...(item.name === name ? [inner] : []), ...foldersNamed(inner, name)];
    });
  }

  test('python3 with a script file in the repository passes and fails on its exit code and output', () => {
    const entries = [
      { id: 'greet', feature: 'Greets a name', run: ['python3', 'tools/greet.py', 'ada'], expect: { exitCode: 0, stdout: { equals: 'Hello, Ada!' } } },
      { id: 'greet-digits', feature: 'Rejects a name with digits', run: ['python3', 'tools/greet.py', 'r2d2'], expect: { exitCode: 3, stderr: { equals: 'not a name: r2d2' } } },
      { id: 'greet-shout', feature: 'Greets a name in capitals', run: ['python3', 'tools/greet.py', 'ada'], expect: { exitCode: 0, stdout: { equals: 'Hello, ADA!' } } },
      { id: 'greet-exit', feature: 'Rejects a name with digits', run: ['python3', 'tools/greet.py', 'r2d2'], expect: { exitCode: 2, stderr: { includes: 'not a name' } } },
    ];
    const result = verify(createRepository(entries, { 'tools/greet.py': greet }), 'run');
    assert.equal(result.exit, 1);
    assert.deepEqual(result.checks.map((check) => [check.id, check.status, check.reasons]), [
      ['greet', 'pass', []],
      ['greet-digits', 'pass', []],
      ['greet-shout', 'fail', ['stdout does not equal "Hello, ADA!"']],
      ['greet-exit', 'fail', ['exit code 3, expected 2']],
    ]);
    assert.match(result.report, /FAIL greet-shout: Greets a name in capitals\n {2}\$ python3 tools\/greet\.py ada\n/);
  });

  test('a library helper in verify-checks/ adds the repository root itself and cannot import from an inherited PYTHONPATH', () => {
    const decoy = mkdtempSync(path.join(tmpdir(), 'verify-decoy-'));
    mkdirSync(path.join(decoy, 'shelf'));
    writeFileSync(path.join(decoy, 'shelf', '__init__.py'), '');
    writeFileSync(path.join(decoy, 'shelf', 'stock.py'), 'def restock(levels, minimum):\n    return ["bolts", "washers"]\n');
    writeFileSync(path.join(decoy, 'pantry.py'), 'print("from the decoy")\n');
    const decoyCheck = {
      id: 'no-decoy', feature: 'Finds no module from the inherited path', run: ['python3', 'verify-checks/no_decoy.py'],
      expect: { exitCode: 0, stdout: { equals: 'pantry not found' } },
    };
    const noDecoy = 'import importlib.util\nprint("pantry", "not found" if importlib.util.find_spec("pantry") is None else "found")\n';
    const broken = createRepository([lowStockCheck, decoyCheck], {
      ...library, 'shelf/stock.py': 'def restock(levels, minimum):\n    return sorted(levels)\n', 'verify-checks/no_decoy.py': noDecoy,
    });
    const result = verifyWith({ PYTHONPATH: decoy }, broken, 'run');
    assert.deepEqual(result.checks.map((check) => [check.id, check.status, check.reasons]), [
      ['low-stock', 'fail', ['stdout does not equal "[\\"bolts\\", \\"washers\\"]"']],
      ['no-decoy', 'pass', []],
    ]);
    assert.equal(JSON.parse(readFileSync(result.evidencePath, 'utf8')).checks[0].stdout, '["bolts", "nuts", "washers"]\n');
    assert.equal(verifyWith({ PYTHONPATH: decoy }, createRepository([lowStockCheck], library), 'run').status, 'passed');
  });

  test('a sitecustomize.py in the repository root or next to the script does not run before a python3 script', () => {
    const shortcut = 'import os\nprint("Hello, ADA!", flush=True)\nos._exit(0)\n';
    const entries = [
      { id: 'greet', feature: 'Greets a name', run: ['python3', 'tools/greet.py', 'ada'], expect: { exitCode: 0, stdout: { equals: 'Hello, Ada!' } } },
      { id: 'greet-shout', feature: 'Greets a name in capitals', run: ['python3', 'tools/greet.py', 'ada'], expect: { exitCode: 0, stdout: { equals: 'Hello, ADA!' } } },
    ];
    const root = createRepository(entries, { 'tools/greet.py': greet, 'sitecustomize.py': shortcut, 'tools/sitecustomize.py': shortcut });
    const result = verifyWith({ PYTHONPATH: root }, root, 'run');
    assert.deepEqual(result.checks.map((check) => [check.id, check.status, check.reasons]), [
      ['greet', 'pass', []],
      ['greet-shout', 'fail', ['stdout does not equal "Hello, ADA!"']],
    ]);
  });

  test('a run that imports a module leaves no __pycache__ folder and the same tree', () => {
    const root = createRepository([lowStockCheck], library);
    const result = verifyWith({ PYTHONDONTWRITEBYTECODE: undefined }, root, 'run');
    assert.equal(result.status, 'passed');
    assert.deepEqual(foldersNamed(root, '__pycache__'), []);
    const evidence = JSON.parse(readFileSync(result.evidencePath, 'utf8'));
    assert.equal(evidence.treeAfter, evidence.tree);
  });

  test('a python3 run gets PYTHONDONTWRITEBYTECODE and loses inherited PYTHONPATH and startup variables while a node run gets no change', () => {
    const names = ['PYTHONPATH', 'PYTHONDONTWRITEBYTECODE', 'PYTHONSTARTUP', 'PYTHONHOME', 'PYTHONINSPECT', 'PYTHONSAFEPATH'];
    const showPython = `import os\nprint(*(os.environ.get(name, "unset") for name in ${JSON.stringify(names)}))\n`;
    const showNode = `console.log(${JSON.stringify(names)}.map((name) => process.env[name] ?? 'unset').join(' '));\n`;
    const entries = [
      { id: 'python-env', feature: 'Shows the Python variables', run: ['python3', 'verify-checks/show_env.py'], expect: { exitCode: 0, stdout: { equals: 'unset 1 unset unset unset unset' } } },
      {
        id: 'node-env', feature: 'Shows the Python variables to node', run: ['node', 'verify-checks/show-env.js'],
        expect: { exitCode: 0, stdout: { equals: '/opt/shelf-lib unset /opt/startup.py /nowhere 1 1' } },
      },
    ];
    const root = createRepository(entries, { 'verify-checks/show_env.py': showPython, 'verify-checks/show-env.js': showNode });
    const inherited = {
      PYTHONPATH: '/opt/shelf-lib', PYTHONDONTWRITEBYTECODE: undefined, PYTHONSTARTUP: '/opt/startup.py',
      PYTHONHOME: '/nowhere', PYTHONINSPECT: '1', PYTHONSAFEPATH: '1',
    };
    const result = verifyWith(inherited, root, 'run');
    assert.deepEqual(result.checks.map((check) => [check.id, check.status, check.reasons]), [['python-env', 'pass', []], ['node-env', 'pass', []]]);
  });

  test('an inherited PYTHONPATH written in another case does not reach a python3 run', () => {
    const show = 'import os\nprint(os.environ.get("PYTHONPATH", "unset"))\n';
    const entry = { id: 'python-path', feature: 'Shows PYTHONPATH', run: ['python3', 'verify-checks/show_path.py'], expect: { exitCode: 0, stdout: { equals: 'unset' } } };
    const root = createRepository([entry], { 'verify-checks/show_path.py': show });
    const result = verifyWith({ PythonPath: '/opt/shelf-lib' }, root, 'run');
    assert.deepEqual(result.checks.map((check) => [check.status, check.reasons]), [['pass', []]]);
  });

  test('a script whose first line is #!/usr/bin/env python3 runs as an executable and its exit code is judged', () => {
    const tool = `#!/usr/bin/env python3\nimport sys\nfrom pathlib import Path\n${rootOnPath}\nfrom shelf.stock import restock\nprint(" ".join(restock({"pins": 0, "clips": 9}, int(sys.argv[1]))))\nsys.exit(4)\n`;
    const entries = [
      { id: 'restock', feature: 'Prints what to restock', run: ['./bin/restock', '2'], expect: { exitCode: 4, stdout: { equals: 'pins' } } },
      { id: 'restock-zero', feature: 'Prints what to restock', run: ['./bin/restock', '2'], expect: { exitCode: 0, stdout: { equals: 'pins' } } },
    ];
    const root = createRepository(entries, { ...library, 'bin/restock': tool });
    chmodSync(path.join(root, 'bin/restock'), 0o755);
    const result = verify(root, 'run');
    assert.deepEqual(result.checks.map((check) => [check.status, check.reasons]), [['pass', []], ['fail', ['exit code 4, expected 0']]]);
    assert.deepEqual(foldersNamed(root, '__pycache__'), []);
  });

  describe('refusals', () => {
    const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'verify-python-')));
    const files = {
      'tools/greet.py': greet, '.venv/bin/greet.py': greet, 'venv/lib/greet.py': greet, 'tools/__pycache__/greet.py': greet,
      'bin/absolute': '#!/usr/bin/python3\nprint(1)\n', 'bin/elsewhere': '#!/opt/python/bin/python3 \t\nprint(1)\n',
      'bin/isolated': '#!/usr/bin/env python3 -I\nprint(1)\n', 'bin/split': '#!/usr/bin/env -S python3 -I\nprint(1)\n',
      'bin/unversioned': '#!/usr/bin/env python\nprint(1)\n', 'bin/inside': `#!${root}/bin/python3\nprint(1)\n`,
    };
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), content, { mode: 0o755 });
    }
    writeFileSync(path.join(root, 'tools/greet.pyc'), Buffer.from([0xcb, 0x0d, 0x0d, 0x0a, 0, 0, 0, 0]));
    const archive = execFileSync('python3', ['-c', [
      'import io, sys, zipfile',
      'buffer = io.BytesIO()',
      'with zipfile.ZipFile(buffer, "w") as archive: archive.writestr("__main__.py", "print(1)")',
      'sys.stdout.buffer.write(buffer.getvalue())',
    ].join('\n')]);
    const padded = (firstLine) => Buffer.concat([Buffer.from(firstLine + 'print("Hello")\n'.repeat(20000)), archive]);
    writeFileSync(path.join(root, 'tools/padded.py'), padded(''));
    writeFileSync(path.join(root, 'bin/padded'), padded('#!/usr/bin/env python3\n'), { mode: 0o755 });
    const problemsFor = (entry) => validateMap({ features: [{ ...upper, ...entry }] }, root);
    const allowedForms = '; a check runs only node or python3 with a script file in the repository, as ["node", "<script>", ...arguments] or ["python3", "<script>", ...arguments], or a script file in the repository whose first line is #!/usr/bin/env node, #!/usr/bin/env python3, #!/<path>/node, or #!/<path>/python3 with no option, as ["./bin/<tool>", ...arguments]';

    test('python3 options before the script are refused', () => {
      for (const run of [
        ['python3', '-c', 'print(1)'], ['python3', '-m', 'json.tool'], ['python3', '-I', 'tools/greet.py'], ['python3', '-W', 'ignore', 'tools/greet.py'],
        ['python3', '-'], ['python3', '--', 'tools/greet.py'],
      ]) {
        assert.deepEqual(problemsFor({ run }), [`features[0] (upper).run gives "python3" the option ${JSON.stringify(run[1])} before the script${allowedForms}`], run.join(' '));
      }
      assert.deepEqual(problemsFor({ run: ['python3'], stdin: 'print(1)' }), [`features[0] (upper).run runs "python3" without a script file${allowedForms}`]);
    });

    test('python and versioned interpreter names are refused as programs on PATH', () => {
      for (const program of ['python', 'python3.12', 'python3-config']) {
        assert.deepEqual(problemsFor({ run: [program, 'tools/greet.py'] }), [`features[0] (upper).run starts "${program}", a program found on PATH, not a file in the repository${allowedForms}`]);
      }
    });

    test('a python3 script in .venv or venv or __pycache__ or a compiled file is refused', () => {
      for (const script of ['.venv/bin/greet.py', 'venv/lib/greet.py', 'tools/__pycache__/greet.py']) {
        assert.deepEqual(problemsFor({ run: ['python3', script] }), [
          `features[0] (upper).run runs "python3" on "${script}", which resolves to ${script}, not a file in the repository outside node_modules, .git, .venv, venv, and __pycache__${allowedForms}`,
        ], script);
      }
      assert.deepEqual(problemsFor({ run: ['./.venv/bin/greet.py'] }), [
        `features[0] (upper).run starts "./.venv/bin/greet.py", which resolves to .venv/bin/greet.py, not a file in the repository outside node_modules, .git, .venv, venv, and __pycache__${allowedForms}`,
      ]);
      assert.deepEqual(problemsFor({ run: ['python3', 'tools/greet.pyc'] }), [`features[0] (upper).run runs "python3" on "tools/greet.pyc", a binary file, not a script that python3 runs${allowedForms}`]);
    });

    test('a python3 script with a long text prefix before a zip archive is refused as a zip archive', () => {
      const zipArchive = 'a zip archive, not a script that python3 runs';
      assert.deepEqual(problemsFor({ run: ['python3', 'tools/padded.py'] }), [`features[0] (upper).run runs "python3" on "tools/padded.py", ${zipArchive}${allowedForms}`]);
      assert.deepEqual(problemsFor({ run: ['bin/padded'] }), [`features[0] (upper).run starts "bin/padded", ${zipArchive}${allowedForms}`]);
    });

    test('a #! line that runs python3 with an option or another python or a python3 in the repository is refused', () => {
      const refused = {
        'bin/isolated': 'whose first line "#!/usr/bin/env python3 -I" does not run node or python3 without options',
        'bin/split': 'whose first line "#!/usr/bin/env -S python3 -I" does not run node or python3 without options',
        'bin/unversioned': 'whose first line "#!/usr/bin/env python" does not run node or python3 without options',
        'bin/inside': insideInterpreter(`#!${root}/bin/python3`, 'python3'),
      };
      for (const [file, problem] of Object.entries(refused)) {
        assert.deepEqual(problemsFor({ run: [file] }), [`features[0] (upper).run starts "${file}", ${problem}${allowedForms}`], file);
      }
      assert.deepEqual(problemsFor({ run: ['bin/absolute'] }), []);
      assert.deepEqual(problemsFor({ run: ['bin/elsewhere'] }), []);
    });

    test('PYTHONPATH and PYTHONWARNINGS and every other PYTHON name in env are refused', () => {
      for (const name of ['PYTHONPATH', 'PYTHONWARNINGS', 'PYTHONSTARTUP', 'PYTHONHOME', 'PYTHONUSERBASE', 'PYTHONDONTWRITEBYTECODE', 'PYTHONSAFEPATH']) {
        assert.deepEqual(problemsFor({ run: ['python3', 'tools/greet.py', 'ada'], env: { [name]: 'x' } }), [`features[0] (upper).env cannot set ${name}, which changes how a program loads or runs code`], name);
      }
    });

    test('an expectation that a Python crash or a printed None satisfies is refused', () => {
      assert.match(problemsFor({ expect: { exitCode: 1, stderr: { includes: 'Traceback' } } })[0], /stderr\.includes "Traceback" is also satisfied by a Python crash, so the check cannot fail$/);
      assert.match(problemsFor({ expect: { exitCode: 1, stderr: { matches: 'No module named' } } })[0], /is also satisfied by a Python crash/);
      assert.match(problemsFor({ expect: { exitCode: 1, stderr: { includes: 'can only concatenate' } } })[0], /is also satisfied by a Python crash/);
      assert.match(problemsFor({ expect: { exitCode: 0, stdout: { equals: 'None' } } })[0], /stdout\.equals "None" is also satisfied by None, so the check cannot fail$/);
    });
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
    const shout = "let text = '';\nprocess.stdin.setEncoding('utf8').on('data', (chunk) => { text += chunk; })\n  .on('end', () => console.log(`${text.trim().toUpperCase()} in ${process.cwd().split(/[\\\\/]/).pop()}`));\n";
    const where = '#!/usr/bin/env node\nconsole.log(`${require("node:path").basename(process.cwd())}: ${require("node:fs").readFileSync(process.argv[2], "utf8").trim()}`);\n';
    const entries = [
      { ...upper, id: 'shout', cwd: 'app', run: ['node', 'tools/shout.mjs'], stdin: { file: 'verify-checks/words.txt' }, expect: { exitCode: 0, stdout: { equals: 'QUIET WORDS in app' } } },
      { ...upper, id: 'where', cwd: 'app', run: ['./bin/where', 'note.txt'], expect: { exitCode: 0, stdout: { equals: 'app: from the app folder' } } },
    ];
    const root = createRepository(entries, {
      'tools/shout.mjs': shout, 'bin/where': where, 'verify-checks/words.txt': 'quiet words\n', 'app/note.txt': 'from the app folder\n',
    });
    chmodSync(path.join(root, 'bin/where'), 0o755);
    const result = verify(root, 'run');
    assert.deepEqual(result.checks.map((check) => [check.status, check.reasons]), [['pass', []], ['pass', []]]);
  });

  test('a path that leaves the repository is refused with the path it resolves to', () => {
    const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'verify-paths-')));
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
      `features[0] (upper).run runs "node" on "../cli.js", which resolves to ${outside('cli.js')}, not a file in the repository outside node_modules, .git, .venv, venv, and __pycache__; a check runs only node or python3 with a script file in the repository, as ["node", "<script>", ...arguments] or ["python3", "<script>", ...arguments], or a script file in the repository whose first line is #!/usr/bin/env node, #!/usr/bin/env python3, #!/<path>/node, or #!/<path>/python3 with no option, as ["./bin/<tool>", ...arguments]`,
      `features[0] (upper).stdin.file "../words.txt" resolves to ${outside('words.txt')}, outside the repository; paths in an entry are relative to the repository root`,
      `features[0] (upper).expect.files[0].path "../saved.txt" resolves to ${outside('saved.txt')}, outside the repository; paths in an entry are relative to the repository root`,
      `features[1] (elsewhere).cwd "../app" resolves to ${outside('app')}, outside the repository; paths in an entry are relative to the repository root`,
    ]);
  });

  test('a cwd or file path that leaves the repository through a symbolic link is refused before anything runs', () => {
    const outside = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'verify-outside-')));
    const save = {
      id: 'save', feature: 'Saves a value to a file in the folder it runs in', cwd: 'linked', run: ['node', 'cli.js', 'save', 'abc'],
      expect: { exitCode: 0, files: [{ path: 'linked/saved.txt', includes: 'saved abc' }, { path: 'linked/new/saved.txt', includes: 'saved abc' }] },
    };
    const root = createRepository([save]);
    symlinkSync(outside, path.join(root, 'linked'), 'junction');
    const linked = path.join(realpathSync.native(root), 'linked');
    const result = verify(root, 'run');
    assert.equal(result.exit, 2);
    assert.deepEqual(result.problems, [
      `features[0] (save).cwd "linked" resolves to ${linked}, a link to ${outside}, outside the repository; paths in an entry are relative to the repository root`,
      `features[0] (save).expect.files[0].path "linked/saved.txt" resolves to ${path.join(linked, 'saved.txt')}, a link to ${path.join(outside, 'saved.txt')}, outside the repository; paths in an entry are relative to the repository root`,
      `features[0] (save).expect.files[1].path "linked/new/saved.txt" resolves to ${path.join(linked, 'new', 'saved.txt')}, a link to ${path.join(outside, 'new', 'saved.txt')}, outside the repository; paths in an entry are relative to the repository root`,
    ]);
    assert.equal(existsSync(path.join(outside, 'saved.txt')), false);
  });

  test('a link to a file that does not exist yet is followed to where it points', () => {
    const outside = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'verify-outside-')));
    const latest = {
      id: 'latest', feature: 'Writes the newest result where latest.txt points', run: ['node', 'writer.js'],
      expect: { exitCode: 0, files: [{ path: 'latest.txt', equals: 'written' }] },
    };
    const root = createRepository([latest], { 'writer.js': "require('node:fs').mkdirSync('sub');\nrequire('node:fs').writeFileSync('sub/r.txt', 'written');\n" });
    symlinkSync(path.join('sub', 'r.txt'), path.join(root, 'latest.txt'));
    symlinkSync(path.join(outside, 'r.txt'), path.join(root, 'away.txt'));
    assert.deepEqual(verify(root, 'run').checks?.map((check) => [check.status, check.reasons]), [['pass', []]]);
    const real = realpathSync.native(root);
    assert.deepEqual(validateMap({ features: [{ ...latest, expect: { exitCode: 0, files: [{ path: 'away.txt', equals: 'written' }] } }] }, real), [
      `features[0] (latest).expect.files[0].path "away.txt" resolves to ${path.join(real, 'away.txt')}, a link to ${path.join(outside, 'r.txt')}, outside the repository; paths in an entry are relative to the repository root`,
    ]);
  });

  test('a link that an earlier check makes is checked again before a later check runs or its files are read', () => {
    const outside = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'verify-outside-')));
    const link = `const fs = require('node:fs');
fs.rmSync('folder', { recursive: true });
fs.symlinkSync(${JSON.stringify(outside)}, 'folder', 'junction');
fs.symlinkSync(${JSON.stringify(outside)}, 'linked', 'junction');
console.log('made links');
`;
    const own = `const fs = require('node:fs');
fs.symlinkSync(${JSON.stringify(outside)}, 'own', 'junction');
fs.writeFileSync('own/own.txt', 'own write');
`;
    const root = createRepository([
      { id: 'link', feature: 'Makes links', run: ['node', 'link.js'], expect: { exitCode: 0, stdout: { includes: 'made links' } } },
      {
        id: 'save', feature: 'Saves a value in the folder it runs in', cwd: 'folder', run: ['node', 'cli.js', 'save', 'abc'],
        expect: { exitCode: 0, files: [{ path: 'folder/saved.txt', includes: 'saved abc' }] },
      },
      { id: 'write', feature: 'Writes a result', run: ['node', 'write.js'], expect: { exitCode: 0, files: [{ path: 'linked/result.txt', includes: 'outside write' }] } },
      { id: 'own', feature: 'Writes through its own link', run: ['node', 'own.js'], expect: { exitCode: 0, files: [{ path: 'own/own.txt', includes: 'own write' }] } },
    ], {
      'folder/.keep': '', 'link.js': link, 'own.js': own, 'write.js': "require('node:fs').writeFileSync('linked/result.txt', 'outside write');\n",
    });
    const real = realpathSync.native(root);
    const leaves = (relative, file) => `${JSON.stringify(relative)} resolves to ${path.join(real, relative)}, a link to ${path.join(outside, file)}, outside the repository; paths in an entry are relative to the repository root`;
    const result = verify(root, 'run');
    assert.deepEqual(result.checks.map((check) => [check.id, check.status, check.reasons]), [
      ['link', 'pass', []],
      ['save', 'not-verified', [`not run: cwd ${leaves('folder', '')}`, `not run: expect.files[0].path ${leaves('folder/saved.txt', 'saved.txt')}`]],
      ['write', 'not-verified', [`not run: expect.files[0].path ${leaves('linked/result.txt', 'result.txt')}`]],
      ['own', 'not-verified', [`own/own.txt was not judged: ${leaves('own/own.txt', 'own.txt')}`]],
    ]);
    assert.deepEqual(readdirSync(outside), ['own.txt']);
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

  test('output cut off at the capture limit is not judged, so its rules neither pass nor fail', () => {
    const flood = { ...upper, id: 'flood', run: ['node', 'cli.js', 'flood'], expect: { exitCode: 0, stdout: { matches: 'a$' } } };
    const root = createRepository([flood, { ...flood, id: 'flood-exit', expect: { exitCode: 4, stdout: { matches: 'a$' } } }]);
    const result = verify(root, 'run');
    const notJudged = 'stdout was not judged: it is longer than the 1048576 characters verify keeps';
    assert.deepEqual(result.checks.map((check) => [check.status, check.reasons]), [
      ['not-verified', [notJudged]],
      ['fail', ['exit code 0, expected 4', notJudged]],
    ]);
    assert.equal(JSON.parse(readFileSync(result.evidencePath, 'utf8')).checks[0].outputTruncated, true);
  });

  test('a matches rule that runs past the check time limit leaves the check not verified and the run reported', () => {
    const backtrack = {
      ...upper, id: 'backtrack', run: ['node', 'cli.js', 'upper', `${'a'.repeat(32)}!`], timeoutMs: 1000, expect: { exitCode: 0, stdout: [{ matches: '^(A+)+$' }, { matches: '^A+!$' }] },
    };
    const root = createRepository([backtrack]);
    const started = Date.now();
    const finished = spawnSync(process.execPath, [script, 'run'], { cwd: root, encoding: 'utf8', timeout: 15000 });
    assert.equal(finished.signal, null, `verify was still matching after ${Date.now() - started} ms`);
    const result = JSON.parse(finished.stdout);
    assert.deepEqual(result.checks.map((check) => [check.status, check.reasons]), [
      ['not-verified', [
        'stdout was not judged: matching "^(A+)+$" did not finish within 1000 ms',
        'stdout was not judged: matching "^(A+)+$" ran out of time first',
      ]],
    ]);
    assert.ok(existsSync(result.evidencePath));
  });

  const backtracking = `${'a'.repeat(34)}!`;
  const runWithin = (root, limitMs, ...args) => {
    const started = Date.now();
    const finished = spawnSync(process.execPath, [script, 'run', ...args], { cwd: root, encoding: 'utf8', timeout: limitMs });
    assert.equal(finished.signal, null, `verify was still matching after ${Date.now() - started} ms`);
    return JSON.parse(finished.stdout || finished.stderr);
  };

  test('a matches rule that backtracks on a run argument or a file named in run is refused within the check time limit', () => {
    const backtrack = {
      ...upper, id: 'argument', run: ['node', 'cli.js', 'upper', backtracking], timeoutMs: 500, expect: { exitCode: 0, stdout: { matches: '^(a+)+$' } },
    };
    const root = createRepository([backtrack, { ...backtrack, id: 'named-file', run: ['node', 'cli.js', 'upper', 'in.txt'] }], { 'in.txt': backtracking });
    const result = runWithin(root, 8000);
    const cannotTell = 'could not be tried against the run\'s inputs within 500 ms, so verify cannot tell whether the check can fail';
    assert.deepEqual(result.problems, [
      `features[0] (argument).expect.stdout.matches "^(a+)+$" ${cannotTell}`,
      `features[1] (named-file).expect.stdout.matches "^(a+)+$" ${cannotTell}`,
    ]);
  });

  test('a matches rule that backtracks on the starting content of its file leaves the check not run within the time limit', () => {
    const saved = {
      ...upper, id: 'saved', run: ['node', 'cli.js', 'save', 'abc'], timeoutMs: 500, expect: { exitCode: 0, files: [{ path: 'out.txt', matches: '^(a+)+$' }] },
    };
    const root = createRepository([saved], { 'out.txt': backtracking });
    const result = runWithin(root, 8000);
    assert.deepEqual(result.checks.map((check) => [check.status, check.reasons]), [
      ['not-verified', ['not run: the content of out.txt before the run could not be matched against its rule (match "^(a+)+$") within 500 ms, so verify cannot tell whether the check can fail']],
    ]);
    assert.ok(existsSync(result.evidencePath));
  });

  test('a check with many matches rules on a fast command passes within its time limit', () => {
    const lines = { 'lines.js': 'for (let line = 0; line < 100; line += 1) console.log(`line ${line} ok`);\n' };
    const rules = Array.from({ length: 100 }, (_, line) => ({ matches: `^line ${line} ok$` }));
    const root = createRepository([{ ...upper, id: 'lines', run: ['node', 'lines.js'], timeoutMs: 500, expect: { exitCode: 0, stdout: rules } }], lines);
    assert.deepEqual(verify(root, 'run').checks.map((check) => [check.status, check.reasons]), [['pass', []]]);
  });

  test('matching before a check runs and on its output gets at most 2000 ms, so a check does not take twice its time limit', () => {
    const starting = {
      ...upper, id: 'starting', run: ['node', 'cli.js', 'save', 'abc'], timeoutMs: 5000, expect: { exitCode: 0, files: [{ path: 'out.txt', matches: '^(a+)+$' }] },
    };
    const output = { ...upper, id: 'output', run: ['node', 'cli.js', 'upper', backtracking], timeoutMs: 5000, expect: { exitCode: 0, stdout: { matches: '^(A+)+$' } } };
    const root = createRepository([starting, output], { 'out.txt': backtracking });
    const result = runWithin(root, 7000);
    assert.deepEqual(result.checks.map((check) => [check.status, check.reasons]), [
      ['not-verified', ['not run: the content of out.txt before the run could not be matched against its rule (match "^(a+)+$") within 2000 ms, so verify cannot tell whether the check can fail']],
      ['not-verified', ['stdout was not judged: matching "^(A+)+$" did not finish within 2000 ms']],
    ]);
  });

  test('a pattern that throws on a huge output is reported with its error at once', () => {
    const huge = { 'huge.js': "require('node:fs').writeFileSync('out.txt', 'ab'.repeat(10000000) + 'c');\n" };
    const root = createRepository([{ ...upper, id: 'huge', run: ['node', 'huge.js'], timeoutMs: 5000, expect: { exitCode: 0, files: [{ path: 'out.txt', matches: '^(?:a|b)+c$' }] } }], huge);
    const started = Date.now();
    const result = runWithin(root, 15000);
    assert.deepEqual(result.checks.map((check) => [check.status, check.reasons]), [
      ['not-verified', ['out.txt was not judged: matching "^(?:a|b)+c$" could not be evaluated: RangeError: Maximum call stack size exceeded']],
    ]);
    assert.ok(Date.now() - started < 2000, `the run took ${Date.now() - started} ms`);
  });

  test('run --id tries only the selected checks\' patterns against their inputs', () => {
    const backtrack = { ...upper, id: 'a', run: ['node', 'cli.js', 'upper', backtracking], timeoutMs: 500, expect: { exitCode: 0, stdout: { matches: '^(a+)+$' } } };
    const root = createRepository([backtrack, { ...backtrack, id: 'b' }, { ...backtrack, id: 'c' }]);
    assert.deepEqual(runWithin(root, 8000, '--id', 'a').problems, [
      'features[0] (a).expect.stdout.matches "^(a+)+$" could not be tried against the run\'s inputs within 500 ms, so verify cannot tell whether the check can fail',
    ]);
  });

  test('trying the patterns against their inputs shares one time budget for the whole map', () => {
    const backtrack = { ...upper, id: 'a', run: ['node', 'cli.js', 'upper', backtracking], timeoutMs: 2000, expect: { exitCode: 0, stdout: { matches: '^(a+)+$' } } };
    const root = realpathSync.native(createRepository(undefined));
    const started = Date.now();
    const problems = validateMap({ features: [backtrack, { ...backtrack, id: 'b' }, { ...backtrack, id: 'c' }] }, root, { deadline: Date.now() + 300 });
    assert.ok(Date.now() - started < 1500, `checking the map took ${Date.now() - started} ms`);
    assert.equal(problems.length, 3);
    assert.match(problems[0], /^features\[0\] \(a\)\.expect\.stdout\.matches "\^\(a\+\)\+\$" could not be tried against the run's inputs within \d+ ms, /);
    assert.deepEqual(problems.slice(1), ['b', 'c'].map((id, position) => (
      `features[${position + 1}] (${id}).expect.stdout.matches "^(a+)+$" could not be tried against the run's inputs before the time for checking the map ran out, so verify cannot tell whether the check can fail`
    )));
  });

  test('last --id leaves out what the run says about checks it did not select', () => {
    const gone = { ...upper, id: 'gone', expect: { exitCode: 0, stdout: { equals: 'ABD' } } };
    const second = { ...upper, id: 'second' };
    const root = createRepository([upper, second, gone]);
    verify(root, 'run');
    writeMap(root, [upper, second]);
    const run = verify(root, 'run');
    assert.match(run.report, /Removed after it failed: gone\./);
    const result = verify(root, 'last', '--id', 'upper');
    assert.doesNotMatch(result.report, /Removed after it failed/);
    const [check] = JSON.parse(readFileSync(run.evidencePath, 'utf8')).checks;
    assert.equal(result.durationMs, check.durationMs);
  });

  test('last --id reports and counts only the checks it selects', () => {
    const second = { ...upper, id: 'second', run: ['node', 'cli.js', 'upper', 'xyz'], expect: { exitCode: 0, stdout: { equals: 'XYW' } } };
    const root = createRepository([upper, second]);
    const run = verify(root, 'run');
    assert.equal(run.status, 'failed');
    const result = verify(root, 'last', '--id', 'upper');
    assert.equal(result.status, 'passed');
    assert.deepEqual(result.counts, { pass: 1, fail: 0, notVerified: 0 });
    assert.deepEqual(result.checks.map((check) => check.id), ['upper']);
    assert.match(result.report, /^verify: 1 passed, 0 failed, 0 not verified \(1 checks, /);
    assert.doesNotMatch(result.report, /second/);
    assert.equal(result.evidencePath, run.evidencePath);
    assert.equal(verify(root, 'last', '--id', 'second').status, 'failed');
    assert.match(verify(root, 'last', '--id', 'missing').error, /no check with id missing in the last run/);
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
    assert.equal(verify(root, 'run').checks[0].changedAfterFail, true);
  });

  test('a check stays marked as changed after it failed until its new definition fails once', () => {
    const wrong = { ...upper, expect: { exitCode: 0, stdout: { equals: 'ABD' } } };
    const root = createRepository([wrong]);
    assert.equal(verify(root, 'run').status, 'failed');
    writeMap(root, [{ ...upper, run: ['node', 'cli.js', 'upper', 'abd'], expect: { exitCode: 0, stdout: { equals: 'ABD' } } }]);
    for (let round = 0; round < 3; round += 1) assert.equal(verify(root, 'run').checks[0].changedAfterFail, true, `run ${round}`);
    writeMap(root, [wrong]);
    assert.equal(verify(root, 'run').checks[0].changedAfterFail, undefined);
    writeMap(root, [upper]);
    assert.equal(verify(root, 'run').checks[0].changedAfterFail, true);
    writeFileSync(path.join(root, 'cli.js'), 'console.log("ABD");\n');
    writeMap(root, [wrong]);
    assert.equal(verify(root, 'run').status, 'passed');
    writeMap(root, [upper]);
    assert.equal(verify(root, 'run').checks[0].changedAfterFail, undefined);
  });

  test('a check removed after it failed and added back changed is marked as changed', () => {
    const wrong = { ...upper, expect: { exitCode: 0, stdout: { equals: 'ABD' } } };
    const other = { ...upper, id: 'other' };
    const root = createRepository([wrong, other]);
    assert.equal(verify(root, 'run').status, 'failed');
    writeMap(root, [other]);
    assert.match(verify(root, 'run').report, /Removed after it failed: upper\./);
    writeMap(root, [upper, other]);
    assert.equal(verify(root, 'run').checks[0].changedAfterFail, true);
  });

  test('a check run from another map after it failed stays marked as changed', () => {
    const root = createRepository([{ ...upper, expect: { exitCode: 0, stdout: { equals: 'ABD' } } }]);
    assert.equal(verify(root, 'run').status, 'failed');
    writeFileSync(path.join(root, 'other.json'), JSON.stringify({ features: [upper] }));
    assert.equal(verify(root, 'run', '--map', 'other.json').checks[0].changedAfterFail, true);
    assert.equal(verify(root, 'run', '--map', 'other.json').checks[0].changedAfterFail, true);
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
    assert.doesNotMatch(result.report, /records no tree/);
  });

  test('a git failure after the checks ran keeps their results and records no tree after them', () => {
    const corrupt = { ...upper, id: 'corrupt', run: ['node', 'verify-checks/corrupt.js'], expect: { exitCode: 0, stdout: { equals: 'DONE' } } };
    const root = createRepository([corrupt], { 'verify-checks/corrupt.js': "require('node:fs').writeFileSync('.git/index', 'garbage');\nconsole.log('DONE');\n" });
    const result = verify(root, 'run');
    assert.equal(result.exit, 0);
    assert.equal(result.checks[0].status, 'pass');
    const evidence = JSON.parse(readFileSync(result.evidencePath, 'utf8'));
    assert.equal(evidence.treeAfter, null);
    assert.match(result.report, /records no tree/);
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
