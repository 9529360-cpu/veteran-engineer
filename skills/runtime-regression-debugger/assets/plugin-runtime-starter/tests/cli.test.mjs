import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runProcess } from '../src/git.mjs';
import { tempDir, cleanup } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const cli = path.join(root, 'bin', 'veteran-engineer.mjs');

test('CLI generic lifecycle exposes status and doctor protocol mode', async () => {
  const home = await tempDir('veteran-cli-');
  const descriptor = path.join(home, 'descriptor.json');
  const common = ['--home', home, '--distribution-root', root];
  try {
    let result = await runProcess(process.execPath, [cli, 'install', 'generic', ...common, '--descriptor', descriptor, '--json'], { cwd: root });
    assert.equal(JSON.parse(result.stdout).host, 'generic');
    result = await runProcess(process.execPath, [cli, 'status', 'generic', ...common, '--descriptor', descriptor, '--json'], { cwd: root });
    const status = JSON.parse(result.stdout);
    assert.equal(status.hosts.generic.installed, true);
    result = await runProcess(process.execPath, [cli, 'doctor', 'generic', ...common, '--descriptor', descriptor], { cwd: root });
    assert.match(result.stdout, /MCP implementation: standalone-fallback/);
    assert.match(result.stdout, /MCP protocols: 2025-11-25/);
    assert.match(result.stdout, /MCP SDK graph: unavailable/);
    assert.match(result.stdout, /MCP SDK lockfile: verified/);
    assert.match(result.stdout, /Pinned 2026-07-28 SDK handshake: NOT RUN/);
    result = await runProcess(process.execPath, [cli, 'uninstall', 'generic', ...common, '--descriptor', descriptor, '--purge'], { cwd: root });
    assert.equal(JSON.parse(result.stdout).purged, true);
  } finally {
    await cleanup(home);
  }
});

test('CLI rejects unknown commands with a non-zero exit', async () => {
  const home = await tempDir('veteran-cli-invalid-');
  try {
    const result = await runProcess(process.execPath, [cli, 'does-not-exist', '--home', home, '--distribution-root', root], { cwd: root, allowFailure: true });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Unknown command/);
  } finally {
    await cleanup(home);
  }
});
