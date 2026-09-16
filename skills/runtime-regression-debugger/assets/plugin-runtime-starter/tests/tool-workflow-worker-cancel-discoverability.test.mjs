import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { TOOL_WORKFLOW_RELATIONS } from '../src/tool-workflow-relations.mjs';
import { TOOL_WORKFLOW_BINDINGS } from '../src/tool-workflow-bindings.mjs';
import { toolWorkflowSuggestions, TOOL_WORKFLOW_SUGGESTIONS_META_KEY } from '../src/tool-workflow-suggestions.mjs';
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

const CANCEL_STATUSES = Object.freeze({
  'T-executing': 'executing',
  'T-cancelling': 'cancelling',
  'T-planned': 'planned',
  'T-dispatched': 'dispatched',
  'T-interrupted': 'interrupted',
  'T-failed': 'failed',
  'T-cancelled': 'cancelled',
  'T-done': 'done'
});

function relation(from, to, kind) {
  return TOOL_WORKFLOW_RELATIONS[from].relations.find((edge) => edge.tool === to && edge.kind === kind);
}

function bindingRelation(from, to, kind) {
  return TOOL_WORKFLOW_BINDINGS[from].relations.find((edge) => edge.tool === to && edge.kind === kind);
}

function cancelSuggestion(meta) {
  return meta?.[TOOL_WORKFLOW_SUGGESTIONS_META_KEY]?.suggestions
    ?.find((item) => item.tool === 'worker_cancel' && item.kind === 'recover');
}

function assertCancelSuggestion(suggestion, missionId) {
  assert.ok(suggestion);
  assert.deepEqual(suggestion.arguments, { missionId });
  assert.deepEqual(suggestion.missingRequired, ['requestId', 'taskId']);
  assert.equal(suggestion.argumentsComplete, false);
  assert.deepEqual([...suggestion.selections[0].candidates].sort(), ['T-cancelling', 'T-executing']);
  for (const taskId of ['T-planned', 'T-dispatched', 'T-interrupted', 'T-failed', 'T-cancelled', 'T-done']) {
    assert.equal(suggestion.selections[0].candidates.includes(taskId), false, `${taskId} must not be cancellable from mission_status`);
  }
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

async function seedMissionState(statuses) {
  const files = Object.fromEntries(Object.keys(statuses).map((taskId) => [`src/${taskId}.txt`, `${taskId}\n`]));
  const fixture = await createGitRepo({ files });
  const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
  const project = await app.callTool('project_open', {
    requestId: 'workflow-cancel-mcp-open',
    repoPath: fixture.repo
  });
  const planned = await app.callTool('mission_plan', {
    requestId: 'workflow-cancel-mcp-plan',
    projectId: project.id,
    goal: 'prove worker cancellation discoverability from authoritative Mission status',
    doneDefinition: 'mission_status publishes only service-legal cancellation candidates without choosing one',
    tasks: Object.keys(statuses).map((taskId) => ({
      id: taskId,
      contract: `own src/${taskId}.txt`,
      owner: `src/${taskId}.txt`,
      dependencies: [],
      writeSet: [`src/${taskId}.txt`],
      risk: 'low'
    }))
  });
  const missionId = planned.mission.id;
  await app.store.transaction('test_seed_workflow_cancel_mcp_statuses', (state) => {
    for (const [taskId, status] of Object.entries(statuses)) {
      state.tasks[`${missionId}:${taskId}`].status = status;
    }
  }, { missionId });
  return { fixture, missionId };
}

async function callMissionStatusThroughFallback(statuses) {
  const { fixture, missionId } = await seedMissionState(statuses);
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
      clientInfo: { name: 'workflow-worker-cancel-mcp-proof', version: '1.0.0' }
    });
    const called = await request('tools/call', {
      name: 'mission_status',
      arguments: { missionId }
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

async function callMissionStatusThroughSdk(statuses) {
  const { fixture, missionId } = await seedMissionState(statuses);
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/client'),
    import('@modelcontextprotocol/client/stdio')
  ]);
  const client = new Client({ name: 'workflow-worker-cancel-sdk-proof', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    cwd: root,
    env: { ...process.env, VETERAN_ENGINEER_STATE_DIR: fixture.stateRoot, VETERAN_MCP_REQUIRE_SDK: '1' },
    stderr: 'pipe'
  });
  try {
    await client.connect(transport);
    const called = await client.callTool({ name: 'mission_status', arguments: { missionId } });
    assert.notEqual(called.isError, true, JSON.stringify(called));
    return { called, missionId };
  } finally {
    await client.close().catch(() => {});
    await cleanup(fixture.root);
  }
}

test('mission_status exposes worker_cancel with explicit executing/cancelling task selection', () => {
  assert.ok(relation('mission_status', 'worker_cancel', 'recover'));
  const cancel = bindingRelation('mission_status', 'worker_cancel', 'recover');
  assert.deepEqual(cancel.requiredCoverage, {
    guaranteed: ['missionId'],
    conditional: [],
    selection: ['taskId'],
    unbound: ['requestId']
  });
  assert.deepEqual(cancel.unboundRequired, ['requestId', 'taskId']);
  assert.deepEqual(cancel.selections, [{
    target: 'taskId',
    cardinality: 'one',
    requiredForRelation: true,
    sources: [{
      source: 'structuredContent',
      collectionPointer: '/tasks',
      itemPointer: '/id',
      filter: { pointer: '/status', operator: 'in', value: ['executing', 'cancelling'] }
    }],
    reason: 'Select one executing or cancelling task that the authoritative worker service can still cancel.'
  }]);

  const result = {
    mission: { id: 'mission-current', projectId: 'project-1', activeCandidateId: null },
    tasks: Object.entries(CANCEL_STATUSES).map(([id, status]) => ({ id, status })),
    candidates: [],
    mergeProposals: []
  };
  const suggestion = toolWorkflowSuggestions('mission_status', { missionId: 'stale-input' }, result)
    .suggestions.find((item) => item.tool === 'worker_cancel' && item.kind === 'recover');
  assertCancelSuggestion(suggestion, 'mission-current');
});

test('mission_status exposes unavailable worker_cancel selection when no task is service-legal', () => {
  const result = {
    mission: { id: 'mission-current', projectId: 'project-1', activeCandidateId: null },
    tasks: ['planned', 'dispatched', 'interrupted', 'failed', 'cancelled', 'done'].map((status) => ({ id: `T-${status}`, status })),
    candidates: [],
    mergeProposals: []
  };
  const suggestion = toolWorkflowSuggestions('mission_status', {}, result)
    .suggestions.find((item) => item.tool === 'worker_cancel' && item.kind === 'recover');
  assert.ok(suggestion);
  assert.deepEqual(suggestion.selections[0].candidates, []);
  assert.deepEqual(suggestion.readiness.selectionRequired, ['taskId']);
  assert.deepEqual(suggestion.readiness.selectionUnavailable, ['taskId']);
  assert.equal(suggestion.readiness.readyAfterCallerGenerated, false);
  assert.equal(Object.hasOwn(suggestion.arguments, 'taskId'), false);
  assert.equal(Object.hasOwn(suggestion.arguments, 'requestId'), false);
});

test('fallback MCP mission_status projects only executing/cancelling worker_cancel candidates', async () => {
  const { called, missionId } = await callMissionStatusThroughFallback(CANCEL_STATUSES);
  assertCancelSuggestion(cancelSuggestion(called._meta), missionId);
});

test('official SDK mission_status projects the same worker_cancel candidates', { skip: !officialSdkAvailable }, async () => {
  const { called, missionId } = await callMissionStatusThroughSdk(CANCEL_STATUSES);
  assertCancelSuggestion(cancelSuggestion(called._meta), missionId);
});
