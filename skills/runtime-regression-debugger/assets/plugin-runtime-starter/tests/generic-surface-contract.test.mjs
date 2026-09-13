import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { VeteranInstaller } from '../src/installer/index.mjs';
import { cleanup, tempDir } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const distributionRoot = path.resolve(here, '..');

async function readGenericDescriptor(binding) {
  return fs.readFile(binding.descriptorPath, 'utf8');
}

test('generic descriptor only binds stdio-capable surface profiles and rejects remote-mcp before descriptor mutation', async () => {
  const home = await tempDir('veteran-generic-surface-');
  try {
    const installer = new VeteranInstaller({
      distributionRoot,
      home,
      env: { ...process.env, HOME: home, USERPROFILE: home }
    });

    const local = await installer.install('generic', { surfaceProfile: 'local-stdio' });
    assert.equal(local.binding.surfaceProfile, 'local-stdio');
    const localDescriptor = JSON.parse(await readGenericDescriptor(local.binding));
    assert.equal(localDescriptor.mcpServers['veteran-engineer'].env.VETERAN_ENGINEER_SURFACE_PROFILE, 'local-stdio');

    const tunnel = await installer.install('generic', { surfaceProfile: 'secure-tunnel' });
    assert.equal(tunnel.binding.surfaceProfile, 'secure-tunnel');
    const descriptorBeforeRejectedInstall = await readGenericDescriptor(tunnel.binding);
    const tunnelDescriptor = JSON.parse(descriptorBeforeRejectedInstall);
    assert.equal(tunnelDescriptor.mcpServers['veteran-engineer'].env.VETERAN_ENGINEER_SURFACE_PROFILE, 'secure-tunnel');

    await assert.rejects(
      installer.install('generic', { surfaceProfile: 'remote-mcp' }),
      (error) => {
        assert.equal(error.code, 'SURFACE_CAPABILITY_UNAVAILABLE');
        assert.equal(error.details?.surfaceProfile, 'remote-mcp');
        assert.equal(error.details?.capability, 'transport.stdioMcp');
        return true;
      }
    );

    assert.equal(
      await readGenericDescriptor(tunnel.binding),
      descriptorBeforeRejectedInstall,
      'rejected remote surface must not rewrite the last valid generic descriptor'
    );

    const status = await installer.status('generic');
    assert.equal(status.hosts.generic.installed, true);
    assert.equal(status.hosts.generic.surfaceProfile, 'secure-tunnel');
  } finally {
    await cleanup(home);
  }
});
