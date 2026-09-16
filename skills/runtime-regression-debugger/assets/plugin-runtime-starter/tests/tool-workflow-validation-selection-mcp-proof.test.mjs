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

async function prepareFixture(capabilityNames) {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'a\n' } });
  if (capabilityNames.length > 0) {
    await fs.mkdir(fixture.stateRoot, { recursive: true });
    await fs.writeFile(path.join(fixture.stateRoot, 'operator.json'), `${JSON.stringify({
      defaults: {
        validationCapabilities: capabilityNames.map((name) => ({
          name,
          command: [process.execPath, '-e', 'process.exit(0)']
        }))
      }
    }, null, 2)}\n`);
  }
  const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
  const project = await app.callTool('project_open', {
    requestId: `workflow-validation-open-${capabilityNames.length}`,
    repoPath: fixture.repo
  });
  return { fixture, projectId: project.id };
}

function assertValidationSelection(meta, projectId, expectedCandidates) {
  const projection = meta?.[TOOL_WORKFLOW_SUGGESTIONS_META_KEY];
  assert.equal(projection?.sourceTool, 'validation_capabilities');
  assert.equal(projection?.sourceOutcome, 'success');
  const next = projection?.suggestions?.find((item) => item.tool === 'validation_run' && item.kind === 'next');
  assert.ok(next);
  assert.deepEqual(next.arguments, { projectId });
  assert.equal(Object.hasOwn(next.arguments, 'requestId'), false);
  assert.equal(Object.hasOwn(next.arguments, 'capability'), false);
  assert.deepEqual(next.missingRequired, ['requestId']);
  assert.deepEqual(next.selections, [{
    target: 'capability',
    cardinality: 'one',
    requiredForRelation: true,
    candidates: expectedCandidates,
    reason: 'Select the configured validation capability to execute; rawCommand is a separate explicitly gated path.'
  }]);
  assert.deepEqual(next.readiness, {
    readyAfterCallerGenerated: false,
    callerGeneratedRequired: ['requestId'],
    conditionalRequired: [],
    resultRequired: [],
    selectionRequired: ['capability'],
    selectionUnavailable: expectedCandidates.length === 0 ? ['capability'] : [],
    inputRequired: []
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
      clientInfo: { name: 'workflow-validation-selection-proof', version: '1.0.0' }
    });
    return await request('tools/call', {
      name: 'validation_capabilities',
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
  const client = new Client({ name: 'workflow-validation-selection-proof', version: '1.0.0' });
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
      name: 'validation_capabilities',
      arguments: { projectId }
    });
  } finally {
    await client.close().catch(() => {});
  }
}

test('fallback MCP exposes configured validation capabilities as explicit selection candidates', async () => {
  const { fixture, projectId } = await prepareFixture(['unit', 'integration']);
  try {
    const called = await callFallback(fixture.stateRoot, projectId);
    assert.equal(called.isError, undefined, JSON.stringify(called));
    assertValidationSelection(called._meta, projectId, ['unit', 'integration']);
  } finally {
    await cleanup(fixture.root);
  }
});

test('fallback MCP marks validation capability selection unavailable when none are configured', async () => {
  const { fixture, projectId } = await prepareFixture([]);
  try {
    const called = await callFallback(fixture.stateRoot, projectId);
    assert.equal(called.isError, undefined, JSON.stringify(called));
    assertValidationSelection(called._meta, projectId, []);
  } finally {
    await cleanup(fixture.root);
  }
});

test('official SDK preserves validation capability selection ownership', { skip: !officialSdkAvailable }, async () => {
  const { fixture, projectId } = await prepareFixture(['unit', 'integration']);
  try {
    const called = await callOfficialSdk(fixture.stateRoot, projectId);
    assert.equal(called.isError, undefined, JSON.stringify(called));
    assertValidationSelection(called._meta, projectId, ['unit', 'integration']);
  } finally {
    await cleanup(fixture.root);
  }
});
