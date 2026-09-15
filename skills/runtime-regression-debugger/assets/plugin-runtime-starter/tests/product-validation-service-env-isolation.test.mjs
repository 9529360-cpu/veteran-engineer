import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { normalizeProductService, startValidationService, stopValidationService } from '../src/product-validation-runner.mjs';
import { cleanup, tempDir } from './helpers.mjs';

async function waitForFile(target, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await fs.readFile(target, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${target}`);
}

test('product validation service does not inherit host secrets and cleans its ephemeral home', async () => {
  const root = await tempDir('veteran-product-service-env-');
  const marker = path.join(root, 'service-env.json');
  const hostHome = path.join(root, 'host-home-secret');
  const hostProfile = path.join(root, 'host-profile-secret');
  const source = `
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({
  secret: process.env.VETERAN_SERVICE_SECRET_TEST || null,
  home: process.env.HOME || null,
  userProfile: process.env.USERPROFILE || null,
  xdgConfig: process.env.XDG_CONFIG_HOME || null,
  xdgCache: process.env.XDG_CACHE_HOME || null,
  appData: process.env.APPDATA || null,
  localAppData: process.env.LOCALAPPDATA || null,
  gitPrompt: process.env.GIT_TERMINAL_PROMPT || null
}));
setInterval(() => {}, 1000);
`;
  const service = normalizeProductService({
    command: [process.execPath, '-e', source],
    readiness: { url: 'http://127.0.0.1:65535/health' },
    shutdownGraceMs: 500
  });
  const environment = {
    ...process.env,
    VETERAN_SERVICE_SECRET_TEST: 'must-not-reach-service',
    HOME: hostHome,
    USERPROFILE: hostProfile,
    XDG_CONFIG_HOME: path.join(hostHome, '.config'),
    XDG_CACHE_HOME: path.join(hostHome, '.cache'),
    APPDATA: path.join(hostProfile, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(hostProfile, 'AppData', 'Local'),
    GIT_TERMINAL_PROMPT: '1'
  };
  let handle = null;
  try {
    handle = startValidationService(service, { cwd: root, environment });
    const observed = JSON.parse(await waitForFile(marker));
    const isolatedHome = observed.home;

    assert.equal(observed.secret, null);
    assert.notEqual(observed.home, hostHome);
    assert.notEqual(observed.userProfile, hostProfile);
    assert.equal(observed.userProfile, observed.home);
    assert.equal(observed.xdgConfig, path.join(observed.home, '.config'));
    assert.equal(observed.xdgCache, path.join(observed.home, '.cache'));
    assert.equal(observed.appData, null);
    assert.equal(observed.localAppData, null);
    assert.equal(observed.gitPrompt, '0');

    const stopped = await stopValidationService(handle, service.shutdownGraceMs);
    handle = null;
    assert.equal(stopped.after.running, false);
    assert.equal(stopped.after.treeRunning, false);
    await assert.rejects(fs.stat(isolatedHome), (error) => error?.code === 'ENOENT');
  } finally {
    if (handle) await stopValidationService(handle, 100).catch(() => {});
    await cleanup(root);
  }
});

test('product validation service keeps a POSIX process group alive when the probe outcome is unknown', {
  skip: process.platform === 'win32'
}, async () => {
  const root = await tempDir('veteran-product-service-probe-');
  const service = normalizeProductService({
    command: [process.execPath, '-e', 'setInterval(() => {}, 1000);'],
    readiness: { url: 'http://127.0.0.1:65535/health' },
    shutdownGraceMs: 100
  });
  const originalKill = process.kill;
  let handle = null;
  try {
    handle = startValidationService(service, { cwd: root });
    const pid = handle.child.pid;
    process.kill = (targetPid, signal) => {
      if (targetPid === -pid && signal === 0) {
        const error = new Error('process group probe outcome is unknown');
        error.code = 'EIO';
        throw error;
      }
      return originalKill.call(process, targetPid, signal);
    };

    const status = handle.status();
    assert.equal(status.running, true);
    assert.equal(status.treeRunning, true);
  } finally {
    process.kill = originalKill;
    if (handle) await stopValidationService(handle, 100).catch(() => {});
    await cleanup(root);
  }
});
