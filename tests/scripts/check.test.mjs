import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/check.sh', import.meta.url));

test('check.sh rejects JSON with NaN or Infinity, which JSON.parse refuses', { skip: process.platform === 'win32' && 'needs bash and python3' }, () => {
  const root = mkdtempSync(path.join(tmpdir(), 'check-sh-'));
  try {
    mkdirSync(path.join(root, 'scripts'));
    copyFileSync(script, path.join(root, 'scripts/check.sh'));
    writeFileSync(path.join(root, 'valid.json'), '{"version": "1.0.0", "count": 1.5}\n');
    writeFileSync(path.join(root, 'nan.json'), '{"count": NaN}\n');
    writeFileSync(path.join(root, 'infinity.json'), '{"count": -Infinity}\n');
    const { LIM_DENYLIST, LIM_DENYLIST_FILE, ...env } = process.env;
    const run = spawnSync('bash', [path.join(root, 'scripts/check.sh')], { encoding: 'utf8', env });
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.deepEqual(run.stdout.match(/^invalid JSON: .*$/gm).sort(), ['invalid JSON: infinity.json', 'invalid JSON: nan.json']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
