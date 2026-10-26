#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, rmSync, statSync,
  utimesSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAP_FILE = 'verify.features.json';
const CHECKS_FOLDER = 'verify-checks';
const REVIEW_FOLDER = '.lim-review';
const DEFAULT_TIMEOUT_MS = 30 * 1000;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const RUN_BUDGET_MS = 9 * 60 * 1000;
const KEPT_RUNS = 20;
const CAPTURE_LIMIT = 1024 * 1024;
const EXCERPT_HEAD = 1000;
const EXCERPT_TAIL = 3000;
// After a timeout the whole process group is killed; a process that left the group can keep the pipes open.
const CLOSE_GRACE_MS = 2000;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const MATCHERS = ['includes', 'matches', 'equals'];
const ENTRY_KEYS = ['id', 'feature', 'run', 'stdin', 'env', 'cwd', 'timeoutMs', 'expect'];
const EXPECT_KEYS = ['exitCode', 'stdout', 'stderr', 'files'];
const FILE_KEYS = ['path', ...MATCHERS];
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SAFE_ARGUMENT = /^[\w@%+=:,./-]+$/;
const RUN_FORMS = 'a check runs only node with a script file in the repository, as ["node", "<script>", ...arguments], or a script file in the repository whose first line is #!/usr/bin/env node or #!/<path>/node with no option, as ["./bin/<tool>", ...arguments]';
// Either form means node runs a script in the repository: an executable must be a script whose #! line runs node with no option.
const NODE_SHEBANG = /^#!(\/usr\/bin\/env node|(?:\/\S*)?\/node)\s*$/;
const BINARY_PROBE_BYTES = 512;
const FIRST_LINE_BYTES = 4096;
// Programs in these folders are installed or kept by tools, not written for the project.
const NOT_PROJECT_FOLDERS = ['node_modules', '.git'];
// node ignores NODE_ENV; only the project's code reads it. Every other NODE_ name changes how node loads or runs code.
const ALLOWED_NODE_NAMES = new Set(['NODE_ENV']);
const LOADER_PREFIXES = ['NODE_', 'LD_', 'DYLD_'];
// node looks for modules under HOME or USERPROFILE and loads OPENSSL_CONF at startup.
const LOADER_NAMES = new Set([
  'HOME', 'USERPROFILE', 'OPENSSL_CONF', 'BASH_ENV', 'ENV', 'BASHOPTS', 'SHELLOPTS', 'PS4', 'ZDOTDIR',
  'PYTHONSTARTUP', 'PYTHONPATH', 'PYTHONHOME', 'PERL5OPT', 'PERL5LIB', 'PERLLIB', 'RUBYOPT', 'RUBYLIB',
]);
const RUN_FILE = /^(.+Z)(?:-(\d+))?\.json$/;
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const PROBES = [
  ['empty output', ''],
  ['undefined', 'undefined'],
  ['null', 'null'],
  ['NaN', 'NaN'],
  ['[object Object]', '[object Object]'],
  ['a crash', [
    'node:internal/modules/cjs/loader:1228',
    '  throw err;',
    '  ^',
    '',
    "Error: Cannot find module '/project/index.js'",
    '    at Module._resolveFilename (node:internal/modules/cjs/loader:1225:15) {',
    "  code: 'MODULE_NOT_FOUND'",
    '}',
    '',
    'Node.js v22.0.0',
  ].join('\n')],
  ['a crash', [
    'file:///project/index.js:3',
    'console.log(value.length);',
    '                  ^',
    '',
    "TypeError: Cannot read properties of undefined (reading 'length')",
    '    at file:///project/index.js:3:19',
    '',
    'Node.js v22.0.0',
  ].join('\n')],
];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const quote = (text) => JSON.stringify(text);
const cleanOutput = (text) => text.replace(ANSI, '').replace(/\r\n/g, '\n');
const rulesOf = (value) => (value === undefined ? [] : [value].flat());

class UsageError extends Error {}

export function displayCommand(run) {
  if (!Array.isArray(run)) return String(run);
  return run.map((part) => (SAFE_ARGUMENT.test(part) ? part : `'${part.replace(/'/g, "'\\''")}'`)).join(' ');
}

const insideOf = (root, target) => {
  const inside = path.relative(root, target);
  return inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside) ? null : inside;
};

// A path inside the repository is shown from its root; any other path is shown in full.
function shownPath(root, target) {
  const inside = insideOf(root, target);
  return inside === null ? target : inside || '.';
}

// The script or executable a check starts: node's script, or the program itself.
const programPath = (run) => (run[0] === 'node' ? run[1] : run[0]);

// Every path in an entry except run's arguments names a file from the repository root, whatever cwd is.
function rootPathProblem(root, relative, { file = true } = {}) {
  if (typeof relative !== 'string' || !relative) return 'must be a relative path inside the repository';
  if (path.isAbsolute(relative)) return `${quote(relative)} is an absolute path; paths in an entry are relative to the repository root`;
  const target = path.resolve(root, relative);
  const inside = insideOf(root, target);
  if (inside === null) return `${quote(relative)} resolves to ${target}, outside the repository; paths in an entry are relative to the repository root`;
  if (file && !inside) return `${quote(relative)} resolves to the repository root, not a file`;
  return null;
}

// Why a path is not a file the project itself holds, or null when it is: outside the repository or in an installed folder.
function projectFileProblem(root, relative) {
  const target = path.resolve(root, relative);
  const exists = existsSync(target);
  const real = exists ? realpathSync(target) : target;
  const resolved = `which resolves to ${shownPath(root, target)}${real === target ? '' : `, a link to ${shownPath(root, real)}`}`;
  const notProject = `${resolved}, not a file in the repository outside node_modules and .git`;
  if (exists && !statSync(target).isFile()) return notProject;
  for (const candidate of [target, real]) {
    const inside = insideOf(root, candidate);
    if (!inside || inside.split(path.sep).some((part) => NOT_PROJECT_FOLDERS.includes(part))) return notProject;
  }
  return null;
}

function firstBytes(target) {
  const buffer = Buffer.alloc(FIRST_LINE_BYTES);
  const descriptor = openSync(target, 'r');
  try {
    return buffer.subarray(0, readSync(descriptor, buffer, 0, FIRST_LINE_BYTES, 0));
  } finally {
    closeSync(descriptor);
  }
}

// Why an executable is not a script that node runs with no option, or null when it is or does not exist yet.
function executableProblem(root, target) {
  if (!existsSync(target)) return null;
  let bytes;
  try {
    bytes = firstBytes(target);
  } catch (error) {
    return `which cannot be read (${error.code})`;
  }
  if (bytes.subarray(0, BINARY_PROBE_BYTES).includes(0)) return 'a binary file, not a script that node runs';
  const [firstLine] = bytes.toString('utf8').split('\n');
  if (!firstLine.startsWith('#!')) return 'whose first line is not a #! line that runs node';
  const interpreter = NODE_SHEBANG.exec(firstLine)?.[1];
  if (!interpreter) return `whose first line ${quote(firstLine.trimEnd())} does not run node without options`;
  const real = existsSync(interpreter) ? realpathSync(interpreter) : interpreter;
  if (interpreter.startsWith('/usr/bin/env ') || ![interpreter, real].some((candidate) => insideOf(root, candidate) !== null)) return null;
  return `whose first line runs ${quote(interpreter)}, a file in the repository, not an installed node`;
}

// A check runs node with one of the project's scripts, or one of the project's node scripts as an executable, and nothing else.
export function runProblem(run, root) {
  const [program, ...args] = run;
  if (program === 'node') {
    const [script] = args;
    if (script === undefined) return 'runs "node" without a script file';
    if (script.startsWith('-')) return `gives "node" the option ${quote(script)} before the script`;
    if (script === 'inspect') return 'runs "node inspect", the debugger, instead of a script file';
    const problem = projectFileProblem(root, script);
    return problem && `runs "node" on ${quote(script)}, ${problem}`;
  }
  if (!program.includes('/')) return `starts ${quote(program)}, a program found on PATH, not a file in the repository`;
  const problem = projectFileProblem(root, program) ?? executableProblem(root, path.resolve(root, program));
  return problem && `starts ${quote(program)}, ${problem}`;
}

export function envProblem(name) {
  if (name === 'PATH') return 'cannot set PATH, so the program that runs is the one the map names';
  if (ALLOWED_NODE_NAMES.has(name)) return null;
  if (LOADER_NAMES.has(name) || LOADER_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return `cannot set ${name}, which changes how a program loads or runs code`;
  }
  return null;
}

function defaultTimeoutOf(value) {
  if (value === undefined || value === '') return DEFAULT_TIMEOUT_MS;
  const number = Number(value);
  if (!/^\d+$/.test(value.trim()) || number < 1 || number > MAX_TIMEOUT_MS) {
    throw new UsageError(`LIM_VERIFY_TIMEOUT_MS must be a whole number of milliseconds from 1 to ${MAX_TIMEOUT_MS}, not ${quote(value)}`);
  }
  return number;
}

function runOrderKey(name) {
  const match = RUN_FILE.exec(name);
  return match ? [match[1], Number(match[2] ?? 1)] : [name, 0];
}

// Two runs that start in the same millisecond get -2, -3, ...; plain name order would put -2 first.
export function compareRunFiles(left, right) {
  const [leftTime, leftSequence] = runOrderKey(left);
  const [rightTime, rightSequence] = runOrderKey(right);
  if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
  return leftSequence - rightSequence;
}

export function satisfies(rule, text) {
  if ('includes' in rule) return text.includes(rule.includes);
  if ('matches' in rule) return new RegExp(rule.matches, 'm').test(text);
  return text.trimEnd() === rule.equals.trimEnd();
}

const withoutWhitespace = (text) => text.replace(/\s+/g, '');

// A command can rewrite a file's layout without doing the feature, such as printing compact JSON pretty.
function satisfiesIgnoringWhitespace(rule, text) {
  if ('matches' in rule) return false;
  const expected = withoutWhitespace(rule.includes ?? rule.equals);
  const content = withoutWhitespace(text);
  return Boolean(expected) && ('includes' in rule ? content.includes(expected) : content === expected);
}

function describeRule(rule) {
  const [kind] = MATCHERS.filter((matcher) => matcher in rule);
  return `${kind === 'matches' ? 'match' : kind === 'equals' ? 'equal' : 'include'} ${quote(rule[kind])}`;
}

function unknownKeys(value, allowed, where) {
  return Object.keys(value).filter((key) => !allowed.includes(key)).map((key) => `${where} has an unknown key ${quote(key)}`);
}

function ruleProblems(rule, where, inputs, allowed = MATCHERS) {
  if (!isObject(rule)) return [`${where} must be an object with one of ${MATCHERS.join(', ')}`];
  const problems = unknownKeys(rule, allowed, where);
  const kinds = MATCHERS.filter((matcher) => matcher in rule);
  if (kinds.length !== 1) return [...problems, `${where} needs exactly one of ${MATCHERS.join(', ')}`];
  const [kind] = kinds;
  if (typeof rule[kind] !== 'string') return [...problems, `${where}.${kind} must be a string`];
  if (kind === 'matches') {
    try {
      new RegExp(rule.matches, 'm');
    } catch (error) {
      return [...problems, `${where}.matches is not a valid regular expression: ${error.message}`];
    }
  }
  const weak = PROBES.find(([, probe]) => satisfies(rule, probe))
    ?? inputs.find(([, probe]) => satisfies(rule, probe) || satisfiesIgnoringWhitespace(rule, probe));
  if (weak) problems.push(`${where}.${kind} ${quote(rule[kind])} is also satisfied by ${weak[0]}, so the check cannot fail`);
  return problems;
}

// The program can echo its stdin, so an expected text that the stdin already holds cannot fail.
function stdinProbes(entry, root) {
  if (typeof entry.stdin === 'string') return entry.stdin ? [['the stdin text', entry.stdin]] : [];
  if (!isObject(entry.stdin) || rootPathProblem(root, entry.stdin.file)) return [];
  const file = path.resolve(root, entry.stdin.file);
  if (!existsSync(file) || !statSync(file).isFile()) return [];
  const text = cleanOutput(readFileSync(file, 'utf8'));
  return text ? [['the stdin file text', text]] : [];
}

// The program can print or copy a file named in run, so an expected text that the file already holds cannot fail.
function argumentFiles(root, entry) {
  const realRoot = realpathSync(root);
  const cwd = path.resolve(root, typeof entry.cwd === 'string' ? entry.cwd : '.');
  const targets = new Set(entry.run.slice(entry.run[0] === 'node' ? 2 : 1).map((argument) => path.resolve(cwd, argument)));
  return [...targets].flatMap((target) => {
    if (!existsSync(target) || !statSync(target).isFile() || insideOf(realRoot, realpathSync(target)) === null) return [];
    const text = cleanOutput(readFileSync(target, 'utf8'));
    return text ? [{ label: `the text of the file ${shownPath(root, target)} named in run`, path: path.relative(root, target), text }] : [];
  });
}

function entryProblems(entry, index, root, seen) {
  const where = `features[${index}]${typeof entry?.id === 'string' ? ` (${entry.id})` : ''}`;
  if (!isObject(entry)) return [`${where} must be an object`];
  const problems = unknownKeys(entry, ENTRY_KEYS, where);
  if (typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id)) {
    problems.push(`${where}.id must be lowercase letters, digits, and hyphens`);
  } else if (seen.has(entry.id)) {
    problems.push(`${where}.id is used twice`);
  }
  seen.add(entry.id);
  if (typeof entry.feature !== 'string' || !entry.feature.trim()) problems.push(`${where}.feature must say what the feature does`);
  const runIsList = Array.isArray(entry.run) && entry.run.length > 0 && entry.run.every((part) => typeof part === 'string') && entry.run[0] !== '';
  if (typeof entry.run === 'string') {
    problems.push(`${where}.run is a string; write it as a list of the program and each argument, such as ["node", "cli.js", "--help"], because verify runs the program without a shell`);
  } else if (!runIsList) {
    problems.push(`${where}.run must be a list of strings: the program, then each argument`);
  }
  if (entry.cwd !== undefined) {
    const cwdProblem = rootPathProblem(root, entry.cwd, { file: false });
    const folder = cwdProblem ? null : path.resolve(root, entry.cwd);
    if (cwdProblem) problems.push(`${where}.cwd ${cwdProblem}`);
    else if (!existsSync(folder) || !statSync(folder).isDirectory()) problems.push(`${where}.cwd ${quote(entry.cwd)} resolves to ${shownPath(root, folder)}, which is not a folder in the repository`);
  }
  const runFormProblem = runIsList && runProblem(entry.run, root);
  if (runFormProblem) problems.push(`${where}.run ${runFormProblem}; ${RUN_FORMS}`);
  if (entry.stdin !== undefined) {
    if (isObject(entry.stdin)) {
      problems.push(...unknownKeys(entry.stdin, ['file'], `${where}.stdin`));
      const stdinProblem = rootPathProblem(root, entry.stdin.file);
      if (stdinProblem) problems.push(`${where}.stdin.file ${stdinProblem}`);
    } else if (typeof entry.stdin !== 'string') {
      problems.push(`${where}.stdin must be a string or { "file": "<path>" }`);
    }
  }
  if (entry.env !== undefined) {
    if (!isObject(entry.env)) {
      problems.push(`${where}.env must be an object of variable names and string values`);
    } else {
      for (const [name, value] of Object.entries(entry.env)) {
        if (!VARIABLE_NAME.test(name)) problems.push(`${where}.env has ${quote(name)}, which is not a variable name`);
        else if (envProblem(name)) problems.push(`${where}.env ${envProblem(name)}`);
        if (typeof value !== 'string') problems.push(`${where}.env.${name} must be a string`);
      }
    }
  }
  if (entry.timeoutMs !== undefined && !(Number.isInteger(entry.timeoutMs) && entry.timeoutMs > 0 && entry.timeoutMs <= MAX_TIMEOUT_MS)) {
    problems.push(`${where}.timeoutMs must be a whole number of milliseconds up to ${MAX_TIMEOUT_MS}`);
  }
  const expect = entry.expect;
  if (!isObject(expect)) return [...problems, `${where}.expect must be an object`];
  problems.push(...unknownKeys(expect, EXPECT_KEYS, `${where}.expect`));
  if (!Number.isInteger(expect.exitCode) || expect.exitCode < 0 || expect.exitCode > 255) {
    problems.push(`${where}.expect.exitCode must be a whole number from 0 to 255`);
  }
  const inputs = [['the command text itself', runIsList ? entry.run.join(' ') : ''], ...stdinProbes(entry, root)];
  const named = runIsList ? argumentFiles(root, entry) : [];
  // A file that a check rewrites and expects is probed just before the run instead, so a second run is not refused.
  const inputsFor = (own) => [...inputs, ...named.filter((file) => file.path !== own).map((file) => [file.label, file.text])];
  for (const stream of ['stdout', 'stderr']) {
    rulesOf(expect[stream]).forEach((rule, position, rules) => {
      const label = rules.length > 1 || Array.isArray(expect[stream]) ? `${where}.expect.${stream}[${position}]` : `${where}.expect.${stream}`;
      problems.push(...ruleProblems(rule, label, inputsFor(null)));
    });
  }
  if (expect.files !== undefined) {
    if (!Array.isArray(expect.files)) {
      problems.push(`${where}.expect.files must be a list`);
    } else {
      expect.files.forEach((file, position) => {
        const label = `${where}.expect.files[${position}]`;
        if (!isObject(file)) return problems.push(`${label} must be an object with a path`);
        const pathProblem = rootPathProblem(root, file.path);
        if (pathProblem) problems.push(`${label}.path ${pathProblem}`);
        const kinds = MATCHERS.filter((matcher) => matcher in file);
        if (kinds.length === 0) {
          problems.push(...unknownKeys(file, FILE_KEYS, label));
          problems.push(`${label} needs one of ${MATCHERS.join(', ')}, because a file that was written does not show the feature's result`);
        } else {
          const own = pathProblem ? null : path.relative(root, path.resolve(root, file.path));
          problems.push(...ruleProblems(file, label, inputsFor(own), FILE_KEYS));
        }
      });
    }
  }
  const expectsOutput = ['stdout', 'stderr'].some((stream) => rulesOf(expect[stream]).length) || expect.files?.length;
  if (!expectsOutput) problems.push(`${where}.expect needs stdout, stderr, or files, because an exit code alone does not show the feature's result`);
  return problems;
}

export function validateMap(map, root) {
  if (!isObject(map)) return ['the feature map must be a JSON object with a "features" list'];
  const problems = unknownKeys(map, ['features'], 'the feature map');
  if (!Array.isArray(map.features) || map.features.length === 0) return [...problems, '"features" must be a non-empty list'];
  const seen = new Set();
  return [...problems, ...map.features.flatMap((entry, index) => entryProblems(entry, index, root, seen))];
}

export function definitionOf(entry) {
  const definition = JSON.stringify({ run: entry.run, stdin: entry.stdin ?? null, env: entry.env ?? null, cwd: entry.cwd ?? '.', expect: entry.expect });
  return createHash('sha1').update(definition).digest('hex').slice(0, 12);
}

function excerpt(text) {
  if (text.length <= EXCERPT_HEAD + EXCERPT_TAIL) return text;
  const omitted = text.length - EXCERPT_HEAD - EXCERPT_TAIL;
  return `${text.slice(0, EXCERPT_HEAD)}\n[... ${omitted} characters omitted ...]\n${text.slice(-EXCERPT_TAIL)}`;
}

function fileState(target) {
  if (!existsSync(target) || !statSync(target).isFile()) return { exists: false };
  const content = readFileSync(target);
  return { exists: true, hash: createHash('sha1').update(content).digest('hex'), content };
}

// The program and the stdin file are named from the repository root; the program reads its arguments from cwd.
function namedCheckFiles(root, entry, cwd) {
  const folder = path.join(root, CHECKS_FOLDER) + path.sep;
  const args = entry.run.slice(entry.run[0] === 'node' ? 2 : 1);
  const fromRoot = [programPath(entry.run), ...(isObject(entry.stdin) ? [entry.stdin.file] : [])];
  const targets = [...fromRoot.map((name) => path.resolve(root, name)), ...args.map((name) => path.resolve(cwd, name))]
    .filter((target) => target.startsWith(folder));
  return [...new Set(targets)].map((target) => path.relative(root, target));
}

function hashOf(target) {
  const state = fileState(target);
  return state.exists ? state.hash.slice(0, 12) : null;
}

// The program is started by its path from the repository root, so cwd changes only the folder it starts in.
function runCommand(root, run, { cwd, timeoutMs, stdin, env: extraEnv }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const output = { stdout: '', stderr: '' };
    let truncated = false;
    let timedOut = false;
    let settled = false;
    const [program, ...args] = run[0] === 'node' ? ['node', path.resolve(root, run[1]), ...run.slice(2)] : [path.resolve(root, run[0]), ...run.slice(1)];
    const child = spawn(program, args, {
      cwd,
      detached: true,
      stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0', ...extraEnv },
    });
    if (stdin !== undefined) {
      child.stdin.on('error', () => {});
      child.stdin.end(stdin);
    }
    const collect = (stream) => (chunk) => {
      if (output[stream].length >= CAPTURE_LIMIT) {
        truncated = true;
        return;
      }
      output[stream] += chunk;
    };
    child.stdout.setEncoding('utf8').on('data', collect('stdout'));
    child.stderr.setEncoding('utf8').on('data', collect('stderr'));
    const finish = (fields) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: cleanOutput(output.stdout), stderr: cleanOutput(output.stderr), truncated, timedOut, durationMs: Date.now() - started, ...fields,
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        finish({ exitCode: null, signal: 'SIGKILL' });
      }, CLOSE_GRACE_MS).unref();
    }, timeoutMs);
    child.on('error', (error) => finish({
      exitCode: null, signal: null, startError: error.code === 'ENOENT' ? `${quote(run[0])} was not found (ENOENT)` : error.message,
    }));
    child.on('close', (exitCode, signal) => finish({ exitCode, signal }));
  });
}

export function judge(entry, outcome, files = []) {
  if (outcome.startError) return { status: 'not-verified', reasons: [`the command could not start: ${outcome.startError}`] };
  if (outcome.timedOut) return { status: 'not-verified', reasons: [`timed out after ${outcome.timeoutMs} ms`] };
  const expect = entry.expect;
  const reasons = [];
  if (outcome.exitCode === null) reasons.push(`the command was killed by ${outcome.signal}`);
  else if (outcome.exitCode !== expect.exitCode) reasons.push(`exit code ${outcome.exitCode}, expected ${expect.exitCode}`);
  for (const stream of ['stdout', 'stderr']) {
    for (const rule of rulesOf(expect[stream])) {
      if (!satisfies(rule, outcome[stream])) reasons.push(`${stream} does not ${describeRule(rule)}`);
    }
  }
  for (const file of files) {
    if (!file.after.exists) reasons.push(`${file.path} was not created`);
    else if (!file.written) reasons.push(`${file.path} was not written by this run`);
    else if (!satisfies(file.rule, file.text)) reasons.push(`${file.path} does not ${describeRule(file.rule)}`);
  }
  return { status: reasons.length ? 'fail' : 'pass', reasons };
}

function stdinOf(root, entry) {
  if (!isObject(entry.stdin)) return { text: entry.stdin };
  const file = path.resolve(root, entry.stdin.file);
  if (!existsSync(file) || !statSync(file).isFile()) return { problem: `the stdin file ${shownPath(root, file)} does not exist` };
  return { text: readFileSync(file) };
}

// Found only when the check is about to run: a file named in the map can change after the map was read.
function notRunReasons(root, entry, stdin, watched) {
  if (stdin.problem) return [stdin.problem];
  const formProblem = runProblem(entry.run, realpathSync(root));
  if (formProblem) return [`run ${formProblem}`];
  const program = path.resolve(root, programPath(entry.run));
  if (!existsSync(program)) return [`${shownPath(root, program)} does not exist`];
  const reasons = [];
  const rules = [...['stdout', 'stderr'].flatMap((stream) => rulesOf(entry.expect[stream]).map((rule) => [`the ${stream} rule`, rule, null])),
    ...watched.map((file) => [`the rule for ${file.path}`, file.rule, file.path])];
  const sources = [
    ...(isObject(entry.stdin) ? [['the stdin file text', cleanOutput(stdin.text.toString('utf8')), null]] : []),
    ...argumentFiles(root, entry).map((file) => [file.label, file.text, file.path]),
  ];
  for (const [source, text, sourcePath] of sources) {
    for (const [label, rule, rulePath] of rules) {
      if (sourcePath && sourcePath === rulePath) continue;
      if (!text) continue;
      if (satisfies(rule, text)) reasons.push(`${source} satisfies ${label} (${describeRule(rule)}), so the check cannot fail`);
      else if (satisfiesIgnoringWhitespace(rule, text)) {
        reasons.push(`${source} satisfies ${label} (${describeRule(rule)}) once whitespace is ignored, so a command that only copies or reformats it would pass`);
      }
    }
  }
  for (const file of watched.filter((watchedFile) => watchedFile.before.exists)) {
    const content = cleanOutput(file.before.content.toString('utf8'));
    if (satisfies(file.rule, content)) {
      reasons.push(`${file.path} already satisfies its rule (${describeRule(file.rule)}) before the run, so the check cannot fail; write its starting content again, or write it empty, before running this check`);
    } else if (satisfiesIgnoringWhitespace(file.rule, content)) {
      reasons.push(`${file.path} already satisfies its rule (${describeRule(file.rule)}) before the run once whitespace is ignored, so a command that only rewrites its layout would pass; write a starting content that does not hold the expected text, or write it empty, before running this check`);
    }
  }
  return reasons;
}

async function runEntry(root, entry, timeoutMs) {
  const cwd = entry.cwd === undefined ? root : path.resolve(root, entry.cwd);
  const watched = (entry.expect.files ?? []).map((file) => {
    const target = path.resolve(root, file.path);
    const [kind] = MATCHERS.filter((matcher) => matcher in file);
    return { path: path.relative(root, target), target, rule: { [kind]: file[kind] }, before: fileState(target) };
  });
  const checkFiles = namedCheckFiles(root, entry, cwd).map((file) => ({ file, before: hashOf(path.join(root, file)) }));
  const stdin = stdinOf(root, entry);
  const notRun = timeoutMs > 0 ? notRunReasons(root, entry, stdin, watched) : ['the time budget for this run was used up'];
  const outcome = notRun.length
    ? { notRun, durationMs: 0, stdout: '', stderr: '' }
    : { ...(await runCommand(root, entry.run, { cwd, timeoutMs, stdin: stdin.text, env: entry.env })), timeoutMs };
  const files = watched.map((file) => {
    const after = fileState(file.target);
    const written = after.exists && (!file.before.exists || after.hash !== file.before.hash);
    return { ...file, after, written, text: after.exists ? cleanOutput(after.content.toString('utf8')) : '' };
  });
  for (const checkFile of checkFiles) checkFile.after = hashOf(path.join(root, checkFile.file));
  const verdict = outcome.notRun
    ? { status: 'not-verified', reasons: outcome.notRun.map((reason) => `not run: ${reason}`) }
    : judge(entry, outcome, files);
  const check = {
    id: entry.id,
    feature: entry.feature,
    command: entry.run,
    ...(entry.stdin !== undefined && { stdin: entry.stdin }),
    ...(entry.env !== undefined && { env: entry.env }),
    cwd: path.relative(root, cwd) || '.',
    status: verdict.status,
    reasons: verdict.reasons,
    exitCode: outcome.exitCode ?? null,
    signal: outcome.signal ?? null,
    timedOut: Boolean(outcome.timedOut),
    timeoutMs: outcome.timeoutMs ?? null,
    durationMs: outcome.durationMs,
    stdout: excerpt(outcome.stdout),
    stderr: excerpt(outcome.stderr),
    outputTruncated: Boolean(outcome.truncated),
    files: files.map((file) => ({
      path: file.path, existedBefore: file.before.exists, exists: file.after.exists, written: file.written, content: excerpt(file.text),
    })),
    definition: definitionOf(entry),
  };
  return { check, checkFiles: Object.fromEntries(checkFiles.map(({ file, before, after }) => [file, { before, after }])) };
}

// A check rewrites its own starting file, and a starting file may be written back before the next run: neither is a change.
function filesChangedAfterFail(failed, checkFiles) {
  const recorded = failed.checkFiles ?? {};
  return Object.keys(checkFiles).filter((file) => Object.hasOwn(recorded, file)
    && ![recorded[file].before, recorded[file].after].includes(checkFiles[file].before));
}

function git(args, cwd, env = process.env) {
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function openRepository(cwd) {
  let root;
  let gitDir;
  try {
    root = git(['rev-parse', '--show-toplevel'], cwd);
    gitDir = git(['rev-parse', '--absolute-git-dir'], cwd);
  } catch {
    throw new Error('verify needs a git repository: evidence is kept under .git/lim/verify/');
  }
  const stateDir = path.join(gitDir, 'lim', 'verify');
  return { root, stateDir, runsDir: path.join(stateDir, 'runs') };
}

function gitStateOf(root, mapPath) {
  let head = null;
  try {
    head = git(['rev-parse', 'HEAD'], root);
  } catch {
    head = null;
  }
  const entries = execFileSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).split('\0').filter(Boolean);
  const files = [];
  for (let index = 0; index < entries.length; index += 1) {
    files.push(entries[index].slice(3));
    if (/[RC]/.test(entries[index].slice(0, 2))) index += 1;
  }
  return { head, uncommittedFiles: files.filter((file) => path.resolve(root, file) !== mapPath).length };
}

function copyRealIndex(root, target) {
  try {
    const realIndex = path.resolve(root, git(['rev-parse', '--git-path', 'index'], root));
    copyFileSync(realIndex, target);
    const { atime, mtime } = statSync(realIndex);
    utimesSync(target, atime, mtime);
    return true;
  } catch {
    return false;
  }
}

function headTree(root) {
  try {
    return git(['rev-parse', 'HEAD^{tree}'], root);
  } catch {
    return null;
  }
}

// Built the way review-loop snapshots a working tree, so both give the same tree id and review-loop can match a run to the code it reviewed.
function workingTree(repository) {
  mkdirSync(repository.stateDir, { recursive: true });
  const index = path.join(repository.stateDir, `tree-${process.pid}.index`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    if (!copyRealIndex(repository.root, index)) {
      const base = headTree(repository.root);
      git(['read-tree', ...(base ? [base] : ['--empty'])], repository.root, env);
    }
    git(['add', '-A'], repository.root, env);
    git(['rm', '-r', '--cached', '--ignore-unmatch', '-q', '--', REVIEW_FOLDER], repository.root, env);
    return git(['write-tree'], repository.root, env);
  } finally {
    rmSync(index, { force: true });
  }
}

function loadMap(repository, option) {
  const relative = typeof option === 'string' ? option : MAP_FILE;
  const mapPath = path.resolve(repository.root, relative);
  if (!existsSync(mapPath)) throw new UsageError(`no feature map at ${path.relative(repository.root, mapPath)}`);
  const text = readFileSync(mapPath, 'utf8');
  let map;
  try {
    map = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`the feature map is not valid JSON: ${error.message}`);
  }
  const problems = validateMap(map, realpathSync(repository.root));
  if (problems.length) throw Object.assign(new UsageError('the feature map has problems; fix them and run again'), { problems });
  return { map, mapPath, hash: createHash('sha1').update(text).digest('hex').slice(0, 12) };
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function runFiles(repository) {
  if (!existsSync(repository.runsDir)) return [];
  return readdirSync(repository.runsDir).filter((name) => name.endsWith('.json')).sort(compareRunFiles);
}

function saveRun(repository, record) {
  mkdirSync(repository.runsDir, { recursive: true });
  const base = record.startedAt.replace(/[:.]/g, '-');
  let name = `${base}.json`;
  for (let suffix = 2; existsSync(path.join(repository.runsDir, name)); suffix += 1) name = `${base}-${suffix}.json`;
  const evidencePath = path.join(repository.runsDir, name);
  writeFileSync(evidencePath, `${JSON.stringify(record, null, 2)}\n`);
  const files = runFiles(repository);
  for (const old of files.slice(0, Math.max(0, files.length - KEPT_RUNS))) rmSync(path.join(repository.runsDir, old), { force: true });
  return evidencePath;
}

function tail(text, lines = 5) {
  const kept = text.trimEnd().split('\n').slice(-lines).join('\n');
  return kept.length > 400 ? `...${kept.slice(-400)}` : kept;
}

export function renderReport(record, evidencePath) {
  const { pass, fail, notVerified } = record.counts;
  const seconds = (record.durationMs / 1000).toFixed(1);
  const lines = [`verify: ${pass} passed, ${fail} failed, ${notVerified} not verified (${record.checks.length} checks, ${seconds} s)`];
  for (const status of ['fail', 'not-verified']) {
    for (const check of record.checks.filter((item) => item.status === status)) {
      lines.push('', `${status === 'fail' ? 'FAIL' : 'NOT VERIFIED'} ${check.id}: ${check.feature}`, `  $ ${displayCommand(check.command)}`);
      if (check.stdin !== undefined) lines.push(`  stdin: ${isObject(check.stdin) ? `from ${check.stdin.file}` : quote(check.stdin.slice(0, 200))}`);
      lines.push(...check.reasons.map((reason) => `  - ${reason}`));
      for (const stream of ['stdout', 'stderr']) {
        if (check[stream].trim()) lines.push(`  ${stream}: ${tail(check[stream]).replace(/\n/g, '\n    ')}`);
      }
    }
  }
  const passed = record.checks.filter((check) => check.status === 'pass').map((check) => check.id);
  if (passed.length) lines.push('', `Passed: ${passed.join(', ')}`);
  const changed = record.checks.filter((check) => check.changedAfterFail)
    .map((check) => (check.changedFiles ? `${check.id} (${check.changedFiles.join(', ')})` : check.id));
  if (changed.length) {
    lines.push('', `Changed after it failed: ${changed.join(', ')}. The check is not the one that failed; review the edit to the feature map or to the files in ${CHECKS_FOLDER}/ it names.`);
  }
  if (record.removedAfterFail.length) {
    lines.push('', `Removed after it failed: ${record.removedAfterFail.join(', ')}. The feature map no longer checks it.`);
  }
  if (record.git.uncommittedFiles) {
    const count = record.git.uncommittedFiles;
    lines.push('', `Ran on uncommitted changes to ${count} ${count === 1 ? 'file' : 'files'} besides the feature map.`);
  }
  lines.push('', `Evidence: ${evidencePath}`);
  return lines.join('\n');
}

const overallStatus = ({ fail, notVerified }) => (fail ? 'failed' : notVerified ? 'not-verified' : 'passed');

async function run(cwd, options) {
  const defaultTimeoutMs = defaultTimeoutOf(process.env.LIM_VERIFY_TIMEOUT_MS);
  const repository = openRepository(cwd);
  const { map, mapPath, hash } = loadMap(repository, options.map);
  const ids = options.id === undefined ? null : [options.id].flat().map(String);
  const unknown = (ids ?? []).filter((id) => !map.features.some((entry) => entry.id === id));
  if (unknown.length) throw new UsageError(`no check with id ${unknown.join(', ')} in the feature map`);
  const selected = ids ? map.features.filter((entry) => ids.includes(entry.id)) : map.features;
  const indexPath = path.join(repository.stateDir, 'checks.json');
  const index = readJson(indexPath, {});
  const started = Date.now();
  const deadline = started + RUN_BUDGET_MS;
  const gitState = gitStateOf(repository.root, mapPath);
  const tree = workingTree(repository);
  const checks = [];
  for (const entry of selected) {
    const limit = Math.min(entry.timeoutMs ?? defaultTimeoutMs, deadline - Date.now());
    const { check, checkFiles } = await runEntry(repository.root, entry, limit);
    const before = index[entry.id];
    if (before?.status === 'fail') {
      const changedFiles = filesChangedAfterFail(before, checkFiles);
      if (changedFiles.length) check.changedFiles = changedFiles;
      if (changedFiles.length || before.definition !== check.definition) check.changedAfterFail = true;
    }
    checks.push(check);
    index[entry.id] = { status: check.status, definition: check.definition, checkFiles, at: new Date().toISOString() };
  }
  const removedAfterFail = Object.keys(index).filter((id) => index[id].status === 'fail' && !map.features.some((entry) => entry.id === id));
  for (const id of removedAfterFail) delete index[id];
  const counts = {
    pass: checks.filter((check) => check.status === 'pass').length,
    fail: checks.filter((check) => check.status === 'fail').length,
    notVerified: checks.filter((check) => check.status === 'not-verified').length,
  };
  const record = {
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    map: path.relative(repository.root, mapPath),
    mapHash: hash,
    selected: ids,
    git: gitState,
    tree,
    treeAfter: workingTree(repository),
    node: process.version,
    status: overallStatus(counts),
    counts,
    removedAfterFail,
    checks,
  };
  const evidencePath = saveRun(repository, record);
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  return {
    status: record.status,
    counts,
    report: renderReport(record, evidencePath),
    evidencePath,
    checks: checks.map(({ id, status, reasons, durationMs, changedAfterFail, changedFiles }) => ({
      id, status, reasons, durationMs, ...(changedAfterFail ? { changedAfterFail } : {}), ...(changedFiles ? { changedFiles } : {}),
    })),
  };
}

function last(cwd, options) {
  const repository = openRepository(cwd);
  const [newest] = runFiles(repository).slice(-1);
  if (!newest) throw new UsageError('no evidence yet: run the checks first');
  const evidencePath = path.join(repository.runsDir, newest);
  const record = JSON.parse(readFileSync(evidencePath, 'utf8'));
  const ids = options.id === undefined ? null : [options.id].flat().map(String);
  const checks = ids ? record.checks.filter((check) => ids.includes(check.id)) : record.checks;
  return { status: record.status, counts: record.counts, report: renderReport(record, evidencePath), evidencePath, ...record, checks };
}

const COMMANDS = { run, last };

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

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`usage: verify.mjs <${Object.keys(COMMANDS).join('|')}> [--id <id>] [--map <file>]`);
    process.exit(2);
  }
  try {
    const result = await handler(process.cwd(), parseOptions(args));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = command === 'run' && result.status !== 'passed' ? 1 : 0;
  } catch (error) {
    console.error(JSON.stringify({ error: error.message, ...(error.problems ? { problems: error.problems } : {}) }, null, 2));
    process.exitCode = 2;
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
