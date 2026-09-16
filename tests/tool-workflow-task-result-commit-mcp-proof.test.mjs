import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
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

function commitSuggestion(meta) {
  return meta?.[TOOL_WORKFLOW_SUGGESTIONS_META_KEY]?.suggestions
    ?.find((item) => item.tool === 'task_result_commit' && item.kind === 'next');
}

function assertDispatchedSuggestion(suggestion, missionId) {
  assert.ok(suggestion);
  assert.equal(suggestion.applicability.state, 'applicable');
  assert.deepEqual(suggestion.applicability.condition, {
    source: 'structuredContent',
    pointer: '/mission/status',
    operator: 'not-equals',
    value: 'cancelled'
  });
  assert.deepEqual(suggestion.arguments, { missionId });
  assert.deepEqual(suggestion.missingRequired, ['requestId', 'taskId']);
  assert.equal(suggestion.argumentsComplete, false);
  assert.deepEqual(suggestion.selections[0].candidates, ['T-external']);
  assert.deepEqual(suggestion.readiness, {
    readyAfterCallerGenerated: false,
    callerGeneratedRequired: ['requestId'],
    conditionalRequired: [],
    resultRequired: [],
    selectionRequired: ['taskId'],
    selectionUnavailable: [],
    inputRequired: []
  });
  assert.equal(Object.hasOwn(suggestion.arguments, 'taskId'), false);
  assert.equal(Object.hasOwn(suggestion.arguments, 'requestId'), false);
}

function assertCancelledSuggestion(suggestion, missionId) {
  assert.ok(suggestion);
  assert.equal(suggestion.applicability.state, 'not-applicable');
  assert.deepEqual(suggestion.arguments, { missionId });
  assert.deepEqual(suggestion.selections[0].candidates, []);
  assert.deepEqual(suggestion.readiness.callerGeneratedRequired, ['requestId']);
  assert.deepEqual(suggestion.readiness.selectionRequired, ['taskId']);
  assert.deepEqual(suggestion.readiness.selectionUnavailable, ['taskId']);
  assert.equal(suggestion.readiness.readyAfterCallerGenerated, false);
  assert.equal(Object.hasOwn(suggestion.arguments, 'taskId'), false);
  assert.equal(Object.hasOwn(suggestion.arguments, 'requestId'), false);
}

async function seedExternalDispatch({ cancelMission = false } = {}) {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
  const project = await app.callTool('project_open', {
    requestId: 'workflow-task-result-open',
    repoPath: fixture.repo
  });
  const planned = await app.callTool('mission_plan', {
    requestId: 'workflow-task-result-plan',
    projectId: project.id,
    goal: 'prove external task result discoverability from authoritative Mission status',
    doneDefinition: 'a dispatched external task is discoverable without binding operator choices',
    tasks: [{
      id: 'T-external',
      contract: 'own src/a.txt',
      owner: 'src/a.txt',
      dependencies: [],
      writeSet: ['src/a.txt'],
      risk: 'low'
    }]
  });
  const missionId = planned.mission.id;
  const executed = await app.callTool('mission_execute', {
    requestId: 'workflow-task-result-dispatch',
    missionId,
    runWorkers: false
  });
  assert.equal(executed.dispatched?.length, 1, JSON.stringify(executed));
  assert.equal(executed.dispatched[0].taskId, 'T-external');
  if (cancelMission) {
    await app.callTool('mission_cancel', {
      requestId: 'workflow-task-result-cancel',
      missionId,
      reason: 'prove cancelled Mission applicability'
    });
  } else {
    await fs.writeFile(path.join(executed.dispatched[0].worktreePath, 'src', 'a.txt'), 'after\n');
  }
  return { fixture, missionId };
}

async function callThroughFallback({ cancelMission = false } = {}) {
  const { fixture, missionId } = await seedExternalDispatch({ cancelMission });
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
      clientInfo: { name: 'workflow-task-result-mcp-proof', version: '1.0.0' }
    });
    const status = await request('tools/call', {
      name: 'mission_status',
      arguments: { missionId }
    });
    assert.equal(status.isError, undefined, JSON.stringify(status));
    if (cancelMission) {
      assertCancelledSuggestion(commitSuggestion(status._meta), missionId);
      return;
    }
    assertDispatchedSuggestion(commitSuggestion(status._meta), missionId);
    const committed = await request('tools/call', {
      name: 'task_result_commit',
      arguments: {
        requestId: 'workflow-task-result-mcp-commit',
        missionId,
        taskId: 'T-external'
      }
    });
    assert.equal(committed.isError, undefined, JSON.stringify(committed));
  } finally {
    for (const item of pending.values()) clearTimeout(item.timer);
    child.stdin.end();
    child.kill('SIGTERM');
    await cleanup(fixture.root);
  }
}

async function callThroughSdk({ cancelMission = false } = {}) {
  const { fixture, missionId } = await seedExternalDispatch({ cancelMission });
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/client'),
    import('@modelcontextprotocol/client/stdio')
  ]);
  const client = new Client({ name: 'workflow-task-result-sdk-proof', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    cwd: root,
    env: { ...process.env, VETERAN_ENGINEER_STATE_DIR: fixture.stateRoot, VETERAN_MCP_REQUIRE_SDK: '1' },
    stderr: 'pipe'
  });
  try {
    await client.connect(transport);
    const status = await client.callTool({ name: 'mission_status', arguments: { missionId } });
    assert.notEqual(status.isError, true, JSON.stringify(status));
    if (cancelMission) {
      assertCancelledSuggestion(commitSuggestion(status._meta), missionId);
      return;
    }
    assertDispatchedSuggestion(commitSuggestion(status._meta), missionId);
    const committed = await client.callTool({
      name: 'task_result_commit',
      arguments: {
        requestId: 'workflow-task-result-sdk-commit',
        missionId,
        taskId: 'T-external'
      }
    });
    assert.notEqual(committed.isError, true, JSON.stringify(committed));
  } finally {
    await client.close().catch(() => {});
    await cleanup(fixture.root);
  }
}

test('fallback MCP discovers and executes task_result_commit for a real external dispatch', async () => {
  await callThroughFallback();
});

test('official SDK discovers and executes task_result_commit for the same external dispatch', { skip: !officialSdkAvailable }, async () => {
  await callThroughSdk();
});

test('fallback MCP gates task_result_commit after authoritative Mission cancellation', async () => {
  await callThroughFallback({ cancelMission: true });
});

test('official SDK gates task_result_commit after authoritative Mission cancellation', { skip: !officialSdkAvailable }, async () => {
  await callThroughSdk({ cancelMission: true });
});
