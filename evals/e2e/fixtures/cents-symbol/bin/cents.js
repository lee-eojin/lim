#!/usr/bin/env node
import { formatCents } from '../src/format.js';

const args = process.argv.slice(2);
const symbolAt = args.indexOf('--symbol');
const symbol = symbolAt === -1 ? '$' : args.splice(symbolAt, 2)[1];
const amount = args[0];
if (!/^\d+$/.test(amount ?? '')) {
  process.stderr.write('cents: amount must be a whole number of cents\n');
  process.exit(2);
}
console.log(formatCents(Number(amount), symbol));
