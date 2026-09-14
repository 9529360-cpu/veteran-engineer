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
const reference = path.join(skillRoot, 'references', 'feature-flag-progressive-delivery-product-engineering.md');
const operability = path.join(skillRoot, 'references', 'operability-control-plane-contract.md');

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

function runPython(script, args) {
  for (const executable of ['python3', 'python']) {
    const result = spawnSync(executable, [script, ...args], { cwd: root, encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

test('feature rollout reaches the progressive-delivery owner through the normal router', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  assert.equal(await exists(reference), true, 'progressive delivery reference must exist');
  const routed = runPython(router, ['--signals', 'feature-rollout', '--max', '7', '--json']);
  assert.ok(routed, 'Python is required to validate the Skill context router');
  assert.equal(routed.status, 0, routed.stderr || routed.stdout);

  const payload = JSON.parse(routed.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const paths = payload.references.map((entry) => entry.path);
  assert.ok(paths.includes('references/operability-control-plane-contract.md'));

  const operabilityText = await fs.readFile(operability, 'utf8');
  assert.match(operabilityText, /feature-flag-progressive-delivery-product-engineering\.md/);

  const specialist = await fs.readFile(reference, 'utf8');
  assert.match(specialist, /A feature flag is production control-plane state, not a harmless boolean/);
  assert.match(specialist, /Lifecycle and deletion/);
});
