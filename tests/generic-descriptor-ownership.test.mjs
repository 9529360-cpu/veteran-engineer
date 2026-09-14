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

test('generic install refuses an unrecorded existing descriptor instead of overwriting it', async () => {
  const home = await tempDir('veteran-generic-conflict-');
  const descriptorPath = path.join(home, 'host', 'mcp.json');
  const foreign = { mcpServers: { foreign: { command: 'foreign-host' } } };
  try {
    await fs.mkdir(path.dirname(descriptorPath), { recursive: true });
    await fs.writeFile(descriptorPath, `${JSON.stringify(foreign, null, 2)}\n`);
    const installer = installerFor(home);

    await assert.rejects(
      installer.install('generic', { descriptorPath }),
      (error) => error?.code === 'HOST_BINDING_CONFLICT'
    );
    assert.deepEqual(JSON.parse(await fs.readFile(descriptorPath, 'utf8')), foreign);
  } finally {
    await cleanup(home);
  }
});

test('generic uninstall recovers a custom descriptor path from the durable binding and removes unchanged owned content', async () => {
  const home = await tempDir('veteran-generic-owned-uninstall-');
  const descriptorPath = path.join(home, 'host', 'custom.mcp.json');
  try {
    const installer = installerFor(home);
    const installed = await installer.install('generic', { descriptorPath });
    assert.equal(typeof installed.binding.descriptorDigest, 'string');
    assert.equal(installed.binding.descriptorDigest.length, 64);
    await fs.access(descriptorPath);

    const removed = await installer.uninstall('generic');
    assert.equal(removed.binding.descriptorPath, path.resolve(descriptorPath));
    assert.equal(removed.binding.descriptorRemoved, true);
    await assert.rejects(fs.access(descriptorPath), (error) => error?.code === 'ENOENT');
  } finally {
    await cleanup(home);
  }
});

test('generic uninstall preserves a descriptor that changed after Veteran installed it', async () => {
  const home = await tempDir('veteran-generic-drift-uninstall-');
  const descriptorPath = path.join(home, 'host', 'custom.mcp.json');
  try {
    const installer = installerFor(home);
    await installer.install('generic', { descriptorPath });
    const replacement = {
      mcpServers: {
        'user-owned-server': { command: 'user-command', args: ['serve'] }
      },
      note: 'replacement after Veteran install'
    };
    await fs.writeFile(descriptorPath, `${JSON.stringify(replacement, null, 2)}\n`);

    const removed = await installer.uninstall('generic');
    assert.equal(removed.binding.descriptorRemoved, false);
    assert.equal(removed.binding.preserved, true);
    assert.equal(removed.binding.reason, 'descriptor-drift');
    assert.deepEqual(JSON.parse(await fs.readFile(descriptorPath, 'utf8')), replacement);
  } finally {
    await cleanup(home);
  }
});
