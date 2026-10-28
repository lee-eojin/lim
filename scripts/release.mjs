#!/usr/bin/env node
// Usage: node scripts/release.mjs <plugin> <version> [--date YYYY-MM-DD]
// Bumps a plugin's version in plugin.json, marketplace.json, the README plugin tables, and its CHANGELOG.
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function isHigher(next, current) {
  const [a, b] = [next, current].map((version) => version.split('.').map(Number));
  const index = a.findIndex((part, position) => part !== b[position]);
  return index !== -1 && a[index] > b[index];
}

function replaceOnce(file, text, pattern, replacement, missing) {
  const matches = text.match(new RegExp(pattern.source, `${pattern.flags}g`)) ?? [];
  if (matches.length !== 1) throw new Error(matches.length === 0 ? `${file} ${missing}` : `${file} has ${matches.length} matches for ${missing.replace(/^has no /, '')}`);
  return text.replace(pattern, replacement);
}

function bumpMarketplace(file, text, plugin, version) {
  const lines = text.split('\n');
  const nameLine = lines.findIndex((line) => new RegExp(`^\\s*"name":\\s*"${escape(plugin)}",?\\s*$`).test(line));
  let versionLine = -1;
  for (let index = nameLine + 1; nameLine !== -1 && index < lines.length && !/^\s*}/.test(lines[index]); index += 1) {
    if (/^\s*"version":/.test(lines[index])) versionLine = index;
  }
  if (versionLine === -1) throw new Error(`${file} has no version line for ${plugin}`);
  lines[versionLine] = lines[versionLine].replace(/"version":\s*"[^"]*"/, `"version": "${version}"`);
  const after = lines.join('\n');
  const entry = JSON.parse(after).plugins.find((candidate) => candidate.name === plugin);
  if (entry?.version !== version) throw new Error(`${file}: the version line found for ${plugin} is not its entry's version`);
  return after;
}

export function release({ root, plugin, version, date }) {
  const marketplaceFile = '.claude-plugin/marketplace.json';
  const marketplaceText = readFileSync(path.join(root, marketplaceFile), 'utf8');
  const manifestFile = `plugins/${plugin}/.claude-plugin/plugin.json`;
  const known = JSON.parse(marketplaceText).plugins.some((entry) => entry.name === plugin);
  if (!known || !existsSync(path.join(root, manifestFile))) throw new Error(`unknown plugin "${plugin}"`);
  if (!versionPattern.test(version)) throw new Error(`"${version}" is not a version like 1.2.3`);
  const day = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date) {
    throw new Error(`"${date}" is not a YYYY-MM-DD date`);
  }

  const manifestText = readFileSync(path.join(root, manifestFile), 'utf8');
  const current = JSON.parse(manifestText).version;
  if (typeof current !== 'string') throw new Error(`${manifestFile} has no version`);
  if (!versionPattern.test(current)) throw new Error(`${manifestFile} has version "${current}", which is not like 1.2.3`);
  if (!isHigher(version, current)) throw new Error(`${version} is not higher than the current ${current}`);

  const edits = [];
  const edit = (file, change) => {
    const before = readFileSync(path.join(root, file), 'utf8');
    edits.push({ file, after: change(before) });
  };

  edit(manifestFile, (text) => replaceOnce(manifestFile, text, /^(\s*"version":\s*")[^"]*(")/m, `$1${version}$2`, 'has no version'));
  edit(marketplaceFile, (text) => bumpMarketplace(marketplaceFile, text, plugin, version));

  const translationDir = path.join(root, 'docs', 'i18n');
  const translations = existsSync(translationDir)
    ? readdirSync(translationDir).filter((name) => /^README\..+\.md$/.test(name)).sort().map((name) => `docs/i18n/${name}`)
    : [];
  for (const file of ['README.md', ...translations]) {
    const row = new RegExp(`^(\\|\\s*\\[${escape(plugin)}\\]\\([^)]*\\)\\s*\\|\\s*)[^|\\s]+(\\s*\\|)`, 'm');
    edit(file, (text) => replaceOnce(file, text, row, `$1${version}$2`, `has no plugin table row for ${plugin}`));
  }

  const changelogFile = `plugins/${plugin}/CHANGELOG.md`;
  edit(changelogFile, (text) => replaceOnce(changelogFile, text, /^## Unreleased[ \t]*$/m, `## ${version} (${date})`, 'has no "## Unreleased" heading'));

  for (const { file, after } of edits) writeFileSync(path.join(root, file), after);
  return edits.map(({ file }) => file);
}

function today() {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, '0')).join('-');
}

function main() {
  const args = process.argv.slice(2);
  const dateIndex = args.indexOf('--date');
  const date = dateIndex === -1 ? today() : args[dateIndex + 1] ?? '';
  const [plugin, version, ...extra] = dateIndex === -1 ? args : args.filter((_, index) => index !== dateIndex && index !== dateIndex + 1);
  if (!plugin || !version || extra.length > 0) {
    console.error('usage: node scripts/release.mjs <plugin> <version> [--date YYYY-MM-DD]');
    process.exit(2);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    for (const file of release({ root, plugin, version, date })) console.log(file);
  } catch (error) {
    console.error(`release: ${error.message}`);
    process.exit(1);
  }
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) main();
