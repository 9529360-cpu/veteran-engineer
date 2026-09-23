import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { initRemoteHostConfig } from '../src/remote-host-config.mjs';
import { startRemoteHost } from '../src/remote-host-server.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

const officialSdkAvailable = (() => {
  const require = createRequire(import.meta.url);
  try {
    require.resolve('@modelcontextprotocol/client');
    require.resolve('@modelcontextprotocol/server');
    require.resolve('@modelcontextprotocol/core');
    require.resolve('zod');
    return true;
  } catch {
    return false;
  }
})();

test('Remote Host exposes opt-in machine inspect/action through the real MCP surface', { skip: !officialSdkAvailable }, async () => {
  const fixture = await createGitRepo({ files: { 'README.md': 'machine bridge\n' } });
  let running = null;
  let client = null;
  try {
    const configPath = path.join(fixture.root, 'remote-host.json');
    const initialized = await initRemoteHostConfig({
      configPath,
      stateRoot: fixture.stateRoot,
      workspaces: [fixture.root],
      machineActions: { enabled: true, allowedExecutables: ['node'] },
      port: 0
    });
    running = await startRemoteHost({ configPath, port: 0 });

    const [{ Client, StreamableHTTPClientTransport }] = await Promise.all([
      import('@modelcontextprotocol/client')
    ]);
    client = new Client({ name: 'veteran-machine-actions-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(running.endpoint), {
      requestInit: { headers: { Authorization: 'Bearer ' + initialized.pairingToken } }
    });
    await client.connect(transport);

    const status = await client.callTool({ name: 'machine_inspect', arguments: { operation: 'status' } });
    assert.equal(status.isError, undefined, JSON.stringify(status));
    assert.equal(status.structuredContent.enabled, true);
    assert.equal(status.structuredContent.device.id, initialized.config.deviceId);

    const target = path.join(fixture.root, 'machine.txt');
    const write = await client.callTool({
      name: 'machine_act',
      arguments: { requestId: crypto.randomUUID(), operation: 'fs.write', path: target, content: 'remote-machine-ok\n' }
    });
    assert.equal(write.isError, undefined, JSON.stringify(write));

    const read = await client.callTool({ name: 'machine_inspect', arguments: { operation: 'fs.read', path: target } });
    assert.equal(read.isError, undefined, JSON.stringify(read));
    assert.equal(read.structuredContent.data, 'remote-machine-ok\n');

    const run = await client.callTool({
      name: 'machine_act',
      arguments: {
        requestId: crypto.randomUUID(),
        operation: 'process.start',
        command: 'node',
        args: ['-e', 'process.stdout.write("remote-process-ok")'],
        cwd: fixture.root,
        timeoutMs: 10_000
      }
    });
    assert.equal(run.isError, undefined, JSON.stringify(run));
    assert.equal(run.structuredContent.exitCode, 0);
    assert.equal(run.structuredContent.stdout, 'remote-process-ok');

    const outside = path.join(path.dirname(fixture.root), 'outside-machine-actions.txt');
    await fs.writeFile(outside, 'outside');
    const denied = await client.callTool({ name: 'machine_inspect', arguments: { operation: 'fs.read', path: outside } });
    assert.equal(denied.isError, true);
    assert.match(denied.content?.[0]?.text || '', /REMOTE_WORKSPACE_NOT_ALLOWED/);
    await fs.rm(outside, { force: true });
  } finally {
    await client?.close().catch(() => {});
    await running?.close().catch(() => {});
    await cleanup(fixture.root);
  }
});
