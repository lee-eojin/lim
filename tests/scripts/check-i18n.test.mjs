import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/check-i18n.mjs', import.meta.url));

const readme = `# Project

## Plugins

| Plugin | Status | One job |
|---|---|---|
| [tool](plugins/tool) | 1.2.0 | Does one job. |

### Measured

[\`behaviors.csv\`](behaviors.csv) lists 40 behaviors. Tests cover 38 of them, and P3 to P5 come later.

\`\`\`
# not a heading
\`\`\`
`;

const translation = `# Project

> Translated on 2026-01-01 from the [English README](../../README.md).

## Erweiterungen

| Plugin | Stand | Aufgabe |
|---|---|---|
| [tool](../../plugins/tool) | 1.2.0 | Macht eine Sache. |

### Gemessen

[\`behaviors.csv\`](../../behaviors.csv) listet 40 Verhaltensweisen in 2 Gruppen. Tests decken 38 davon ab.
`;

function runCheck(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'check-i18n-'));
  try {
    for (const [file, content] of Object.entries({ 'behaviors.csv': '', 'plugins/tool/.keep': '', ...files })) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), content);
    }
    const result = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
    return { status: result.status, lines: result.stdout.trim().split('\n').filter(Boolean) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const withTranslation = (source, translated) => ({ 'README.md': source, 'docs/i18n/README.de.md': translated });

test('passes when a translation keeps headings, versions, numbers, and links', () => {
  assert.deepEqual(runCheck(withTranslation(readme, translation)), { status: 0, lines: [] });
});

test('reports a heading whose level or count differs from README.md', () => {
  const result = runCheck(withTranslation(readme.replace('### Measured', '## Measured'), translation));
  assert.equal(result.status, 1);
  assert.deepEqual(result.lines, ['docs/i18n/README.de.md:11: heading 3 is "### Gemessen", README.md:9 has "## Measured"']);

  const added = runCheck(withTranslation(`${readme}\n## License\n`, translation));
  assert.match(added.lines[0], /^docs\/i18n\/README\.de\.md:11: 3 headings here, 4 in README\.md; heading 4 is missing/);
});

test('reports a plugin version that differs from README.md', () => {
  const result = runCheck(withTranslation(readme.replace('1.2.0', '1.3.0'), translation));
  assert.deepEqual(result.lines, ['docs/i18n/README.de.md:9: tool is 1.2.0, README.md:7 has 1.3.0']);
});

test('reports a measured number missing from the translation, ignoring numbers inside words such as P3', () => {
  const result = runCheck(withTranslation(readme.replace('38 of them', '39 of them'), translation));
  assert.deepEqual(result.lines, ['docs/i18n/README.de.md:13: measured paragraph lacks 39 from README.md:11']);
});

test('reports links to files that do not exist', () => {
  const result = runCheck(withTranslation(readme, translation.replace('../../plugins/tool', '../../plugins/gone')));
  assert.deepEqual(result.lines, ['docs/i18n/README.de.md:9: link to a file that does not exist: ../../plugins/gone']);
});

test('reports a plugin row that one side has and the other does not', () => {
  const missing = runCheck(withTranslation(readme, translation.replace(/^\| \[tool\].*\n/m, '')));
  assert.equal(missing.status, 1);
  assert.match(missing.lines.join('\n'), /^docs\/i18n\/README\.de\.md:\d+: plugin table has no tool row, README\.md:7 has 1\.2\.0$/m);

  const extraRow = '| [extra](../../plugins/extra) | 0.1.0 | Extra. |\n';
  const extra = runCheck({
    ...withTranslation(readme, translation.replace(/^(\| \[tool\].*\n)/m, `$1${extraRow}`)),
    'plugins/extra/.keep': '',
  });
  assert.deepEqual(extra.lines, ['docs/i18n/README.de.md:10: extra is not in the plugin table of README.md']);
});

test('reports a translation without the measured paragraph', () => {
  const result = runCheck(withTranslation(readme, translation.replace(/^\[`behaviors\.csv`\].*\n/m, '')));
  assert.equal(result.status, 1);
  assert.match(result.lines.join('\n'), /^docs\/i18n\/README\.de\.md:\d+: no paragraph links behaviors\.csv, README\.md:11 has one$/m);
});
