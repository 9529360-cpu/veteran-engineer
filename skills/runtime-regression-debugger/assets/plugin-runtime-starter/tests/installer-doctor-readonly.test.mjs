import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { VeteranInstaller } from '../src/installer/index.mjs';
import { cleanup, tempDir } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const distributionRoot = path.resolve(here, '..');

test('installer doctor verifies modern MCP without persisting a probe project', async () => {
  const home = await tempDir('veteran-installer-doctor-readonly-');
  const installerRoot = path.join(home, 'installer');
  const runtimeStateRoot = path.join(home, 'runtime-state');
  try {
    const installer = new VeteranInstaller({
      distributionRoot,
      runtimeRoot: distributionRoot,
      runtimeStateRoot,
      installerRoot,
      home,
      env: { ...process.env, HOME: home, USERPROFILE: home }
    });
    await installer.install('generic');

    const report = await installer.doctor('generic');
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    assert.equal(report.runtime.sdkAvailable, true, 'source runtime should expose the installed official SDK graph');
    assert.equal(report.runtime.modern.era, 'modern');
    assert.equal(report.runtime.modern.toolCount, 36);
    assert.equal(report.runtime.modern.runtime.mcp.implementation, 'official-sdk');
    assert.equal(report.runtime.modern.stateful, null, 'doctor must not execute the mutating project_open stateful probe');

    const state = JSON.parse(await fs.readFile(path.join(runtimeStateRoot, 'state.json'), 'utf8'));
    assert.deepEqual(state.projects, {}, 'doctor must not persist a temporary project into the runtime state');
  } finally {
    await cleanup(home);
  }
});
