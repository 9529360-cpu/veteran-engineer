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

test('stack fingerprint recognizes extension frameworks and a real WebExtension manifest', async (t) => {
  if (!(await exists(fingerprint))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-browser-extension-'));
  try {
    await fs.writeFile(path.join(repo, 'package.json'), JSON.stringify({
      name: 'extension-fixture',
      devDependencies: {
        wxt: '0.20.0',
        'webextension-polyfill': '0.12.0',
        '@crxjs/vite-plugin': '2.2.0'
      }
    }, null, 2));
    await fs.writeFile(path.join(repo, 'manifest.json'), JSON.stringify({
      manifest_version: 3,
      name: 'Fixture Extension',
      version: '1.0.0',
      permissions: ['storage'],
      host_permissions: ['https://example.com/*']
    }, null, 2));

    const result = runFingerprint(repo);
    assert.ok(result, 'Python is required to validate the stack fingerprint');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.detected['browser-extension'], [
      'CRXJS',
      'Manifest V3',
      'WXT',
      'WebExtension Polyfill'
    ]);
    assert.ok(payload.suggested_references.includes('references/browser-extension-product-engineering.md'));
    assert.equal(payload.suggested_references.includes('references/mobile-product-engineering.md'), false);
    assert.equal(payload.suggested_references.includes('references/runtime-lifecycle-patterns.md'), false);
  } finally {
    await fs.rm(repo, { recursive: true, force: true });
  }
});

test('manifest.json without manifest_version is not treated as a browser extension', async (t) => {
  if (!(await exists(fingerprint))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-pwa-manifest-'));
  try {
    await fs.writeFile(path.join(repo, 'package.json'), JSON.stringify({
      name: 'ordinary-web-app',
      dependencies: { react: '19.0.0', vite: '7.0.0' }
    }, null, 2));
    await fs.writeFile(path.join(repo, 'manifest.json'), JSON.stringify({
      name: 'Ordinary PWA',
      short_name: 'PWA',
      start_url: '/',
      display: 'standalone'
    }, null, 2));

    const result = runFingerprint(repo);
    assert.ok(result, 'Python is required to validate the stack fingerprint');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(Object.hasOwn(payload.detected, 'browser-extension'), false);
    assert.equal(payload.suggested_references.includes('references/browser-extension-product-engineering.md'), false);
    assert.ok(payload.suggested_references.includes('references/stack-react-nextjs.md'));
  } finally {
    await fs.rm(repo, { recursive: true, force: true });
  }
});
