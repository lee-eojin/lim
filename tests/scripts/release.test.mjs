import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { release } from '../../scripts/release.mjs';

const script = fileURLToPath(new URL('../../scripts/release.mjs', import.meta.url));

const marketplace = `{
  "name": "lim",
  "plugins": [
    {
      "name": "other",
      "source": "./plugins/other",
      "version": "2.0.0"
    },
    {
      "name": "tool",
      "source": "./plugins/tool",
      "description": "Does one job.",
      "version": "1.2.0",
      "category": "development"
    }
  ]
}
`;

const pluginJson = (name, version) => `{
  "name": "${name}",
  "version": "${version}",
  "keywords": ["one", "two"]
}
`;

const readme = `# Project

| Plugin | Status | One job |
|---|---|---|
| [other](plugins/other) | 2.0.0 | Other job. |
| [tool](plugins/tool) | 1.2.0 | Does one job, version 1.2.0 of it. |
`;

const translation = `# Projekt

| Plugin | Stand | Aufgabe |
|---|---|---|
| [other](../../plugins/other) | 2.0.0 | Andere Sache. |
| [tool](../../plugins/tool) | 1.2.0 | Macht eine Sache. |
`;

const changelog = `# Changelog

## Unreleased

- Fixed: something. (#1)

## 1.2.0 (2026-01-01)

- Added: the tool.
`;

const fixture = {
  '.claude-plugin/marketplace.json': marketplace,
  'plugins/tool/.claude-plugin/plugin.json': pluginJson('tool', '1.2.0'),
  'plugins/tool/CHANGELOG.md': changelog,
  'plugins/other/.claude-plugin/plugin.json': pluginJson('other', '2.0.0'),
  'README.md': readme,
  'docs/i18n/README.de.md': translation,
  'docs/i18n/README.ko.md': translation,
};

const tempDirs = [];
afterEach(() => {
  for (const root of tempDirs.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeRoot(overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'release-'));
  tempDirs.push(root);
  for (const [file, content] of Object.entries({ ...fixture, ...overrides })) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return root;
}

const read = (root, file) => readFileSync(path.join(root, file), 'utf8');
const snapshot = (root) => Object.fromEntries(Object.keys(fixture).map((file) => [file, read(root, file)]));

test('bumps the version in every place it appears and returns the changed files', () => {
  const root = makeRoot();
  const changed = release({ root, plugin: 'tool', version: '1.3.0', date: '2026-10-28' });

  assert.deepEqual(changed, [
    'plugins/tool/.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
    'README.md',
    'docs/i18n/README.de.md',
    'docs/i18n/README.ko.md',
    'plugins/tool/CHANGELOG.md',
  ]);
  assert.equal(read(root, 'plugins/tool/.claude-plugin/plugin.json'), pluginJson('tool', '1.3.0'));
  assert.equal(read(root, '.claude-plugin/marketplace.json'), marketplace.replace('"1.2.0"', '"1.3.0"'));
  assert.equal(read(root, 'README.md'), readme.replace('| 1.2.0 |', '| 1.3.0 |'));
  assert.equal(read(root, 'docs/i18n/README.de.md'), translation.replace('| 1.2.0 |', '| 1.3.0 |'));
  assert.equal(read(root, 'docs/i18n/README.ko.md'), translation.replace('| 1.2.0 |', '| 1.3.0 |'));
  assert.equal(read(root, 'plugins/tool/CHANGELOG.md'), changelog.replace('## Unreleased', '## 1.3.0 (2026-10-28)'));
  assert.equal(read(root, 'plugins/other/.claude-plugin/plugin.json'), pluginJson('other', '2.0.0'));
});

const refusals = [
  ['an unknown plugin', { plugin: 'missing' }, {}, /unknown plugin "missing"/],
  ['a version that is not semver', { version: '1.3' }, {}, /not a version/],
  ['a version equal to the current one', { version: '1.2.0' }, {}, /not higher than the current 1\.2\.0/],
  ['a version lower than the current one', { version: '1.1.9' }, {}, /not higher than the current 1\.2\.0/],
  ['a date that is not YYYY-MM-DD', { date: '28.10.2026' }, {}, /not a YYYY-MM-DD date/],
  ['a date that does not exist', { date: '2026-02-30' }, {}, /not a YYYY-MM-DD date/],
  ['a month that does not exist', { date: '2026-13-01' }, {}, /not a YYYY-MM-DD date/],
  [
    'a CHANGELOG without ## Unreleased',
    {},
    { 'plugins/tool/CHANGELOG.md': changelog.replace('## Unreleased\n\n- Fixed: something. (#1)\n\n', '') },
    /plugins\/tool\/CHANGELOG\.md has no "## Unreleased" heading/,
  ],
  [
    'a marketplace without a version for the plugin',
    {},
    { '.claude-plugin/marketplace.json': marketplace.replace('      "version": "1.2.0",\n', '') },
    /\.claude-plugin\/marketplace\.json has no version line for tool/,
  ],
  [
    'a plugin.json without a version',
    {},
    { 'plugins/tool/.claude-plugin/plugin.json': pluginJson('tool', '1.2.0').replace('  "version": "1.2.0",\n', '') },
    /plugins\/tool\/\.claude-plugin\/plugin\.json has no version/,
  ],
  [
    'a README without the plugin row',
    {},
    { 'README.md': readme.replace(/^\| \[tool\].*\n/m, '') },
    /README\.md has no plugin table row for tool/,
  ],
  [
    'a translation without the plugin row',
    {},
    { 'docs/i18n/README.ko.md': translation.replace(/^\| \[tool\].*\n/m, '') },
    /docs\/i18n\/README\.ko\.md has no plugin table row for tool/,
  ],
];

for (const [name, options, overrides, message] of refusals) {
  test(`refuses ${name} and writes nothing`, () => {
    const root = makeRoot(overrides);
    const before = snapshot(root);
    assert.throws(() => release({ root, plugin: 'tool', version: '1.3.0', date: '2026-10-28', ...options }), message);
    assert.deepEqual(snapshot(root), before);
  });
}

function runCli(root, args) {
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  copyFileSync(script, path.join(root, 'scripts', 'release.mjs'));
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'release.mjs'), ...args], { encoding: 'utf8' });
}

test('a translation that links the plugin by full URL still has its version bumped', () => {
  const linked = translation.replace(/\]\(\.\.\/\.\.\/plugins\/tool\)/, '](https://github.com/example/repo/tree/main/plugins/tool)');
  assert.notEqual(linked, translation);
  const root = makeRoot({ 'docs/i18n/README.de.md': linked });
  release({ root, plugin: 'tool', version: '1.3.0', date: '2026-10-28' });
  assert.match(read(root, 'docs/i18n/README.de.md'), /\(https:\/\/github\.com\/example\/repo\/tree\/main\/plugins\/tool\) \| 1\.3\.0 \|/);
});

test('the command line prints the changed files and uses --date for the heading', () => {
  const root = makeRoot();
  const result = runCli(root, ['tool', '1.3.0', '--date', '2026-10-28']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n'), [
    'plugins/tool/.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
    'README.md',
    'docs/i18n/README.de.md',
    'docs/i18n/README.ko.md',
    'plugins/tool/CHANGELOG.md',
  ]);
  assert.match(read(root, 'plugins/tool/CHANGELOG.md'), /^## 1\.3\.0 \(2026-10-28\)$/m);
});

test('the command line exits 1 with the reason on a refusal', () => {
  const root = makeRoot();
  const result = runCli(root, ['tool', '1.2.0']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not higher than the current 1\.2\.0/);
  assert.equal(result.stdout, '');
});
