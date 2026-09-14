import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const skillRoot = path.join(root, 'skills', 'runtime-regression-debugger');
const gate = path.join(skillRoot, 'scripts', 'specialist_reachability_gate.py');

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

async function makeFixture({ orphan = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-specialist-reach-'));
  await fs.mkdir(path.join(dir, 'scripts'), { recursive: true });
  await fs.mkdir(path.join(dir, 'references'), { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), 'Read `references/root.md`.\n', 'utf8');
  await fs.writeFile(path.join(dir, 'scripts', 'engineering_context_router.py'), `
CORE = ['references/root.md']
ROUTES = {
  'auth': ['references/security.md'],
}
ALIASES = {}
`, 'utf8');
  await fs.writeFile(path.join(dir, 'references', 'root.md'), '# root\n', 'utf8');
  await fs.writeFile(path.join(dir, 'references', 'security.md'), 'Read `account-product-engineering.md`.\n', 'utf8');
  await fs.writeFile(path.join(dir, 'references', 'account-product-engineering.md'), '# account\n', 'utf8');
  if (orphan) await fs.writeFile(path.join(dir, 'references', 'orphan-product-engineering.md'), '# orphan\n', 'utf8');
  return dir;
}

test('all current product-engineering specialists are reachable from router roots', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill specialist-reachability gate is not present in this isolated runtime starter');
    return;
  }
  const result = runPython(gate, ['--skill-root', skillRoot, '--json']);
  assert.ok(result);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.gate_passed, true);
  assert.deepEqual(payload.blockers, []);
  assert.ok(payload.specialist_count > 0);
  assert.equal(payload.reachable_specialists.length, payload.specialist_count);
  assert.deepEqual(payload.unreachable_specialists, []);
});

test('specialist reachability follows an explicit routed parent to an indirect specialist', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill specialist-reachability gate is not present in this isolated runtime starter');
    return;
  }
  const dir = await makeFixture();
  try {
    const result = runPython(gate, ['--skill-root', dir, '--json']);
    assert.ok(result);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gate_passed, true);
    assert.deepEqual(payload.reachable_specialists, ['references/account-product-engineering.md']);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('specialist reachability fails closed when a product-engineering specialist becomes orphaned', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill specialist-reachability gate is not present in this isolated runtime starter');
    return;
  }
  const dir = await makeFixture({ orphan: true });
  try {
    const result = runPython(gate, ['--skill-root', dir, '--json']);
    assert.ok(result);
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gate_passed, false);
    assert.deepEqual(payload.unreachable_specialists, ['references/orphan-product-engineering.md']);
    assert.ok(payload.blockers.some((item) => item.code === 'SPECIALIST_UNREACHABLE'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
