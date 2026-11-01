#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const OPERATORS = {
  '=': (left, right) => String(left) === right,
  '!=': (left, right) => String(left) !== right,
  '>': (left, right) => Number(left) > Number(right),
};

const lines = readFileSync(process.argv[2], 'utf8').split('\n').filter((line) => line.trim() && !line.startsWith('#|'));
const [, field, operator, value] = /^query:\s*(\w+)\s*(!=|=|>)\s*(.+)$/.exec(lines[0]);
for (const line of lines.slice(1)) {
  const record = JSON.parse(line);
  if (field in record && OPERATORS[operator](record[field], value.trim())) console.log(line);
}
