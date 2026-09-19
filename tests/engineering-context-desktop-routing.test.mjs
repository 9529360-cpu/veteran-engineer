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

test('engineering context router connects desktop and Electron work to existing specialist references', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const direct = runRouter('desktop,electron,desktop-runtime,desktop-shell,desktop-packaging,electron-ipc');
  assert.ok(direct, 'Python is required to validate the Skill context router');
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  const payload = JSON.parse(direct.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const paths = [...payload.references, ...payload.deferred_references].map((entry) => entry.path);
  for (const expected of [
    'references/runtime-lifecycle-patterns.md',
    'references/host-shell-platform-patterns.md',
    'references/runtime-failure-patterns.md',
    'references/auth-navigation-platform-patterns.md',
    'references/release-promotion-patterns.md'
  ]) {
    assert.ok(paths.includes(expected), `expected route ${expected}`);
  }

  const aliases = runRouter('desktop-app,desktop-application,electronjs,electron-app,electron-main,electron-preload,electron-renderer,electron-builder,electron-forge,electron-ipc-main');
  assert.ok(aliases, 'Python is required to validate desktop engineering aliases');
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  const aliasPayload = JSON.parse(aliases.stdout);
  assert.deepEqual(aliasPayload.unmatched_signals, []);
  assert.deepEqual(aliasPayload.signals, [
    'desktop',
    'electron',
    'desktop-runtime',
    'desktop-packaging',
    'electron-ipc'
  ]);

  const ambiguous = runRouter('ipc,renderer,preload');
  assert.ok(ambiguous, 'Python is required to validate ambiguous desktop terms');
  assert.equal(ambiguous.status, 0, ambiguous.stderr || ambiguous.stdout);
  const ambiguousPayload = JSON.parse(ambiguous.stdout);
  assert.deepEqual(ambiguousPayload.unmatched_signals, ['ipc', 'renderer', 'preload']);
});
