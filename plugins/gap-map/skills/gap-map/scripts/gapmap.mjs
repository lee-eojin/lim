#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkIds } from './_shared/check-ids.mjs';
import { countHitsSkipping } from './_shared/count-hits.mjs';
import { isEntryPoint } from './_shared/entry-point.mjs';
import { within } from './_shared/within.mjs';
import { renderSvg, TONES } from './render.mjs';
import { judge, runOnce } from './run.mjs';

export { within };

export const MAP_FILE = 'gap-map.json';
export const OUT_FOLDER = 'gap-map';
export const CASE_KINDS = ['positive', 'negative', 'malformed', 'boundary', 'parity', 'teardown'];
export const AUTHORITIES = ['read', 'run'];
export const DISPOSITIONS = ['active', 'wontfix', 'blocked'];
const STAGE_KINDS = ['state', 'end', 'stopped'];
const STREAMS = ['stdout', 'stdout+stderr'];
const POINTER = /^(.+?):(\d+)(?:-(\d+))?$/;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const EXCERPT = 2000;
const SKIPPED_FOLDERS = new Set(['.git', 'node_modules']);


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
  const ignored = [path.resolve(mapPath), path.join(mapDir, OUT_FOLDER)];
  return { map, mapDir, root, ignored, problems: validate(map, root) };
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
  const groups = checkIds(map.groups, 'group', problems);
  for (const group of map.groups) {
    if (group.tone !== undefined && !(group.tone in TONES)) problems.push(`group ${group.id} tone must be one of ${Object.keys(TONES).join(', ')}`);
  }
  const regions = checkIds(map.regions ?? [], 'region', problems);
  const stages = checkIds(map.stages, 'stage', problems);
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
  checkIds(map.obligations, 'obligation', problems);
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
    if (obligation.question !== undefined) {
      if (typeof obligation.question !== 'string' || !obligation.question.trim()) problems.push(`${label} question must be a sentence`);
      if (!Array.isArray(obligation.basis) || obligation.basis.length === 0) {
        problems.push(`${label} has a question, so basis must list the file lines or searches it rests on`);
      }
    }
    for (const entry of obligation.basis ?? []) {
      const isFile = typeof entry?.file === 'string' && !('search' in entry)
        && (entry.text === undefined || (typeof entry.text === 'string' && entry.text.trim() !== ''));
      const isSearch = typeof entry?.search === 'string' && entry.search !== '' && typeof entry.scope === 'string' && Number.isInteger(entry.hits) && !('file' in entry);
      if (!isFile && !isSearch) problems.push(`${label} basis ${JSON.stringify(entry)} must be { file } or { search, scope, hits }`);
      else if (!insideRoot(root, isFile ? entry.file.replace(POINTER, '$1') : entry.scope)) problems.push(`${label} basis path ${isFile ? entry.file : entry.scope} leaves the root`);
    }
    if (obligation.anchors !== undefined) {
      const keys = Object.keys(obligation.anchors ?? {});
      if (typeof obligation.anchors !== 'object' || keys.length === 0 || keys.some((key) => !['owner', 'source'].includes(key))
        || keys.some((key) => typeof obligation.anchors[key] !== 'string' || !obligation.anchors[key].trim())) {
        problems.push(`${label} anchors must map owner or source to the literal text their lines hold`);
      }
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
  const first = Number(match[2]);
  const last = Number(match[3] ?? match[2]);
  return first >= 1 && last >= first && last <= lineCount(readFileSync(target, 'utf8'));
}

export function anchorProblem(root, pointer, text) {
  if (!resolvePointer(root, pointer)) return null;
  const match = POINTER.exec(pointer);
  const file = match ? match[1] : pointer;
  const lines = readFileSync(path.resolve(root, file), 'utf8').split('\n');
  const first = match ? Number(match[2]) : 1;
  const last = match ? Number(match[3] ?? match[2]) : lines.length;
  if (lines.slice(first - 1, last).join('\n').includes(text)) return null;
  const elsewhere = lines.flatMap((line, index) => (line.includes(text) ? [index + 1] : []));
  return `${pointer} does not contain ${JSON.stringify(text)}`
    + (elsewhere.length ? `; it is now at ${file}:${elsewhere.slice(0, 3).join(', ')}` : '; the file no longer contains it');
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

export function decide(obligation, { root, verifiers, results, ignored = [] }) {
  const reasons = [];
  if (obligation.disposition === 'wontfix') return { status: 'wontfix', reasons: ['the project will not fix this; shown, never counted as proven'] };
  if (obligation.disposition === 'blocked') reasons.push('blocked: the authority this claim needs is not available here');
  if (!resolvePointer(root, obligation.source)) reasons.push(`source ${obligation.source ?? '(none)'} does not resolve to a file and line`);
  if (!resolvePointer(root, obligation.owner)) reasons.push(`owner ${obligation.owner ?? '(none)'} does not resolve to a file and line`);
  for (const [key, text] of Object.entries(obligation.anchors ?? {})) {
    const problem = anchorProblem(root, obligation[key], text);
    if (problem) reasons.push(`${key} ${problem}`);
  }
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
  for (const why of checkBasis(root, obligation.basis ?? [], ignored)) reasons.push(`basis: ${why}`);
  for (const unknown of obligation.unknowns ?? []) reasons.push(`unknown: ${unknown}`);
  const contradictions = obligation.contradictions ?? [];
  for (const contradiction of contradictions) reasons.push(`contradiction: ${contradiction}`);
  if (contradictions.length) return { status: 'contradicted', reasons };
  if (obligation.disposition === 'blocked') return { status: 'blocked', reasons };
  return { status: reasons.length ? 'open' : 'closed', reasons };
}

export const countHits = countHitsSkipping(SKIPPED_FOLDERS);

export function checkBasis(root, basis, ignored = []) {
  return basis.flatMap((entry) => {
    if (entry.file !== undefined) {
      if (!resolvePointer(root, entry.file)) return [`${entry.file} does not resolve to a file and line`];
      const problem = entry.text === undefined ? null : anchorProblem(root, entry.file, entry.text);
      return problem ? [problem] : [];
    }
    const counted = countHits(root, entry.scope, entry.search, ignored);
    if (counted.error) return [counted.error];
    return counted.hits === entry.hits ? [] : [`searching ${entry.scope} for ${JSON.stringify(entry.search)} now finds ${counted.hits}, the question says ${entry.hits}`];
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
      const stale = decisions.get(obligation.id).reasons.filter((reason) => reason.startsWith('basis: '));
      lines.push(`- \`${obligation.id}\`${stale.length ? ' (stale, recheck before deciding)' : ''}: ${parts.join(' ')}`);
      for (const entry of obligation.basis ?? []) {
        lines.push(`  - basis: ${entry.file ?? `${entry.hits} hit(s) for ${JSON.stringify(entry.search)} within ${entry.scope}`}`);
      }
      for (const reason of stale) lines.push(`  - ${reason}`);
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
  const context = { root: loaded.root, verifiers: loaded.map.verifiers ?? {}, results, ignored: loaded.ignored };
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

if (isEntryPoint(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
