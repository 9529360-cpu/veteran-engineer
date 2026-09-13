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
const mobileReference = path.join(skillRoot, 'references', 'mobile-product-engineering.md');

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
    const result = spawnSync(executable, [router, '--signals', signals, '--max', '7', '--json'], {
      cwd: root,
      encoding: 'utf8'
    });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

test('engineering context router treats mobile engineering as a first-class product capability', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }
  assert.equal(await exists(mobileReference), true, 'Mobile engineering reference must exist when its route is published');

  const direct = runRouter('mobile,ios,android,react-native,expo,flutter,mobile-design,deep-link,push-notification,mobile-offline');
  assert.ok(direct, 'Python is required to validate the Skill context router');
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  const payload = JSON.parse(direct.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const paths = payload.references.map((entry) => entry.path);
  assert.ok(paths.includes('references/mobile-product-engineering.md'));
  assert.ok(paths.includes('references/full-stack-product-engineering.md'));
  assert.ok(paths.includes('references/frontend-product-patterns.md'));
  assert.ok(paths.includes('references/async-edge-job-patterns.md'));
  assert.ok(paths.includes('references/distributed-systems-consistency.md'));

  const aliases = runRouter('app,rn,swiftui,jetpack-compose,expo-app,dart-flutter,deep-linking,push-notifications,offline-mobile');
  assert.ok(aliases, 'Python is required to validate mobile engineering aliases');
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  const aliasPayload = JSON.parse(aliases.stdout);
  assert.deepEqual(aliasPayload.unmatched_signals, []);
  assert.deepEqual(aliasPayload.signals, [
    'mobile',
    'react-native',
    'ios',
    'android',
    'expo',
    'flutter',
    'deep-link',
    'push-notification',
    'mobile-offline'
  ]);
  assert.ok(aliasPayload.references.some((entry) => entry.path === 'references/mobile-product-engineering.md'));
});
