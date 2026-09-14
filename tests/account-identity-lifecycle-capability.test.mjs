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
const reference = path.join(skillRoot, 'references', 'account-identity-lifecycle-product-engineering.md');

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

test('auth routing retains account identity lifecycle ownership and takeover invariants', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill router is not present in this isolated runtime starter');
    return;
  }
  assert.equal(await exists(securityReference), true);
  assert.equal(await exists(reference), true);

  const routed = runRouter(['--signals', 'auth', '--max', '5', '--json']);
  assert.ok(routed);
  assert.equal(routed.status, 0, routed.stderr || routed.stdout);
  const payload = JSON.parse(routed.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  assert.ok(payload.references.some((entry) => entry.path === 'references/security-multitenancy-patterns.md'));

  const security = await fs.readFile(securityReference, 'utf8');
  assert.match(security, /account-identity-lifecycle-product-engineering\.md/);
  assert.match(security, /Account and identity lifecycle/);

  const specialist = await fs.readFile(reference, 'utf8');
  assert.match(specialist, /mutable email, phone, display name, OAuth profile, session cookie, or current credential is not the durable account identity/);
  assert.match(specialist, /old token must not verify a newly changed destination/);
  assert.match(specialist, /Never complete recovery solely because the requester controls a new email\/phone/);
  assert.match(specialist, /“Same email means same user” is not a merge policy/);
  assert.match(specialist, /must not stay authoritative merely because its signature remains valid/);
  assert.match(specialist, /must not resurrect a closed account/);
  assert.match(specialist, /stale proof must never regain authority/);
});
