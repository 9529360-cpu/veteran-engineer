import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const skillRoot = path.join(root, 'skills', 'runtime-regression-debugger');
const router = path.join(skillRoot, 'scripts', 'engineering_context_router.py');
const reference = path.join(skillRoot, 'references', 'cli-tui-product-engineering.md');

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function runRouter(signals) {
  for (const executable of ['python3', 'python']) {
    const result = spawnSync(executable, [router, '--signals', signals, '--max', '10', '--json'], {
      cwd: root,
      encoding: 'utf8'
    });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

test('engineering context router treats CLI and TUI work as a first-class product surface', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }
  assert.equal(await exists(reference), true, 'CLI/TUI reference must exist when routed');

  const direct = runRouter('cli,command-line,tui,terminal-app,cli-arguments,cli-config,cli-output,cli-signals,shell-completion,cli-release');
  assert.ok(direct, 'Python is required to validate the Skill context router');
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  const payload = JSON.parse(direct.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const paths = payload.references.map((entry) => entry.path);
  for (const expected of [
    'references/cli-tui-product-engineering.md',
    'references/runtime-lifecycle-patterns.md',
    'references/release-promotion-patterns.md'
  ]) {
    assert.ok(paths.includes(expected), `expected route ${expected}`);
  }

  const aliases = runRouter('command-line-interface,command-line-tool,developer-cli,terminal-ui,terminal-user-interface,cli-args,cli-flags,cli-configuration,cli-json-output,cli-packaging,command-completion');
  assert.ok(aliases, 'Python is required to validate CLI/TUI aliases');
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  const aliasPayload = JSON.parse(aliases.stdout);
  assert.deepEqual(aliasPayload.unmatched_signals, []);
  assert.deepEqual(aliasPayload.signals, [
    'cli',
    'cli',
    'cli',
    'tui',
    'tui',
    'cli-arguments',
    'cli-arguments',
    'cli-config',
    'cli-output',
    'cli-release',
    'shell-completion'
  ]);

  const ambiguous = runRouter('command,arguments,flags,terminal');
  assert.ok(ambiguous, 'Python is required to validate ambiguous CLI terms');
  assert.equal(ambiguous.status, 0, ambiguous.stderr || ambiguous.stdout);
  const ambiguousPayload = JSON.parse(ambiguous.stdout);
  assert.deepEqual(ambiguousPayload.unmatched_signals, ['command', 'arguments', 'flags', 'terminal']);
});
