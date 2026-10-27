#!/usr/bin/env node
import { formatCents } from '../src/format.js';

const amount = process.argv[2];
if (!/^\d+$/.test(amount ?? '')) {
  process.stderr.write('cents: amount must be a whole number of cents\n');
  process.exit(2);
}
console.log(formatCents(Number(amount)));
