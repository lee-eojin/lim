import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const pathOf = (file) => fileURLToPath(new URL(`../../${file}`, import.meta.url));
const marketplace = JSON.parse(readFileSync(pathOf('.claude-plugin/marketplace.json'), 'utf8'));
const readme = readFileSync(pathOf('README.md'), 'utf8');

test('the marketplace lists every plugin folder', () => {
  const folders = readdirSync(pathOf('plugins'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  assert.deepEqual(marketplace.plugins.map((plugin) => plugin.name).sort(), folders.sort());
});

for (const { name, version } of marketplace.plugins) {
  test(`${name} has the marketplace version ${version} in its plugin.json and the README table`, () => {
    const manifest = JSON.parse(readFileSync(pathOf(`plugins/${name}/.claude-plugin/plugin.json`), 'utf8'));
    assert.equal(manifest.version, version, 'plugin.json');
    const row = readme.split('\n').find((line) => line.startsWith(`| [${name}](plugins/${name}) |`));
    assert.ok(row, `README.md has no table row for ${name}`);
    assert.equal(row.split('|')[2].trim(), version, 'README.md table');
  });
}
