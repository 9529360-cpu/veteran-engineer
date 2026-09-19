import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { initRemoteHostConfig } from '../src/remote-host-config.mjs';
import { startRemoteHost } from '../src/remote-host-server.mjs';
import { cleanup, tempDir } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const mcpServer = path.resolve(here, '..', 'mcp', 'server.mjs');
const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXcAAAAASUVORK5CYII=', 'base64');

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

async function seedImageEvidence(stateRoot) {
  const app = await createVeteranApp({ stateRoot });
  const evidence = await app.services.evidenceService.record({
    projectId: 'project-image-evidence',
    type: 'browser-validation',
    summary: 'bounded screenshot evidence',
    attachments: [{ name: 'fullstack.png', kind: 'browser-screenshot', content: PNG_BYTES }]
  });
  return { app, evidence };
}

function assertImageResult(result, evidenceId) {
  assert.equal(result.isError, undefined);
  assert.ok(Array.isArray(result.structuredContent));
  assert.equal(result.structuredContent[0]?.id, evidenceId);
  const image = result.content?.find((item) => item.type === 'image');
  assert.ok(image, 'MCP result did not include image content');
  assert.equal(image.mimeType, 'image/png');
  assert.deepEqual(Buffer.from(image.data, 'base64'), PNG_BYTES);
  const text = result.content?.find((item) => item.type === 'text');
  assert.ok(text);
  assert.equal(text.text.includes(PNG_BYTES.toString('base64')), false, 'structured/text metadata must not duplicate image bytes');
}

test('local official MCP projects exact evidence PNG attachments as opt-in image content', { skip: !officialSdkAvailable }, async () => {
  const root = await tempDir('veteran-evidence-image-local-');
  let client = null;
  try {
    const stateRoot = path.join(root, 'state');
    const { app, evidence } = await seedImageEvidence(stateRoot);
    const [{ Client }, { StdioClientTransport }] = await Promise.all([
      import('@modelcontextprotocol/client'),
      import('@modelcontextprotocol/client/stdio')
    ]);
    client = new Client({ name: 'veteran-evidence-image-local-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [mcpServer],
      env: {
        ...process.env,
        VETERAN_ENGINEER_STATE_DIR: stateRoot,
        VETERAN_MCP_REQUIRE_SDK: '1'
      },
      stderr: 'pipe'
    });
    await client.connect(transport);

    const metadataOnly = await client.callTool({
      name: 'evidence_query',
      arguments: { ids: [evidence.id] }
    });
    assert.equal(metadataOnly.content?.some((item) => item.type === 'image'), false);

    const projected = await client.callTool({
      name: 'evidence_query',
      arguments: { ids: [evidence.id], includeImageAttachments: true }
    });
    assertImageResult(projected, evidence.id);

    const broad = await client.callTool({
      name: 'evidence_query',
      arguments: { projectId: evidence.projectId, includeImageAttachments: true }
    });
    assert.equal(broad.isError, true);
    assert.match(broad.content?.[0]?.text || '', /EVIDENCE_IMAGE_IDS_REQUIRED/);

    const attachment = evidence.attachments[0];
    const filename = path.basename(attachment.artifactPointer);
    await fs.writeFile(path.join(app.services.evidenceService.store.artifactsDir, filename), Buffer.from('tampered'));
    const tampered = await client.callTool({
      name: 'evidence_query',
      arguments: { ids: [evidence.id], includeImageAttachments: true }
    });
    assert.equal(tampered.isError, true);
    assert.match(tampered.content?.[0]?.text || '', /EVIDENCE_IMAGE_INTEGRITY_MISMATCH/);
  } finally {
    await client?.close().catch(() => {});
    await cleanup(root);
  }
});

test('authenticated Remote Host MCP uses the same bounded image projection', { skip: !officialSdkAvailable }, async () => {
  const root = await tempDir('veteran-evidence-image-remote-');
  const workspace = path.join(root, 'workspace');
  const stateRoot = path.join(root, 'state');
  const configPath = path.join(root, 'remote-host.json');
  let running = null;
  let client = null;
  try {
    await fs.mkdir(workspace, { recursive: true });
    const { evidence } = await seedImageEvidence(stateRoot);
    const initialized = await initRemoteHostConfig({
      configPath,
      stateRoot,
      workspaces: [workspace],
      port: 0
    });
    running = await startRemoteHost({ configPath, port: 0 });
    const [{ Client, StreamableHTTPClientTransport }] = await Promise.all([
      import('@modelcontextprotocol/client')
    ]);
    client = new Client({ name: 'veteran-evidence-image-remote-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(running.endpoint), {
      requestInit: { headers: { Authorization: `Bearer ${initialized.pairingToken}` } }
    });
    await client.connect(transport);

    const projected = await client.callTool({
      name: 'evidence_query',
      arguments: { ids: [evidence.id], includeImageAttachments: true }
    });
    assertImageResult(projected, evidence.id);
  } finally {
    await client?.close().catch(() => {});
    await running?.close().catch(() => {});
    await cleanup(root);
  }
});
