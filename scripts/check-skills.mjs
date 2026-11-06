#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] ?? fileURLToPath(new URL('../', import.meta.url)));
const problems = [];
const report = (file, message) => problems.push(`${file}: ${message}`);
const read = (file) => readFileSync(path.join(root, file), 'utf8');

function frontmatterName(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error('missing or unclosed frontmatter');
  const fields = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const field = /^([a-z][a-z0-9-]*):\s+(.+?)\s*$/.exec(line);
    if (!field || fields.has(field[1])) throw new Error('invalid or duplicate frontmatter field');
    let value = field[2];
    if (value.startsWith('"')) value = JSON.parse(value);
    else if (value.startsWith("'")) {
      if (!/^'(?:[^']|'')*'$/.test(value)) throw new Error('invalid quoted frontmatter value');
      value = value.slice(1, -1).replaceAll("''", "'");
    } else if (/^[\[\]{}&*!|>@`%]|:\s|\s#/.test(value)) {
      throw new Error('unsupported frontmatter value; expected a string scalar');
    }
    fields.set(field[1], value);
  }
  const name = fields.get('name');
  if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error('frontmatter name must be a nonempty skill name');
  }
  return name;
}

let count = 0;
try {
  for (const plugin of readdirSync(path.join(root, 'plugins'), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!plugin.isDirectory()) continue;
    count += 1;
    const base = `plugins/${plugin.name}`;
    const manifestFile = `${base}/.claude-plugin/plugin.json`;
    let manifest;
    try {
      manifest = JSON.parse(read(manifestFile));
      if (manifest.name !== plugin.name) report(manifestFile, `name must match plugin directory "${plugin.name}"`);
    } catch (error) {
      report(manifestFile, error.message);
    }
    const expected = `${base}/skills/${plugin.name}/SKILL.md`;
    let directories = [];
    try {
      directories = readdirSync(path.join(root, base, 'skills'), { withFileTypes: true }).filter((entry) => entry.isDirectory());
    } catch {}
    if (!directories.some((entry) => entry.name === plugin.name)) report(expected, 'missing entry skill directory');
    for (const directory of directories) {
      const file = `${base}/skills/${directory.name}/SKILL.md`;
      if (directory.name !== plugin.name) report(file, `entry skill directory must match plugin "${plugin.name}"`);
      try {
        const name = frontmatterName(read(file));
        if (name !== directory.name) report(file, `name "${name}" must match skill directory "${directory.name}"`);
        if (name !== manifest?.name) report(file, `name "${name}" must match ${manifestFile} name`);
      } catch (error) {
        report(file, error.message);
      }
    }
  }
  if (count === 0) report('plugins', 'no plugins found');
} catch (error) {
  report('plugins', error.message);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${count} plugin entry skills (static structure only).`);
}
