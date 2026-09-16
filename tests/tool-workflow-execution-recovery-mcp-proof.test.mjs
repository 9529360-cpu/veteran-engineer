import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { TOOL_WORKFLOW_SUGGESTIONS_META_KEY } from '../src/tool-workflow-suggestions.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

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

function recoverySuggestion(meta, targetTool) {
  return meta?.[TOOL_WORKFLOW_SUGGESTIONS_META_KEY]?.suggestions
    ?.find((item) => item.tool === targetTool && item.kind === 'recover');
}

async function seedExecutionMission(kind) {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'a\n', 'src/b.txt': 'b\n' } });
  const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
  const project = await app.callTool('project_open', {
    requestId: `execution-recovery-${kind}-open`,
    repoPath: fixture.repo
  });
  const tasks = kind === 'cancel'
    ? [{ id: 'T-active', contract: 'own src/a.txt', owner: 'src/a.txt', dependencies: [], writeSet: ['src/a.txt'], risk: 'low' }]
    : [
        { id: 'T-failed', contract: 'own src/a.txt', owner: 'src/a.txt', dependencies: [], writeSet: ['src/a.txt'], risk: 'low' },
        { id: 'T-cancelled', contract: 'own src/b.txt', owner: 'src/b.txt', dependencies: [], writeSet: ['src/b.txt'], risk: 'low' }
      ];
  const planned = await app.callTool('mission_plan', {
    requestId: `execution-recovery-${kind}-plan`,
    projectId: project.id,
    goal: `prove mission_execute ${kind} recovery workflow metadata through the real MCP path`,
    doneDefinition: 'execution recovery suggestions preserve explicit task selection and caller-generated request identity',
    tasks
  });
  const missionId = planned.mission.id;

  if (kind === 'cancel') {
    const prepared = await app.callTool('mission_execute', {
      requestId: 'execution-recovery-cancel-prepare',
      missionId,
      runWorkers: false
    });
    assert.equal(prepared.dispatched.length, 1);
    await app.store.transaction('test_seed_execution_recovery_active', (state) => {
      state.tasks[`${missionId}:T-active`].status = 'executing';
      state.missions[missionId].status = 'executing';
    }, { missionId });
  } else {
    await app.store.transaction('test_seed_execution_recovery_retry', (state) => {
      state.tasks[`${missionId}:T-failed`].status = 'failed';
      state.tasks[`${missionId}:T-cancelled`].status = 'cancelled';
      state.missions[missionId].status = 'blocked';
    }, { missionId });
  }

  return { fixture, missionId };
}

async function callThroughFallback(kind) {
  const { fixture, missionId } = await seedExecutionMission(kind);
  const child = spawn(process.execPath, [server], {
    cwd: root,
    env: { ...process.env, VETERAN_ENGINEER_STATE_DIR: fixture.stateRoot, VETERAN_MCP_FORCE_FALLBACK: '1' },
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
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 10_000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

  try {
    await request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'workflow-execution-recovery-mcp-proof', version: '1.0.0' }
    });
    const called = await request('tools/call', {
      name: 'mission_execute',
      arguments: {
        requestId: `execution-recovery-${kind}-fallback-call`,
        missionId,
        runWorkers: false
      }
    });
    assert.equal(called.isError, undefined, JSON.stringify(called));
    return { called, missionId };
  } finally {
    for (const item of pending.values()) clearTimeout(item.timer);
    child.stdin.end();
    child.kill('SIGTERM');
    await cleanup(fixture.root);
  }
}

async function callThroughSdk(kind) {
  const { fixture, missionId } = await seedExecutionMission(kind);
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/client'),
    import('@modelcontextprotocol/client/stdio')
  ]);
  const client = new Client({ name: 'workflow-execution-recovery-sdk-proof', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    cwd: root,
    env: { ...process.env, VETERAN_ENGINEER_STATE_DIR: fixture.stateRoot, VETERAN_MCP_REQUIRE_SDK: '1' },
    stderr: 'pipe'
  });
  try {
    await client.connect(transport);
    const called = await client.callTool({
      name: 'mission_execute',
      arguments: {
        requestId: `execution-recovery-${kind}-sdk-call`,
        missionId,
        runWorkers: false
      }
    });
    assert.notEqual(called.isError, true, JSON.stringify(called));
    return { called, missionId };
  } finally {
    await client.close().catch(() => {});
    await cleanup(fixture.root);
  }
}

function assertCancelProjection(called, missionId) {
  const projection = called._meta?.[TOOL_WORKFLOW_SUGGESTIONS_META_KEY];
  assert.equal(projection?.sourceTool, 'mission_execute');
  assert.equal(projection?.sourceOutcome, 'success');

  const cancel = recoverySuggestion(called._meta, 'worker_cancel');
  assert.ok(cancel);
  assert.deepEqual(cancel.arguments, { missionId });
  assert.deepEqual(cancel.selections[0].candidates, ['T-active']);
  assert.deepEqual(cancel.readiness, {
    readyAfterCallerGenerated: false,
    callerGeneratedRequired: ['requestId'],
    conditionalRequired: [],
    resultRequired: [],
    selectionRequired: ['taskId'],
    selectionUnavailable: [],
    inputRequired: []
  });
  assert.equal(Object.hasOwn(cancel.arguments, 'taskId'), false);
  assert.equal(Object.hasOwn(cancel.arguments, 'requestId'), false);

  const retry = recoverySuggestion(called._meta, 'worker_retry');
  assert.ok(retry);
  assert.deepEqual(retry.arguments, { missionId });
  assert.deepEqual(retry.selections[0].candidates, []);
  assert.deepEqual(retry.readiness.selectionUnavailable, ['taskId']);
}

function assertRetryProjection(called, missionId) {
  const projection = called._meta?.[TOOL_WORKFLOW_SUGGESTIONS_META_KEY];
  assert.equal(projection?.sourceTool, 'mission_execute');
  assert.equal(projection?.sourceOutcome, 'success');

  const retry = recoverySuggestion(called._meta, 'worker_retry');
  assert.ok(retry);
  assert.deepEqual(retry.arguments, { missionId });
  assert.deepEqual(retry.selections[0].candidates, ['T-cancelled', 'T-failed']);
  assert.deepEqual(retry.readiness, {
    readyAfterCallerGenerated: false,
    callerGeneratedRequired: ['requestId'],
    conditionalRequired: [],
    resultRequired: [],
    selectionRequired: ['taskId'],
    selectionUnavailable: [],
    inputRequired: []
  });
  assert.equal(Object.hasOwn(retry.arguments, 'taskId'), false);
  assert.equal(Object.hasOwn(retry.arguments, 'requestId'), false);

  const cancel = recoverySuggestion(called._meta, 'worker_cancel');
  assert.ok(cancel);
  assert.deepEqual(cancel.arguments, { missionId });
  assert.deepEqual(cancel.selections[0].candidates, []);
  assert.deepEqual(cancel.readiness.selectionUnavailable, ['taskId']);
}

test('fallback MCP mission_execute exposes only active worker cancellation candidates', async () => {
  const { called, missionId } = await callThroughFallback('cancel');
  assertCancelProjection(called, missionId);
});

test('official SDK mission_execute exposes the same active worker cancellation candidates', { skip: !officialSdkAvailable }, async () => {
  const { called, missionId } = await callThroughSdk('cancel');
  assertCancelProjection(called, missionId);
});

test('fallback MCP mission_execute exposes only failed/cancelled retry candidates', async () => {
  const { called, missionId } = await callThroughFallback('retry');
  assertRetryProjection(called, missionId);
});

test('official SDK mission_execute exposes the same failed/cancelled retry candidates', { skip: !officialSdkAvailable }, async () => {
  const { called, missionId } = await callThroughSdk('retry');
  assertRetryProjection(called, missionId);
});
