#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'data');

const usage = `Usage: node check-clarity.mjs [--json] [file]

Reads an explanation in English or Korean from the file, or from stdin, and lists what to look
at with line numbers: vague words, long sentences, chained possessives, stacked passives,
double negatives, and two characters to replace. Fenced and indented code blocks, inline code,
and URLs are skipped, except for the two characters.

  --json   print the findings and a summary as JSON

Exit code: 1 when something must be fixed (one of the two characters), 2 on a usage error or
a file it cannot read, otherwise 0.
`;

export const LIMITS = { englishWords: 25, koreanCharacters: 100, possessives: 2 };

// Built from code points so this file never contains the characters it reports.
const FORBIDDEN_CHARACTERS = [
  { character: String.fromCharCode(0x2014), name: 'em dash (U+2014)', advice: 'end the sentence, or use a comma or parentheses' },
  { character: String.fromCharCode(0x00b7), name: 'middle dot (U+00B7)', advice: 'use a comma or a slash, or write "and" or "or"' },
];

const STRUCTURE_RULES = [
  { rule: 'double-negative', pattern: /지\s*않으면\s*안\s*(?:된|돼|됩)/gu, advice: 'write ~해야 한다' },
  { rule: 'passive-stack', pattern: /(?:되어|보여|쓰여|잊혀|불려)[지-짛져-졓]/gu, advice: 'one passive is enough (되다, 보이다)' },
  {
    rule: 'passive-stack',
    pattern: /\b(?:is|are|was|were|be|been|being)\s+\w+(?:ed|en)\s+to\s+be\s+\w+(?:ed|en)\b/giu,
    advice: 'name who acts and use the active voice',
  },
];

const KOREAN_NOUNS_ENDING_IN_UI = new Set([
  '거의', '정의', '회의', '주의', '동의', '논의', '합의', '강의', '편의', '의의',
  '모의', '질의', '문의', '결의', '호의', '예의', '성의', '상의', '하의', '협의',
]);

const FENCE = /^([ \t]*)(?:```|~~~)/;
const INDENTED = /^(?: {4}|\t)/;
const EMPHASIS = /(?<=^|[\s(\[])[*_]+(?=\S)|(?<=\S)[*_]+(?=$|[\s.,!?:;)\]])/gu;
const INLINE_CODE = /`[^`]*`/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const URL_PATTERN = /https?:\/\/\S+/g;
const SENTENCE_END = /(?<=[.!?])\s+/u;
const QUOTE_MARKER = /^\s*>+\s?/;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;
const HANGUL = /[가-힣]/u;
const EDGE_PUNCTUATION = /^[.,!?()[\]{}'"]+|[.,!?()[\]{}'"]+$/gu;
const ENGLISH_POSSESSIVES = /(?:\b[\w-]+'s\s+){2,}[\w-]+/gu;
const OF_CHAIN = /\bof\s+(?:(?:the|a|an)\s+)?[\w-]+\s+of\s+(?:(?:the|a|an)\s+)?[\w-]+\s+of\b/giu;

export function loadPatterns(file, flags) {
  return readFileSync(file, 'utf8').split('\n').flatMap((line) => {
    if (!line.trim() || line.startsWith('#') || !line.includes(' => ')) return [];
    const [expression, advice] = line.split(' => ');
    return [{ rule: 'vague-word', pattern: new RegExp(expression.trim(), flags), advice: advice.trim() }];
  });
}

let defaultPatterns;
function vaguePatterns() {
  defaultPatterns ??= [
    ...loadPatterns(path.join(dataDir, 'vague-words-en.txt'), 'giu'),
    ...loadPatterns(path.join(dataDir, 'vague-words-ko.txt'), 'gu'),
  ];
  return defaultPatterns;
}

// A fence starts with at most three spaces of indentation, as in CommonMark, except inside a
// list, where the item's own indentation comes first.
function isFence(line, inList) {
  const match = FENCE.exec(line);
  return Boolean(match) && (inList || match[1].replace(/\t/g, '    ').length <= 3);
}

// An indented code block starts after a blank line, outside a list, and runs until a line that
// is neither blank nor indented.
export function proseLines(text) {
  const lines = [];
  let inFence = false;
  let inIndentedCode = false;
  let inList = false;
  let afterBlank = true;
  text.split('\n').forEach((line, index) => {
    const blank = !line.trim();
    const wasAfterBlank = afterBlank;
    afterBlank = blank;
    if (inFence) {
      if (isFence(line, inList)) inFence = false;
      return;
    }
    if (blank && inIndentedCode) return;
    if (INDENTED.test(line) && !blank && (inIndentedCode || (wasAfterBlank && !inList))) {
      inIndentedCode = true;
      return;
    }
    if (isFence(line, inList)) {
      inFence = true;
      inIndentedCode = false;
      return;
    }
    inIndentedCode = false;
    if (LIST_MARKER.test(line)) inList = true;
    else if (!blank && wasAfterBlank && !/^\s/.test(line)) inList = false;
    const cleaned = line.replace(INLINE_CODE, 'code').replace(LINK, '$1').replace(URL_PATTERN, 'url').replace(EMPHASIS, '');
    lines.push({ number: index + 1, text: cleaned });
  });
  return lines;
}

function forbiddenCharacters(text) {
  return text.split('\n').flatMap((line, index) => FORBIDDEN_CHARACTERS
    .filter(({ character }) => line.includes(character))
    .map(({ name, advice }) => ({ line: index + 1, rule: 'forbidden-character', match: name, advice, mustFix: true })));
}

function patternMatches(lines, rules) {
  return lines.flatMap(({ number, text }) => rules.flatMap(({ rule, pattern, advice }) =>
    [...text.matchAll(pattern)].map((match) => ({ line: number, rule, match: match[0], advice, mustFix: false }))));
}

export function sentenceSize(sentence) {
  if (HANGUL.test(sentence)) return { size: [...sentence].length, unit: 'characters', limit: LIMITS.koreanCharacters };
  return { size: sentence.split(/\s+/).filter(Boolean).length, unit: 'words', limit: LIMITS.englishWords };
}

function longSentences(lines) {
  return lines.flatMap(({ number, text }) => {
    const body = text.replace(QUOTE_MARKER, '').replace(LIST_MARKER, '').trim();
    if (!body || body.startsWith('|') || body.startsWith('#')) return [];
    return body.split(SENTENCE_END).flatMap((sentence) => {
      const { size, unit, limit } = sentenceSize(sentence.trim());
      if (size <= limit) return [];
      const preview = [...sentence.trim()].slice(0, 30).join('');
      return [{ line: number, rule: 'long-sentence', match: `${size} ${unit} (${preview}...)`, advice: `one idea per sentence; aim for ${limit} ${unit} or fewer`, mustFix: false }];
    });
  });
}

function koreanPossessives(lines) {
  return lines.flatMap(({ number, text }) => {
    const findings = [];
    let chain = [];
    for (const word of [...text.split(/\s+/), '']) {
      const bare = word.replace(EDGE_PUNCTUATION, '');
      if (bare.length > 1 && bare.endsWith('의') && HANGUL.test(bare) && !KOREAN_NOUNS_ENDING_IN_UI.has(bare)) {
        chain.push(bare);
        continue;
      }
      if (chain.length > LIMITS.possessives) {
        findings.push({ line: number, rule: 'possessive-chain', match: [...chain, bare].join(' ').trim(), advice: 'use 의 at most twice in a row; rewrite with a verb', mustFix: false });
      }
      chain = [];
    }
    return findings;
  });
}

function englishPossessives(lines) {
  return patternMatches(lines, [
    { rule: 'possessive-chain', pattern: ENGLISH_POSSESSIVES, advice: 'break the chain; rewrite with a verb' },
    { rule: 'possessive-chain', pattern: OF_CHAIN, advice: 'break the chain; rewrite with a verb' },
  ]);
}

export function checkText(text, { patterns = vaguePatterns() } = {}) {
  const lines = proseLines(text);
  const findings = [
    ...forbiddenCharacters(text),
    ...patternMatches(lines, patterns),
    ...patternMatches(lines, STRUCTURE_RULES),
    ...longSentences(lines),
    ...koreanPossessives(lines),
    ...englishPossessives(lines),
  ].sort((a, b) => Number(b.mustFix) - Number(a.mustFix) || a.line - b.line);
  const characters = lines.reduce((sum, { text: line }) => sum + [...line.trim()].length, 0);
  const fix = findings.filter((finding) => finding.mustFix).length;
  return {
    findings,
    summary: {
      fix,
      review: findings.length - fix,
      characters,
      issuesPer1000: characters ? Number(((findings.length * 1000) / characters).toFixed(2)) : 0,
      longSentences: findings.filter((finding) => finding.rule === 'long-sentence').length,
    },
  };
}

export function formatReport({ findings, summary }) {
  if (!findings.length) return 'Nothing to look at.\n';
  const rows = findings.map((finding) =>
    `line ${finding.line} [${finding.mustFix ? 'fix' : 'review'}] ${finding.rule}: ${finding.match} -> ${finding.advice}`);
  return `${rows.join('\n')}\n\n${summary.fix} to fix, ${summary.review} to review\n`;
}

function main() {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      allowPositionals: true,
      options: { json: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h', default: false } },
    }));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage}`);
    process.exit(2);
  }
  if (values.help) {
    process.stdout.write(usage);
    return;
  }
  if (positionals.length > 1) {
    process.stderr.write(usage);
    process.exit(2);
  }
  let text;
  try {
    text = readFileSync(positionals[0] ?? 0, 'utf8');
  } catch (error) {
    process.stderr.write(`Cannot read ${positionals[0] ?? 'stdin'}: ${error.message}\n`);
    process.exit(2);
  }
  const result = checkText(text);
  process.stdout.write(values.json ? `${JSON.stringify(result, null, 2)}\n` : formatReport(result));
  process.exitCode = result.summary.fix > 0 ? 1 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
