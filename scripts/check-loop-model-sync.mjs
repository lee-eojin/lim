#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOOP = 'plugins/review-loop/skills/review-loop/scripts/loop.mjs';
const SKILL = '.claude/skills/check-loop-model/SKILL.md';
const WHOLE_LINE_COMMENT = '^[[:space:]]*//';
const HUNK = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@ ?(.*)$/;
const HEADER_NAME = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*|(?:const|let|var)\s+)?([\w$]+)/;
const DEFINITIONS = [
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)/,
  /^(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=/,
];

function stop(message) {
  console.error(message);
  process.exit(2);
}

const root = path.resolve(process.argv[2] ?? fileURLToPath(new URL('../', import.meta.url)));

function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) stop(`Cannot run git: ${result.error.message}`);
  return result;
}

function readSkill() {
  let text;
  try {
    text = readFileSync(path.join(root, SKILL), 'utf8');
  } catch (error) {
    stop(`Cannot read ${SKILL}: ${error.message}`);
  }
  const sync = /^Sync commit: `([0-9a-f]{4,64})`\./m.exec(text)?.[1];
  if (!sync) stop(`${SKILL}: no "Sync commit: \`<sha>\`." line`);
  const bullet = text.split(/\r?\n/).find((line) => line.startsWith(`- \`${LOOP}\`:`));
  if (!bullet) stop(`${SKILL}: no coverage bullet for ${LOOP}`);
  const covered = new Set([...bullet.matchAll(/`([^`]+)`/g)].map((match) => match[1]).filter((token) => token !== LOOP));
  if (!covered.size) stop(`${SKILL}: the coverage bullet names nothing`);
  return { sync, covered };
}

function touchedNames(diff) {
  const names = new Set();
  let inHunk = false;
  for (const line of diff.split(/\r?\n/)) {
    const hunk = HUNK.exec(line);
    if (hunk) {
      inHunk = true;
      const name = HEADER_NAME.exec(hunk[1])?.[1];
      if (name) names.add(name);
    } else if (inHunk && /^[-+]/.test(line)) {
      for (const definition of DEFINITIONS) {
        const name = definition.exec(line.slice(1))?.[1];
        if (name) names.add(name);
      }
    }
  }
  return [...names];
}

const { sync, covered } = readSkill();
const resolved = git('rev-parse', '--verify', '--quiet', `${sync}^{commit}`);
if (resolved.status !== 0) {
  stop(`Sync commit ${sync} is not in this clone. Fetch full history (git fetch --unshallow) or fix the sha in ${SKILL}.`);
}
const diff = git('--no-pager', 'diff', '--unified=0', '--no-color', '--no-ext-diff', `--ignore-matching-lines=${WHOLE_LINE_COMMENT}`, `${resolved.stdout.trim()}..HEAD`, '--', LOOP);
if (diff.status !== 0) stop(`git diff failed: ${diff.stderr.trim()}`);

if (!diff.stdout.trim()) {
  console.log(`Loop-model sync OK (no covered loop.mjs drift since ${sync}).`);
} else {
  const names = touchedNames(diff.stdout);
  const drifted = names.filter((name) => covered.has(name));
  if (drifted.length) {
    console.error(`Covered names in loop.mjs changed since ${sync}: ${drifted.join(', ')}.`);
    console.error('Re-read those actions in scripts/loop-model/ReviewLoop.tla, rerun `node scripts/check-loop-model.mjs`, show a mutation failing if the model changed, then move the Sync commit forward.');
    process.exitCode = 1;
  } else {
    const near = names.length ? ` Uncovered names at the edits: ${names.join(', ')}.` : '';
    console.log(`Loop-model sync OK (loop.mjs changed since ${sync}, no covered name touched).${near} The Sync commit may still move forward after a reconfirm.`);
  }
}
