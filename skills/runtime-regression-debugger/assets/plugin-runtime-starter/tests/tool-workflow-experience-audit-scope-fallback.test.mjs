import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { toolOutputJsonSchema } from '../src/tool-output-contracts.mjs';
import { TOOL_WORKFLOW_BINDINGS } from '../src/tool-workflow-bindings.mjs';
import {
  TOOL_WORKFLOW_SUGGESTIONS_META_KEY,
  toolWorkflowSuggestions
} from '../src/tool-workflow-suggestions.mjs';
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

function bindingEdge(targetTool, kind) {
  return TOOL_WORKFLOW_BINDINGS.experience_audit.relations
    .find((item) => item.tool === targetTool && item.kind === kind);
}

function suggestion(projection, targetTool, kind) {
  return projection.suggestions.find((item) => item.tool === targetTool && item.kind === kind);
}

function projectSelection(next) {
  return next.selections.find((item) => item.target === 'projectId');
}

function auditRows() {
  return [
    { id: 'exp-1', projectId: 'project-1', status: 'candidate', mechanism: 'one' },
    { id: 'exp-2', projectId: 'project-1', status: 'retired', mechanism: 'two' },
    { id: 'exp-3', projectId: 'project-2', status: 'candidate', mechanism: 'three' }
  ];
}

function assertGlobalScopeSuggestions(meta, expectedProjectId) {
  const projection = meta?.[TOOL_WORKFLOW_SUGGESTIONS_META_KEY];
  assert.equal(projection?.sourceTool, 'experience_audit');
  assert.equal(projection?.sourceOutcome, 'success');

  const compact = suggestion(projection, 'experience_compact', 'next');
  const query = suggestion(projection, 'experience_query', 'inspect');
  assert.ok(compact);
  assert.ok(query);
  assert.deepEqual(compact.arguments, {});
  assert.deepEqual(query.arguments, {});

  for (const next of [compact, query]) {
    const selection = projectSelection(next);
    assert.ok(selection);
    assert.equal(selection.cardinality, 'one');
    assert.equal(selection.requiredForRelation, true);
    assert.equal(selection.fallbackForMissingBinding, true);
    assert.deepEqual(selection.candidates, [expectedProjectId]);
  }

  assert.deepEqual(compact.readiness, {
    readyAfterCallerGenerated: false,
    callerGeneratedRequired: ['requestId'],
    conditionalRequired: [],
    resultRequired: [],
    selectionRequired: ['projectId'],
    selectionUnavailable: [],
    inputRequired: []
  });
  assert.deepEqual(query.readiness, {
    readyAfterCallerGenerated: false,
    callerGeneratedRequired: [],
    conditionalRequired: [],
    resultRequired: [],
    selectionRequired: ['projectId'],
    selectionUnavailable: [],
    inputRequired: []
  });
}

async function prepareFixture(suffix) {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'a\n' } });
  const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
  const project = await app.callTool('project_open', {
    requestId: `workflow-audit-scope-open-${suffix}`,
    repoPath: fixture.repo
  });
  await app.services.experienceService.commit({
    projectId: project.id,
    mechanism: `workflow-audit-scope-${suffix}`,
    statement: `workflow audit scope ${suffix}`,
    kind: 'invariant',
    equivalenceClass: `workflow-audit-scope-${suffix}`
  });
  return { fixture, projectId: project.id };
}

async function callFallback(stateRoot) {
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
      clientInfo: { name: 'workflow-audit-scope-fallback-proof', version: '1.0.0' }
    });
    return await request('tools/call', { name: 'experience_audit', arguments: {} });
  } finally {
    for (const item of pending.values()) clearTimeout(item.timer);
    child.stdin.end();
    child.kill('SIGTERM');
  }
}

async function callOfficialSdk(stateRoot) {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/client'),
    import('@modelcontextprotocol/client/stdio')
  ]);
  const client = new Client({ name: 'workflow-audit-scope-fallback-proof', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    cwd: root,
    env: { ...process.env, VETERAN_ENGINEER_STATE_DIR: stateRoot, VETERAN_MCP_REQUIRE_SDK: '1' },
    stderr: 'pipe'
  });
  try {
    await client.connect(transport);
    return await client.callTool({ name: 'experience_audit', arguments: {} });
  } finally {
    await client.close().catch(() => {});
  }
}

test('experience audit output guarantees identities needed by call-time scope discovery', () => {
  const natural = toolOutputJsonSchema('experience_audit');
  const legacy = toolOutputJsonSchema('experience_audit', { legacyEnvelope: true });
  assert.equal(natural.type, 'array');
  assert.deepEqual(natural.items.required, ['id', 'projectId', 'status']);
  assert.ok(natural.items.properties.projectId);
  assert.deepEqual(legacy.properties.result.items.required, ['id', 'projectId', 'status']);
  assert.ok(legacy.properties.result.items.properties.projectId);
});

test('project-scoped audit keeps deterministic project binding and publishes no fallback selection', () => {
  for (const [targetTool, kind] of [['experience_compact', 'next'], ['experience_query', 'inspect']]) {
    const binding = bindingEdge(targetTool, kind).bindings.find((item) => item.target === 'projectId');
    assert.deepEqual(binding, {
      target: 'projectId',
      source: 'arguments',
      pointer: '/projectId',
      mode: 'if-present-non-null',
      transform: 'identity',
      availability: 'conditional'
    });
  }

  const projection = toolWorkflowSuggestions('experience_audit', { projectId: 'project-1' }, auditRows());
  const compact = suggestion(projection, 'experience_compact', 'next');
  const query = suggestion(projection, 'experience_query', 'inspect');
  assert.deepEqual(compact.arguments, { projectId: 'project-1' });
  assert.deepEqual(query.arguments, { projectId: 'project-1' });
  assert.equal(projectSelection(compact), undefined);
  assert.equal(projectSelection(query), undefined);
  assert.deepEqual(compact.readiness, {
    readyAfterCallerGenerated: true,
    callerGeneratedRequired: ['requestId'],
    conditionalRequired: [],
    resultRequired: [],
    selectionRequired: [],
    selectionUnavailable: [],
    inputRequired: []
  });
  assert.equal(query.readiness.readyAfterCallerGenerated, true);
  assert.deepEqual(query.readiness.selectionRequired, []);
});

test('global audit turns missing conditional project binding into a deduplicated explicit scope selection', () => {
  const projection = toolWorkflowSuggestions('experience_audit', {}, auditRows());
  const compact = suggestion(projection, 'experience_compact', 'next');
  const query = suggestion(projection, 'experience_query', 'inspect');

  assert.deepEqual(compact.arguments, {});
  assert.deepEqual(compact.missingRequired, ['requestId', 'projectId']);
  assert.deepEqual(query.arguments, {});
  assert.deepEqual(query.missingRequired, ['projectId']);

  for (const next of [compact, query]) {
    const selection = projectSelection(next);
    assert.ok(selection);
    assert.equal(selection.fallbackForMissingBinding, true);
    assert.deepEqual(selection.candidates, ['project-1', 'project-2']);
    assert.deepEqual(next.readiness.conditionalRequired, []);
    assert.deepEqual(next.readiness.selectionRequired, ['projectId']);
    assert.deepEqual(next.readiness.selectionUnavailable, []);
    assert.deepEqual(next.readiness.inputRequired, []);
  }
  assert.deepEqual(compact.readiness.callerGeneratedRequired, ['requestId']);
  assert.deepEqual(query.readiness.callerGeneratedRequired, []);
});

test('global audit reports project scope selection unavailable when no audited rows exist', () => {
  const projection = toolWorkflowSuggestions('experience_audit', {}, []);
  for (const [targetTool, kind] of [['experience_compact', 'next'], ['experience_query', 'inspect']]) {
    const next = suggestion(projection, targetTool, kind);
    const selection = projectSelection(next);
    assert.ok(selection);
    assert.deepEqual(selection.candidates, []);
    assert.deepEqual(next.readiness.selectionRequired, ['projectId']);
    assert.deepEqual(next.readiness.selectionUnavailable, ['projectId']);
    assert.deepEqual(next.readiness.conditionalRequired, []);
  }
});

test('fallback MCP publishes global audit project scope candidates without auto-binding them', async () => {
  const seeded = await prepareFixture('fallback');
  try {
    const called = await callFallback(seeded.fixture.stateRoot);
    assert.equal(called.isError, undefined, JSON.stringify(called));
    assertGlobalScopeSuggestions(called._meta, seeded.projectId);
  } finally {
    await cleanup(seeded.fixture.root);
  }
});

test('official SDK publishes the same global audit project scope fallback', { skip: !officialSdkAvailable }, async () => {
  const seeded = await prepareFixture('sdk');
  try {
    const called = await callOfficialSdk(seeded.fixture.stateRoot);
    assert.equal(called.isError, undefined, JSON.stringify(called));
    assertGlobalScopeSuggestions(called._meta, seeded.projectId);
  } finally {
    await cleanup(seeded.fixture.root);
  }
});
