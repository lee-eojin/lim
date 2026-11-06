import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { reportNotice } from '../../plugins/review-loop/skills/review-loop/scripts/loop.mjs';

const hook = fileURLToPath(new URL('../../plugins/review-loop/hooks/show-report.mjs', import.meta.url));
const report = 'Review round 1 of 3 (reviewer: session model)\nChecks: none detected, reviewing the diff only\n\nStopped: no P1 or P2 left in this change';
const record = 'node /plugins/review-loop/skills/review-loop/scripts/loop.mjs record --file round-1.json';
const runHook = (payload) => spawnSync(process.execPath, [hook], { input: payload, encoding: 'utf8' });

test('the report hook shows the user the report a loop command returns exactly as printed', () => {
  const run = runHook(JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: record },
    tool_response: { stdout: JSON.stringify({ report, decision: 'stop' }, null, 2), stderr: '' },
  }));
  assert.equal(run.status, 0);
  assert.equal(JSON.parse(run.stdout).systemMessage, `review-loop report\n${report}`);
});

test('the report hook stays silent unless a loop command returns a report', () => {
  assert.equal(reportNotice({ command: 'node /plugins/review-loop/skills/review-loop/scripts/loop.mjs decide --id F-1 --choice keep', stdout: '{"recorded": true}' }), null);
  assert.equal(reportNotice({ command: 'node /plugins/review-loop/skills/review-loop/scripts/loop.mjs record', stdout: '{"report": "  "}' }), null);
  assert.equal(reportNotice({ command: 'cat notes.json', stdout: JSON.stringify({ report }) }), null);
  assert.equal(reportNotice({ command: 'node /plugins/review-loop/skills/review-loop/scripts/loop.mjs status', stdout: 'loop.mjs: not a git repository' }), null);
  const unrelated = JSON.stringify({ report: 'Unrelated command result' });
  assert.equal(reportNotice({ command: 'node ./tools/game/loop.mjs', stdout: unrelated }), null);
  assert.equal(reportNotice({ command: 'cat notes.json # see loop.mjs', stdout: unrelated }), null);
  assert.equal(reportNotice({ command: 'node my-loop.mjs', stdout: unrelated }), null);
  for (const payload of ['not json', JSON.stringify({ tool_name: 'Read' }), JSON.stringify({ tool_name: 'Bash' })]) {
    const run = runHook(payload);
    assert.equal(run.status, 0);
    assert.equal(run.stdout, '');
  }
});
