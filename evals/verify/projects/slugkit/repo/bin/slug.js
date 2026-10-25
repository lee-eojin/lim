#!/usr/bin/env node
import { slugify } from '../src/slugify.js';

const args = process.argv.slice(2);
let maxLength;
const maxIndex = args.indexOf('--max');
if (maxIndex !== -1) {
  maxLength = Number(args[maxIndex + 1]);
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    console.error('--max must be a positive whole number');
    process.exit(1);
  }
  args.splice(maxIndex, 2);
}
const text = args.join(' ');
if (!text.trim()) {
  console.error('Usage: slug [--max <n>] <text>');
  process.exit(1);
}
console.log(slugify(text, { maxLength }));
