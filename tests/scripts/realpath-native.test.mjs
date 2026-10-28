import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const FS_NAMED_IMPORTS = /\bimport\s*\{([^}]*)\}\s*from\s*['"](?:node:)?fs['"]/g;

// Lines that name realpathSync without .native, so an alias, a stored reference, or a split call is caught too.
// Only a plain named import from node:fs is left alone: every use after it is checked on its own.
function nonNativeLines(text) {
  const imported = new Set([...text.matchAll(FS_NAMED_IMPORTS)].flatMap((match) => {
    const start = match.index + match[0].indexOf('{') + 1;
    return [...match[1].matchAll(/\brealpathSync\b(?!\s+as\b)/g)].map((name) => start + name.index);
  }));
  return [...text.matchAll(/\brealpathSync\b(?!\s*\.\s*native\b)/g)]
    .filter((use) => !imported.has(use.index))
    .map((use) => text.slice(0, use.index).split('\n').length);
}

function nonNativeUses(root) {
  const plugins = path.join(root, 'plugins');
  return readdirSync(plugins, { recursive: true })
    .filter((file) => /\.(mjs|cjs|js)$/.test(file) && statSync(path.join(plugins, file)).isFile())
    .flatMap((file) => nonNativeLines(readFileSync(path.join(plugins, file), 'utf8'))
      .map((line) => `plugins/${file.split(path.sep).join('/')}:${line}`));
}

test('every way of reaching realpathSync without .native is found', () => {
  const evasions = {
    'an aliased import': "import { readFileSync, realpathSync as rp } from 'node:fs';\nrp(x);",
    'a stored reference': "import fs from 'node:fs';\nconst resolve = fs.realpathSync;\nresolve(x);",
    '.call': 'fs.realpathSync.call(null, x);',
    'a space before (': 'fs.realpathSync (x);',
    'a call split across lines': 'const real = fs.realpathSync\n  (x);',
    'a destructured require': "const { realpathSync } = require('fs');",
    'a direct call after a named import': "import { realpathSync } from 'node:fs';\nrealpathSync(x);",
    'a bracket lookup': "fs['realpathSync'](x);",
  };
  for (const [form, text] of Object.entries(evasions)) assert.notDeepEqual(nonNativeLines(text), [], form);
  assert.deepEqual(nonNativeLines("import { realpathSync as rp } from 'node:fs';"), [1]);
  assert.deepEqual(nonNativeLines('const real = fs.realpathSync\n  (x);'), [1]);
  assert.deepEqual(nonNativeLines("import {\n  readFileSync,\n  realpathSync,\n} from 'node:fs';\nrealpathSync.native(x);\nfs.realpathSync .native(x);\nconst resolve = realpathSync.native;"), []);
});

test('hooks, nested script folders, and .cjs and .js files are scanned', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'realpath-native-'));
  const files = ['plugins/p/hooks/gate.mjs', 'plugins/p/skills/s/scripts/lib/nested.mjs', 'plugins/p/skills/s/scripts/other.cjs', 'plugins/p/tool.js'];
  for (const file of files) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), 'realpathSync(x);\n');
  }
  writeFileSync(path.join(root, 'plugins/p/notes.md'), 'realpathSync(x);\n');
  assert.deepEqual(nonNativeUses(root).sort(), files.map((file) => `${file}:1`).sort());
});

// On Windows realpathSync can keep an 8.3 short name (RUNNER~1) while git and realpathSync.native give the long one.
test('plugin code resolves real paths with realpathSync.native', () => {
  const uses = nonNativeUses(repositoryRoot);
  assert.deepEqual(uses, [], `call realpathSync.native instead of realpathSync at ${uses.join(', ')}, so a path compares equal to the one git gives on Windows (#178, #189)`);
});
