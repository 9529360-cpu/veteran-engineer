import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { initRemoteHostConfig } from '../src/remote-host-config.mjs';
import { TOOL_NAMES } from '../src/tool-catalog.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const remoteHostCli = path.resolve(here, '..', 'bin', 'veteran-remote-host.mjs');

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

test('secure tunnel stdio exposes the same allowlisted Veteran MCP surface without HTTP authentication', { skip: !officialSdkAvailable }, async () => {
  const allowed = await createGitRepo({ files: { 'README.md': 'allowed through tunnel\n' } });
  const outside = await createGitRepo({ files: { 'README.md': 'outside tunnel workspace\n' } });
  let client = null;
  try {
    const configPath = path.join(allowed.root, 'remote-host.json');
    await initRemoteHostConfig({
      configPath,
      stateRoot: allowed.stateRoot,
      workspaces: [allowed.root],
      port: 0
    });

    const [{ Client }, { StdioClientTransport }] = await Promise.all([
      import('@modelcontextprotocol/client'),
      import('@modelcontextprotocol/client/stdio')
    ]);
    client = new Client({ name: 'veteran-secure-tunnel-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [remoteHostCli, 'tunnel-stdio', '--config', configPath],
      env: process.env,
      stderr: 'pipe'
    });
    await client.connect(transport);

    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [...TOOL_NAMES].sort());

    const health = await client.callTool({ name: 'runtime_health', arguments: {} });
    const healthPayload = JSON.parse(health.content?.[0]?.text || '{}');
    assert.equal(healthPayload.surface?.id, 'secure-tunnel');

    const opened = await client.callTool({
      name: 'project_open',
      arguments: { requestId: crypto.randomUUID(), repoPath: allowed.repo }
    });
    assert.equal(opened.isError, undefined);
    assert.ok(opened.structuredContent);

    const rejectedPath = await client.callTool({
      name: 'project_open',
      arguments: { requestId: crypto.randomUUID(), repoPath: outside.repo }
    });
    assert.equal(rejectedPath.isError, true);
    assert.match(rejectedPath.content?.[0]?.text || '', /REMOTE_WORKSPACE_NOT_ALLOWED/);

    const rejectedFileUrl = await client.callTool({
      name: 'project_open',
      arguments: { requestId: crypto.randomUUID(), repoUrl: pathToFileURL(outside.repo).href }
    });
    assert.equal(rejectedFileUrl.isError, true);
    assert.match(rejectedFileUrl.content?.[0]?.text || '', /REMOTE_WORKSPACE_NOT_ALLOWED/);
  } finally {
    await client?.close().catch(() => {});
    await cleanup(allowed.root);
    await cleanup(outside.root);
  }
});
