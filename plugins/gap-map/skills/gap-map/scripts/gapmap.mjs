#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSvg, TONES } from './render.mjs';

export const MAP_FILE = 'gap-map.json';
export const OUT_FOLDER = 'gap-map';
export const CASE_KINDS = ['positive', 'negative', 'malformed', 'boundary', 'parity', 'teardown'];
export const AUTHORITIES = ['read', 'run'];
export const DISPOSITIONS = ['active', 'wontfix', 'blocked'];
const STAGE_KINDS = ['state', 'end', 'stopped'];
const STREAMS = ['stdout', 'stdout+stderr'];
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const POINTER = /^(.+?):(\d+)$/;
const DEFAULT_TIMEOUT_MS = 60 * 1000;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const EXCERPT = 2000;
// A descendant that left the process group can keep a pipe open after the kill.
const CLOSE_GRACE_MS = 2000;

const STATUS_ORDER = ['contradicted', 'open', 'blocked', 'closed', 'wontfix'];

export function loadMap(mapPath) {
  if (!existsSync(mapPath)) return { problems: [`no map at ${mapPath}`] };
  let map;
  try {
    map = JSON.parse(readFileSync(mapPath, 'utf8'));
  } catch (error) {
    return { problems: [`${mapPath} is not JSON: ${error.message}`] };
  }
  const mapDir = path.dirname(path.resolve(mapPath));
  const root = path.resolve(mapDir, map.root ?? '.');
  return { map, mapDir, root, problems: validate(map, root) };
}

function ids(list, label, problems) {
  const seen = new Set();
  for (const item of list ?? []) {
    if (typeof item?.id !== 'string' || !ID_PATTERN.test(item.id)) problems.push(`${label} id ${JSON.stringify(item?.id)} must match ${ID_PATTERN}`);
    else if (seen.has(item.id)) problems.push(`${label} id ${item.id} appears twice`);
    seen.add(item?.id);
  }
  return seen;
}

export function within(base, file) {
  const relative = path.relative(base, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export const lineCount = (text) => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));

function insideRoot(root, relative) {
  const target = path.resolve(root, relative);
  if (!within(root, target)) return false;
  if (!existsSync(target)) return true;
  return within(realpathSync.native(root), realpathSync.native(target));
}

export function validate(map, root) {
  const problems = [];
  if (!existsSync(root)) return [`root ${root} does not exist`];
  for (const key of ['target', 'goal']) {
    if (typeof map[key] !== 'string' || !map[key].trim()) problems.push(`${key} must be a non-empty string`);
  }
  for (const key of ['groups', 'stages', 'edges', 'obligations']) {
    if (!Array.isArray(map[key])) problems.push(`${key} must be a list`);
  }
  if (problems.length) return problems;
  const groups = ids(map.groups, 'group', problems);
  for (const group of map.groups) {
    if (group.tone !== undefined && !(group.tone in TONES)) problems.push(`group ${group.id} tone must be one of ${Object.keys(TONES).join(', ')}`);
  }
  const regions = ids(map.regions ?? [], 'region', problems);
  const stages = ids(map.stages, 'stage', problems);
  const verifiers = new Set(Object.keys(map.verifiers ?? {}));
  for (const stage of map.stages) {
    if (typeof stage.label !== 'string' || !stage.label.trim()) problems.push(`stage ${stage.id} needs a label`);
    if (!groups.has(stage.group)) problems.push(`stage ${stage.id} names group ${stage.group}, which is not in groups`);
    if (stage.region !== undefined && !regions.has(stage.region)) problems.push(`stage ${stage.id} names region ${stage.region}, which is not in regions`);
    if (stage.kind !== undefined && !STAGE_KINDS.includes(stage.kind)) problems.push(`stage ${stage.id} kind must be one of ${STAGE_KINDS.join(', ')}`);
  }
  for (const edge of map.edges) {
    for (const end of ['from', 'to']) {
      if (!stages.has(edge[end])) problems.push(`edge ${edge.from} -> ${edge.to} names stage ${edge[end]}, which is not in stages`);
    }
    if (typeof edge.label !== 'string' || !edge.label.trim()) problems.push(`edge ${edge.from} -> ${edge.to} needs a label`);
  }
  for (const [name, verifier] of Object.entries(map.verifiers ?? {})) {
    if (!Array.isArray(verifier.run) || verifier.run.length === 0 || !verifier.run.every((part) => typeof part === 'string')) {
      problems.push(`verifier ${name} run must be a list of strings`);
    } else if (!verifier.run.includes('{fixture}')) {
      problems.push(`verifier ${name} run must pass {fixture} as one argument`);
    }
    if (!AUTHORITIES.includes(verifier.authority)) problems.push(`verifier ${name} authority must be one of ${AUTHORITIES.join(', ')}`);
    const pass = verifier.pass ?? {};
    const lines = pass.fixtureLines;
    if (pass.exitCode !== undefined && !Number.isInteger(pass.exitCode)) problems.push(`verifier ${name} pass.exitCode must be an integer`);
    if (lines !== undefined) {
      if (typeof lines.prefix !== 'string' || !lines.prefix) problems.push(`verifier ${name} pass.fixtureLines.prefix must be the line prefix, such as "#|"`);
      if (!STREAMS.includes(lines.streams ?? 'stdout')) problems.push(`verifier ${name} pass.fixtureLines.streams must be one of ${STREAMS.join(', ')}`);
      if (lines.exitLine !== undefined && !(typeof lines.exitLine === 'string' && lines.exitLine.includes('{code}'))) {
        problems.push(`verifier ${name} pass.fixtureLines.exitLine must contain {code}, such as "exit {code}"`);
      }
    }
    if (pass.exitCode === undefined && lines?.exitLine === undefined) problems.push(`verifier ${name} needs pass.exitCode or pass.fixtureLines.exitLine`);
    if (verifier.timeoutMs !== undefined && !(Number.isInteger(verifier.timeoutMs) && verifier.timeoutMs > 0 && verifier.timeoutMs <= MAX_TIMEOUT_MS)) {
      problems.push(`verifier ${name} timeoutMs must be a whole number from 1 to ${MAX_TIMEOUT_MS}`);
    }
  }
  ids(map.obligations, 'obligation', problems);
  for (const obligation of map.obligations) {
    const label = `obligation ${obligation.id}`;
    if (!stages.has(obligation.stage)) problems.push(`${label} names stage ${obligation.stage}, which is not in stages`);
    if (typeof obligation.claim !== 'string' || !obligation.claim.trim()) problems.push(`${label} needs a claim`);
    if (!Array.isArray(obligation.cases) || obligation.cases.length === 0) problems.push(`${label} cases must list at least one of ${CASE_KINDS.join(', ')}`);
    for (const kind of obligation.cases ?? []) {
      if (!CASE_KINDS.includes(kind)) problems.push(`${label} case ${kind} is not one of ${CASE_KINDS.join(', ')}`);
    }
    if (!AUTHORITIES.includes(obligation.authority)) problems.push(`${label} authority must be one of ${AUTHORITIES.join(', ')}`);
    if (obligation.disposition !== undefined && !DISPOSITIONS.includes(obligation.disposition)) {
      problems.push(`${label} disposition must be one of ${DISPOSITIONS.join(', ')}`);
    }
    for (const fixture of obligation.fixtures ?? []) {
      if (!(obligation.cases ?? []).includes(fixture.case)) problems.push(`${label} has a fixture for case ${fixture.case}, which is not in its cases`);
      if (typeof fixture.path !== 'string' || !insideRoot(root, fixture.path)) problems.push(`${label} fixture path ${fixture.path} leaves the root`);
      if (!verifiers.has(fixture.verifier)) problems.push(`${label} fixture ${fixture.path} names verifier ${fixture.verifier}, which is not in verifiers`);
    }
    for (const key of ['unknowns', 'contradictions']) {
      if (obligation[key] !== undefined && !(Array.isArray(obligation[key]) && obligation[key].every((entry) => typeof entry === 'string'))) {
        problems.push(`${label} ${key} must be a list of sentences`);
      }
    }
  }
  return problems;
}

export function resolvePointer(root, pointer) {
  if (typeof pointer !== 'string' || !pointer.trim()) return false;
  const match = POINTER.exec(pointer);
  const file = match ? match[1] : pointer;
  if (!insideRoot(root, file)) return false;
  const target = path.resolve(root, file);
  if (!existsSync(target) || !statSync(target).isFile()) return false;
  if (!match) return true;
  const line = Number(match[2]);
  return line >= 1 && line <= lineCount(readFileSync(target, 'utf8'));
}

export function ownerDigest(root, owner) {
  if (!resolvePointer(root, owner)) return null;
  return fixtureDigest(root, POINTER.exec(owner)?.[1] ?? owner);
}

export function fixtureDigest(root, fixturePath) {
  const target = path.resolve(root, fixturePath);
  return existsSync(target) ? createHash('sha256').update(readFileSync(target)).digest('hex') : null;
}

export function verifierDigest(verifier, root) {
  const scripts = verifier.run.map((part) => {
    const target = path.resolve(root, part);
    return part !== '{fixture}' && existsSync(target) && statSync(target).isFile() ? createHash('sha256').update(readFileSync(target)).digest('hex') : null;
  });
  return createHash('sha256').update(JSON.stringify([verifier.run, verifier.pass, verifier.authority, verifier.timeoutMs ?? null, scripts])).digest('hex');
}

export const resultKey = (obligationId, fixture) => `${obligationId}|${fixture.case}|${fixture.path}|${fixture.verifier}`;

export function decide(obligation, { root, verifiers, results }) {
  const reasons = [];
  if (obligation.disposition === 'wontfix') return { status: 'wontfix', reasons: ['the project will not fix this; shown, never counted as proven'] };
  if (obligation.disposition === 'blocked') reasons.push('blocked: the authority this claim needs is not available here');
  if (!resolvePointer(root, obligation.source)) reasons.push(`source ${obligation.source ?? '(none)'} does not resolve to a file and line`);
  if (!resolvePointer(root, obligation.owner)) reasons.push(`owner ${obligation.owner ?? '(none)'} does not resolve to a file and line`);
  for (const kind of obligation.cases) {
    const fixtures = (obligation.fixtures ?? []).filter((fixture) => fixture.case === kind);
    if (fixtures.length === 0) {
      reasons.push(`${kind}: no fixture`);
      continue;
    }
    for (const fixture of fixtures) {
      const verifier = verifiers[fixture.verifier];
      const digest = fixtureDigest(root, fixture.path);
      const result = results[resultKey(obligation.id, fixture)];
      if (digest === null) reasons.push(`${kind}: fixture ${fixture.path} does not exist`);
      else if (AUTHORITIES.indexOf(verifier.authority) < AUTHORITIES.indexOf(obligation.authority)) {
        reasons.push(`${kind}: verifier ${fixture.verifier} only reads, the claim needs a run`);
      } else if (!result) reasons.push(`${kind}: ${fixture.path} has not been run`);
      else if (result.fixtureSha256 !== digest) reasons.push(`${kind}: ${fixture.path} changed after its last run`);
      else if (result.ownerSha256 !== ownerDigest(root, obligation.owner)) reasons.push(`${kind}: owner ${obligation.owner} changed after the last run`);
      else if (result.verifierSha256 !== verifierDigest(verifier, root)) reasons.push(`${kind}: verifier ${fixture.verifier} or a file it runs changed after the last run`);
      else if (!result.passed) reasons.push(`${kind}: ${fixture.path} failed (${result.why})`);
    }
  }
  for (const unknown of obligation.unknowns ?? []) reasons.push(`unknown: ${unknown}`);
  const contradictions = obligation.contradictions ?? [];
  for (const contradiction of contradictions) reasons.push(`contradiction: ${contradiction}`);
  if (contradictions.length) return { status: 'contradicted', reasons };
  if (obligation.disposition === 'blocked') return { status: 'blocked', reasons };
  return { status: reasons.length ? 'open' : 'closed', reasons };
}

const tidy = (text) => text.replace(/[ \t]+$/gm, '').trim();

export function judge(verifier, fixtureText, exitCode, output, timedOut) {
  if (timedOut) return { passed: false, why: `timed out after ${verifier.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms` };
  const { exitCode: wantedCode, fixtureLines } = verifier.pass;
  if (wantedCode !== undefined && exitCode !== wantedCode) return { passed: false, why: `exit code ${exitCode}, expected ${wantedCode}` };
  if (fixtureLines === undefined) return { passed: true, why: 'exit code matched' };
  const { prefix, exitLine } = fixtureLines;
  const wanted = fixtureText.replace(/\r\n/g, '\n').split('\n').filter((line) => line.startsWith(prefix));
  if (wanted.length === 0) return { passed: false, why: `the fixture has no ${prefix} lines to compare` };
  const expected = tidy(wanted.map((line) => line.slice(prefix.length)).join('\n')).split('\n');
  let text = tidy(output.replace(/\r\n/g, '\n'));
  if (exitLine !== undefined && exitCode !== 0) {
    const tail = exitLine.replace('{code}', String(exitCode));
    text = text === '' ? tail : `${text}\n${tail}`;
  }
  const actual = text.split('\n');
  const mismatch = expected.findIndex((line, index) => actual[index] !== line);
  if (mismatch === -1 && actual.length === expected.length) return { passed: true, why: `output equals the ${expected.length} ${prefix} line(s)` };
  const index = mismatch === -1 ? expected.length : mismatch;
  return { passed: false, why: `line ${index + 1}: expected ${JSON.stringify(expected[index] ?? '(end)')}, got ${JSON.stringify(actual[index] ?? '(end)')}` };
}

function runOnce(root, verifier, fixturePath) {
  const [program, ...args] = verifier.run.map((part) => (part === '{fixture}' ? fixturePath : part));
  const timeoutMs = verifier.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const merged = verifier.pass.fixtureLines?.streams === 'stdout+stderr';
  const scratch = merged ? mkdtempSync(path.join(tmpdir(), 'gap-map-run-')) : null;
  const outputFile = scratch && path.join(scratch, 'output');
  const descriptor = scratch && openSync(outputFile, 'w');
  return new Promise((resolve) => {
    const started = Date.now();
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let finished = false;
    let grace;
    const finish = (exitCode, extra = '') => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(grace);
      let output = Buffer.concat(stdout).toString('utf8');
      if (scratch) {
        closeSync(descriptor);
        output = readFileSync(outputFile, 'utf8');
        rmSync(scratch, { recursive: true, force: true });
      }
      resolve({ exitCode, stdout: output, stderr: Buffer.concat(stderr).toString('utf8') + extra, timedOut, ms: Date.now() - started });
    };
    const child = spawn(program, args, {
      cwd: root, detached: process.platform !== 'win32', windowsHide: true,
      stdio: merged ? ['ignore', descriptor, descriptor] : ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
        else process.kill(-child.pid, 'SIGKILL');
      } catch {}
      grace = setTimeout(() => finish(null), CLOSE_GRACE_MS);
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => stdout.push(chunk));
    child.stderr?.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => finish(null, error.message));
    child.on('close', (code) => finish(code));
  });
}

const excerpt = (text) => (text.length > EXCERPT ? `${text.slice(0, EXCERPT / 2)}\n...\n${text.slice(-EXCERPT / 2)}` : text);

export async function runFixtures({ map, root }, results, { only = [], jobs = 4 } = {}) {
  const queue = map.obligations
    .filter((obligation) => obligation.disposition !== 'wontfix' && (only.length === 0 || only.includes(obligation.id)))
    .flatMap((obligation) => (obligation.fixtures ?? []).map((fixture) => ({ obligation, fixture })))
    .filter(({ fixture }) => fixtureDigest(root, fixture.path) !== null);
  const ran = [];
  const worker = async () => {
    while (queue.length) {
      const { obligation, fixture } = queue.shift();
      const verifier = map.verifiers[fixture.verifier];
      const fixtureBytes = readFileSync(path.resolve(root, fixture.path));
      const fixtureText = fixtureBytes.toString('utf8');
      const outcome = await runOnce(root, verifier, fixture.path);
      const verdict = outcome.exitCode === null && !outcome.timedOut
        ? { passed: false, why: `could not start: ${outcome.stderr.trim()}` }
        : judge(verifier, fixtureText, outcome.exitCode, outcome.stdout, outcome.timedOut);
      const record = {
        obligation: obligation.id, case: fixture.case, path: fixture.path, verifier: fixture.verifier,
        command: verifier.run.map((part) => (part === '{fixture}' ? fixture.path : part)),
        fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'), ownerSha256: ownerDigest(root, obligation.owner), verifierSha256: verifierDigest(verifier, root),
        exitCode: outcome.exitCode, ms: outcome.ms, passed: verdict.passed, why: verdict.why,
        stdout: excerpt(outcome.stdout), stderr: excerpt(outcome.stderr), at: new Date().toISOString(),
      };
      results[resultKey(obligation.id, fixture)] = record;
      ran.push(record);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));
  return ran;
}

export function summarize(map, decisions) {
  const counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]));
  for (const { status } of decisions.values()) counts[status] += 1;
  const byStage = new Map(map.stages.map((stage) => [stage.id, Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]))]));
  for (const obligation of map.obligations) byStage.get(obligation.stage)[decisions.get(obligation.id).status] += 1;
  return { counts, byStage };
}

const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function gapsMarkdown(map, decisions, { counts, byStage }) {
  const counted = map.obligations.length - counts.wontfix;
  const lines = [
    `# ${map.target}: design map and gaps`,
    '',
    `Goal: ${map.goal}`,
    '',
    `${counts.closed} of ${counted} obligations are proven. ${counts.open} open, ${counts.contradicted} contradicted, ${counts.blocked} blocked, ${counts.wontfix} won't fix (not counted).`,
    '',
    'An obligation is proven only when its source and owner resolve, every required case has a fixture, and each fixture passed a verifier run that can observe the claim, on the fixture bytes as they are now.',
    '',
  ];
  const questions = map.obligations.filter((obligation) => obligation.question || (obligation.contradictions ?? []).length);
  if (questions.length) {
    lines.push('## Design decisions to make', '');
    for (const obligation of questions) {
      const parts = [obligation.question, ...(obligation.contradictions ?? [])].filter(Boolean);
      lines.push(`- \`${obligation.id}\`: ${parts.join(' ')}`);
    }
    lines.push('');
  }
  for (const stage of map.stages) {
    const members = map.obligations.filter((obligation) => obligation.stage === stage.id);
    if (members.length === 0) continue;
    const tally = byStage.get(stage.id);
    lines.push(`## ${stage.label}`, '', `${tally.closed} of ${members.length - tally.wontfix} proven.`, '', '| Obligation | Status | Claim | Why not proven |', '|---|---|---|---|');
    members.sort((left, right) => STATUS_ORDER.indexOf(decisions.get(left.id).status) - STATUS_ORDER.indexOf(decisions.get(right.id).status));
    for (const obligation of members) {
      const { status, reasons } = decisions.get(obligation.id);
      lines.push(`| \`${obligation.id}\` | ${status} | ${cell(obligation.claim)} | ${cell(status === 'closed' ? '' : reasons.join('; '))} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function readResults(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function parseArgs(argv) {
  const flags = { map: MAP_FILE, ids: [], jobs: 4 };
  const [command, ...rest] = argv;
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === '--map') flags.map = rest[++index];
    else if (flag === '--id') flags.ids.push(rest[++index]);
    else if (flag === '--jobs') flags.jobs = Number(rest[++index]);
    else return { command, error: `unknown option ${flag}` };
  }
  return { command, flags };
}

const USAGE = `usage:
  gapmap.mjs check [--map gap-map.json]
      Validate the map, decide every obligation's status, and write gap-map/gaps.md, gap-map/map.svg, and gap-map/status.json next to the map.
  gapmap.mjs run [--map gap-map.json] [--id <obligation>]... [--jobs 4]
      Run each fixture's verifier, save the results in gap-map/results.json, then check.
Exit codes: 0 written, 2 the map has problems (nothing written).`;

async function main(argv) {
  const { command, flags, error } = parseArgs(argv);
  if (error || !['check', 'run'].includes(command)) {
    console.log(error ? `${error}\n${USAGE}` : USAGE);
    return command === '--help' || command === 'help' ? 0 : 2;
  }
  const loaded = loadMap(flags.map);
  if (loaded.problems.length) {
    console.log(`The map has ${loaded.problems.length} problem(s); nothing was written:\n${loaded.problems.map((problem) => `- ${problem}`).join('\n')}`);
    return 2;
  }
  const outDir = path.join(loaded.mapDir, OUT_FOLDER);
  mkdirSync(outDir, { recursive: true });
  const resultsFile = path.join(outDir, 'results.json');
  const results = readResults(resultsFile);
  if (command === 'run') {
    const unknown = flags.ids.filter((id) => !loaded.map.obligations.some((obligation) => obligation.id === id));
    if (unknown.length) {
      console.log(`unknown obligation id: ${unknown.join(', ')}`);
      return 2;
    }
    const ran = await runFixtures(loaded, results, { only: flags.ids, jobs: flags.jobs });
    writeFileSync(resultsFile, `${JSON.stringify(results, null, 2)}\n`);
    const failed = ran.filter((record) => !record.passed);
    console.log(`ran ${ran.length} fixture(s): ${ran.length - failed.length} passed, ${failed.length} failed`);
    for (const record of failed) console.log(`- ${record.obligation} ${record.case} ${record.path}: ${record.why}`);
  }
  const context = { root: loaded.root, verifiers: loaded.map.verifiers ?? {}, results };
  const decisions = new Map(loaded.map.obligations.map((obligation) => [obligation.id, decide(obligation, context)]));
  const summary = summarize(loaded.map, decisions);
  writeFileSync(path.join(outDir, 'gaps.md'), `${gapsMarkdown(loaded.map, decisions, summary)}\n`);
  writeFileSync(path.join(outDir, 'map.svg'), renderSvg(loaded.map, summary));
  const status = Object.fromEntries([...decisions].map(([id, decision]) => [id, decision]));
  writeFileSync(path.join(outDir, 'status.json'), `${JSON.stringify({ counts: summary.counts, obligations: status }, null, 2)}\n`);
  const { counts } = summary;
  console.log(`${counts.closed} of ${loaded.map.obligations.length - counts.wontfix} proven; ${counts.open} open, ${counts.contradicted} contradicted, ${counts.blocked} blocked, ${counts.wontfix} won't fix`);
  console.log(`wrote ${path.relative(process.cwd(), outDir) || '.'}/gaps.md, map.svg, status.json`);
  return 0;
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) process.exitCode = await main(process.argv.slice(2));
