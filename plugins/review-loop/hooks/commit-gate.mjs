#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { gateDecision } from '../skills/review-loop/scripts/loop.mjs';

try {
  const payload = JSON.parse(readFileSync(0, 'utf8'));
  if (payload.tool_name === 'Bash') {
    const result = gateDecision({
      cwd: payload.cwd ?? process.cwd(),
      command: payload.tool_input?.command ?? '',
      projectDir: process.env.CLAUDE_PROJECT_DIR,
    });
    if (result) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: result.decision,
          permissionDecisionReason: result.reason,
        },
      }));
    }
  }
} catch {
  process.exitCode = 0;
}
