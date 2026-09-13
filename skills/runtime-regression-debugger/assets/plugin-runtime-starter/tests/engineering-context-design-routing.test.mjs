import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const router = path.join(root, 'skills', 'runtime-regression-debugger', 'scripts', 'engineering_context_router.py');

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

test('engineering context router treats UI and product design as first-class frontend capability', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const direct = runRouter('ui,ux,product-design,wireframe,design-system,visual-design');
  assert.ok(direct, 'Python is required to validate the Skill context router');
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  const payload = JSON.parse(direct.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  assert.equal(payload.truncated, false);
  assert.deepEqual(payload.signals, ['ui', 'ux', 'product-design', 'wireframe', 'design-system', 'visual-design']);
  const paths = payload.references.map((entry) => entry.path);
  assert.ok(paths.includes('references/frontend-product-patterns.md'));
  assert.ok(paths.includes('references/full-stack-product-engineering.md'));

  const aliases = runRouter('interface-design,ux-design,design-tokens,responsive-ui');
  assert.ok(aliases, 'Python is required to validate the Skill context router aliases');
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  const aliasPayload = JSON.parse(aliases.stdout);
  assert.deepEqual(aliasPayload.unmatched_signals, []);
  assert.deepEqual(aliasPayload.signals, ['ui', 'ux', 'design-system', 'responsive-design']);
  assert.ok(aliasPayload.references.some((entry) => entry.path === 'references/frontend-product-patterns.md'));
});
