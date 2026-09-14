import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { VeteranInstaller } from '../src/installer/index.mjs';
import { cleanup, tempDir } from './helpers.mjs';

async function writeExecutable(file, source) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, source, { mode: 0o755 });
  await fs.chmod(file, 0o755);
}

async function codexHarness(home) {
  const bin = path.join(home, 'bin');
  const codex = path.join(bin, process.platform === 'win32' ? 'codex.cmd' : 'codex');
  await writeExecutable(codex, process.platform === 'win32' ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n');
  const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` };
  let installed = false;
  const exec = async (command, args = []) => {
    const name = path.basename(command).toLowerCase();
    if (!name.startsWith('codex')) throw new Error(`unexpected command: ${command}`);
    if (args[0] !== 'plugin') return { code: 2, signal: null, stdout: '', stderr: 'unexpected command' };
    if (args[1] === 'add') installed = true;
    if (args[1] === 'remove') installed = false;
    const stdout = args[1] === 'list'
      ? JSON.stringify(installed ? [{ name: 'veteran-engineer', marketplace: 'personal', installed: true }] : [])
      : JSON.stringify({ ok: true });
    return { code: 0, signal: null, stdout, stderr: '' };
  };
  return { env, exec };
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function veteranEntry(marketplace) {
  return marketplace.plugins.find((entry) => entry?.name === 'veteran-engineer');
}

test('Codex status and repair fail closed on recorded marketplace entry drift', async () => {
  const home = await tempDir('veteran-codex-marketplace-drift-');
  const marketplacePath = path.join(home, '.agents', 'plugins', 'marketplace.json');
  try {
    const { env, exec } = await codexHarness(home);
    const installer = new VeteranInstaller({ home, env, exec });
    const installed = await installer.install('codex');
    assert.match(installed.binding.marketplaceEntryDigest, /^[0-9a-f]{64}$/);
    const original = await readJson(marketplacePath);

    const mutations = [
      (entry) => { entry.policy.authentication = 'NONE'; },
      (entry) => { entry.category = 'User Managed'; },
      (entry) => { entry.source = { source: 'git', url: 'https://example.invalid/user/veteran-engineer.git' }; }
    ];

    for (const mutate of mutations) {
      const marketplace = JSON.parse(JSON.stringify(original));
      mutate(veteranEntry(marketplace));
      await fs.writeFile(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`);

      const status = await installer.status('codex');
      assert.equal(status.hosts.codex.installed, false);
      assert.equal(status.hosts.codex.marketplaceEntryCurrent, false);
      assert.equal(status.hosts.codex.marketplaceEntryDigestCurrent, false);

      const repaired = await installer.repair('codex');
      assert.equal(repaired.ok, false);
      assert.equal(repaired.hosts.codex.error, 'HOST_BINDING_DRIFT');
      assert.deepEqual(await readJson(marketplacePath), marketplace);
    }
  } finally {
    await cleanup(home);
  }
});

test('Codex repair recreates a missing recorded marketplace entry', async () => {
  const home = await tempDir('veteran-codex-marketplace-missing-');
  const marketplacePath = path.join(home, '.agents', 'plugins', 'marketplace.json');
  try {
    const { env, exec } = await codexHarness(home);
    const installer = new VeteranInstaller({ home, env, exec });
    await installer.install('codex');
    const marketplace = await readJson(marketplacePath);
    marketplace.plugins = marketplace.plugins.filter((entry) => entry?.name !== 'veteran-engineer');
    await fs.writeFile(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`);

    const repaired = await installer.repair('codex');
    assert.equal(repaired.ok, true, JSON.stringify(repaired, null, 2));
    assert.match(repaired.hosts.codex.binding.marketplaceEntryDigest, /^[0-9a-f]{64}$/);
    const status = await installer.status('codex');
    assert.equal(status.hosts.codex.installed, true);
    assert.equal(status.hosts.codex.marketplaceEntryCurrent, true);
    assert.equal(status.hosts.codex.marketplaceEntryDigestCurrent, true);
  } finally {
    await cleanup(home);
  }
});

test('Codex repair migrates an unchanged legacy binding without a marketplace entry digest', async () => {
  const home = await tempDir('veteran-codex-marketplace-legacy-');
  const installerStatePath = path.join(home, '.veteran-engineer', 'installer', 'installer.json');
  try {
    const { env, exec } = await codexHarness(home);
    const installer = new VeteranInstaller({ home, env, exec });
    await installer.install('codex');
    const state = await readJson(installer.installerStatePath);
    delete state.hosts.codex.binding.marketplaceEntryDigest;
    await fs.writeFile(installer.installerStatePath, `${JSON.stringify(state, null, 2)}\n`);

    const repaired = await installer.repair('codex');
    assert.equal(repaired.ok, true, JSON.stringify(repaired, null, 2));
    assert.match(repaired.hosts.codex.binding.marketplaceEntryDigest, /^[0-9a-f]{64}$/);
    const persisted = await readJson(installer.installerStatePath);
    assert.match(persisted.hosts.codex.binding.marketplaceEntryDigest, /^[0-9a-f]{64}$/);
  } finally {
    await cleanup(home);
  }
});
