import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const fingerprint = path.join(root, 'skills', 'runtime-regression-debugger', 'scripts', 'stack_fingerprint.py');

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function runFingerprint(repo) {
  for (const executable of ['python3', 'python']) {
    const result = spawnSync(executable, [fingerprint, repo, '--json'], { cwd: root, encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

test('stack fingerprint connects Electron evidence to existing desktop engineering references', async (t) => {
  if (!(await exists(fingerprint))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-desktop-fingerprint-'));
  try {
    await fs.writeFile(path.join(repo, 'package.json'), JSON.stringify({
      name: 'electron-fixture',
      devDependencies: {
        electron: '40.0.0',
        'electron-builder': '26.0.0',
        '@electron-forge/cli': '7.10.0'
      }
    }, null, 2));

    const result = runFingerprint(repo);
    assert.ok(result, 'Python is required to validate the stack fingerprint');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.detected['desktop-runtime'], [
      'Electron',
      'Electron Builder',
      'Electron Forge'
    ]);
    for (const expected of [
      'references/runtime-lifecycle-patterns.md',
      'references/host-shell-platform-patterns.md',
      'references/release-promotion-patterns.md'
    ]) {
      assert.ok(payload.suggested_references.includes(expected), `expected desktop reference ${expected}`);
    }
    assert.equal(payload.suggested_references.includes('references/mobile-product-engineering.md'), false);
  } finally {
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('plain Electron detection does not imply packaging/release work', async (t) => {
  if (!(await exists(fingerprint))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-electron-runtime-'));
  try {
    await fs.writeFile(path.join(repo, 'package.json'), JSON.stringify({
      name: 'electron-runtime-only',
      dependencies: { electron: '40.0.0' }
    }, null, 2));

    const result = runFingerprint(repo);
    assert.ok(result, 'Python is required to validate the stack fingerprint');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.detected['desktop-runtime'], ['Electron']);
    assert.ok(payload.suggested_references.includes('references/runtime-lifecycle-patterns.md'));
    assert.ok(payload.suggested_references.includes('references/host-shell-platform-patterns.md'));
    assert.equal(payload.suggested_references.includes('references/release-promotion-patterns.md'), false);
  } finally {
    await fs.rm(repo, { recursive: true, force: true });
  }
});
