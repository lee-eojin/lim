#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LEDGER_FILE = 'ledger.json';
export const EVIDENCE_FOLDER = 'ledger-evidence';
export const KINDS = ['observed', 'inferred'];
export const NEEDS = ['static', 'runtime'];
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const POINTER = /^(.+?):(\d+)(?:-(\d+))?$/;
const SKIPPED_FOLDERS = new Set(['.git', 'node_modules', EVIDENCE_FOLDER]);
const SEARCH_FILE_LIMIT = 20000;
const SAVE_TIMEOUT_MS = 10 * 60 * 1000;
const EXCERPT = 200000;
const REA_ID = /^ev_[0-9a-f]{64}$/;

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

export function within(base, file) {
  const relative = path.relative(base, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function insideRoot(root, relative) {
  const target = path.resolve(root, relative);
  if (!within(root, target)) return false;
  if (!existsSync(target)) return true;
  return within(realpathSync.native(root), realpathSync.native(target));
}

export function loadLedger(ledgerPath) {
  if (!existsSync(ledgerPath)) return { problems: [`no ledger at ${ledgerPath}`] };
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  } catch (error) {
    return { problems: [`${ledgerPath} is not JSON: ${error.message}`] };
  }
  const ledgerDir = path.dirname(path.resolve(ledgerPath));
  const root = path.resolve(ledgerDir, ledger.root ?? '.');
  const ignored = [path.resolve(ledgerPath), path.join(ledgerDir, 'ledger.md')];
  return { ledger, ledgerDir, root, ignored, problems: validate(ledger, root, ledgerDir) };
}

function checkIds(list, label, problems) {
  const seen = new Set();
  for (const item of list) {
    if (typeof item?.id !== 'string' || !ID_PATTERN.test(item.id)) problems.push(`${label} id ${JSON.stringify(item?.id)} must match ${ID_PATTERN}`);
    else if (seen.has(item.id) && label !== 'unknown') problems.push(`${label} id ${item.id} appears twice`);
    seen.add(item?.id);
  }
  return seen;
}

function evidenceShape(evidence) {
  const keys = ['file', 'output', 'search', 'rea'].filter((key) => key in (evidence ?? {}));
  return keys.length === 1 ? keys[0] : null;
}

export function validate(ledger, root, ledgerDir = root) {
  const problems = [];
  if (!existsSync(root)) return [`root ${root} does not exist`];
  if (typeof ledger.subject !== 'string' || !ledger.subject.trim()) problems.push('subject must be a non-empty string');
  for (const key of ['questions', 'claims']) if (!Array.isArray(ledger[key])) problems.push(`${key} must be a list`);
  if (ledger.unknowns !== undefined && !Array.isArray(ledger.unknowns)) problems.push('unknowns must be a list');
  if (problems.length) return problems;
  const questions = checkIds(ledger.questions, 'question', problems);
  const claims = checkIds(ledger.claims, 'claim', problems);
  checkIds(ledger.unknowns ?? [], 'unknown', problems);
  for (const question of ledger.questions) {
    if (typeof question.question !== 'string' || !question.question.trim()) problems.push(`question ${question.id} needs its question text`);
    if (!NEEDS.includes(question.needs)) problems.push(`question ${question.id} needs must be one of ${NEEDS.join(', ')}`);
  }
  for (const claim of ledger.claims) {
    const label = `claim ${claim.id}`;
    if (!questions.has(claim.question)) problems.push(`${label} answers question ${claim.question}, which is not in questions`);
    if (typeof claim.statement !== 'string' || !claim.statement.trim()) problems.push(`${label} needs a statement`);
    if (!KINDS.includes(claim.kind)) problems.push(`${label} kind must be one of ${KINDS.join(', ')}`);
    if (!Array.isArray(claim.evidence) || claim.evidence.length === 0) problems.push(`${label} needs at least one piece of evidence`);
    for (const evidence of claim.evidence ?? []) {
      const shape = evidenceShape(evidence);
      if (!shape) problems.push(`${label} evidence ${JSON.stringify(evidence)} must have exactly one of file, output, search, rea`);
      else if (shape === 'search' && (typeof evidence.search !== 'string' || !evidence.search || typeof evidence.scope !== 'string' || !Number.isInteger(evidence.hits))) {
        problems.push(`${label} search evidence needs search (the literal text), scope (a folder or file), and hits (the count you saw)`);
      } else if (shape === 'rea' && (!REA_ID.test(evidence.rea) || typeof evidence.bundle !== 'string')) {
        problems.push(`${label} rea evidence needs rea (an ev_ id) and bundle (the exported Evidence bundle file)`);
      }
      if (typeof evidence?.file === 'string' && !insideRoot(root, evidence.file.replace(POINTER, '$1'))) problems.push(`${label} evidence path ${evidence.file} leaves the root`);
      if (typeof evidence?.scope === 'string' && !insideRoot(root, evidence.scope)) problems.push(`${label} evidence path ${evidence.scope} leaves the root`);
      for (const key of ['output', 'bundle']) {
        if (typeof evidence?.[key] === 'string' && !insideRoot(ledgerDir, evidence[key])) problems.push(`${label} evidence path ${evidence[key]} leaves the ledger's folder`);
      }
    }
    for (const key of ['supersedes', 'contradicts']) {
      for (const other of [claim[key]].flat().filter((entry) => entry !== undefined)) {
        if (!claims.has(other)) problems.push(`${label} ${key} ${other}, which is not in claims`);
      }
    }
  }
  for (const unknown of ledger.unknowns ?? []) {
    const label = `unknown ${unknown.id}`;
    if (!questions.has(unknown.question)) problems.push(`${label} belongs to question ${unknown.question}, which is not in questions`);
    if (!Number.isInteger(unknown.revision) || unknown.revision < 1) problems.push(`${label} revision must be a whole number from 1`);
    if (!['open', 'resolved'].includes(unknown.state)) problems.push(`${label} state must be open or resolved`);
    if (unknown.state === 'resolved' && !claims.has(unknown.resolvedBy)) problems.push(`${label} is resolved, so resolvedBy must name the claim that resolves it`);
    if (unknown.state === 'open' && (typeof unknown.probe !== 'string' || !unknown.probe.trim())) problems.push(`${label} is open, so probe must say what evidence would resolve it`);
  }
  return problems;
}

function listFiles(target, files = [], ignored = new Set()) {
  if (files.length > SEARCH_FILE_LIMIT || ignored.has(target)) return files;
  const stat = lstatSync(target);
  if (stat.isFile()) files.push(target);
  else if (stat.isDirectory()) {
    for (const name of readdirSync(target).sort()) {
      if (!SKIPPED_FOLDERS.has(name)) listFiles(path.join(target, name), files, ignored);
    }
  }
  return files;
}

export function countHits(root, scope, needle, ignored = []) {
  const target = path.resolve(root, scope);
  if (!existsSync(target)) return { error: `scope ${scope} does not exist` };
  const files = listFiles(target, [], new Set(ignored.map((file) => path.resolve(file))));
  if (files.length > SEARCH_FILE_LIMIT) return { error: `scope ${scope} has more than ${SEARCH_FILE_LIMIT} files; narrow it` };
  let hits = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (let index = text.indexOf(needle); index !== -1; index = text.indexOf(needle, index + needle.length)) hits += 1;
  }
  return { hits, files: files.length };
}

export const lineCount = (text) => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));

const RECORD_KEYS = ['command', 'cwd', 'exitCode', 'signal', 'error', 'ms', 'at', 'stdout', 'stderr', 'sha256'];

function findEvidenceId(value, id) {
  if (Array.isArray(value)) return value.some((entry) => findEvidenceId(entry, id));
  if (value === null || typeof value !== 'object') return false;
  return value.evidence_id === id || Object.values(value).some((entry) => findEvidenceId(entry, id));
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

export function checkEvidence(root, ledgerDir, evidence, ignored = []) {
  const shape = evidenceShape(evidence);
  if (shape === 'file') {
    const match = POINTER.exec(evidence.file);
    const file = match ? match[1] : evidence.file;
    const target = path.resolve(root, file);
    if (!existsSync(target) || !statSync(target).isFile()) return { ok: false, why: `${evidence.file} does not exist` };
    const content = readFileSync(target);
    if (!resolvePointer(root, evidence.file)) return { ok: false, why: `${evidence.file} is past the end of ${file} (${lineCount(content.toString('utf8'))} lines)` };
    if (evidence.sha256 !== undefined && evidence.sha256 !== sha256(content)) return { ok: false, why: `${file} changed after the claim was pinned` };
    return { ok: true, runtime: false };
  }
  if (shape === 'output') {
    const target = path.resolve(ledgerDir, evidence.output);
    if (!existsSync(target)) return { ok: false, why: `saved output ${evidence.output} does not exist` };
    let record;
    try {
      record = JSON.parse(readFileSync(target, 'utf8'));
    } catch {
      return { ok: false, why: `saved output ${evidence.output} is not a record written by ledger.mjs save` };
    }
    const keys = Object.keys(record ?? {});
    if (keys.length !== RECORD_KEYS.length || !RECORD_KEYS.every((key) => keys.includes(key)) || !Array.isArray(record.command) || record.command.length === 0) {
      return { ok: false, why: `saved output ${evidence.output} is not a record written by ledger.mjs save` };
    }
    const { sha256: stated, ...body } = record;
    if (stated !== sha256(JSON.stringify(body))) return { ok: false, why: `saved output ${evidence.output} was edited after it was saved` };
    if (evidence.sha256 !== undefined && evidence.sha256 !== stated) return { ok: false, why: `saved output ${evidence.output} is not the record this claim cited` };
    return { ok: true, runtime: true };
  }
  if (shape === 'search') {
    const counted = countHits(root, evidence.scope, evidence.search, ignored);
    if (counted.error) return { ok: false, why: counted.error };
    if (counted.hits !== evidence.hits) return { ok: false, why: `searching ${evidence.scope} for ${JSON.stringify(evidence.search)} now finds ${counted.hits}, the claim says ${evidence.hits}` };
    return { ok: true, runtime: false, bounded: `${evidence.hits} hit(s) for ${JSON.stringify(evidence.search)} within ${evidence.scope}` };
  }
  const bundle = path.resolve(ledgerDir, evidence.bundle);
  if (!existsSync(bundle)) return { ok: false, why: `Evidence bundle ${evidence.bundle} does not exist` };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(bundle, 'utf8'));
  } catch {
    return { ok: false, why: `Evidence bundle ${evidence.bundle} is not JSON` };
  }
  if (!findEvidenceId(parsed, evidence.rea)) return { ok: false, why: `${evidence.rea} is not an evidence_id in ${evidence.bundle}` };
  return { ok: true, runtime: evidence.runtime === true };
}

export function decide(ledger, root, ledgerDir = root, ignored = []) {
  const superseded = new Set(ledger.claims.flatMap((claim) => [claim.supersedes].flat().filter(Boolean)));
  const latestUnknowns = new Map();
  for (const unknown of ledger.unknowns ?? []) {
    const current = latestUnknowns.get(unknown.id);
    if (!current || unknown.revision > current.revision) latestUnknowns.set(unknown.id, unknown);
  }
  const claimResults = new Map(ledger.claims.map((claim) => {
    if (superseded.has(claim.id)) return [claim.id, { status: 'superseded', reasons: [] }];
    const checks = claim.evidence.map((evidence) => checkEvidence(root, ledgerDir, evidence, ignored));
    const broken = checks.filter((check) => !check.ok).map((check) => check.why);
    return [claim.id, { status: broken.length ? 'broken' : 'holds', reasons: broken, runtime: checks.some((check) => check.ok && check.runtime), bounded: checks.map((check) => check.bounded).filter(Boolean) }];
  }));
  const holds = (id) => claimResults.get(id)?.status === 'holds';
  const clashing = ledger.claims.flatMap((claim) => [claim.contradicts].flat().filter(Boolean).map((other) => [claim.id, other])).filter(([left, right]) => holds(left) && holds(right));
  return ledger.questions.map((question) => {
    const active = ledger.claims.filter((claim) => claim.question === question.id && !superseded.has(claim.id));
    const reasons = [];
    for (const claim of active) {
      const result = claimResults.get(claim.id);
      for (const why of result.reasons) reasons.push(`${claim.id}: ${why}`);
    }
    const holding = active.filter((claim) => claimResults.get(claim.id).status === 'holds');
    const clashes = clashing.filter(([left, right]) => holding.some((claim) => claim.id === left || claim.id === right)).map(([left, right]) => `${left} contradicts ${right}`);
    const open = [...latestUnknowns.values()].filter((unknown) => unknown.question === question.id && unknown.state === 'open');
    for (const unknown of open) reasons.push(`unknown ${unknown.id}: ${unknown.text ?? ''} (next: ${unknown.probe})`.replace(':  (', ': ('));
    const answering = holding.filter((claim) => claim.kind === 'observed' && (question.needs === 'static' || claimResults.get(claim.id).runtime));
    if (holding.some((claim) => claim.kind === 'observed') && answering.length === 0) reasons.push(`needs runtime evidence; the observed claims cite only static evidence`);
    if (holding.length && holding.every((claim) => claim.kind === 'inferred')) reasons.push('only inferred claims; an inference never answers a question');
    const bounded = holding.flatMap((claim) => claimResults.get(claim.id).bounded);
    let status;
    if (clashes.length) status = 'contradicted';
    else if (answering.length && open.length === 0 && reasons.length === 0) status = 'answered';
    else if (active.length || open.length) status = 'partial';
    else status = 'unresolved';
    return { id: question.id, question: question.question, status, reasons: [...clashes, ...reasons], bounded, claims: active.map((claim) => ({ id: claim.id, kind: claim.kind, ...claimResults.get(claim.id) })) };
  });
}

const MARK = { answered: '[x]', partial: '[~]', unresolved: '[ ]', contradicted: '[!]' };

export function report(ledger, decisions) {
  const counts = Object.fromEntries(Object.keys(MARK).map((status) => [status, decisions.filter((decision) => decision.status === status).length]));
  const lines = [
    `# ${ledger.subject}`,
    '',
    `${counts.answered} of ${decisions.length} questions answered, ${counts.partial} partial, ${counts.unresolved} unresolved, ${counts.contradicted} contradicted.`,
    '',
  ];
  for (const decision of decisions) {
    lines.push(`- ${MARK[decision.status]} \`${decision.id}\` ${decision.question} (${decision.status})`);
    for (const claim of decision.claims) {
      if (claim.status === 'superseded') continue;
      const text = ledger.claims.find((entry) => entry.id === claim.id).statement;
      lines.push(`  - ${claim.kind}, ${claim.status}: ${text} (\`${claim.id}\`)`);
    }
    for (const bounded of decision.bounded) lines.push(`  - bounded search: ${bounded}`);
    for (const reason of decision.reasons) lines.push(`  - not answered because ${reason}`);
  }
  return { text: `${lines.join('\n')}\n`, counts };
}

export function saveOutput(root, ledgerDir, command) {
  const started = Date.now();
  const run = spawnSync(command[0], command.slice(1), { cwd: root, encoding: 'utf8', timeout: SAVE_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  const keep = (text) => (text ?? '').length > EXCERPT ? `${text.slice(0, EXCERPT / 2)}\n...\n${text.slice(-EXCERPT / 2)}` : text ?? '';
  const body = {
    command, cwd: path.relative(ledgerDir, root) || '.', exitCode: run.status, signal: run.signal ?? null,
    error: run.error?.message ?? null, ms: Date.now() - started, at: new Date().toISOString(),
    stdout: keep(run.stdout), stderr: keep(run.stderr),
  };
  const folder = path.join(ledgerDir, EVIDENCE_FOLDER);
  mkdirSync(folder, { recursive: true });
  const taken = new Set(readdirSync(folder));
  let index = taken.size + 1;
  while (taken.has(`${index}.json`)) index += 1;
  const file = path.join(folder, `${index}.json`);
  writeFileSync(file, `${JSON.stringify({ ...body, sha256: sha256(JSON.stringify(body)) }, null, 2)}\n`);
  return { file, body };
}

export function pin(ledger, root) {
  let pinned = 0;
  for (const claim of ledger.claims) {
    for (const evidence of claim.evidence) {
      if (evidenceShape(evidence) !== 'file' || evidence.sha256 !== undefined) continue;
      const target = path.resolve(root, evidence.file.replace(POINTER, '$1'));
      if (!existsSync(target)) continue;
      evidence.sha256 = sha256(readFileSync(target));
      pinned += 1;
    }
  }
  return pinned;
}

const USAGE = `usage:
  ledger.mjs check [--ledger ledger.json]
      Check every piece of evidence again, decide each question, print the checklist, and write ledger.md next to the ledger.
  ledger.mjs save [--ledger ledger.json] -- <program> [arguments...]
      Run one command from the ledger's root without a shell and save its output as ledger-evidence/<n>.json.
  ledger.mjs pin [--ledger ledger.json]
      Record the SHA-256 of every file a claim cites, so a later change to that file marks the claim broken.
Exit codes: 0 every question answered, 1 some question is not, 2 the ledger has problems.`;

async function main(argv) {
  const [command, ...rest] = argv;
  let ledgerPath = LEDGER_FILE;
  const separator = rest.indexOf('--');
  const options = separator === -1 ? rest : rest.slice(0, separator);
  for (let index = 0; index < options.length; index += 1) {
    if (options[index] === '--ledger') ledgerPath = options[++index];
    else {
      console.log(`unknown option ${options[index]}\n${USAGE}`);
      return 2;
    }
  }
  if (!['check', 'save', 'pin'].includes(command)) {
    console.log(USAGE);
    return ['--help', 'help'].includes(command) ? 0 : 2;
  }
  const loaded = loadLedger(ledgerPath);
  if (command === 'save') {
    const program = separator === -1 ? [] : rest.slice(separator + 1);
    if (program.length === 0) {
      console.log(`save needs a command after --\n${USAGE}`);
      return 2;
    }
    if (!loaded.ledger) {
      console.log(loaded.problems.join('\n'));
      return 2;
    }
    const { file, body } = saveOutput(loaded.root, loaded.ledgerDir, program);
    const cite = JSON.stringify({ output: path.relative(loaded.ledgerDir, file).split(path.sep).join('/'), sha256: sha256(JSON.stringify(body)) });
    console.log(`saved ${path.relative(loaded.ledgerDir, file).split(path.sep).join('/')} (exit ${body.exitCode}); cite it as ${cite}`);
    return 0;
  }
  if (loaded.problems.length) {
    console.log(`The ledger has ${loaded.problems.length} problem(s):\n${loaded.problems.map((problem) => `- ${problem}`).join('\n')}`);
    return 2;
  }
  if (command === 'pin') {
    const pinned = pin(loaded.ledger, loaded.root);
    writeFileSync(path.resolve(ledgerPath), `${JSON.stringify(loaded.ledger, null, 2)}\n`);
    console.log(`pinned ${pinned} file(s)`);
    return 0;
  }
  const decisions = decide(loaded.ledger, loaded.root, loaded.ledgerDir, loaded.ignored);
  const { text, counts } = report(loaded.ledger, decisions);
  writeFileSync(path.join(loaded.ledgerDir, 'ledger.md'), text);
  console.log(text.trimEnd());
  return counts.answered === decisions.length ? 0 : 1;
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
