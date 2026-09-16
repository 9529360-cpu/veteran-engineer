import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { TOOL_WORKFLOW_RELATIONS } from '../src/tool-workflow-relations.mjs';
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

function suggestions(meta) {
  return meta?.[TOOL_WORKFLOW_SUGGESTIONS_META_KEY]?.suggestions || [];
}

function assertStateDrivenCandidateStatus(meta, missionId) {
  const projected = suggestions(meta);
  assert.equal(projected.some((item) => item.tool === 'mission_advance'), false);

  const readiness = projected.find((item) => item.tool === 'mission_readiness' && item.kind === 'next');
  assert.ok(readiness);
  assert.deepEqual(readiness.arguments, { missionId });
  assert.deepEqual(readiness.missingRequired, []);
  assert.equal(readiness.argumentsComplete, true);
  assert.deepEqual(readiness.readiness, {
    readyAfterCallerGenerated: true,
    callerGeneratedRequired: [],
    conditionalRequired: [],
    resultRequired: [],
    selectionRequired: [],
    selectionUnavailable: [],
    inputRequired: []
  });
}

async function seedCancelledMission() {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
  const project = await app.callTool('project_open', {
    requestId: 'candidate-status-observation-open',
    repoPath: fixture.repo
  });
  const planned = await app.callTool('mission_plan', {
    requestId: 'candidate-status-observation-plan',
    projectId: project.id,
    goal: 'prove candidate status cannot bypass Mission readiness after cancellation',
    doneDefinition: 'cancelled Mission observations never advertise a rejected direct advance',
    tasks: [{
      id: 'T1',
      contract: 'own src/a.txt',
      owner: 'src/a.txt',
      dependencies: [],
      writeSet: ['src/a.txt'],
      risk: 'low'
    }]
  });
  const missionId = planned.mission.id;
  await app.callTool('mission_cancel', {
    requestId: 'candidate-status-observation-cancel',
    missionId,
    reason: 'prove terminal Mission advance authority'
  });
  return { fixture, app, missionId };
}

async function callCandidateStatusThroughFallback() {
  const { fixture, app, missionId } = await seedCancelledMission();
  await assert.rejects(
    app.callTool('mission_advance', {
      requestId: 'candidate-status-observation-advance',
      missionId
    }),
    (error) => error?.code === 'MISSION_CANCELLED'
  );

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
      clientInfo: { name: 'candidate-status-readiness-mcp-proof', version: '1.0.0' }
    });
    const called = await request('tools/call', {
      name: 'candidate_status',
      arguments: { missionId }
    });
    assert.equal(called.isError, undefined, JSON.stringify(called));
    assertStateDrivenCandidateStatus(called._meta, missionId);
  } finally {
    for (const item of pending.values()) clearTimeout(item.timer);
    child.stdin.end();
    child.kill('SIGTERM');
    await cleanup(fixture.root);
  }
}

async function callCandidateStatusThroughSdk() {
  const { fixture, app, missionId } = await seedCancelledMission();
  await assert.rejects(
    app.callTool('mission_advance', {
      requestId: 'candidate-status-observation-sdk-advance',
      missionId
    }),
    (error) => error?.code === 'MISSION_CANCELLED'
  );

  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/client'),
    import('@modelcontextprotocol/client/stdio')
  ]);
  const client = new Client({ name: 'candidate-status-readiness-sdk-proof', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    cwd: root,
    env: { ...process.env, VETERAN_ENGINEER_STATE_DIR: fixture.stateRoot, VETERAN_MCP_REQUIRE_SDK: '1' },
    stderr: 'pipe'
  });
  try {
    await client.connect(transport);
    const called = await client.callTool({ name: 'candidate_status', arguments: { missionId } });
    assert.notEqual(called.isError, true, JSON.stringify(called));
    assertStateDrivenCandidateStatus(called._meta, missionId);
  } finally {
    await client.close().catch(() => {});
    await cleanup(fixture.root);
  }
}

test('candidate_status routes state-machine progress through Mission readiness instead of direct advance', () => {
  assert.deepEqual(
    TOOL_WORKFLOW_RELATIONS.candidate_status.relations.map((edge) => [edge.tool, edge.kind]),
    [
      ['candidate_preflight', 'inspect'],
      ['mission_readiness', 'next'],
      ['handoff_export', 'next']
    ]
  );
});

test('fallback MCP candidate_status does not advertise mission_advance after cancellation', async () => {
  await callCandidateStatusThroughFallback();
});

test('official SDK candidate_status projects the same state-driven next step', { skip: !officialSdkAvailable }, async () => {
  await callCandidateStatusThroughSdk();
});
