#!/usr/bin/env node
// Checks the shape of one evidence report. It cannot prove that the report is true.
import { readFileSync } from 'node:fs';

const REQUIRED = ['revision', 'repro', 'run', 'proof', 'limits', 'verdict'];
const VERDICTS = ['PASS', 'FAIL', 'NOT_RUN', 'BLOCKED'];
// A label starts its line. Without a colon it stands alone, so a sentence like "Run the tests" stays text.
const LABEL = /^(revision|repro|run|proof|limits|verdict|mutation)(?::(.*))?\s*$/i;

function parseText(text, problems) {
  const fields = {};
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const label = LABEL.exec(line);
    if (label) {
      current = label[1].toLowerCase();
      if (current in fields) problems.push(`${current}: appears more than once`);
      fields[current] = label[2] ?? '';
    } else if (current) {
      fields[current] += `\n${line}`;
    }
  }
  for (const field of Object.keys(fields)) fields[field] = fields[field].trim();
  return fields;
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/check-evidence-report.mjs <file>');
  process.exit(2);
}
let text;
try {
  text = readFileSync(file, 'utf8').replace(/^﻿/, '');
} catch (error) {
  console.error(`Cannot read ${file}: ${error.message}`);
  process.exit(2);
}

const problems = [];
let fields;
if (text.trimStart().startsWith('{')) {
  try {
    fields = JSON.parse(text);
  } catch (error) {
    problems.push(`${file}: invalid JSON: ${error.message}`);
  }
} else {
  fields = parseText(text, problems);
}

if (fields) {
  for (const field of [...REQUIRED, 'mutation']) {
    const value = fields[field];
    if (value === undefined) {
      if (field !== 'mutation') problems.push(`${field}: missing`);
    } else if (typeof value !== 'string') {
      problems.push(`${field}: must be a string`);
    } else if (!value.trim()) {
      problems.push(`${field}: must not be empty`);
    } else if (field === 'verdict' && !VERDICTS.includes(value)) {
      problems.push(`verdict: must be one of ${VERDICTS.join(', ')}`);
    }
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Evidence report OK (verdict ${fields.verdict}).`);
}
