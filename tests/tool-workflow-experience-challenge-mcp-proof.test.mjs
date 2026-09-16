import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
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

function challengeSuggestion(meta) {
  return meta?.[TOOL_WORKFLOW_SUGGESTIONS_META_KEY]?.suggestions
    ?.find((item) => item.tool === 'experience_challenge' && item.kind === 'recover');
}

function reviewSuggestion(meta) {
  return meta?.[TOOL_WORKFLOW_SUGGESTIONS_META_KEY]?.suggestions
    ?.find((item) => item.tool === 'experience_review' && item.kind === 'next');
}

function assertChallengeSuggestion(called, experienceId, expectedStatus, expectedApplicability) {
  assert.equal(called.isError, undefined, JSON.stringify(called));
  assert.equal(called.structuredContent?.status, expectedStatus);
  const next = challengeSuggestion(called._meta);
  assert.ok(next);
  assert.deepEqual(next.condition, {
    source: 'structuredContent',
    pointer: '/status',
    operator: 'equals',
    value: 'active'
  });
  assert.equal(next.applicability.state, expectedApplicability);
  assert.deepEqual(next.arguments, { experienceId });
  assert.equal(Object.hasOwn(next.arguments, 'requestId'), false);
  assert.equal(Object.hasOwn(next.arguments, 'statement'), false);
  assert.deepEqual(next.readiness, {
    readyAfterCallerGenerated: false,
    callerGeneratedRequired: ['requestId'],
    conditionalRequired: [],
    resultRequired: [],
    selectionRequired: [],
    selectionUnavailable: [],
    inputRequired: ['statement']
  });
}

function assertDirectReviewSuggestion(called, experienceId, expectedStatus, expectedActions) {
  assert.equal(called.isError, undefined, JSON.stringify(called));
  assert.equal(called.structuredContent?.status, expectedStatus);
  const next = reviewSuggestion(called._meta);
  assert.ok(next);
  assert.deepEqual(next.arguments, { experienceId });
  assert.equal(Object.hasOwn(next.arguments, 'requestId'), false);
  assert.equal(Object.hasOwn(next.arguments, 'action'), false);
  const actionSelection = next.selections.find((item) => item.target === 'action');
  assert.ok(actionSelection);
  assert.equal(actionSelection.sourceState, expectedStatus);
  assert.equal(Object.hasOwn(actionSelection, 'dependsOn'), false);
  assert.deepEqual(actionSelection.candidates, expectedActions);
  assert.deepEqual(next.readiness, {
    readyAfterCallerGenerated: false,
    callerGeneratedRequired: ['requestId'],
    conditionalRequired: [],
    resultRequired: [],
    selectionRequired: ['action'],
    selectionUnavailable: [],
    inputRequired: []
  });
  assert.deepEqual(next.applicability, { state: 'not-declared' });
}

async function prepareFixture(suffix) {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'a\n' } });
  const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
  const project = await app.callTool('project_open', {
    requestId: `workflow-experience-challenge-open-${suffix}`,
    repoPath: fixture.repo
  });
  return { fixture, projectId: project.id };
}

async function withFallbackClient(stateRoot, run) {
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
      clientInfo: { name: 'workflow-experience-challenge-proof', version: '1.0.0' }
    });
    await run(async (name, args) => request('tools/call', { name, arguments: args }));
  } finally {
    for (const item of pending.values()) clearTimeout(item.timer);
    child.stdin.end();
    child.kill('SIGTERM');
  }
}

async function withOfficialSdkClient(stateRoot, run) {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/client'),
    import('@modelcontextprotocol/client/stdio')
  ]);
  const client = new Client({ name: 'workflow-experience-challenge-proof', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    cwd: root,
    env: { ...process.env, VETERAN_ENGINEER_STATE_DIR: stateRoot, VETERAN_MCP_REQUIRE_SDK: '1' },
    stderr: 'pipe'
  });
  try {
    await client.connect(transport);
    await run((name, args) => client.callTool({ name, arguments: args }));
  } finally {
    await client.close().catch(() => {});
  }
}

async function exerciseReviewLifecycle(callTool, projectId, suffix) {
  const committed = await callTool('experience_commit', {
    requestId: `workflow-experience-challenge-commit-${suffix}`,
    projectId,
    mechanism: `workflow-challenge-${suffix}`,
    statement: `workflow challenge ${suffix}`,
    kind: 'invariant'
  });
  const experienceId = committed.structuredContent?.id;
  assert.equal(typeof experienceId, 'string');
  assertDirectReviewSuggestion(committed, experienceId, 'candidate', ['activate', 'reject']);

  const activated = await callTool('experience_review', {
    requestId: `workflow-experience-challenge-activate-${suffix}`,
    experienceId,
    action: 'activate'
  });
  assertChallengeSuggestion(activated, experienceId, 'active', 'applicable');

  const challenged = await callTool('experience_challenge', {
    requestId: `workflow-experience-challenge-record-${suffix}`,
    experienceId,
    statement: 'contrary runtime evidence'
  });
  assertDirectReviewSuggestion(challenged, experienceId, 'challenged', ['reactivate', 'retire']);

  const retired = await callTool('experience_review', {
    requestId: `workflow-experience-challenge-retire-${suffix}`,
    experienceId,
    action: 'retire'
  });
  assertChallengeSuggestion(retired, experienceId, 'retired', 'not-applicable');
}

test('fallback MCP publishes lifecycle-driven review choices and challenge applicability', async () => {
  const seeded = await prepareFixture('fallback');
  try {
    await withFallbackClient(seeded.fixture.stateRoot, async (callTool) => {
      await exerciseReviewLifecycle(callTool, seeded.projectId, 'fallback');
    });
  } finally {
    await cleanup(seeded.fixture.root);
  }
});

test('official SDK publishes the same lifecycle-driven review choices and challenge applicability', { skip: !officialSdkAvailable }, async () => {
  const seeded = await prepareFixture('sdk');
  try {
    await withOfficialSdkClient(seeded.fixture.stateRoot, async (callTool) => {
      await exerciseReviewLifecycle(callTool, seeded.projectId, 'sdk');
    });
  } finally {
    await cleanup(seeded.fixture.root);
  }
});
