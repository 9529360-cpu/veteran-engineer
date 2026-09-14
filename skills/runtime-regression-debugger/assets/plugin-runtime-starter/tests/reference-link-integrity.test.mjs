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
const gate = path.join(skillRoot, 'scripts', 'reference_link_integrity_gate.py');

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

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-ref-links-'));
  await fs.mkdir(path.join(dir, 'references'), { recursive: true });
  return dir;
}

test('current Skill documentation has no broken explicit local reference links', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill reference-link gate is not present in this isolated runtime starter');
    return;
  }
  const result = runPython(gate, ['--skill-root', skillRoot, '--json']);
  assert.ok(result);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.gate_passed, true);
  assert.deepEqual(payload.blockers, []);
  assert.ok(payload.documents_scanned > 0);
  assert.ok(payload.links_checked > 0);
});

test('reference-link integrity accepts explicit and sibling links while ignoring code fences and non-reference markdown', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill reference-link gate is not present in this isolated runtime starter');
    return;
  }
  const dir = await fixture();
  try {
    await fs.writeFile(path.join(dir, 'SKILL.md'), 'Read `references/good.md`. Ignore `README.md`.\n```\n`references/missing-in-code.md`\n```\n', 'utf8');
    await fs.writeFile(path.join(dir, 'references', 'good.md'), 'Use `other-good.md`. Ignore `https://example.com/external.md`.', 'utf8');
    await fs.writeFile(path.join(dir, 'references', 'other-good.md'), '# ok\n', 'utf8');
    const result = runPython(gate, ['--skill-root', dir, '--json']);
    assert.ok(result);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gate_passed, true);
    assert.deepEqual(payload.blockers, []);
    assert.equal(payload.links_checked, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('reference-link integrity fails closed on missing sibling/explicit references and path escape', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill reference-link gate is not present in this isolated runtime starter');
    return;
  }
  const dir = await fixture();
  try {
    await fs.writeFile(path.join(dir, 'SKILL.md'), 'Read `references/nope.md`.', 'utf8');
    await fs.writeFile(path.join(dir, 'references', 'source.md'), 'Use `missing-specialist.md` and `references/../secret.md`.', 'utf8');
    const result = runPython(gate, ['--skill-root', dir, '--json']);
    assert.ok(result);
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gate_passed, false);
    const codes = new Set(payload.blockers.map((item) => item.code));
    assert.ok(codes.has('REFERENCE_LINK_MISSING'));
    assert.ok(codes.has('REFERENCE_LINK_ESCAPE'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
