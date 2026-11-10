import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/check-skills.mjs', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
const skillPath = 'plugins/tool/skills/tool/SKILL.md';
const manifestPath = 'plugins/tool/.claude-plugin/plugin.json';
const valid = '---\nname: tool\ndescription: Does a thing.\n---\n# Tool\n';
const run = (cwd) => spawnSync(process.execPath, [script, cwd], { encoding: 'utf8' });

function fixture(t, skill = valid, manifest = 'tool', directory = 'tool') {
  const cwd = mkdtempSync(path.join(tmpdir(), 'skill-check-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const files = { [manifestPath]: JSON.stringify({ name: manifest }) };
  if (skill !== null) files[`plugins/tool/skills/${directory}/SKILL.md`] = skill;
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    writeFileSync(path.join(cwd, file), content);
  }
  return run(cwd);
}

test('static entry skill structure checks all five repository plugins without proving Claude loads them at runtime', () => {
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Checked 5 plugin entry skills/);
});

test('valid fixture passes', (t) => {
  const result = fixture(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Checked 1 plugin entry skills/);
});

for (const [label, content] of [
  ['missing skill', null],
  ['missing frontmatter', '# Tool\n'],
  ['unclosed frontmatter', '---\nname: tool\n'],
  ['missing name', '---\ndescription: Tool\n---\n'],
  ['empty name', '---\nname:\n---\n'],
  ['malformed name', '---\nname: [tool\n---\n'],
  ['duplicate name', '---\nname: tool\nname: tool\n---\n'],
  ['malformed frontmatter', '---\nname: tool\nbroken mapping\n---\n'],
  ['skill name mismatch', valid.replace('name: tool', 'name: other')],
]) {
  test(`reports affected path for ${label}`, (t) => {
    const result = fixture(t, content);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(skillPath), result.stderr);
  });
}

test('reports manifest name mismatch', (t) => {
  const result = fixture(t, valid, 'other');
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(manifestPath), result.stderr);
});

test('reports skill directory name mismatch', (t) => {
  const result = fixture(t, valid, 'tool', 'other');
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('plugins/tool/skills/other/SKILL.md'), result.stderr);
});
