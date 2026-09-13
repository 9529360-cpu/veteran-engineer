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
const reference = path.join(skillRoot, 'references', 'browser-extension-product-engineering.md');

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

test('engineering context router treats browser extensions as a first-class product surface', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }
  assert.equal(await exists(reference), true, 'Browser extension reference must exist when routed');

  const direct = runRouter('browser-extension,chrome-extension,firefox-extension,webextension,extension-manifest,content-script,extension-background,extension-permissions,extension-store');
  assert.ok(direct, 'Python is required to validate the Skill context router');
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  const payload = JSON.parse(direct.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const paths = payload.references.map((entry) => entry.path);
  for (const expected of [
    'references/browser-extension-product-engineering.md',
    'references/frontend-product-patterns.md',
    'references/async-edge-job-patterns.md',
    'references/security-multitenancy-patterns.md',
    'references/release-promotion-patterns.md'
  ]) {
    assert.ok(paths.includes(expected), `expected route ${expected}`);
  }

  const aliases = runRouter('browser-addon,chrome-addon,firefox-addon,web-extension,manifest-v3,mv3,extension-service-worker,host-permissions,chrome-web-store,addons-mozilla-org');
  assert.ok(aliases, 'Python is required to validate browser extension aliases');
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  const aliasPayload = JSON.parse(aliases.stdout);
  assert.deepEqual(aliasPayload.unmatched_signals, []);
  assert.deepEqual(aliasPayload.signals, [
    'browser-extension',
    'chrome-extension',
    'firefox-extension',
    'webextension',
    'extension-manifest',
    'extension-manifest',
    'extension-background',
    'extension-permissions',
    'extension-store',
    'extension-store'
  ]);

  const ambiguous = runRouter('extension,manifest,service-worker,permissions');
  assert.ok(ambiguous, 'Python is required to validate ambiguous extension terms');
  assert.equal(ambiguous.status, 0, ambiguous.stderr || ambiguous.stdout);
  const ambiguousPayload = JSON.parse(ambiguous.stdout);
  assert.deepEqual(ambiguousPayload.unmatched_signals, ['extension', 'manifest', 'service-worker', 'permissions']);
});
