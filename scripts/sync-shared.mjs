#!/usr/bin/env node
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const COPIES = {
  'entry-point.mjs': ['gap-map', 'ledger'],
  'check-ids.mjs': ['gap-map', 'ledger'],
  'within.mjs': ['gap-map', 'ledger'],
  'count-hits.mjs': ['gap-map', 'ledger'],
  'kill-group.mjs': ['gap-map', 'verify'],
};

const statOf = (root, file) => lstatSync(path.join(root, file), { throwIfNoEntry: false });
const scriptsOf = (plugin) => `plugins/${plugin}/skills/${plugin}/scripts`;

function foldersIn(root, folder) {
  if (!statOf(root, folder)?.isDirectory()) return [];
  return readdirSync(path.join(root, folder), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${folder}/${entry.name}`)
    .sort();
}

function expectedCopies(root) {
  for (const name of readdirSync(path.join(root, 'shared'))) {
    if (!Object.hasOwn(COPIES, name)) throw new Error(`shared/${name}: not listed in COPIES in scripts/sync-shared.mjs`);
  }
  const copies = Object.entries(COPIES).flatMap(([helper, plugins]) => {
    if (!statOf(root, `shared/${helper}`)?.isFile()) throw new Error(`shared/${helper}: listed in COPIES but missing`);
    return plugins.map((plugin) => {
      if (!statOf(root, scriptsOf(plugin))?.isDirectory()) throw new Error(`${scriptsOf(plugin)}: no such folder; fix COPIES`);
      return { source: `shared/${helper}`, file: `${scriptsOf(plugin)}/_shared/${helper}` };
    });
  });
  if (copies.length === 0) throw new Error('COPIES lists no helpers');
  return copies;
}

function problemWith(root, { source, file }) {
  const stats = statOf(root, file);
  if (!stats) return 'missing';
  if (!stats.isFile()) return 'not a regular file';
  const same = readFileSync(path.join(root, source)).equals(readFileSync(path.join(root, file)));
  return same ? null : `differs from ${source}`;
}

export function syncShared(root = defaultRoot, { write = true } = {}) {
  const copies = expectedCopies(root);
  const wanted = new Set(copies.map(({ file }) => file));
  const stale = [];
  const remove = (file, problem) => {
    stale.push({ file, problem });
    if (write) rmSync(path.join(root, file), { recursive: true, force: true });
  };
  const sharedFolders = foldersIn(root, 'plugins')
    .flatMap((plugin) => foldersIn(root, `${plugin}/skills`))
    .map((skill) => `${skill}/scripts/_shared`)
    .filter((folder) => statOf(root, folder));
  for (const folder of sharedFolders) {
    if (!statOf(root, folder).isDirectory()) {
      remove(folder, 'not a folder');
      continue;
    }
    for (const name of readdirSync(path.join(root, folder)).sort()) {
      if (!wanted.has(`${folder}/${name}`)) remove(`${folder}/${name}`, 'not in COPIES');
    }
  }
  for (const copy of copies) {
    const problem = problemWith(root, copy);
    if (!problem) continue;
    stale.push({ file: copy.file, problem });
    if (write) {
      rmSync(path.join(root, copy.file), { recursive: true, force: true });
      mkdirSync(path.dirname(path.join(root, copy.file)), { recursive: true });
      copyFileSync(path.join(root, copy.source), path.join(root, copy.file));
    }
  }
  return stale;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const root = path.resolve(args.find((arg) => arg !== '--check') ?? defaultRoot);
  let stale;
  try {
    stale = syncShared(root, { write: !check });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (check && stale.length > 0) console.log('Shared helpers are out of date. Run node scripts/sync-shared.mjs to update:');
  for (const { file, problem } of stale) console.log(`${check ? '' : 'updated '}${file}: ${problem}`);
  if (check && stale.length === 0) console.log(`Checked ${Object.values(COPIES).flat().length} copies: all match shared/.`);
  process.exit(check && stale.length > 0 ? 1 : 0);
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) main();
