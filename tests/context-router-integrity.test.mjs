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
const gate = path.join(skillRoot, 'scripts', 'context_router_integrity_gate.py');
const router = path.join(skillRoot, 'scripts', 'engineering_context_router.py');

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

async function writeFixture(rootDir, routerSource, references = ['ok.md']) {
  const scriptsDir = path.join(rootDir, 'scripts');
  const refsDir = path.join(rootDir, 'references');
  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.mkdir(refsDir, { recursive: true });
  await fs.writeFile(path.join(scriptsDir, 'engineering_context_router.py'), routerSource, 'utf8');
  for (const ref of references) await fs.writeFile(path.join(refsDir, ref), `# ${ref}\n`, 'utf8');
  return path.join(scriptsDir, 'engineering_context_router.py');
}

test('current engineering context router has no dangling references or aliases', async (t) => {
  if (!(await exists(gate)) || !(await exists(router))) {
    t.skip('source Skill router integrity gate is not present in this isolated runtime starter');
    return;
  }
  const result = runPython(gate, ['--skill-root', skillRoot, '--json']);
  assert.ok(result);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.gate_passed, true);
  assert.deepEqual(payload.blockers, []);
  assert.ok(Array.isArray(payload.redundant_aliases));
  assert.ok(payload.core_references > 0);
  assert.ok(payload.route_count > 0);
  assert.ok(payload.alias_count > 0);
});

test('router integrity fails closed on missing references, dangling aliases, semantic shadowing, and path escape', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill router integrity gate is not present in this isolated runtime starter');
    return;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-router-integrity-'));
  try {
    const fixture = await writeFixture(dir, `
CORE = ['references/ok.md']
ROUTES = {
  'good': ['references/ok.md'],
  'missing': ['references/missing.md'],
  'escape': ['references/../secret.md'],
}
ALIASES = {
  'dangling': 'not-a-route',
  'good': 'missing',
  'self': 'self',
}
`);
    const result = runPython(gate, ['--skill-root', dir, '--router', fixture, '--json']);
    assert.ok(result);
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gate_passed, false);
    const codes = new Set(payload.blockers.map((item) => item.code));
    for (const code of ['REFERENCE_MISSING', 'REFERENCE_PATH_ESCAPE', 'ALIAS_TARGET_MISSING', 'ALIAS_SHADOWS_ROUTE', 'ALIAS_SELF_REFERENCE']) {
      assert.ok(codes.has(code), `expected blocker ${code}`);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('router integrity surfaces canonical identity aliases as harmless redundancy', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill router integrity gate is not present in this isolated runtime starter');
    return;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-router-identity-alias-'));
  try {
    const fixture = await writeFixture(dir, `
CORE = ['references/ok.md']
ROUTES = {
  'good': ['references/ok.md'],
}
ALIASES = {
  'good': 'good',
}
`);
    const result = runPython(gate, ['--skill-root', dir, '--router', fixture, '--json']);
    assert.ok(result);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gate_passed, true);
    assert.deepEqual(payload.blockers, []);
    assert.deepEqual(payload.redundant_aliases, ['good']);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('router integrity rejects duplicate route and alias ownership plus malformed route values', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill router integrity gate is not present in this isolated runtime starter');
    return;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-router-duplicates-'));
  try {
    const fixture = await writeFixture(dir, `
CORE = ['references/ok.md']
ROUTES = {
  'good': ['references/ok.md'],
  'empty': [],
  'wrong': 'references/ok.md',
}
ROUTES.update({
  'good': ['references/ok.md'],
})
ALIASES = {
  'alias': 'good',
}
ALIASES.update({
  'alias': 'empty',
})
`);
    const result = runPython(gate, ['--skill-root', dir, '--router', fixture, '--json']);
    assert.ok(result);
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    const codes = new Set(payload.blockers.map((item) => item.code));
    assert.ok(codes.has('ROUTE_DUPLICATE'));
    assert.ok(codes.has('ALIAS_DUPLICATE'));
    assert.ok(codes.has('ROUTE_REFERENCES_REQUIRED'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
