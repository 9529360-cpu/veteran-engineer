import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runProcess } from '../src/git.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const handshake = path.join(root, 'scripts', 'mcp-handshake.mjs');
const server = path.join(root, 'mcp', 'server.mjs');

function hasPackage(name) {
  try {
    createRequire(import.meta.url).resolve(name);
    return true;
  } catch {
    return false;
  }
}

const officialSdkAvailable = hasPackage('@modelcontextprotocol/client')
  && hasPackage('@modelcontextprotocol/server')
  && hasPackage('@modelcontextprotocol/core')
  && hasPackage('zod');

test('repeated stateful modern handshakes succeed against the same persistent state root', { skip: !officialSdkAvailable }, async () => {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-mcp-persistent-state-'));
  const args = [
    handshake,
    '--server', server,
    '--mode', 'modern-pinned',
    '--require-sdk',
    '--require-server-sdk',
    '--stateful',
    '--expect-tools', '34',
    '--state-root', state
  ];
  try {
    const first = await runProcess(process.execPath, args, { cwd: root, timeoutMs: 45_000 });
    const second = await runProcess(process.execPath, args, { cwd: root, timeoutMs: 45_000 });
    const firstReport = JSON.parse(first.stdout.trim());
    const secondReport = JSON.parse(second.stdout.trim());

    assert.equal(firstReport.ok, true);
    assert.equal(secondReport.ok, true);
    assert.equal(firstReport.era, 'modern');
    assert.equal(secondReport.era, 'modern');
    assert.equal(firstReport.toolCount, 34);
    assert.equal(secondReport.toolCount, 34);
    assert.equal(firstReport.stateful.tool, 'project_open');
    assert.equal(secondReport.stateful.tool, 'project_open');
    assert.ok(firstReport.stateful.projectId);
    assert.ok(secondReport.stateful.projectId);
    assert.notEqual(firstReport.stateful.projectId, secondReport.stateful.projectId);
  } finally {
    await fs.rm(state, { recursive: true, force: true });
  }
});
