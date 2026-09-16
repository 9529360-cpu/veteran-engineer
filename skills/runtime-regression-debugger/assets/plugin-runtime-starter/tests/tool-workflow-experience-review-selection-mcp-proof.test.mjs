import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { TOOL_WORKFLOW_BINDINGS } from '../src/tool-workflow-bindings.mjs';
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

function reviewRelation() {
  return TOOL_WORKFLOW_RELATIONS.experience_audit.relations
    .find((item) => item.tool === 'experience_review' && item.kind === 'next');
}

function reviewBinding() {
  return TOOL_WORKFLOW_BINDINGS.experience_audit.relations
    .find((item) => item.tool === 'experience_review' && item.kind === 'next');
}

function reviewSuggestion(meta) {
  return meta?.[TOOL_WORKFLOW_SUGGESTIONS_META_KEY]?.suggestions
    ?.find((item) => item.tool === 'experience_review' && item.kind === 'next');
}

async function commitExperience(app, projectId, suffix) {
  return app.services.experienceService.commit({
    projectId,
    mechanism: `workflow-review-${suffix}`,
    statement: `workflow review ${suffix}`,
    kind: 'invariant',
    equivalenceClass: `workflow-review-${suffix}`
  });
}

async function prepareFixture({ onlyRetired = false } = {}) {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'a\n' } });
  const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
  const project = await app.callTool('project_open', {
    requestId: `workflow-experience-review-open-${onlyRetired ? 'retired' : 'mixed'}`,
    repoPath: fixture.repo
  });

  if (onlyRetired) {
    const retired = await commitExperience(app, project.id, 'retired-only');
    await app.services.experienceService.review({ experienceId: retired.id, action: 'reject' });
    return { fixture, projectId: project.id, expectedCandidates: [], retiredIds: [retired.id] };
  }

  const candidate = await commitExperience(app, project.id, 'candidate');
  const active = await commitExperience(app, project.id, 'active');
  await app.services.experienceService.review({ experienceId: active.id, action: 'activate' });
  const challenged = await commitExperience(app, project.id, 'challenged');
  await app.services.experienceService.review({ experienceId: challenged.id, action: 'activate' });
  await app.services.experienceService.challenge({
    experienceId: challenged.id,
    statement: 'new evidence requires explicit review'
  });
  const retired = await commitExperience(app, project.id, 'retired');
  await app.services.experienceService.review({ experienceId: retired.id, action: 'reject' });

  return {
    fixture,
    projectId: project.id,
    expectedCandidates: [candidate.id, active.id, challenged.id],
    retiredIds: [retired.id]
  };
}

function assertReviewSelection(meta, expectedCandidates, retiredIds = []) {
  const projection = meta?.[TOOL_WORKFLOW_SUGGESTIONS_META_KEY];
  assert.equal(projection?.sourceTool, 'experience_audit');
  assert.equal(projection?.sourceOutcome, 'success');
  const next = reviewSuggestion(meta);
  assert.ok(next);
  assert.deepEqual(next.arguments, {});
  assert.equal(Object.hasOwn(next.arguments, 'experienceId'), false);
  assert.equal(Object.hasOwn(next.arguments, 'requestId'), false);
  assert.equal(Object.hasOwn(next.arguments, 'action'), false);
  assert.deepEqual([...next.selections[0].candidates].sort(), [...expectedCandidates].sort());
  for (const retiredId of retiredIds) assert.equal(next.selections[0].candidates.includes(retiredId), false);
  assert.deepEqual(next.readiness, {
    readyAfterCallerGenerated: false,
    callerGeneratedRequired: ['requestId'],
    conditionalRequired: [],
    resultRequired: [],
    selectionRequired: ['experienceId'],
    selectionUnavailable: expectedCandidates.length === 0 ? ['experienceId'] : [],
    inputRequired: ['action']
  });
  assert.deepEqual(next.applicability, { state: 'not-declared' });
}

async function callFallback(stateRoot, projectId) {
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
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 10_000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  try {
    await request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'workflow-experience-review-selection-proof', version: '1.0.0' }
    });
    return await request('tools/call', {
      name: 'experience_audit',
      arguments: { projectId }
    });
  } finally {
    for (const item of pending.values()) clearTimeout(item.timer);
    child.stdin.end();
    child.kill('SIGTERM');
  }
}

async function callOfficialSdk(stateRoot, projectId) {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/client'),
    import('@modelcontextprotocol/client/stdio')
  ]);
  const client = new Client({ name: 'workflow-experience-review-selection-proof', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    cwd: root,
    env: { ...process.env, VETERAN_ENGINEER_STATE_DIR: stateRoot, VETERAN_MCP_REQUIRE_SDK: '1' },
    stderr: 'pipe'
  });
  try {
    await client.connect(transport);
    return await client.callTool({
      name: 'experience_audit',
      arguments: { projectId }
    });
  } finally {
    await client.close().catch(() => {});
  }
}

test('experience audit review selection follows the authoritative lifecycle transition set', () => {
  const relation = reviewRelation();
  assert.match(relation.when, /candidate, active, or challenged/);
  assert.doesNotMatch(relation.when, /retired|rejected/);

  const source = reviewBinding().selections[0].sources[0];
  assert.deepEqual(source.filter, {
    pointer: '/status',
    operator: 'in',
    value: ['candidate', 'active', 'challenged']
  });
  assert.equal(source.collectionPointer, '');
  assert.equal(source.legacyCollectionPointer, '/result');
  assert.equal(source.itemPointer, '/id');
});

test('fallback MCP excludes retired experiences from explicit review selection', async () => {
  const seeded = await prepareFixture();
  try {
    const called = await callFallback(seeded.fixture.stateRoot, seeded.projectId);
    assert.equal(called.isError, undefined, JSON.stringify(called));
    assertReviewSelection(called._meta, seeded.expectedCandidates, seeded.retiredIds);
  } finally {
    await cleanup(seeded.fixture.root);
  }
});

test('fallback MCP marks experience review selection unavailable when audit contains only retired state', async () => {
  const seeded = await prepareFixture({ onlyRetired: true });
  try {
    const called = await callFallback(seeded.fixture.stateRoot, seeded.projectId);
    assert.equal(called.isError, undefined, JSON.stringify(called));
    assertReviewSelection(called._meta, [], seeded.retiredIds);
  } finally {
    await cleanup(seeded.fixture.root);
  }
});

test('official SDK preserves reviewable experience selection ownership', { skip: !officialSdkAvailable }, async () => {
  const seeded = await prepareFixture();
  try {
    const called = await callOfficialSdk(seeded.fixture.stateRoot, seeded.projectId);
    assert.equal(called.isError, undefined, JSON.stringify(called));
    assertReviewSelection(called._meta, seeded.expectedCandidates, seeded.retiredIds);
  } finally {
    await cleanup(seeded.fixture.root);
  }
});
