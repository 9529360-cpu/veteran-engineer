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
  const calls = [];
  const exec = async (command, args = []) => {
    const name = path.basename(command).toLowerCase();
    if (!name.startsWith('codex')) throw new Error(`unexpected command: ${command}`);
    calls.push([...args]);
    if (args[0] !== 'plugin') return { code: 2, signal: null, stdout: '', stderr: 'unexpected command' };
    if (args[1] === 'add') installed = true;
    if (args[1] === 'remove') installed = false;
    const stdout = args[1] === 'list'
      ? JSON.stringify(installed ? [{ name: 'veteran-engineer', marketplace: 'personal', installed: true }] : [])
      : JSON.stringify({ ok: true });
    return { code: 0, signal: null, stdout, stderr: '' };
  };
  return { env, exec, calls };
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function expectedEntry() {
  return {
    name: 'veteran-engineer',
    source: { source: 'local', path: './plugins/veteran-engineer' },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    category: 'Developer Tools'
  };
}

function veteranEntry(marketplace) {
  return marketplace.plugins.find((entry) => entry?.name === 'veteran-engineer');
}

test('Codex install refuses an unrecorded same-name marketplace entry even when it looks local', async () => {
  const home = await tempDir('veteran-codex-unrecorded-marketplace-');
  const marketplacePath = path.join(home, '.agents', 'plugins', 'marketplace.json');
  const marketplace = { name: 'personal', interface: { displayName: 'Personal' }, plugins: [expectedEntry()] };
  try {
    const { env, exec, calls } = await codexHarness(home);
    await fs.mkdir(path.dirname(marketplacePath), { recursive: true });
    await fs.writeFile(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`);
    const installer = new VeteranInstaller({ home, env, exec });

    await assert.rejects(
      installer.install('codex'),
      (error) => error?.code === 'HOST_BINDING_CONFLICT'
    );
    assert.deepEqual(await readJson(marketplacePath), marketplace);
    assert.equal(calls.some((args) => args[0] === 'plugin' && args[1] === 'add'), false, 'conflict must stop before plugin add');
  } finally {
    await cleanup(home);
  }
});

test('Codex uninstall stops before plugin removal when the recorded marketplace entry drifted', async () => {
  const home = await tempDir('veteran-codex-uninstall-drift-');
  const marketplacePath = path.join(home, '.agents', 'plugins', 'marketplace.json');
  try {
    const { env, exec, calls } = await codexHarness(home);
    const installer = new VeteranInstaller({ home, env, exec });
    await installer.install('codex');
    const original = await readJson(marketplacePath);

    const mutations = [
      (entry) => { entry.policy.authentication = 'NONE'; },
      (entry) => { entry.source = { source: 'git', url: 'https://example.invalid/user/veteran-engineer.git' }; }
    ];

    for (const mutate of mutations) {
      const marketplace = JSON.parse(JSON.stringify(original));
      mutate(veteranEntry(marketplace));
      await fs.writeFile(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`);
      const before = calls.length;

      await assert.rejects(
        installer.uninstall('codex'),
        (error) => error?.code === 'HOST_BINDING_DRIFT'
      );
      assert.equal(
        calls.slice(before).some((args) => args[0] === 'plugin' && args[1] === 'remove'),
        false,
        'drift must stop before Codex plugin removal'
      );
      assert.deepEqual(await readJson(marketplacePath), marketplace);
      const state = await readJson(installer.installerStatePath);
      assert.ok(state.hosts.codex, 'failed uninstall must retain durable Codex ownership metadata');
    }

    await fs.writeFile(marketplacePath, `${JSON.stringify(original, null, 2)}\n`);
    const removed = await installer.uninstall('codex');
    assert.equal(removed.removed, true);
    assert.equal(calls.some((args) => args[0] === 'plugin' && args[1] === 'remove'), true);
    const finalMarketplace = await readJson(marketplacePath);
    assert.equal(finalMarketplace.plugins.some((entry) => entry?.name === 'veteran-engineer'), false);
    const finalState = await readJson(installer.installerStatePath);
    assert.equal(finalState.hosts.codex, undefined);
  } finally {
    await cleanup(home);
  }
});
