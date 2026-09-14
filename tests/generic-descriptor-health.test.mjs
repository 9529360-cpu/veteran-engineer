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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('generic status allows unrelated sibling MCP servers while exposing whole-descriptor ownership drift', async () => {
  const home = await tempDir('veteran-generic-health-sibling-');
  const descriptorPath = path.join(home, 'host', 'mcp.json');
  try {
    const installer = installerFor(home);
    await installer.install('generic', { descriptorPath });
    const descriptor = JSON.parse(await fs.readFile(descriptorPath, 'utf8'));
    descriptor.mcpServers['user-owned-server'] = { command: 'user-command', args: ['serve'] };
    await fs.writeFile(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);

    const status = await installer.status('generic');
    assert.equal(status.hosts.generic.installed, true);
    assert.equal(status.hosts.generic.drift, false);
    assert.equal(status.hosts.generic.descriptorDigestCurrent, false);
  } finally {
    await cleanup(home);
  }
});

test('generic status fails closed when the Veteran server launch contract gains extra argv, env, or cwd', async () => {
  const home = await tempDir('veteran-generic-health-server-');
  const descriptorPath = path.join(home, 'host', 'mcp.json');
  try {
    const installer = installerFor(home);
    await installer.install('generic', { descriptorPath });
    const original = JSON.parse(await fs.readFile(descriptorPath, 'utf8'));
    const mutations = [
      (descriptor) => descriptor.mcpServers['veteran-engineer'].args.push('--unexpected'),
      (descriptor) => { descriptor.mcpServers['veteran-engineer'].env.VETERAN_MCP_FORCE_FALLBACK = '1'; },
      (descriptor) => { descriptor.mcpServers['veteran-engineer'].cwd = home; }
    ];

    for (const mutate of mutations) {
      const descriptor = clone(original);
      mutate(descriptor);
      await fs.writeFile(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);
      const status = await installer.status('generic');
      assert.equal(status.hosts.generic.installed, false);
      assert.equal(status.hosts.generic.drift, true);
      assert.equal(status.hosts.generic.descriptorDigestCurrent, false);
    }

    const descriptor = clone(original);
    descriptor.mcpServers['veteran-engineer'].env.VETERAN_MCP_FORCE_FALLBACK = '1';
    await fs.writeFile(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);
    const doctor = await installer.doctor('generic');
    assert.equal(doctor.ok, false);
    assert.equal(doctor.hosts.generic.ok, false);
    assert.equal(doctor.hosts.generic.checks[0].details.installed, false);
  } finally {
    await cleanup(home);
  }
});
