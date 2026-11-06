import { spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { killGroup } from './_shared/kill-group.mjs';

const DEFAULT_TIMEOUT_MS = 60 * 1000;
const CLOSE_GRACE_MS = 2000;

const tidy = (text) => text.replace(/[ \t]+$/gm, '').trim();

export function judge(verifier, fixtureText, exitCode, output, timedOut) {
  if (timedOut) return { passed: false, why: `timed out after ${verifier.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms` };
  const { exitCode: wantedCode, fixtureLines } = verifier.pass;
  if (wantedCode !== undefined && exitCode !== wantedCode) return { passed: false, why: `exit code ${exitCode}, expected ${wantedCode}` };
  if (fixtureLines === undefined) return { passed: true, why: 'exit code matched' };
  const { prefix, exitLine } = fixtureLines;
  const wanted = fixtureText.replace(/\r\n/g, '\n').split('\n').filter((line) => line.startsWith(prefix));
  if (wanted.length === 0) return { passed: false, why: `the fixture has no ${prefix} lines to compare` };
  const expected = tidy(wanted.map((line) => line.slice(prefix.length)).join('\n')).split('\n');
  let text = tidy(output.replace(/\r\n/g, '\n'));
  if (exitLine !== undefined && exitCode !== 0) {
    const tail = exitLine.replace('{code}', String(exitCode));
    text = text === '' ? tail : `${text}\n${tail}`;
  }
  const actual = text.split('\n');
  const mismatch = expected.findIndex((line, index) => actual[index] !== line);
  if (mismatch === -1 && actual.length === expected.length) return { passed: true, why: `output equals the ${expected.length} ${prefix} line(s)` };
  const index = mismatch === -1 ? expected.length : mismatch;
  return { passed: false, why: `line ${index + 1}: expected ${JSON.stringify(expected[index] ?? '(end)')}, got ${JSON.stringify(actual[index] ?? '(end)')}` };
}

export function runOnce(root, verifier, fixturePath) {
  const [program, ...args] = verifier.run.map((part) => (part === '{fixture}' ? fixturePath : part));
  const timeoutMs = verifier.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const merged = verifier.pass.fixtureLines?.streams === 'stdout+stderr';
  const scratch = merged ? mkdtempSync(path.join(tmpdir(), 'gap-map-run-')) : null;
  const outputFile = scratch && path.join(scratch, 'output');
  const descriptor = scratch && openSync(outputFile, 'w');
  return new Promise((resolve) => {
    const started = Date.now();
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let finished = false;
    let grace;
    const finish = (exitCode, extra = '') => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(grace);
      let output = Buffer.concat(stdout).toString('utf8');
      if (scratch) {
        closeSync(descriptor);
        output = readFileSync(outputFile, 'utf8');
        rmSync(scratch, { recursive: true, force: true });
      }
      resolve({ exitCode, stdout: output, stderr: Buffer.concat(stderr).toString('utf8') + extra, timedOut, ms: Date.now() - started });
    };
    const child = spawn(program, args, {
      cwd: root, detached: process.platform !== 'win32', windowsHide: true,
      stdio: merged ? ['ignore', descriptor, descriptor] : ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child);
      grace = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish(null);
      }, CLOSE_GRACE_MS);
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => stdout.push(chunk));
    child.stderr?.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => finish(null, error.message));
    child.on('close', (code) => finish(code));
  });
}
