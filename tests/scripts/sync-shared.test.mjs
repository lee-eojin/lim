
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COPIES } from '../../scripts/sync-shared.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = path.join(root, 'scripts', 'sync-shared.mjs');
const run = (cwd, ...args) => spawnSync(process.execPath, [script, ...args, cwd], { encoding: 'utf8' });

const source = 'shared/entry-point.mjs';
const sources = Object.keys(COPIES).map((name) => `shared/${name}`);
const copies = Object.entries(COPIES).flatMap(([name, plugins]) => plugins.map((plugin) => `plugins/${plugin}/skills/${plugin}/scripts/_shared/${name}`));
const helper = 'export const one = 1;\n';

function temporary(t) {
  const folder = mkdtempSync(path.join(tmpdir(), 'sync-shared-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

function write(cwd, files) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    writeFileSync(path.join(cwd, file), text);
  }
}

function unsynced(t) {
  const cwd = temporary(t);
  write(cwd, {
    ...Object.fromEntries(sources.map((file) => [file, helper])),
    'plugins/gap-map/skills/gap-map/scripts/gapmap.mjs': '',
    'plugins/ledger/skills/ledger/scripts/ledger.mjs': '',
    'plugins/verify/skills/verify/scripts/verify.mjs': '',
  });
  return cwd;
}

function synced(t) {
  const cwd = unsynced(t);
  write(cwd, Object.fromEntries(copies.map((file) => [file, helper])));
  return cwd;
}

function linked(t, target, file) {
  try {
    symlinkSync(target, file);
    return true;
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    t.skip('symbolic links need extra rights on this Windows account');
    return false;
  }
}

function assertStale(cwd, line) {
  const result = run(cwd, '--check');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.ok(result.stdout.split('\n').includes(line), result.stdout);
}

test('the copies in this repository match shared/ byte for byte', () => {
  const result = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stdout, 'Checked 8 copies: all match shared/.\n');
});

test('a sync writes the copies, a second sync changes nothing, and --check then passes', (t) => {
  const cwd = unsynced(t);
  const first = run(cwd);
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(first.stdout.trim().split('\n'), copies.map((file) => `updated ${file}: missing`));
  for (const file of copies) assert.equal(readFileSync(path.join(cwd, file), 'utf8'), helper);
  const second = run(cwd);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout, '');
  assert.equal(run(cwd, '--check').status, 0);
});

test('--check names a copy one byte off, exits 1, and writes nothing', (t) => {
  const cwd = synced(t);
  const changed = helper.replace('1', '2');
  write(cwd, { [copies[1]]: changed });
  assertStale(cwd, `${copies[1]}: differs from ${source}`);
  assert.equal(readFileSync(path.join(cwd, copies[1]), 'utf8'), changed);
});

test('--check tells CRLF line endings from LF', (t) => {
  const cwd = synced(t);
  write(cwd, { [copies[0]]: helper.replace('\n', '\r\n') });
  assertStale(cwd, `${copies[0]}: differs from ${source}`);
});

test('--check names a missing copy', (t) => {
  const cwd = synced(t);
  rmSync(path.join(cwd, copies[0]));
  assertStale(cwd, `${copies[0]}: missing`);
});

test('a file in _shared/ that COPIES does not list fails --check in any plugin, and a sync removes it', (t) => {
  const cwd = synced(t);
  const strays = ['plugins/verify/skills/verify/scripts/_shared/entry-point.mjs', `${path.posix.dirname(copies[0])}/old.mjs`];
  write(cwd, Object.fromEntries(strays.map((file) => [file, helper])));
  for (const file of strays) assertStale(cwd, `${file}: not in COPIES`);
  assert.equal(run(cwd).status, 0);
  for (const file of strays) assert.equal(existsSync(path.join(cwd, file)), false, file);
  assert.equal(run(cwd, '--check').status, 0);
});

test('a link in place of a copy fails --check, and a sync replaces it without writing through it', (t) => {
  const cwd = synced(t);
  const file = path.join(cwd, copies[0]);
  rmSync(file);
  if (!linked(t, path.join(cwd, source), file)) return;
  assertStale(cwd, `${copies[0]}: not a regular file`);
  assert.equal(run(cwd).status, 0);
  assert.ok(lstatSync(file).isFile());
  assert.equal(readFileSync(path.join(cwd, source), 'utf8'), helper);
});

test('a link in place of the _shared folder fails --check, and a sync replaces it and keeps shared/', (t) => {
  const cwd = synced(t);
  const folder = path.join(cwd, path.dirname(copies[0]));
  rmSync(folder, { recursive: true });
  if (!linked(t, path.join(cwd, 'shared'), folder)) return;
  assertStale(cwd, `${path.posix.dirname(copies[0])}: not a folder`);
  assert.equal(run(cwd).status, 0);
  assert.ok(lstatSync(folder).isDirectory());
  assert.equal(readFileSync(path.join(cwd, source), 'utf8'), helper);
  assert.equal(run(cwd, '--check').status, 0);
});

const refusals = [
  ['a helper that COPIES does not list', (cwd) => write(cwd, { 'shared/other.mjs': helper }), /shared\/other\.mjs: not listed in COPIES/],
  ['a helper file that is gone', (cwd) => rmSync(path.join(cwd, source)), /shared\/entry-point\.mjs: listed in COPIES but missing/],
  ['a plugin scripts folder that is gone', (cwd) => rmSync(path.join(cwd, 'plugins/ledger'), { recursive: true }), /plugins\/ledger\/skills\/ledger\/scripts: no such folder/],
  ['no shared folder', (cwd) => rmSync(path.join(cwd, 'shared'), { recursive: true }), /ENOENT/],
];

for (const [name, change, message] of refusals) {
  test(`stops with exit 1 and writes nothing on ${name}`, (t) => {
    const cwd = unsynced(t);
    change(cwd);
    for (const args of [['--check'], []]) {
      const result = run(cwd, ...args);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, message);
    }
    for (const file of copies) assert.equal(existsSync(path.join(cwd, file)), false, file);
  });
}

const RELATIVE_IMPORT = /(?:\bfrom\s+|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

function pluginImports(base) {
  return readdirSync(path.join(base, 'plugins')).flatMap((plugin) => {
    const folder = path.join(base, 'plugins', plugin);
    return readdirSync(folder, { recursive: true })
      .filter((file) => /\.(mjs|cjs|js)$/.test(file))
      .flatMap((file) => [...readFileSync(path.join(folder, file), 'utf8').matchAll(RELATIVE_IMPORT)]
        .map(([, specifier]) => ({ folder, specifier, target: path.resolve(folder, path.dirname(file), specifier) })));
  });
}

const broken = ({ folder, target }) => path.relative(folder, target).startsWith('..') || !existsSync(target);

test('a plugin import that leaves the plugin folder or finds no file is caught', (t) => {
  const cwd = temporary(t);
  write(cwd, {
    'plugins/p/skills/p/scripts/a.mjs': "import './b.mjs';\nimport '../../../../../shared/x.mjs';\nawait import('../c.mjs');\nexport { d } from './missing.mjs';\n",
    'plugins/p/skills/p/scripts/b.mjs': '',
    'shared/x.mjs': '',
  });
  assert.deepEqual(pluginImports(cwd).filter(broken).map(({ specifier }) => specifier), ['../../../../../shared/x.mjs', '../c.mjs', './missing.mjs']);
});

test('every relative import in a plugin stays inside that plugin and finds its file', () => {
  assert.deepEqual(pluginImports(root).filter(broken).map(({ target }) => target), []);
});

test('every copy in COPIES has a plugin file that imports it', () => {
  const imported = new Set(pluginImports(root).map(({ target }) => target));
  for (const [helperName, plugins] of Object.entries(COPIES)) {
    for (const plugin of plugins) {
      const copy = path.join(root, 'plugins', plugin, 'skills', plugin, 'scripts', '_shared', helperName);
      assert.ok(imported.has(copy), `no file in plugins/${plugin} imports ./_shared/${helperName}`);
    }
  }
});

for (const [plugin, file] of [['gap-map', 'gapmap.mjs'], ['ledger', 'ledger.mjs']]) {
  test(`${plugin} runs from a copy of its folder with no repository around it`, (t) => {
    const folder = path.join(temporary(t), plugin);
    cpSync(path.join(root, 'plugins', plugin), folder, { recursive: true });
    const result = spawnSync(process.execPath, [path.join(folder, 'skills', plugin, 'scripts', file), '--help'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`${file} check`));
  });
}
