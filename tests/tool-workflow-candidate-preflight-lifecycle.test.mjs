import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { git } from '../src/git.mjs';
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

function assertCancelledPreflightProjection(called, missionId) {
  assert.equal(called.structuredContent.ready, false);
  assert.deepEqual(called.structuredContent.blockers, [{ code: 'MISSION_CANCELLED' }]);

  const projected = suggestions(called._meta);
  assert.equal(projected.some((item) => item.tool === 'mission_advance'), false);

  const readiness = projected.find((item) => item.tool === 'mission_readiness' && item.kind === 'next');
  assert.ok(readiness);
  assert.deepEqual(readiness.arguments, { missionId });
  assert.equal(readiness.argumentsComplete, true);

  const refresh = projected.find((item) => item.tool === 'candidate_refresh' && item.kind === 'recover');
  assert.ok(refresh);
  assert.equal(refresh.applicability.state, 'not-applicable');
  assert.equal(Object.hasOwn(refresh.arguments, 'requestId'), false);
}

async function seedMission(prefix) {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
  const project = await app.callTool('project_open', {
    requestId: `${prefix}-open`,
    repoPath: fixture.repo
  });
  const planned = await app.callTool('mission_plan', {
    requestId: `${prefix}-plan`,
    projectId: project.id,
    goal: 'prove candidate lifecycle authority remains fail closed',
    doneDefinition: 'terminal or uncertain Mission state cannot create a candidate or bypass readiness',
    tasks: [{
      id: 'T1',
      contract: 'own src/a.txt',
      owner: 'src/a.txt',
      dependencies: [],
      writeSet: ['src/a.txt'],
      risk: 'low'
    }]
  });
  return { fixture, app, missionId: planned.mission.id };
}

async function seedCancelledMission(prefix) {
  const seeded = await seedMission(prefix);
  await seeded.app.callTool('mission_cancel', {
    requestId: `${prefix}-cancel`,
    missionId: seeded.missionId,
    reason: 'prove candidate lifecycle guard'
  });
  return seeded;
}

async function callPreflightThroughFallback() {
  const { fixture, app, missionId } = await seedCancelledMission('candidate-preflight-fallback');
  await assert.rejects(
    app.callTool('candidate_refresh', {
      requestId: 'candidate-preflight-fallback-refresh',
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
      clientInfo: { name: 'candidate-preflight-lifecycle-mcp-proof', version: '1.0.0' }
    });
    const called = await request('tools/call', {
      name: 'candidate_preflight',
      arguments: { missionId }
    });
    assert.equal(called.isError, undefined, JSON.stringify(called));
    assertCancelledPreflightProjection(called, missionId);
  } finally {
    for (const item of pending.values()) clearTimeout(item.timer);
    child.stdin.end();
    child.kill('SIGTERM');
    await cleanup(fixture.root);
  }
}

async function callPreflightThroughSdk() {
  const { fixture, app, missionId } = await seedCancelledMission('candidate-preflight-sdk');
  await assert.rejects(
    app.callTool('candidate_refresh', {
      requestId: 'candidate-preflight-sdk-refresh',
      missionId
    }),
    (error) => error?.code === 'MISSION_CANCELLED'
  );

  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/client'),
    import('@modelcontextprotocol/client/stdio')
  ]);
  const client = new Client({ name: 'candidate-preflight-lifecycle-sdk-proof', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    cwd: root,
    env: { ...process.env, VETERAN_ENGINEER_STATE_DIR: fixture.stateRoot, VETERAN_MCP_REQUIRE_SDK: '1' },
    stderr: 'pipe'
  });
  try {
    await client.connect(transport);
    const called = await client.callTool({ name: 'candidate_preflight', arguments: { missionId } });
    assert.notEqual(called.isError, true, JSON.stringify(called));
    assertCancelledPreflightProjection(called, missionId);
  } finally {
    await client.close().catch(() => {});
    await cleanup(fixture.root);
  }
}

test('candidate_preflight routes Mission progress through readiness and keeps explicit refresh gated by preflight readiness', () => {
  assert.deepEqual(
    TOOL_WORKFLOW_RELATIONS.candidate_preflight.relations.map((edge) => [edge.tool, edge.kind]),
    [
      ['candidate_status', 'inspect'],
      ['candidate_refresh', 'recover'],
      ['mission_readiness', 'next']
    ]
  );
  const refresh = TOOL_WORKFLOW_RELATIONS.candidate_preflight.relations.find((edge) => edge.tool === 'candidate_refresh');
  assert.deepEqual(refresh.condition, {
    source: 'structuredContent', pointer: '/ready', operator: 'equals', value: true
  });
});

test('candidate preflight and candidate refresh fail closed after Mission cancellation', async () => {
  const { fixture, app, missionId } = await seedCancelledMission('candidate-preflight-service');
  try {
    const preflight = await app.services.candidateService.preflight({ missionId });
    assert.equal(preflight.ready, false);
    assert.equal(preflight.ok, false);
    assert.deepEqual(preflight.blockers, [{ code: 'MISSION_CANCELLED' }]);
    await assert.rejects(
      app.services.candidateService.createOrRefresh({ missionId, reason: 'cancelled-proof' }),
      (error) => error?.code === 'MISSION_CANCELLED'
    );
    const after = await app.services.missionService.status({ missionId });
    assert.equal(after.mission.status, 'cancelled');
    assert.deepEqual(after.mission.candidateIds, []);
  } finally {
    await cleanup(fixture.root);
  }
});

test('candidate preflight and refresh require interruption reconciliation before candidate mutation', async () => {
  const { fixture, app, missionId } = await seedMission('candidate-preflight-reconciliation');
  try {
    await app.services.candidateService.store.transaction('test_candidate_reconciliation_required', (state) => {
      const mission = state.missions[missionId];
      mission.status = 'blocked';
      mission.interruption = { requiresReconciliation: true, taskIds: ['T1'], detectedAt: new Date().toISOString() };
    }, { missionId });

    const preflight = await app.services.candidateService.preflight({ missionId });
    assert.equal(preflight.ready, false);
    assert.equal(preflight.ok, false);
    assert.deepEqual(preflight.blockers, [{ code: 'RECONCILIATION_REQUIRED', taskIds: ['T1'] }]);
    await assert.rejects(
      app.services.candidateService.createOrRefresh({ missionId, reason: 'reconciliation-proof' }),
      (error) => error?.code === 'RECONCILIATION_REQUIRED'
    );
  } finally {
    await cleanup(fixture.root);
  }
});

test('candidate refresh re-checks lifecycle state inside the candidate transaction and rolls back a raced ref', async () => {
  const { fixture, app, missionId } = await seedMission('candidate-preflight-race');
  try {
    const originalPreflight = app.services.candidateService.preflight.bind(app.services.candidateService);
    app.services.candidateService.preflight = async (args) => {
      const result = await originalPreflight(args);
      await app.services.missionService.cancel({ missionId, reason: 'race-after-preflight' });
      return result;
    };

    await assert.rejects(
      app.services.candidateService.createOrRefresh({ missionId, reason: 'race-proof' }),
      (error) => error?.code === 'MISSION_CANCELLED'
    );
    const refs = await git(fixture.repo, ['for-each-ref', '--format=%(refname)', 'refs/veteran/candidates']);
    assert.equal(refs.stdout.trim(), '');
    const after = await app.services.missionService.status({ missionId });
    assert.equal(after.mission.status, 'cancelled');
    assert.deepEqual(after.mission.candidateIds, []);
  } finally {
    await cleanup(fixture.root);
  }
});

test('fallback MCP candidate_preflight marks candidate refresh not applicable and routes next through readiness after cancellation', async () => {
  await callPreflightThroughFallback();
});

test('official SDK candidate_preflight projects the same lifecycle-safe workflow', { skip: !officialSdkAvailable }, async () => {
  await callPreflightThroughSdk();
});
