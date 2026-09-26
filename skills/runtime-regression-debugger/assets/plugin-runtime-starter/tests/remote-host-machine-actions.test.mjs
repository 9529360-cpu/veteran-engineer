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

    const repoStatus = await client.callTool({
      name: 'machine_inspect',
      arguments: { operation: 'repo.status', path: fixture.repo }
    });
    assert.equal(repoStatus.isError, undefined, JSON.stringify(repoStatus));
    assert.equal(repoStatus.structuredContent.repository.head, fixture.head);
    assert.equal(repoStatus.structuredContent.repository.dirty, false);

    const target = path.join(fixture.repo, 'machine.txt');
    const writeRequestId = crypto.randomUUID();
    const writeArguments = {
      requestId: writeRequestId,
      operation: 'fs.write',
      path: target,
      content: 'remote-machine-ok\n',
      requireAbsent: true,
      expectedRepoHead: repoStatus.structuredContent.repository.head
    };
    const write = await client.callTool({ name: 'machine_act', arguments: writeArguments });
    assert.equal(write.isError, undefined, JSON.stringify(write));
    assert.equal(write.structuredContent.receipt.contract, 'veteran-machine-action-receipt-v1');
    assert.equal(write.structuredContent.receipt.requestId, writeRequestId);
    assert.equal(write.structuredContent.receipt.repository.head, fixture.head);
    assert.match(write.structuredContent.afterSha256, /^[0-9a-f]{64}$/);

    const replay = await client.callTool({ name: 'machine_act', arguments: writeArguments });
    assert.equal(replay.isError, undefined, JSON.stringify(replay));
    assert.equal(replay.structuredContent.receipt.actionId, write.structuredContent.receipt.actionId);
    assert.equal(replay.structuredContent.afterSha256, write.structuredContent.afterSha256);

    const replace = await client.callTool({
      name: 'machine_act',
      arguments: {
        requestId: crypto.randomUUID(),
        operation: 'fs.replace',
        path: target,
        oldText: 'remote-machine-ok\n',
        newText: 'remote-machine-edited\n',
        expectedOccurrences: 1,
        expectedSha256: write.structuredContent.afterSha256,
        expectedRepoHead: fixture.head
      }
    });
    assert.equal(replace.isError, undefined, JSON.stringify(replace));
    assert.equal(replace.structuredContent.replacements, 1);
    assert.equal(replace.structuredContent.receipt.repository.head, fixture.head);

    const read = await client.callTool({ name: 'machine_inspect', arguments: { operation: 'fs.read', path: target } });
    assert.equal(read.isError, undefined, JSON.stringify(read));
    assert.equal(read.structuredContent.data, 'remote-machine-edited\n');

    const trackedReadme = path.join(fixture.repo, 'README.md');
    const trackedDigest = await client.callTool({
      name: 'machine_inspect',
      arguments: { operation: 'fs.digest', path: trackedReadme }
    });
    assert.equal(trackedDigest.isError, undefined, JSON.stringify(trackedDigest));
    const trackedEdit = await client.callTool({
      name: 'machine_act',
      arguments: {
        requestId: crypto.randomUUID(),
        operation: 'fs.replace',
        path: trackedReadme,
        oldText: 'machine bridge\n',
        newText: 'machine bridge edited\n',
        expectedOccurrences: 1,
        expectedSha256: trackedDigest.structuredContent.digest,
        expectedRepoHead: fixture.head
      }
    });
    assert.equal(trackedEdit.isError, undefined, JSON.stringify(trackedEdit));

    const diff = await client.callTool({
      name: 'machine_inspect',
      arguments: { operation: 'repo.diff', path: trackedReadme }
    });
    assert.equal(diff.isError, undefined, JSON.stringify(diff));
    assert.equal(diff.structuredContent.scope, 'README.md');
    assert.match(diff.structuredContent.patch, /\+machine bridge edited/);
    assert.doesNotMatch(diff.structuredContent.patch, /remote-machine-edited/);

    const run = await client.callTool({
      name: 'machine_act',
      arguments: {
        requestId: crypto.randomUUID(),
        operation: 'process.start',
        command: 'node',
        args: ['-e', 'process.stdout.write("remote-process-ok")'],
        cwd: fixture.repo,
        expectedRepoHead: fixture.head,
        timeoutMs: 10_000
      }
    });
    assert.equal(run.isError, undefined, JSON.stringify(run));
    assert.equal(run.structuredContent.exitCode, 0);
    assert.equal(run.structuredContent.stdout, 'remote-process-ok');
    assert.equal(run.structuredContent.outputComplete, true);
    assert.equal(run.structuredContent.outputDigestContract, 'veteran-process-output-digest-v1');
    assert.equal(run.structuredContent.stdoutBytes, Buffer.byteLength('remote-process-ok'));
    assert.equal(run.structuredContent.stderrBytes, 0);
    assert.match(run.structuredContent.stdoutSha256, /^[0-9a-f]{64}$/);
    assert.match(run.structuredContent.stderrSha256, /^[0-9a-f]{64}$/);
    assert.match(run.structuredContent.outputSha256, /^[0-9a-f]{64}$/);
    assert.equal(run.structuredContent.receipt.contract, 'veteran-machine-action-receipt-v1');

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
