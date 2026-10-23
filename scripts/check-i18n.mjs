#!/usr/bin/env node
// Checks that each translation in docs/i18n/ matches README.md in headings, plugin versions,
// the numbers in the measured paragraph, and links to files that exist.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const sourceFile = path.join(root, 'README.md');
const translationDir = path.join(root, 'docs', 'i18n');
const problems = [];

const relative = (file) => path.relative(root, file);
const report = (file, line, message) => problems.push(`${relative(file)}:${line}: ${message}`);

export function proseLines(file) {
  const lines = [];
  let inFence = false;
  readFileSync(file, 'utf8').split('\n').forEach((text, index) => {
    if (text.trimStart().startsWith('```')) inFence = !inFence;
    else if (!inFence) lines.push({ number: index + 1, text });
  });
  return lines;
}

function headings(lines) {
  return lines.flatMap(({ number, text }) => {
    const match = /^(#{1,6})\s/.exec(text);
    return match ? [{ number, level: match[1].length, text: text.trim() }] : [];
  });
}

function pluginVersions(lines) {
  return new Map(lines.flatMap(({ number, text }) => {
    const match = /^\|\s*\[([^\]]+)\]\([^)]*\)\s*\|\s*(\d+\.\d+\.\d+\S*)\s*\|/.exec(text);
    return match ? [[match[1], { number, version: match[2] }]] : [];
  }));
}

export function measuredParagraph(lines) {
  const index = lines.findIndex(({ text }) => text.includes('behaviors.csv)'));
  if (index === -1) return undefined;
  let first = index;
  let last = index;
  while (lines[first - 1]?.text.trim() && lines[first - 1].number === lines[first].number - 1) first -= 1;
  while (lines[last + 1]?.text.trim() && lines[last + 1].number === lines[last].number + 1) last += 1;
  const text = lines.slice(first, last + 1).map((line) => line.text).join(' ').replace(/\]\([^)]*\)/g, ']');
  return { number: lines[first].number, numbers: text.match(/(?<![A-Za-z\d.])\d+(?:\.\d+)*/g) ?? [] };
}

function checkLinks(file, lines) {
  for (const { number, text } of lines) {
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^([a-z][a-z\d+.-]*:|#)/i.test(target)) continue;
      const targetPath = path.resolve(path.dirname(file), decodeURIComponent(target.split('#')[0]));
      if (!existsSync(targetPath)) report(file, number, `link to a file that does not exist: ${target}`);
    }
  }
}

function checkHeadings(file, source, translation) {
  const index = source.findIndex((heading, position) => heading.level !== translation[position]?.level);
  if (index === -1 && source.length === translation.length) return;
  const position = index === -1 ? source.length : index;
  const expected = source[position];
  const actual = translation[position];
  const counts = source.length === translation.length ? '' : `${translation.length} headings here, ${source.length} in README.md; `;
  report(
    file,
    actual?.number ?? translation.at(-1)?.number ?? 1,
    `${counts}heading ${position + 1} is ${actual ? `"${actual.text}"` : 'missing'}, ` +
      `README.md${expected ? `:${expected.number} has "${expected.text}"` : ' has no such heading'}`,
  );
}

function sectionLine(sourceHeadings, translationHeadings, sourceLine) {
  const index = sourceHeadings.findLastIndex((heading) => heading.number < sourceLine);
  return translationHeadings[index]?.number ?? 1;
}

function main() {
  const sourceLines = proseLines(sourceFile);
  const sourceHeadings = headings(sourceLines);
  const sourceVersions = pluginVersions(sourceLines);
  const sourceMeasured = measuredParagraph(sourceLines);
  checkLinks(sourceFile, sourceLines);

  const translationFiles = existsSync(translationDir)
    ? readdirSync(translationDir).filter((name) => /^README\..+\.md$/.test(name)).sort()
    : [];

  for (const name of translationFiles) {
    const file = path.join(translationDir, name);
    const lines = proseLines(file);
    const translationHeadings = headings(lines);
    checkLinks(file, lines);
    checkHeadings(file, sourceHeadings, translationHeadings);

    const versions = pluginVersions(lines);
    for (const [plugin, expected] of sourceVersions) {
      const actual = versions.get(plugin);
      if (!actual) {
        report(file, sectionLine(sourceHeadings, translationHeadings, expected.number),
          `plugin table has no ${plugin} row, README.md:${expected.number} has ${expected.version}`);
      } else if (actual.version !== expected.version) {
        report(file, actual.number, `${plugin} is ${actual.version}, README.md:${expected.number} has ${expected.version}`);
      }
    }
    for (const [plugin, actual] of versions) {
      if (!sourceVersions.has(plugin)) report(file, actual.number, `${plugin} is not in the plugin table of README.md`);
    }

    if (sourceMeasured) {
      const measured = measuredParagraph(lines);
      if (!measured) {
        report(file, sectionLine(sourceHeadings, translationHeadings, sourceMeasured.number),
          `no paragraph links behaviors.csv, README.md:${sourceMeasured.number} has one`);
      } else {
        const missing = [...new Set(sourceMeasured.numbers)].filter((value) => !measured.numbers.includes(value));
        if (missing.length > 0) {
          report(file, measured.number,
            `measured paragraph lacks ${missing.join(', ')} from README.md:${sourceMeasured.number}`);
        }
      }
    }
  }

  for (const problem of problems) console.log(problem);
  process.exit(problems.length > 0 ? 1 : 0);
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
