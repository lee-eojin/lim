#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOOP = 'plugins/review-loop/skills/review-loop/scripts/loop.mjs';
const SKILL = '.claude/skills/check-loop-model/SKILL.md';
const BASE = 'refs/remotes/origin/main';
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
  const sync = /^Sync blob: `([0-9a-f]{4,64})`\./m.exec(text)?.[1];
  if (!sync) stop(`${SKILL}: no "Sync blob: \`<sha>\`." line`);
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

function isShallow() {
  return git('rev-parse', '--is-shallow-repository').stdout.trim() === 'true';
}

function missingBlob(sync) {
  if (isShallow()) stop(`Sync blob ${sync} is not in this shallow clone. Fetch full history (git fetch --unshallow) and run again.`);
  stop(`Sync blob ${sync} is not in this repository. Set it in ${SKILL} to the loop.mjs blob the model was confirmed against: git rev-parse HEAD:${LOOP}`);
}

function isOnBase(sync, blob) {
  if (git('rev-parse', '--verify', '--quiet', `${BASE}^{commit}`).status !== 0) {
    stop(`Cannot check that Sync blob ${sync} is on origin/main: ${BASE} is not in this repository. Fetch it (git fetch origin main:${BASE}) and run again.`);
  }
  const objects = git('rev-list', '--objects', '--full-history', BASE, '--', LOOP);
  if (objects.status !== 0) stop(`git rev-list failed: ${objects.stderr.trim()}`);
  return objects.stdout.split('\n').some((line) => line.startsWith(`${blob} `));
}

const { sync, covered } = readSkill();
const resolved = git('rev-parse', '--verify', '--quiet', `${sync}^{blob}`);
if (resolved.status !== 0) missingBlob(sync);
const head = git('rev-parse', '--verify', '--quiet', `HEAD:${LOOP}`);
if (head.status !== 0) stop(`${LOOP} is not in HEAD.`);
const pinned = resolved.stdout.trim();
const current = head.stdout.trim();
if (pinned !== current && !isOnBase(sync, pinned)) {
  if (isShallow()) stop(`Cannot tell whether Sync blob ${sync} is on origin/main in this shallow clone. Fetch full history (git fetch --unshallow) and run again.`);
  console.error(`Sync blob ${sync} is neither the loop.mjs blob at HEAD nor a loop.mjs blob on origin/main. A squash merge keeps only the final files, so this blob would be gone from main and this check would fail there.`);
  console.error(`Set it in ${SKILL} to the blob at HEAD once the model is confirmed against it (git rev-parse --short HEAD:${LOOP}), or to a blob on origin/main (git rev-parse --short origin/main:${LOOP}). On a pull request, update the branch from main first.`);
  process.exit(1);
}
const diff = git('--no-pager', 'diff', '--unified=0', '--no-color', '--no-ext-diff', pinned, current);
if (diff.status !== 0) stop(`git diff failed: ${diff.stderr.trim()}`);

if (!diff.stdout.trim()) {
  console.log(`Loop-model sync OK (no covered loop.mjs drift since ${sync}).`);
} else {
  const names = touchedNames(diff.stdout);
  const drifted = names.filter((name) => covered.has(name));
  if (drifted.length) {
    console.error(`Covered names in loop.mjs changed since ${sync}: ${drifted.join(', ')}.`);
    console.error(`Re-read those actions in scripts/loop-model/ReviewLoop.tla, rerun \`node scripts/check-loop-model.mjs\`, show a mutation failing if the model changed, then set the Sync blob to git rev-parse HEAD:${LOOP}.`);
    process.exitCode = 1;
  } else {
    const near = names.length ? ` Uncovered names at the edits: ${names.join(', ')}.` : '';
    console.log(`Loop-model sync OK (loop.mjs changed since ${sync}, no covered name touched).${near} The Sync blob may still move forward after a reconfirm.`);
  }
}
