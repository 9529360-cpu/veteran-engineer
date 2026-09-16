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

const RECOVERY_STATUSES = Object.freeze({
  'T-interrupted': 'interrupted',
  'T-failed': 'failed',
  'T-cancelled': 'cancelled',
  'T-executing': 'executing',
  'T-planned': 'planned'
});

function recoverySuggestion(meta, targetTool) {
  return meta?.[TOOL_WORKFLOW_SUGGESTIONS_META_KEY]?.suggestions
    ?.find((item) => item.tool === targetTool && item.kind === 'recover');
}

async function seedMissionState(statuses) {
  const files = Object.fromEntries(Object.keys(statuses).map((taskId) => [`src/${taskId}.txt`, `${taskId}\n`]));
  const fixture = await createGitRepo({ files });
  const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
  const project = await app.callTool('project_open', {
    requestId: 'workflow-recovery-mcp-open',
    repoPath: fixture.repo
  });
  const planned = await app.callTool('mission_plan', {
    requestId: 'workflow-recovery-mcp-plan',
    projectId: project.id,
    goal: 'prove task recovery workflow metadata through the real MCP path',
    doneDefinition: 'mission_status publishes authoritative task recovery candidates without choosing them',
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
  const interruptedTaskIds = Object.entries(statuses)
    .filter(([, status]) => status === 'interrupted')
    .map(([taskId]) => taskId);
  const blocked = Object.values(statuses).some((status) => ['interrupted', 'failed', 'cancelled'].includes(status));
  if (Object.values(statuses).some((status) => status !== 'planned')) {
    await app.store.transaction('test_seed_workflow_recovery_mcp_statuses', (state) => {
      for (const [taskId, status] of Object.entries(statuses)) {
        state.tasks[`${missionId}:${taskId}`].status = status;
      }
      if (blocked) state.missions[missionId].status = 'blocked';
      if (interruptedTaskIds.length > 0) {
        state.missions[missionId].interruption = {
          requiresReconciliation: true,
          taskIds: interruptedTaskIds,
          detectedAt: new Date().toISOString()
        };
      }
    }, { missionId });
  }
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
      clientInfo: { name: 'workflow-task-recovery-mcp-proof', version: '1.0.0' }
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
  const client = new Client({ name: 'workflow-task-recovery-sdk-proof', version: '1.0.0' });
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

function assertRecoveryCandidates(called, missionId) {
  const projection = called._meta?.[TOOL_WORKFLOW_SUGGESTIONS_META_KEY];
  assert.equal(projection?.sourceTool, 'mission_status');
  assert.equal(projection?.sourceOutcome, 'success');

  const resume = recoverySuggestion(called._meta, 'worker_resume');
  assert.ok(resume);
  assert.deepEqual(resume.applicability, { state: 'not-declared' });
  assert.deepEqual(resume.arguments, { missionId });
  assert.deepEqual(resume.selections[0].candidates, ['T-interrupted']);
  assert.deepEqual(resume.readiness, {
    readyAfterCallerGenerated: false,
    callerGeneratedRequired: ['requestId'],
    conditionalRequired: [],
    resultRequired: [],
    selectionRequired: ['taskId'],
    selectionUnavailable: [],
    inputRequired: []
  });
  assert.equal(Object.hasOwn(resume.arguments, 'taskId'), false);
  assert.equal(Object.hasOwn(resume.arguments, 'requestId'), false);

  const retry = recoverySuggestion(called._meta, 'worker_retry');
  assert.ok(retry);
  assert.deepEqual(retry.applicability, { state: 'not-declared' });
  assert.deepEqual(retry.arguments, { missionId });
  assert.deepEqual(retry.selections[0].candidates, ['T-cancelled', 'T-failed']);
  assert.equal(retry.selections[0].candidates.includes('T-interrupted'), false);
  assert.equal(retry.selections[0].candidates.includes('T-executing'), false);
  assert.equal(retry.selections[0].candidates.includes('T-planned'), false);
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
}

function assertUnavailableRecoverySelections(called) {
  for (const targetTool of ['worker_resume', 'worker_retry']) {
    const suggestion = recoverySuggestion(called._meta, targetTool);
    assert.ok(suggestion);
    assert.deepEqual(suggestion.applicability, { state: 'not-declared' });
    assert.deepEqual(suggestion.selections[0].candidates, []);
    assert.deepEqual(suggestion.readiness.selectionRequired, ['taskId']);
    assert.deepEqual(suggestion.readiness.selectionUnavailable, ['taskId']);
    assert.equal(suggestion.readiness.readyAfterCallerGenerated, false);
  }
}

test('fallback MCP mission_status publishes task recovery candidates without binding operator choices', async () => {
  const { called, missionId } = await callMissionStatusThroughFallback(RECOVERY_STATUSES);
  assertRecoveryCandidates(called, missionId);
});

test('official SDK mission_status publishes the same task recovery candidates', { skip: !officialSdkAvailable }, async () => {
  const { called, missionId } = await callMissionStatusThroughSdk(RECOVERY_STATUSES);
  assertRecoveryCandidates(called, missionId);
});

test('fallback MCP mission_status exposes unavailable recovery selections when no task is eligible', async () => {
  const { called } = await callMissionStatusThroughFallback({ T1: 'planned', T2: 'planned' });
  assertUnavailableRecoverySelections(called);
});

test('official SDK mission_status exposes the same unavailable recovery selections', { skip: !officialSdkAvailable }, async () => {
  const { called } = await callMissionStatusThroughSdk({ T1: 'planned', T2: 'planned' });
  assertUnavailableRecoverySelections(called);
});
