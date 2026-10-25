#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createClient } from './client.js';

const { values } = parseArgs({
  options: {
    path: { type: 'string', default: '/status' },
  },
});

const client = createClient();
const response = await client.get(values.path);
console.log(response.status);
