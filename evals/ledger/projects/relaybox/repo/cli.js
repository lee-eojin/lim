#!/usr/bin/env node
import { formatSize } from './src/format.js';

console.log(formatSize(Number(process.argv[2])));
