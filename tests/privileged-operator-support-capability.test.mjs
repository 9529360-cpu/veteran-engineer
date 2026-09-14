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
const reference = path.join(skillRoot, 'references', 'privileged-operator-support-product-engineering.md');

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

test('auth routing retains privileged support ownership and stale-privilege boundaries', async (t) => {
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
  assert.match(security, /privileged-operator-support-product-engineering\.md/);
  assert.match(security, /Privileged operator and support workflows/);

  const specialist = await fs.readFile(reference, 'utf8');
  assert.match(specialist, /Never collapse the operator principal into the customer principal/);
  assert.match(specialist, /Break-glass does not mean “skip authorization”/);
  assert.match(specialist, /requester cannot approve their own action/);
  assert.match(specialist, /support tooling requests those transitions; it must not become a shadow source of truth/);
  assert.match(specialist, /“Was authorized when queued” is not automatically authorization to execute later/);
  assert.match(specialist, /timeout-after-commit is an unknown outcome/);
  assert.match(specialist, /A cryptographically valid stale token is not sufficient authority/);
  assert.match(specialist, /ambient legacy admin endpoint remains an indefinite bypass/);
  assert.match(specialist, /stale privilege must not survive behind another path/);
});
