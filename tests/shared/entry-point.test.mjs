
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const helperUrl = new URL('../../shared/entry-point.mjs', import.meta.url).href;
const missingRoot = path.join(tmpdir(), 'lim-entry-point-no-such-root');

const guarded = [
  ['check-comments.mjs', [missingRoot], 2, /No \.mjs files in scope/],
  ['check-i18n.mjs', [missingRoot], 1, /ENOENT/],
  ['check-loop-model.mjs', ['--nonsense'], 2, /unknown argument --nonsense/],
  ['release.mjs', [], 2, /usage: node scripts\/release\.mjs/],
  ['sync-counts.mjs', ['--check', missingRoot], 1, /ENOENT/],
  ['sync-shared.mjs', ['--check', missingRoot], 1, /ENOENT/],
];

const started = (file, args) => spawnSync(process.execPath, [file, ...args], { encoding: 'utf8' });

function assertMainRan(result, status, message) {
  assert.equal(result.status, status, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, message);
}

for (const [name, args, status, message] of guarded) {
  const script = path.join(root, 'scripts', name);

  test(`scripts/${name} runs its main when started directly`, () => {
    assertMainRan(started(script, args), status, message);
  });

  test(`scripts/${name} runs its main when started through a link`, (t) => {
    const folder = mkdtempSync(path.join(tmpdir(), 'entry-point-'));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    const link = path.join(folder, name);
    try {
      symlinkSync(script, link);
    } catch (error) {
      if (error.code !== 'EPERM') throw error;
      t.skip('symbolic links need extra rights on this Windows account');
      return;
    }
    assertMainRan(started(link, args), status, message);
  });
}

test('every script in scripts/ that reads process.argv[1] is in the table above', () => {
  const readers = readdirSync(path.join(root, 'scripts'))
    .filter((name) => name.endsWith('.mjs') && readFileSync(path.join(root, 'scripts', name), 'utf8').includes('process.argv[1]'));
  assert.deepEqual(readers.sort(), guarded.map(([name]) => name));
});

const probe = `import { isEntryPoint } from ${JSON.stringify(helperUrl)}; console.log(isEntryPoint(${JSON.stringify(helperUrl)}));`;

test('isEntryPoint is false when no script started the process', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8' });
  assert.equal(result.stdout.trim(), 'false', result.stderr);
});

test('isEntryPoint is false when the script path does not exist', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe, 'no-such-script'], { encoding: 'utf8' });
  assert.equal(result.stdout.trim(), 'false', result.stderr);
});
