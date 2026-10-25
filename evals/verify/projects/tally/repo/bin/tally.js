#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseCsv } from '../src/csv.js';
import { columnStats } from '../src/stats.js';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args.splice(index, 2)[1];
};
const column = option('--column');
const format = option('--format') ?? 'text';
const [file] = args;

if (!file || !column) {
  console.error('Usage: tally <file.csv> --column <name> [--format text|json]');
  process.exit(1);
}

let text;
try {
  text = readFileSync(file, 'utf8');
} catch {
  console.error(`Cannot read ${file}`);
  process.exit(2);
}

let stats;
try {
  stats = columnStats(parseCsv(text), column);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

if (format === 'json') {
  console.log(JSON.stringify(stats));
} else {
  console.log(`count: ${stats.count}`);
  console.log(`sum: ${stats.sum}`);
  console.log(`mean: ${stats.mean ?? '-'}`);
}
