import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const plugins = path.join(root, 'plugins');
const pluginNames = readdirSync(plugins);
const loopScript = path.join(plugins, 'review-loop/skills/review-loop/scripts/loop.mjs');
const readJson = (...parts) => JSON.parse(readFileSync(path.join(...parts), 'utf8'));
const hooksFile = (plugin) => path.join(plugins, plugin, 'hooks', 'hooks.json');

const report = JSON.stringify({ report: 'Review round 1 of 3\n\nStopped: no P1 or P2 left in this change', decision: 'stop' });
const record = 'node /plugins/review-loop/skills/review-loop/scripts/loop.mjs record --file round-1.json';
const before = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const after = (command) => ({ ...before(command), tool_response: { stdout: report, stderr: '' } });

const HOOKS = {
  'review-loop PreToolUse Bash command node "${CLAUDE_PLUGIN_ROOT}/hooks/commit-gate.mjs"': {
    fires: before('git commit -m x'),
    decision: 'deny',
    turnOn: (cwd) => execFileSync(process.execPath, [loopScript, 'gate', '--on'], { cwd, stdio: 'ignore' }),
  },
  'review-loop PostToolUse Bash command node "${CLAUDE_PLUGIN_ROOT}/hooks/show-report.mjs"': {
    fires: after(record),
    message: `review-loop report\n${JSON.parse(report).report}`,
    other: after('cat notes.json'),
  },
};

function registeredHooks() {
  return pluginNames.filter((plugin) => existsSync(hooksFile(plugin))).flatMap((plugin) => (
    Object.entries(readJson(hooksFile(plugin)).hooks).flatMap(([event, groups]) => groups.flatMap(({ matcher, hooks }) => (
      hooks.map(({ type, command }) => ({ id: `${plugin} ${event} ${matcher} ${type} ${command}`, plugin, event, command }))
    )))
  ));
}

const listed = () => registeredHooks().filter(({ id }) => id in HOOKS);

function run({ plugin, command }, payload, cwd) {
  const script = command.slice('node "'.length, -1).replace('${CLAUDE_PLUGIN_ROOT}', path.join(plugins, plugin));
  return spawnSync(process.execPath, [script], { input: JSON.stringify({ ...payload, cwd }), encoding: 'utf8', cwd });
}

function repository(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'hook-rule-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  git('init', '-q');
  git('-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--allow-empty', '-m', 'base');
  return cwd;
}

test('plugins register hooks only in hooks/hooks.json', () => {
  for (const plugin of pluginNames) {
    assert.equal(readJson(plugins, plugin, '.claude-plugin/plugin.json').hooks, undefined, plugin);
    if (existsSync(hooksFile(plugin))) assert.equal(readJson(hooksFile(plugin)).modules, undefined, plugin);
  }
  for (const entry of readJson(root, '.claude-plugin/marketplace.json').plugins) assert.equal(entry.hooks, undefined, entry.name);
});

test('every registered hook is listed as opt-in or always-on', () => {
  const ids = registeredHooks().map(({ id }) => id).sort();
  assert.deepEqual(ids, Object.keys(HOOKS).sort(), 'list each hook in HOOKS and follow plugin rule 4 in CONTRIBUTING.md');
});

test('an always-on hook outputs only a systemMessage, and nothing for other commands', () => {
  for (const hook of listed().filter(({ id }) => !HOOKS[id].turnOn)) {
    const shown = run(hook, HOOKS[hook.id].fires);
    assert.equal(shown.status, 0, shown.stderr);
    assert.equal(shown.stderr, '', hook.id);
    const output = JSON.parse(shown.stdout);
    assert.deepEqual(Object.keys(output), ['systemMessage'], hook.id);
    assert.equal(output.systemMessage, HOOKS[hook.id].message, hook.id);
    const other = run(hook, HOOKS[hook.id].other);
    assert.equal(other.status, 0, other.stderr);
    assert.equal(other.stderr, '', hook.id);
    assert.equal(other.stdout, '', hook.id);
  }
});

test('an opt-in hook has no effect until the user turns it on', (t) => {
  for (const hook of listed().filter(({ id }) => HOOKS[id].turnOn)) {
    const { fires, turnOn } = HOOKS[hook.id];
    const cwd = repository(t);
    const off = run(hook, fires, cwd);
    assert.equal(off.status, 0, off.stderr);
    assert.equal(off.stdout, '', hook.id);
    turnOn(cwd);
    const on = run(hook, fires, cwd);
    assert.equal(on.status, 0, on.stderr);
    assert.equal(on.stderr, '', hook.id);
    const output = JSON.parse(on.stdout).hookSpecificOutput;
    assert.equal(output.hookEventName, hook.event, hook.id);
    assert.equal(output.permissionDecision, HOOKS[hook.id].decision, hook.id);
  }
});
