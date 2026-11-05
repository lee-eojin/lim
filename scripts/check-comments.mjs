#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCOPE = ['plugins', 'scripts', 'evals'];

export const EXCLUDED = [
  /^evals\/(?:.+\/)?repo\//,
  /(?:^|\/)fixtures\//,
  /(?:^|\/)node_modules\//,
  'plugins/review-loop/skills/review-loop/scripts/loop.mjs',
  'plugins/verify/skills/verify/scripts/verify.mjs',
  'evals/clear-explain/run-explain.mjs',
  'evals/verify/run-benchmark.mjs',
  'plugins/clear-explain/skills/clear-explain/scripts/check-clarity.mjs',
  'evals/e2e/run-sessions.mjs',
  'evals/review-loop/run-detection.mjs',
  'scripts/check-loop-model.mjs',
  'scripts/check-loop-model-sync.mjs',
  'scripts/check-skills.mjs',
  'scripts/sync-counts.mjs',
  'evals/review-loop/run-triggers.mjs',
  'plugins/ledger/skills/ledger/scripts/ledger.mjs',
  'scripts/check-evidence-report.mjs',
  'scripts/check-i18n.mjs',
  'scripts/release.mjs',
  'evals/gap-map/run-benchmark.mjs',
  'plugins/gap-map/skills/gap-map/scripts/gapmap.mjs',
  'plugins/gap-map/skills/gap-map/scripts/run.mjs',
];

const EXPRESSION_KEYWORDS = new Set([
  'await', 'case', 'default', 'delete', 'do', 'else', 'extends', 'in', 'instanceof',
  'new', 'return', 'throw', 'typeof', 'void', 'yield',
]);
const WORD = /[\p{ID_Continue}$\\\u200C\u200D]+/uy;
const LINE_END = /[\n\r\u2028\u2029]/;
const SPACE = /[\s\uFEFF]/;

const lineAt = (text, offset) => text.slice(0, offset).split('\n').length;

class LexError extends Error {
  constructor(text, offset, what) {
    super(`${lineAt(text, offset)}: ${what}`);
    this.line = lineAt(text, offset);
  }
}

function skipQuoted(text, start) {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      i += text.startsWith('\r\n', i + 1) ? 3 : 2;
    } else if (c === quote) {
      return i + 1;
    } else if (c === '\n' || c === '\r') {
      break;
    } else {
      i += 1;
    }
  }
  throw new LexError(text, start, 'unterminated string');
}

function skipRegex(text, start) {
  let i = start + 1;
  let inClass = false;
  while (i < text.length) {
    const c = text[i];
    if (LINE_END.test(c)) break;
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      i += 1;
      WORD.lastIndex = i;
      return WORD.test(text) ? WORD.lastIndex : i;
    }
    i += 1;
  }
  throw new LexError(text, start, 'unterminated regular expression');
}

function scanTemplate(text, start, from) {
  let i = from;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') i += 2;
    else if (c === '`') return { end: i + 1, opened: false };
    else if (c === '$' && text[i + 1] === '{') return { end: i + 2, opened: true };
    else i += 1;
  }
  throw new LexError(text, start, 'unterminated template');
}

export function findComments(text) {
  const comments = [];
  const braces = [];
  let regexAllowed = true;
  let afterDot = false;
  let i = 0;
  if (text.startsWith('#!')) {
    const match = LINE_END.exec(text);
    i = match ? match.index : text.length;
  }
  const enterTemplate = (start, from) => {
    const { end, opened } = scanTemplate(text, start, from);
    if (opened) braces.push(start);
    regexAllowed = opened;
    afterDot = false;
    return end;
  };
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (SPACE.test(c)) {
      i += 1;
    } else if (c === '/' && next === '/') {
      let end = i + 2;
      while (end < text.length && !LINE_END.test(text[end])) end += 1;
      comments.push({ kind: 'line', start: i, end, line: lineAt(text, i) });
      i = end;
    } else if (c === '/' && next === '*') {
      const close = text.indexOf('*/', i + 2);
      if (close === -1) throw new LexError(text, i, 'unterminated block comment');
      comments.push({ kind: 'block', start: i, end: close + 2, line: lineAt(text, i) });
      i = close + 2;
    } else if (c === '/' && regexAllowed) {
      i = skipRegex(text, i);
      regexAllowed = false;
      afterDot = false;
    } else if (c === '\'' || c === '"') {
      i = skipQuoted(text, i);
      regexAllowed = false;
      afterDot = false;
    } else if (c === '`') {
      i = enterTemplate(i, i + 1);
    } else if ((WORD.lastIndex = i, WORD.test(text))) {
      const word = text.slice(i, WORD.lastIndex);
      regexAllowed = !afterDot && EXPRESSION_KEYWORDS.has(word);
      afterDot = false;
      i = WORD.lastIndex;
    } else if ((c === '+' || c === '-') && next === c) {
      afterDot = false;
      i += 2;
    } else if (c === '.' || c === '#') {
      afterDot = true;
      regexAllowed = false;
      i += 1;
    } else if (c === '{') {
      braces.push(null);
      regexAllowed = true;
      afterDot = false;
      i += 1;
    } else if (c === '}') {
      const entry = braces.pop();
      if (entry !== undefined && entry !== null) {
        i = enterTemplate(entry, i + 1);
      } else {
        regexAllowed = false;
        afterDot = false;
        i += 1;
      }
    } else if (c === ')' || c === ']') {
      regexAllowed = false;
      afterDot = false;
      i += 1;
    } else {
      regexAllowed = true;
      afterDot = false;
      i += 1;
    }
  }
  return comments;
}

export function blankComments(text, comments) {
  let out = '';
  let last = 0;
  for (const { start, end } of comments) {
    out += text.slice(last, start) + text.slice(start, end).replace(/[^\n\r\u2028\u2029]/g, ' ');
    last = end;
  }
  return out + text.slice(last);
}

const isExcluded = (file) =>
  EXCLUDED.some((rule) => (typeof rule === 'string' ? rule === file : rule.test(file)));

export function scopedFiles(root) {
  const files = [];
  for (const folder of SCOPE) {
    const dir = path.join(root, folder);
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue;
    for (const entry of readdirSync(dir, { recursive: true })) {
      const file = `${folder}/${String(entry).split(path.sep).join('/')}`;
      if (file.endsWith('.mjs') && !isExcluded(file)) files.push(file);
    }
  }
  return files.sort();
}

export function checkFile(root, file) {
  const text = readFileSync(path.join(root, file), 'utf8');
  let comments;
  try {
    comments = findComments(text);
  } catch (error) {
    return { undecided: [`${file}:${error.message}`], comments: [] };
  }
  if (comments.length === 0) return { undecided: [], comments: [] };
  const parsed = spawnSync(process.execPath, ['--input-type=module', '--check', '-'], {
    input: blankComments(text, comments),
    encoding: 'utf8',
  });
  if (parsed.status !== 0) {
    const reason = parsed.stderr.split('\n').find((line) => line.startsWith('SyntaxError')) ?? 'parse failed';
    return {
      undecided: [`${file}: no longer parses once its comments are blanked: ${reason}. Move a regular expression that follows ), } or ... into a const.`],
      comments: [],
    };
  }
  return { undecided: [], comments: comments.map((comment) => `${file}:${comment.line}: ${comment.kind} comment`) };
}

function main() {
  const root = path.resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)));
  let files;
  try {
    files = scopedFiles(root);
  } catch (error) {
    console.error(`Cannot read ${root}: ${error.message}`);
    process.exit(2);
  }
  if (files.length === 0) {
    console.error(`No .mjs files in scope under ${root}`);
    process.exit(2);
  }
  const undecided = [];
  const found = [];
  for (const file of files) {
    const result = checkFile(root, file);
    undecided.push(...result.undecided);
    found.push(...result.comments);
  }
  for (const line of [...found, ...undecided]) console.error(line);
  if (undecided.length > 0) process.exit(2);
  if (found.length > 0) {
    console.error('Comments are not allowed. Move the intent into names or functions.');
    process.exit(1);
  }
  console.log(`Checked ${files.length} files: no comments.`);
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
