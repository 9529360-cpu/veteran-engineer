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
const securityReference = path.join(skillRoot, 'references', 'security-multitenancy-patterns.md');
const reference = path.join(skillRoot, 'references', 'organization-membership-product-engineering.md');

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

function runRouter(args) {
  for (const executable of ['python3', 'python']) {
    const result = spawnSync(executable, [router, ...args], { cwd: root, encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

test('auth and tenant routing keeps organization membership as a focused security owner', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill router is not present in this isolated runtime starter');
    return;
  }
  assert.equal(await exists(securityReference), true);
  assert.equal(await exists(reference), true);

  const routed = runRouter(['--signals', 'auth,tenant', '--max', '6', '--json']);
  assert.ok(routed);
  assert.equal(routed.status, 0, routed.stderr || routed.stdout);
  assert.deepEqual(JSON.parse(routed.stdout).unmatched_signals, []);

  const security = await fs.readFile(securityReference, 'utf8');
  assert.match(security, /organization-membership-product-engineering\.md/);
  assert.match(security, /Organization and membership lifecycle/);

  const specialist = await fs.readFile(reference, 'utf8');
  assert.match(specialist, /Carry a membership\/authorization generation/);
  assert.match(specialist, /A still-valid signature must not revive a revoked\/stale invitation/);
  assert.match(specialist, /A stale worker must not restore membership/);
  assert.match(specialist, /Do not allow the only recoverable owner to remove themselves/);
  assert.match(specialist, /A directory deprovision must still obey last-owner/);
  assert.match(specialist, /work authorized when queued is not forever authorized/);
});
