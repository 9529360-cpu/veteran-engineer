import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { VeteranInstaller } from '../src/installer/index.mjs';
import { tempDir, cleanup } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const distributionRoot = path.resolve(here, '..');

async function fakeHermesEnvironment(home) {
  const bin = path.join(home, 'fake-bin');
  await fs.mkdir(bin, { recursive: true });
  const executable = process.platform === 'win32' ? path.join(bin, 'hermes.cmd') : path.join(bin, 'hermes');
  await fs.writeFile(executable, process.platform === 'win32' ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  if (process.platform !== 'win32') await fs.chmod(executable, 0o755);

  const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}` };
  let mcpInstalled = false;
  const exec = async (command, args = []) => {
    if (!path.basename(command).toLowerCase().startsWith('hermes')) {
      throw new Error(`Unexpected command in Hermes drift test: ${command}`);
    }
    if (args[0] !== 'mcp') return { code: 2, signal: null, stdout: '', stderr: 'unexpected command' };
    if (args[1] === 'list') return { code: 0, signal: null, stdout: mcpInstalled ? 'veteran-engineer\n' : '', stderr: '' };
    if (args[1] === 'add') {
      mcpInstalled = true;
      return { code: 0, signal: null, stdout: 'added\n', stderr: '' };
    }
    if (args[1] === 'remove') {
      mcpInstalled = false;
      return { code: 0, signal: null, stdout: 'removed\n', stderr: '' };
    }
    if (args[1] === 'test') return { code: mcpInstalled ? 0 : 1, signal: null, stdout: '', stderr: '' };
    return { code: 2, signal: null, stdout: '', stderr: 'unexpected mcp command' };
  };
  return { env, exec };
}

test('Hermes status detects copied Skill content and version drift and repair restores the projection', async () => {
  const home = await tempDir('veteran-hermes-skill-drift-');
  const hermesHome = path.join(home, '.hermes-test');
  try {
    const { env, exec } = await fakeHermesEnvironment(home);
    const installer = new VeteranInstaller({ distributionRoot, home, env, exec });
    const installed = await installer.install('hermes', { hermesHome });
    const skillPath = installed.binding.skillPath;
    const skillFile = path.join(skillPath, 'SKILL.md');
    const markerFile = path.join(skillPath, '.veteran-engineer-owned.json');

    let status = await installer.status('hermes', { hermesHome });
    assert.equal(status.hosts.hermes.installed, true);
    assert.equal(status.hosts.hermes.skillOwned, true);
    assert.equal(status.hosts.hermes.skillVersionCurrent, true);
    assert.equal(status.hosts.hermes.skillProjectionCurrent, true);
    assert.equal(status.hosts.hermes.skillProjectionError, null);

    await fs.appendFile(skillFile, '\n# local drift\n');
    status = await installer.status('hermes', { hermesHome });
    assert.equal(status.hosts.hermes.installed, false, 'content drift must make the host binding unhealthy');
    assert.equal(status.hosts.hermes.skillOwned, true);
    assert.equal(status.hosts.hermes.skillVersionCurrent, true);
    assert.equal(status.hosts.hermes.skillProjectionCurrent, false);
    assert.equal(status.hosts.hermes.skillInstalled, false);

    const repairedContent = await installer.repair('hermes', { hermesHome });
    assert.equal(repairedContent.ok, true);
    status = await installer.status('hermes', { hermesHome });
    assert.equal(status.hosts.hermes.installed, true, 'repair must restore the packaged Skill after content drift');
    assert.equal(status.hosts.hermes.skillProjectionCurrent, true);

    const marker = JSON.parse(await fs.readFile(markerFile, 'utf8'));
    marker.version = '0.0.0-stale';
    await fs.writeFile(markerFile, `${JSON.stringify(marker, null, 2)}\n`);
    status = await installer.status('hermes', { hermesHome });
    assert.equal(status.hosts.hermes.installed, false, 'stale projection version must make the host binding unhealthy');
    assert.equal(status.hosts.hermes.skillOwned, true);
    assert.equal(status.hosts.hermes.skillVersionCurrent, false);
    assert.equal(status.hosts.hermes.skillProjectionCurrent, false);

    const repairedVersion = await installer.repair('hermes', { hermesHome });
    assert.equal(repairedVersion.ok, true);
    status = await installer.status('hermes', { hermesHome });
    assert.equal(status.hosts.hermes.installed, true, 'repair must refresh stale projection metadata');
    assert.equal(status.hosts.hermes.skillVersionCurrent, true);
    assert.equal(status.hosts.hermes.skillProjectionCurrent, true);
  } finally {
    await cleanup(home);
  }
});
