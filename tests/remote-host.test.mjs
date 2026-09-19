import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { initRemoteHostConfig, rotateRemoteHostToken } from '../src/remote-host-config.mjs';
import { startRemoteHost } from '../src/remote-host-server.mjs';
import { TOOL_NAMES } from '../src/tool-catalog.mjs';
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

function structuredArray(result) {
  const structured = result?.structuredContent;
  const items = Array.isArray(structured) ? structured : structured?.result;
  assert.ok(Array.isArray(items), `Expected array structuredContent or legacy { result: [] } envelope: ${JSON.stringify(structured)}`);
  return items;
}

function requestWithHost(url, headers = {}) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: target.hostname,
      port: target.port,
      path: target.pathname,
      method: 'GET',
      headers
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('remote host config stores only a digest of the pairing token', async () => {
  const fixture = await createGitRepo();
  try {
    const configPath = path.join(fixture.root, 'remote-host.json');
    const initialized = await initRemoteHostConfig({
      configPath,
      stateRoot: fixture.stateRoot,
      workspaces: [fixture.root],
      port: 0
    });
    const raw = await fs.readFile(configPath, 'utf8');
    assert.equal(raw.includes(initialized.pairingToken), false);
    const parsed = JSON.parse(raw);
    assert.match(parsed.tokenSha256, /^[0-9a-f]{64}$/);
    assert.equal(parsed.allowedLocalRoots.length, 1);
  } finally {
    await cleanup(fixture.root);
  }
});

test('remote host exposes authenticated MCP while rejecting untrusted origins and hosts', { skip: !officialSdkAvailable }, async () => {
  const fixture = await createGitRepo({ files: { 'README.md': 'allowed\n' } });
  let running = null;
  try {
    const configPath = path.join(fixture.root, 'remote-host.json');
    const initialized = await initRemoteHostConfig({
      configPath,
      stateRoot: fixture.stateRoot,
      workspaces: [fixture.root],
      port: 0
    });
    running = await startRemoteHost({ configPath, port: 0 });
    const base = new URL(running.endpoint);
    const health = await fetch(running.healthEndpoint);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);

    const noAuth = await fetch(running.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(noAuth.status, 401);

    const originRejected = await fetch(new URL('/status', base), {
      headers: { Authorization: `Bearer ${initialized.pairingToken}`, Origin: 'https://evil.example' }
    });
    assert.equal(originRejected.status, 403);

    const hostRejected = await requestWithHost(new URL('/status', base), {
      Authorization: `Bearer ${initialized.pairingToken}`,
      Host: 'evil.example'
    });
    assert.equal(hostRejected.status, 421);

    const status = await fetch(new URL('/status', base), {
      headers: { Authorization: `Bearer ${initialized.pairingToken}` }
    });
    assert.equal(status.status, 200);
    const statusBody = await status.json();
    assert.equal(statusBody.deviceId, initialized.config.deviceId);
    assert.equal(statusBody.surfaceProfile, 'secure-tunnel');
  } finally {
    await running?.close().catch(() => {});
    await cleanup(fixture.root);
  }
});

test('running remote host rejects the old pairing token immediately after rotation', { skip: !officialSdkAvailable }, async () => {
  const fixture = await createGitRepo({ files: { 'README.md': 'allowed\n' } });
  let running = null;
  try {
    const configPath = path.join(fixture.root, 'remote-host.json');
    const initialized = await initRemoteHostConfig({
      configPath,
      stateRoot: fixture.stateRoot,
      workspaces: [fixture.root],
      port: 0
    });
    running = await startRemoteHost({ configPath, port: 0 });
    const base = new URL(running.endpoint);

    const before = await fetch(new URL('/status', base), {
      headers: { Authorization: `Bearer ${initialized.pairingToken}` }
    });
    assert.equal(before.status, 200);

    const rotated = await rotateRemoteHostToken(configPath);

    const oldStatus = await fetch(new URL('/status', base), {
      headers: { Authorization: `Bearer ${initialized.pairingToken}` }
    });
    assert.equal(oldStatus.status, 401);

    const oldMcp = await fetch(running.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${initialized.pairingToken}`,
        'content-type': 'application/json'
      },
      body: '{}'
    });
    assert.equal(oldMcp.status, 401);

    const newStatus = await fetch(new URL('/status', base), {
      headers: { Authorization: `Bearer ${rotated.pairingToken}` }
    });
    assert.equal(newStatus.status, 200);

    const newMcp = await fetch(running.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${rotated.pairingToken}`,
        'content-type': 'application/json'
      },
      body: '{}'
    });
    assert.notEqual(newMcp.status, 401);
  } finally {
    await running?.close().catch(() => {});
    await cleanup(fixture.root);
  }
});

test('official MCP client can use the same Veteran tools remotely and local paths are workspace-scoped', { skip: !officialSdkAvailable }, async () => {
  const allowed = await createGitRepo({ files: { 'README.md': 'allowed\n' } });
  const outside = await createGitRepo({ files: { 'README.md': 'outside\n' } });
  let running = null;
  let client = null;
  try {
    const configPath = path.join(allowed.root, 'remote-host.json');
    const initialized = await initRemoteHostConfig({
      configPath,
      stateRoot: allowed.stateRoot,
      workspaces: [allowed.root],
      port: 0
    });
    running = await startRemoteHost({ configPath, port: 0 });
    const [{ Client, StreamableHTTPClientTransport }] = await Promise.all([
      import('@modelcontextprotocol/client')
    ]);
    client = new Client({ name: 'veteran-remote-host-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(running.endpoint), {
      requestInit: { headers: { Authorization: `Bearer ${initialized.pairingToken}` } }
    });
    await client.connect(transport);

    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [...TOOL_NAMES].sort());

    const opened = await client.callTool({
      name: 'project_open',
      arguments: { requestId: crypto.randomUUID(), repoPath: allowed.repo }
    });
    assert.equal(opened.isError, undefined);
    assert.ok(opened.structuredContent);

    const screenshotBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZK1sAAAAASUVORK5CYII=', 'base64');
    const evidence = await running.app.services.evidenceService.record({
      projectId: opened.structuredContent.id,
      type: 'remote-image-proof',
      summary: 'Synthetic one-pixel screenshot for MCP image-content transport proof.',
      attachments: [{
        name: 'synthetic.png',
        kind: 'browser-screenshot',
        content: screenshotBytes
      }]
    });

    const metadataOnly = await client.callTool({
      name: 'evidence_query',
      arguments: { projectId: opened.structuredContent.id, ids: [evidence.id] }
    });
    assert.equal(metadataOnly.isError, undefined);
    assert.equal(metadataOnly.content.some((item) => item.type === 'image'), false);

    const broadImageRequest = await client.callTool({
      name: 'evidence_query',
      arguments: { projectId: opened.structuredContent.id, includeImages: true }
    });
    assert.equal(broadImageRequest.isError, true);
    assert.match(broadImageRequest.content?.[0]?.text || '', /EVIDENCE_IMAGE_IDS_REQUIRED/);

    const duplicateImageRequest = await client.callTool({
      name: 'evidence_query',
      arguments: { projectId: opened.structuredContent.id, ids: [evidence.id, evidence.id], includeImages: true }
    });
    assert.equal(duplicateImageRequest.isError, true);
    assert.match(duplicateImageRequest.content?.[0]?.text || '', /EVIDENCE_IMAGE_IDS_DUPLICATE/);

    const withImage = await client.callTool({
      name: 'evidence_query',
      arguments: { projectId: opened.structuredContent.id, ids: [evidence.id], includeImages: true, maxImages: 1 }
    });
    assert.equal(withImage.isError, undefined, JSON.stringify(withImage));
    const imageBlocks = withImage.content.filter((item) => item.type === 'image');
    assert.equal(imageBlocks.length, 1);
    assert.equal(imageBlocks[0].mimeType, 'image/png');
    assert.deepEqual(Buffer.from(imageBlocks[0].data, 'base64'), screenshotBytes);
    const structuredEvidence = structuredArray(withImage);
    assert.equal(structuredEvidence[0].id, evidence.id);
    assert.equal(structuredEvidence[0].attachments[0].artifactHash, evidence.attachments[0].artifactHash);
    assert.equal(Object.hasOwn(structuredEvidence[0].attachments[0], 'data'), false);

    await fs.writeFile(path.join(allowed.stateRoot, evidence.attachments[0].artifactPointer), Buffer.from('tampered'));
    const tampered = await client.callTool({
      name: 'evidence_query',
      arguments: { projectId: opened.structuredContent.id, ids: [evidence.id], includeImages: true }
    });
    assert.equal(tampered.isError, true);
    assert.match(tampered.content?.[0]?.text || '', /EVIDENCE_IMAGE_INTEGRITY_MISMATCH/);

    const rejected = await client.callTool({
      name: 'project_open',
      arguments: { requestId: crypto.randomUUID(), repoPath: outside.repo }
    });
    assert.equal(rejected.isError, true);
    assert.match(rejected.content?.[0]?.text || '', /REMOTE_WORKSPACE_NOT_ALLOWED/);

    // A shared durable state root may already contain projects that were opened
    // locally before Remote Host starts. The remote token must not bypass the
    // configured workspace roots merely by reusing one of those stable ids.
    const broadEvidenceQuery = await client.callTool({
      name: 'evidence_query',
      arguments: {}
    });
    assert.equal(broadEvidenceQuery.isError, true, JSON.stringify(broadEvidenceQuery));
    assert.match(broadEvidenceQuery.content?.[0]?.text || '', /REMOTE_PROJECT_SCOPE_REQUIRED/);

    const emptyEvidenceQuery = await client.callTool({
      name: 'evidence_query',
      arguments: { ids: [] }
    });
    assert.equal(emptyEvidenceQuery.isError, undefined, JSON.stringify(emptyEvidenceQuery));
    assert.equal(structuredArray(emptyEvidenceQuery).length, 0);

    const integrityBlocked = await client.callTool({
      name: 'runtime_integrity',
      arguments: {}
    });
    assert.equal(integrityBlocked.isError, true, JSON.stringify(integrityBlocked));
    assert.match(integrityBlocked.content?.[0]?.text || '', /REMOTE_WORKSPACE_NOT_ALLOWED/);

    const cleanupBlocked = await client.callTool({
      name: 'runtime_cleanup',
      arguments: { requestId: crypto.randomUUID(), apply: false }
    });
    assert.equal(cleanupBlocked.isError, true, JSON.stringify(cleanupBlocked));
    assert.match(cleanupBlocked.content?.[0]?.text || '', /REMOTE_WORKSPACE_NOT_ALLOWED/);

    const preexistingOutside = await running.app.services.projectService.open({ repoPath: outside.repo });

    const allowedSnapshot = await client.callTool({
      name: 'project_snapshot',
      arguments: { requestId: crypto.randomUUID(), projectId: opened.structuredContent.id }
    });
    assert.equal(allowedSnapshot.isError, undefined, JSON.stringify(allowedSnapshot));

    const outsideSnapshot = await client.callTool({
      name: 'project_snapshot',
      arguments: { requestId: crypto.randomUUID(), projectId: preexistingOutside.id }
    });
    assert.equal(outsideSnapshot.isError, true, JSON.stringify(outsideSnapshot));
    assert.match(outsideSnapshot.content?.[0]?.text || '', /REMOTE_WORKSPACE_NOT_ALLOWED/);

    const outsideEvidence = await running.app.services.evidenceService.record({
      projectId: preexistingOutside.id,
      type: 'outside-proof',
      summary: 'Must remain unreachable through the Remote Host token.'
    });
    const outsideEvidenceQuery = await client.callTool({
      name: 'evidence_query',
      arguments: { ids: [outsideEvidence.id] }
    });
    assert.equal(outsideEvidenceQuery.isError, true, JSON.stringify(outsideEvidenceQuery));
    assert.match(outsideEvidenceQuery.content?.[0]?.text || '', /REMOTE_WORKSPACE_NOT_ALLOWED/);
  } finally {
    await client?.close().catch(() => {});
    await running?.close().catch(() => {});
    await cleanup(allowed.root);
    await cleanup(outside.root);
  }
});
