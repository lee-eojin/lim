import { readFileSync, writeFileSync } from 'node:fs';
import { legacyExport } from '../src/export.js';

const records = JSON.parse(readFileSync(process.argv[2], 'utf8'));
writeFileSync(process.argv[3], legacyExport(records));
