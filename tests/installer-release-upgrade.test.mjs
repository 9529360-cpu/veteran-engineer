import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { VeteranInstaller } from '../src/installer/index.mjs';
import { buildRuntimeBundle, materializeRuntimeBundle } from '../src/installer/runtime-bundle.mjs';
import { tempDir, cleanup } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const distributionRoot = path.resolve(here, '..');
const envFor = (home) => ({ ...process.env, HOME: home, USERPROFILE: home });

async function materializedTarget(target) {
  await materializeRuntimeBundle(await buildRuntimeBundle({ root: distributionRoot, version: '0.4.0' }), target);
}

test('verified remote upgrade swaps runtime atomically, preserves installed capabilities, and records target version', async () => {
  const home = await tempDir('veteran-installer-remote-upgrade-');
  const target = await tempDir('veteran-installer-remote-target-');
  let cleaned = false;
  try {
    const baseInstaller = new VeteranInstaller({ distributionRoot, home, env: envFor(home) });
    await baseInstaller.install('generic');
    const sentinel = path.join(baseInstaller.runtimeRoot, 'node_modules', '.remote-upgrade-sentinel');
    await fs.mkdir(path.dirname(sentinel), { recursive: true });
    await fs.writeFile(sentinel, 'preserve-capability');
    await materializedTarget(target);
    await fs.appendFile(path.join(target, 'README.md'), '\nremote-upgrade-target\n');

    const releaseSource = {
      async stage(selector) {
        assert.equal(selector, 'latest');
        return { root: target, version: '9.9.9', tag: 'v9.9.9', commit: 'a'.repeat(40), releaseId: 99, runtimeSha256: 'b'.repeat(64), async cleanup() { cleaned = true; } };
      }
    };
    const installer = new VeteranInstaller({ distributionRoot, home, env: envFor(home), releaseSource });
    const upgraded = await installer.upgrade({ release: 'latest' });
    assert.equal(upgraded.ok, true);
    assert.equal(upgraded.version, '9.9.9');
    assert.equal(upgraded.release.tag, 'v9.9.9');
    assert.match(await fs.readFile(path.join(installer.runtimeRoot, 'README.md'), 'utf8'), /remote-upgrade-target/);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'preserve-capability');
    const state = JSON.parse(await fs.readFile(installer.installerStatePath, 'utf8'));
    assert.equal(state.installedVersion, '9.9.9');
    assert.equal(cleaned, true);
  } finally {
    await Promise.all([cleanup(home), cleanup(target)]);
  }
});

test('remote upgrade source failure leaves the installed runtime untouched', async () => {
  const home = await tempDir('veteran-installer-remote-failure-');
  try {
    const local = new VeteranInstaller({ distributionRoot, home, env: envFor(home) });
    await local.install('generic');
    const before = await fs.readFile(path.join(local.runtimeRoot, 'README.md'));
    const installer = new VeteranInstaller({ distributionRoot, home, env: envFor(home), releaseSource: { async stage() { throw Object.assign(new Error('bad digest'), { code: 'RELEASE_ASSET_DIGEST_MISMATCH' }); } } });
    await assert.rejects(installer.upgrade({ release: 'latest' }), (error) => error.code === 'RELEASE_ASSET_DIGEST_MISMATCH');
    assert.deepEqual(await fs.readFile(path.join(installer.runtimeRoot, 'README.md')), before);
  } finally {
    await cleanup(home);
  }
});

test('remote upgrade rejects dependency graph changes before replacing runtime', async () => {
  const home = await tempDir('veteran-installer-remote-deps-');
  const target = await tempDir('veteran-installer-remote-deps-target-');
  let cleaned = false;
  try {
    const local = new VeteranInstaller({ distributionRoot, home, env: envFor(home) });
    await local.install('generic');
    const before = await fs.readFile(path.join(local.runtimeRoot, 'README.md'));
    await materializedTarget(target);
    const lockPath = path.join(target, 'package-lock.json');
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
    lock.packages[''].optionalDependencies ||= {};
    lock.packages[''].optionalDependencies['future-runtime-dependency'] = '1.0.0';
    await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    const installer = new VeteranInstaller({ distributionRoot, home, env: envFor(home), releaseSource: { async stage() { return { root: target, version: '0.5.0', tag: 'v0.5.0', commit: 'c'.repeat(40), releaseId: 5, runtimeSha256: 'd'.repeat(64), async cleanup() { cleaned = true; } }; } } });
    await assert.rejects(installer.upgrade({ release: 'latest' }), (error) => error.code === 'RELEASE_DEPENDENCY_GRAPH_CHANGED');
    assert.deepEqual(await fs.readFile(path.join(installer.runtimeRoot, 'README.md')), before);
    assert.equal(cleaned, true);
  } finally {
    await Promise.all([cleanup(home), cleanup(target)]);
  }
});

test('remote upgrade rejects version downgrades before replacing runtime', async () => {
  const home = await tempDir('veteran-installer-remote-downgrade-');
  const target = await tempDir('veteran-installer-remote-downgrade-target-');
  try {
    const local = new VeteranInstaller({ distributionRoot, home, env: envFor(home) });
    await local.install('generic');
    await materializedTarget(target);
    const installer = new VeteranInstaller({ distributionRoot, home, env: envFor(home), releaseSource: { async stage() { return { root: target, version: '0.3.0', tag: 'v0.3.0', commit: 'e'.repeat(40), releaseId: 3, runtimeSha256: 'f'.repeat(64), async cleanup() {} }; } } });
    await assert.rejects(installer.upgrade({ release: 'v0.3.0' }), (error) => error.code === 'RELEASE_DOWNGRADE_REJECTED');
  } finally {
    await Promise.all([cleanup(home), cleanup(target)]);
  }
});
