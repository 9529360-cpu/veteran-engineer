import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { initRemoteHostConfig } from '../src/remote-host-config.mjs';
import {
  installRemoteHostService,
  remoteHostServiceStatus,
  uninstallRemoteHostService
} from '../src/remote-host-service.mjs';
import { cleanup, tempDir } from './helpers.mjs';

test('Windows Task Scheduler can register and remove the real Remote Host supervisor action', { skip: process.platform !== 'win32' }, async () => {
  const root = await tempDir('veteran-remote-service-win-');
  const workspace = path.join(root, 'workspace');
  const configPath = path.join(root, 'remote-host.json');
  const serviceRoot = path.join(root, 'service');
  let installed = false;
  try {
    await fs.mkdir(workspace, { recursive: true });
    const initialized = await initRemoteHostConfig({
      configPath,
      stateRoot: path.join(root, 'state'),
      workspaces: [workspace],
      port: 0
    });
    const result = await installRemoteHostService({
      configPath,
      serviceRoot,
      startNow: false
    });
    installed = result.installed;
    assert.equal(result.installed, true);
    assert.equal(result.started, false);
    const status = await remoteHostServiceStatus({ serviceRoot });
    assert.equal(status.registration, 'registered');
    assert.equal(status.desiredState, 'running');
    const launcher = await fs.readFile(path.join(serviceRoot, 'remote-host-service.cmd'), 'utf8');
    assert.equal(launcher.includes(initialized.pairingToken), false);
    assert.match(launcher, / supervise --config /);
  } finally {
    if (installed) {
      await uninstallRemoteHostService({ serviceRoot, purgeLogs: true }).catch(() => {});
    }
    await cleanup(root);
  }
});
