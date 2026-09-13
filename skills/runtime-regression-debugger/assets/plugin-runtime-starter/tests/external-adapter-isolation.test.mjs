import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { VeteranInstaller } from '../src/installer/index.mjs';
import { cleanup, tempDir } from './helpers.mjs';

test('malformed external adapter stays visible as invalid without blocking healthy host discovery', async () => {
  const root = await tempDir('veteran-external-adapter-isolation-');
  try {
    const adaptersDir = path.join(root, 'adapters');
    const home = path.join(root, 'home');
    await fs.mkdir(adaptersDir, { recursive: true });
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(path.join(adaptersDir, 'broken-agent.mjs'), 'export default {\n', 'utf8');
    await fs.writeFile(path.join(adaptersDir, 'healthy-agent.mjs'), `export default {\n  apiVersion: 1,\n  id: 'healthy-agent',\n  displayName: 'Healthy Agent',\n  async install() { return { installed: true }; },\n  async status() { return { installed: false, source: 'healthy' }; },\n  async doctor() { return { ok: true, checks: [] }; },\n  async uninstall() { return { removed: true }; }\n};\n`, 'utf8');

    const installer = new VeteranInstaller({ home, trustedAdapterDirs: [adaptersDir] });
    const hosts = await installer.listHosts();
    for (const id of ['codex', 'hermes', 'generic', 'healthy-agent']) {
      assert.ok(hosts.some((host) => host.id === id), `${id} must remain discoverable`);
    }
    const invalid = hosts.find((host) => host.capabilities?.invalid === true);
    assert.ok(invalid, 'malformed adapter must remain visible as invalid host discovery evidence');
    assert.match(invalid.id, /^invalid-external-[0-9a-f]{16}$/);
    assert.equal(invalid.capabilities.external, true);
    assert.equal(invalid.capabilities.source, 'broken-agent.mjs');
    assert.equal(invalid.capabilities.failureCode, 'HOST_ADAPTER_LOAD_FAILED');

    const healthyStatus = await installer.status('healthy-agent');
    assert.equal(healthyStatus.hosts['healthy-agent'].installed, false);
    assert.equal(healthyStatus.hosts['healthy-agent'].source, 'healthy');

    const invalidStatus = await installer.status(invalid.id);
    assert.equal(invalidStatus.hosts[invalid.id].installed, false);
    assert.equal(invalidStatus.hosts[invalid.id].error, 'HOST_ADAPTER_INVALID');
    assert.equal(invalidStatus.hosts[invalid.id].source, 'broken-agent.mjs');

    const invalidDoctor = await installer.doctor(invalid.id);
    assert.equal(invalidDoctor.hosts[invalid.id].ok, false);
    assert.equal(invalidDoctor.hosts[invalid.id].error, 'HOST_ADAPTER_INVALID');
    assert.equal(invalidDoctor.hosts[invalid.id].checks[0].name, 'adapter-valid');
    assert.equal(invalidDoctor.hosts[invalid.id].checks[0].ok, false);
  } finally {
    await cleanup(root);
  }
});
