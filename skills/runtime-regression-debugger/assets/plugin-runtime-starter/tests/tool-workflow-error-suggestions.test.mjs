import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  TOOL_WORKFLOW_SUGGESTIONS_META_KEY,
  TOOL_WORKFLOW_SUGGESTIONS_SCHEMA,
  toolWorkflowErrorSuggestionsMeta
} from '../src/tool-workflow-suggestions.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const server = path.join(root, 'mcp', 'server.mjs');
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

function assertMissionAdvanceErrorSuggestions(meta, errorCode = 'MISSION_NOT_FOUND') {
  const projection = meta?.[TOOL_WORKFLOW_SUGGESTIONS_META_KEY];
  assert.equal(projection?.schema, TOOL_WORKFLOW_SUGGESTIONS_SCHEMA);
  assert.equal(projection?.sourceTool, 'mission_advance');
  assert.equal(projection?.sourceOutcome, 'error');
  assert.equal(projection?.sourceErrorCode, errorCode);
  assert.ok(projection.invocationPolicy.includes('Error outcomes have no authoritative structured result'));

  const status = projection.suggestions.find((item) => item.tool === 'mission_status' && item.kind === 'inspect');
  assert.ok(status);
  assert.deepEqual(status.arguments, { missionId: 'mission-missing' });
  assert.deepEqual(status.missingRequired, []);

  const readiness = projection.suggestions.find((item) => item.tool === 'mission_readiness' && item.kind === 'next');
  assert.ok(readiness);
  assert.deepEqual(readiness.arguments, { missionId: 'mission-missing' });
  assert.deepEqual(readiness.missingRequired, []);

  const remediation = projection.suggestions.find((item) => item.tool === 'remediation_plan' && item.kind === 'recover');
  assert.ok(remediation);
  assert.deepEqual(remediation.arguments, { missionId: 'mission-missing' });
  assert.deepEqual(remediation.missingRequired, ['requestId']);
  assert.equal(Object.hasOwn(remediation.arguments, 'requestId'), false);
}

function parseToolError(result) {
  const text = result?.content?.find((item) => item.type === 'text')?.text;
  return JSON.parse(text || '{}');
}

test('error workflow suggestions retain argument-derived scope without fabricating structured results', () => {
  const meta = toolWorkflowErrorSuggestionsMeta(
    'mission_advance',
    { requestId: 'old-request-id', missionId: 'mission-missing' },
    'RECONCILIATION_REQUIRED'
  );
  assertMissionAdvanceErrorSuggestions(meta, 'RECONCILIATION_REQUIRED');

  const projection = meta[TOOL_WORKFLOW_SUGGESTIONS_META_KEY];
  const evidence = projection.suggestions.find((item) => item.tool === 'evidence_query');
  assert.ok(evidence);
  assert.deepEqual(evidence.arguments, { missionId: 'mission-missing' });
  assert.equal(Object.hasOwn(evidence.arguments, 'ids'), false);
  assert.deepEqual(evidence.selections, []);
});

test('standalone fallback publishes workflow suggestions on tool errors and preserves unknown-tool behavior', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-tool-error-workflow-'));
  const child = spawn(process.execPath, [server], {
    cwd: root,
    env: { ...process.env, VETERAN_ENGINEER_STATE_DIR: stateRoot, VETERAN_MCP_FORCE_FALLBACK: '1' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  child.stdout.setEncoding('utf8');
  let buffer = '';
  let nextId = 1;
  const pending = new Map();
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (;;) {
      const index = buffer.indexOf('\n');
      if (index < 0) break;
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (!pending.has(message.id)) continue;
      const request = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    }
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 5000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  try {
    await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'error-workflow-test', version: '1.0.0' } });
    const failed = await request('tools/call', {
      name: 'mission_advance',
      arguments: { requestId: 'fallback-error-request', missionId: 'mission-missing' }
    });
    assert.equal(failed.isError, true);
    assert.equal(parseToolError(failed).code, 'MISSION_NOT_FOUND');
    assertMissionAdvanceErrorSuggestions(failed._meta);

    const unknown = await request('tools/call', { name: 'not_a_public_tool', arguments: {} });
    assert.equal(unknown.isError, true);
    assert.equal(parseToolError(unknown).code, 'TOOL_NOT_FOUND');
    assert.equal(unknown._meta, undefined);
  } finally {
    for (const item of pending.values()) clearTimeout(item.timer);
    child.stdin.end();
    child.kill('SIGTERM');
    await fs.rm(stateRoot, { recursive: true, force: true });
  }
});

test('official SDK preserves workflow suggestions on tool errors', { skip: !officialSdkAvailable }, async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-tool-error-workflow-sdk-'));
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/client'),
    import('@modelcontextprotocol/client/stdio')
  ]);
  const client = new Client({ name: 'error-workflow-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    cwd: root,
    env: { ...process.env, VETERAN_ENGINEER_STATE_DIR: stateRoot, VETERAN_MCP_REQUIRE_SDK: '1' },
    stderr: 'pipe'
  });
  try {
    await client.connect(transport);
    const failed = await client.callTool({
      name: 'mission_advance',
      arguments: { requestId: 'sdk-error-request', missionId: 'mission-missing' }
    });
    assert.equal(failed.isError, true);
    assert.equal(parseToolError(failed).code, 'MISSION_NOT_FOUND');
    assertMissionAdvanceErrorSuggestions(failed._meta);
  } finally {
    await client.close().catch(() => {});
    await fs.rm(stateRoot, { recursive: true, force: true });
  }
});
