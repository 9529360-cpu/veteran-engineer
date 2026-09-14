import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { VeteranInstaller } from '../src/installer/index.mjs';
import { cleanup, tempDir } from './helpers.mjs';

function installerFor(home) {
  return new VeteranInstaller({
    home,
    runtimeRoot: path.join(home, 'runtime'),
    runtimeStateRoot: path.join(home, 'state'),
    installerRoot: path.join(home, 'installer'),
    env: { ...process.env, HOME: home, USERPROFILE: home }
  });
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

test('generic repair preserves a descriptor with user-owned sibling servers and fails closed', async () => {
  const home = await tempDir('veteran-generic-repair-drift-');
  const descriptorPath = path.join(home, 'host', 'mcp.json');
  try {
    const installer = installerFor(home);
    await installer.install('generic', { descriptorPath });
    const descriptor = await readJson(descriptorPath);
    descriptor.mcpServers['user-owned-server'] = { command: 'user-command', args: ['serve'] };
    await fs.writeFile(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);

    const before = await installer.status('generic');
    assert.equal(before.hosts.generic.installed, true);
    assert.equal(before.hosts.generic.descriptorDigestCurrent, false);

    const repaired = await installer.repair('generic');
    assert.equal(repaired.ok, false);
    assert.equal(repaired.hosts.generic.ok, false);
    assert.equal(repaired.hosts.generic.error, 'HOST_BINDING_DRIFT');
    assert.deepEqual(await readJson(descriptorPath), descriptor);
  } finally {
    await cleanup(home);
  }
});

test('generic repair preserves an unreadable recorded descriptor instead of overwriting it', async () => {
  const home = await tempDir('veteran-generic-repair-unreadable-');
  const descriptorPath = path.join(home, 'host', 'mcp.json');
  try {
    const installer = installerFor(home);
    await installer.install('generic', { descriptorPath });
    const malformed = '{not-json\n';
    await fs.writeFile(descriptorPath, malformed);

    const repaired = await installer.repair('generic');
    assert.equal(repaired.ok, false);
    assert.equal(repaired.hosts.generic.error, 'HOST_BINDING_DRIFT');
    assert.equal(await fs.readFile(descriptorPath, 'utf8'), malformed);
  } finally {
    await cleanup(home);
  }
});

test('generic repair recreates a missing owned descriptor', async () => {
  const home = await tempDir('veteran-generic-repair-missing-');
  const descriptorPath = path.join(home, 'host', 'mcp.json');
  try {
    const installer = installerFor(home);
    await installer.install('generic', { descriptorPath });
    await fs.rm(descriptorPath);

    const repaired = await installer.repair('generic');
    assert.equal(repaired.ok, true, JSON.stringify(repaired, null, 2));
    const status = await installer.status('generic');
    assert.equal(status.hosts.generic.installed, true);
    assert.equal(status.hosts.generic.descriptorDigestCurrent, true);
  } finally {
    await cleanup(home);
  }
});

test('generic repair migrates an unchanged legacy binding that predates descriptor digests', async () => {
  const home = await tempDir('veteran-generic-repair-legacy-');
  const descriptorPath = path.join(home, 'host', 'mcp.json');
  const installerStatePath = path.join(home, 'installer', 'installer.json');
  try {
    const installer = installerFor(home);
    await installer.install('generic', { descriptorPath });
    const state = await readJson(installerStatePath);
    delete state.hosts.generic.binding.descriptorDigest;
    await fs.writeFile(installerStatePath, `${JSON.stringify(state, null, 2)}\n`);

    const repaired = await installer.repair('generic');
    assert.equal(repaired.ok, true, JSON.stringify(repaired, null, 2));
    assert.match(repaired.hosts.generic.binding.descriptorDigest, /^[0-9a-f]{64}$/);

    const persisted = await readJson(installerStatePath);
    assert.match(persisted.hosts.generic.binding.descriptorDigest, /^[0-9a-f]{64}$/);
  } finally {
    await cleanup(home);
  }
});
