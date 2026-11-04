#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { reportNotice } from '../skills/review-loop/scripts/loop.mjs';

try {
  const payload = JSON.parse(readFileSync(0, 'utf8'));
  if (payload.tool_name === 'Bash') {
    const notice = reportNotice({ command: payload.tool_input?.command, stdout: payload.tool_response?.stdout });
    if (notice) process.stdout.write(JSON.stringify({ systemMessage: notice }));
  }
} catch {
  process.exitCode = 0;
}
