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
  toolWorkflowSuggestions,
  toolWorkflowSuggestionsMeta
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

function suggestion(sourceTool, targetTool, kind, args, result) {
  return toolWorkflowSuggestions(sourceTool, args, result).suggestions.find((item) => item.tool === targetTool && item.kind === kind);
}

function assertRuntimeHealthSuggestions(meta) {
  const projection = meta?.[TOOL_WORKFLOW_SUGGESTIONS_META_KEY];
  assert.equal(projection?.schema, TOOL_WORKFLOW_SUGGESTIONS_SCHEMA);
  assert.equal(projection?.sourceTool, 'runtime_health');
  assert.equal(typeof projection?.invocationPolicy, 'string');
  assert.ok(projection.invocationPolicy.includes('never treat a suggestion as authorization'));
  const integrity = projection.suggestions.find((item) => item.tool === 'runtime_integrity');
  assert.ok(integrity);
  assert.deepEqual(integrity.arguments, {});
  assert.deepEqual(integrity.missingRequired, []);
  assert.equal(integrity.argumentsComplete, true);
}

test('workflow suggestions resolve safe identity bindings into partial next-call arguments', () => {
  let next = suggestion('project_open', 'mission_plan', 'next', {}, { id: 'project-1' });
  assert.deepEqual(next.arguments, { projectId: 'project-1' });
  assert.deepEqual(next.missingRequired, ['requestId', 'goal', 'doneDefinition']);
  assert.equal(next.argumentsComplete, false);
  assert.equal(typeof next.when, 'string');

  next = suggestion('mission_plan', 'mission_execute', 'next', {}, { mission: { id: 'mission-1', projectId: 'project-1' }, tasks: [] });
  assert.deepEqual(next.arguments, { missionId: 'mission-1' });
  assert.deepEqual(next.missingRequired, ['requestId']);

  next = suggestion('mission_status', 'mission_readiness', 'next', { missionId: 'ignored-input' }, {
    mission: { id: 'mission-current', projectId: 'project-1', activeCandidateId: null },
    tasks: [], candidates: [], mergeProposals: []
  });
  assert.deepEqual(next.arguments, { missionId: 'mission-current' });
  assert.deepEqual(next.missingRequired, []);
  assert.equal(next.argumentsComplete, true);
});

test('workflow suggestions do not invent missing selected identities or request ids', () => {
  let next = suggestion('mission_execute', 'worker_retry', 'recover', { requestId: 'old-request', missionId: 'mission-1' }, {
    missionId: 'mission-1', phase: 'execution', status: 'blocked', results: [], deferredTaskIds: []
  });
  assert.deepEqual(next.arguments, { missionId: 'mission-1' });
  assert.deepEqual(next.missingRequired, ['requestId', 'taskId']);
  assert.equal(Object.hasOwn(next.arguments, 'requestId'), false);
  assert.equal(Object.hasOwn(next.arguments, 'taskId'), false);

  next = suggestion('candidate_preflight', 'candidate_status', 'inspect', { missionId: 'mission-1' }, {
    missionId: 'mission-1', candidateId: null, ready: false, sourceDrift: true
  });
  assert.deepEqual(next.arguments, { missionId: 'mission-1' });
  assert.equal(Object.hasOwn(next.arguments, 'candidateId'), false);

  const meta = toolWorkflowSuggestionsMeta('experience_commit', { requestId: 'old-request' }, {
    id: 'experience-1', projectId: 'project-1', mechanism: 'x', statement: 'y', status: 'candidate', evidenceIds: [], freshness: 'fresh'
  });
  const review = meta[TOOL_WORKFLOW_SUGGESTIONS_META_KEY].suggestions.find((item) => item.tool === 'experience_review');
  assert.deepEqual(review.arguments, { experienceId: 'experience-1' });
  assert.deepEqual(review.missingRequired, ['requestId', 'action']);
});

test('standalone fallback publishes dynamic workflow suggestions on successful tool calls', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-tool-workflow-suggestions-'));
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
    await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'workflow-suggestions-test', version: '1.0.0' } });
    const called = await request('tools/call', { name: 'runtime_health', arguments: {} });
    assert.equal(called.isError, undefined);
    assertRuntimeHealthSuggestions(called._meta);
  } finally {
    for (const item of pending.values()) clearTimeout(item.timer);
    child.stdin.end();
    child.kill('SIGTERM');
    await fs.rm(stateRoot, { recursive: true, force: true });
  }
});

test('official SDK publishes the same dynamic workflow suggestions', { skip: !officialSdkAvailable }, async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-tool-workflow-suggestions-sdk-'));
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/client'),
    import('@modelcontextprotocol/client/stdio')
  ]);
  const client = new Client({ name: 'workflow-suggestions-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    cwd: root,
    env: { ...process.env, VETERAN_ENGINEER_STATE_DIR: stateRoot, VETERAN_MCP_REQUIRE_SDK: '1' },
    stderr: 'pipe'
  });
  try {
    await client.connect(transport);
    const called = await client.callTool({ name: 'runtime_health', arguments: {} });
    assertRuntimeHealthSuggestions(called._meta);
  } finally {
    await client.close().catch(() => {});
    await fs.rm(stateRoot, { recursive: true, force: true });
  }
});
