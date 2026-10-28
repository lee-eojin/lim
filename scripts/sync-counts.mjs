#!/usr/bin/env node
// Writes the behavior counts from evals/*/behaviors.csv into README.md, its translations, and the plugin READMEs.
// Usage: node scripts/sync-counts.mjs [--check] [root]
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function csvCells(line) {
  const cells = [''];
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (quoted && character === '"' && line[index + 1] === '"') cells[cells.length - 1] += line[++index];
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) cells.push('');
    else cells[cells.length - 1] += character;
  }
  return cells;
}

export const behaviorRows = (csvFile) => readFileSync(csvFile, 'utf8').trim().split('\n').slice(1).map(csvCells);

export function behaviorCounts(csvFile) {
  const rows = behaviorRows(csvFile);
  const tested = rows.filter((row) => row[3].startsWith('test:')).length;
  return { total: rows.length, tested, rest: rows.length - tested };
}

export function russianBehaviorNoun(count) {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'вариантов';
  if (last === 1) return 'вариант';
  if (last >= 2 && last <= 4) return 'варианта';
  return 'вариантов';
}

const countNames = ['total', 'tested', 'rest'];

// A count in a README is the number right after <!--total-->, <!--tested-->, or <!--rest-->.
// GitHub renders the comment as nothing. A Russian noun after the number is matched so its form can follow the count.
const countMarker = /<!--(total|tested|rest)-->(\d+)(?:(\s+)вариант(?:ов|а)?(?![а-яё]))?/gu;

export function countTargets(root = defaultRoot) {
  const filesIn = (directory, pattern) =>
    existsSync(path.join(root, directory)) ? readdirSync(path.join(root, directory)).filter((name) => pattern.test(name)).sort() : [];
  return [
    'README.md',
    ...filesIn('docs/i18n', /^README\..+\.md$/).map((name) => `docs/i18n/${name}`),
    ...filesIn('plugins', /./).map((name) => `plugins/${name}/README.md`).filter((file) => existsSync(path.join(root, file))),
  ];
}

export function statedCounts(root, file) {
  const text = readFileSync(path.join(root, file), 'utf8');
  const csv = /\]\(([^)\s]*behaviors\.csv)\)/.exec(text)?.[1];
  if (!csv) throw new Error(`${file}: no link to behaviors.csv`);
  const marks = [...text.matchAll(countMarker)].map(([, name, value]) => ({ name, value: Number(value) }));
  const written = [...text.matchAll(/<!--\s*(total|tested|rest)\s*-->\s*\d*/giu)];
  const broken = written.find(([whole]) => !/^<!--(total|tested|rest)-->\d+$/u.test(whole));
  if (broken) {
    const line = text.slice(0, broken.index).split('\n').length;
    throw new Error(`${file}:${line}: "${broken[0].trim()}" is not a count marker; write it as <!--${broken[1].toLowerCase()}--> with the number right after it`);
  }
  for (const name of countNames) {
    if (!marks.some((mark) => mark.name === name)) throw new Error(`${file}: no <!--${name}--> marker before the ${name} count; add it by hand once`);
  }
  return { text, csv: path.posix.join(path.posix.dirname(file), csv), marks };
}

function syncedText(root, file) {
  const { text, csv, marks } = statedCounts(root, file);
  const expected = behaviorCounts(path.join(root, csv));
  const after = text.replace(countMarker, (_, name, value, space) =>
    `<!--${name}-->${expected[name]}${space === undefined ? '' : space + russianBehaviorNoun(expected[name])}`);
  const counts = countNames.flatMap((name) => {
    const stated = [...new Set(marks.filter((mark) => mark.name === name).map((mark) => mark.value))];
    return stated.some((value) => value !== expected[name]) ? [{ name, stated, expected: expected[name] }] : [];
  });
  return { file, before: text, after, counts };
}

export function syncCounts(root = defaultRoot, { write = true } = {}) {
  const stale = countTargets(root).map((file) => syncedText(root, file)).filter(({ before, after }) => before !== after);
  if (write) for (const { file, after } of stale) writeFileSync(path.join(root, file), after);
  return stale;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const root = path.resolve(args.find((arg) => arg !== '--check') ?? defaultRoot);
  let stale;
  try {
    stale = syncCounts(root, { write: !check });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (check && stale.length > 0) console.log('Behavior counts are out of date. Run node scripts/sync-counts.mjs to update:');
  for (const { file, counts } of stale) {
    const changes = counts.map(({ name, stated, expected }) => `${name} ${stated.join(', ')} -> ${expected}`);
    console.log(`${check ? '' : 'updated '}${file}: ${changes.join('; ') || 'Russian noun form'}`);
  }
  if (stale.some(({ counts }) => counts.some(({ name }) => name === 'rest'))) {
    console.log('The number of behaviors that need a model run changed. Update the list of them in each file by hand.');
  }
  process.exit(check && stale.length > 0 ? 1 : 0);
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
