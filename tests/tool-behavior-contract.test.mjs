import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { TOOL_NAMES, REQUEST_ID_TOOL_NAMES, toolRequiresRequestId } from '../src/tool-catalog.mjs';
import { TOOL_ANNOTATIONS, toolAnnotations } from '../src/tool-annotations.mjs';
import { ExperienceService } from '../src/experience-service.mjs';

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

function assertPublishedAnnotations(tools) {
  assert.equal(tools.length, 34);
  for (const tool of tools) {
    assert.ok(TOOL_NAMES.includes(tool.name), `unexpected tool ${tool.name}`);
    assert.deepEqual(tool.annotations, TOOL_ANNOTATIONS[tool.name], `annotation drift for ${tool.name}`);
  }
}

test('tool annotations cover the exact public surface and align with mutation authority', () => {
  assert.equal(Object.keys(TOOL_ANNOTATIONS).length, TOOL_NAMES.length);
  assert.equal(TOOL_NAMES.length, 34);
  for (const name of TOOL_NAMES) {
    const annotations = toolAnnotations(name);
    if (toolRequiresRequestId(name)) {
      assert.equal(annotations.readOnlyHint, false, name);
      assert.equal(annotations.idempotentHint, true, name);
    } else {
      assert.equal(annotations.readOnlyHint, true, name);
      assert.equal('destructiveHint' in annotations, false, name);
      assert.equal('idempotentHint' in annotations, false, name);
    }
  }
  assert.equal(REQUEST_ID_TOOL_NAMES.length, 23);
  assert.equal(toolAnnotations('project_open').openWorldHint, true);
  assert.equal(toolAnnotations('mission_status').openWorldHint, false);
  assert.equal(toolAnnotations('mission_execute').destructiveHint, true);
  assert.equal(toolAnnotations('runtime_cleanup').destructiveHint, true);
  assert.equal(toolAnnotations('runtime_maintenance').destructiveHint, false);
});

test('experience query is read-only by default while internal routing still records usage', async () => {
  const state = {
    experiences: {
      exp1: {
        id: 'exp1', projectId: 'project-1', mechanism: 'tool-contract', statement: 'query is read-only', kind: 'ownership',
        equivalenceClass: null, evidenceIds: [], sourceIdentity: null, appliesWhen: null, doesNotApplyWhen: null, expiresAt: null,
        status: 'active', challenges: [], usage: { count: 0, lastUsedAt: null }, createdAt: '2026-01-01T00:00:00.000Z'
      }
    },
    evidence: {}
  };
  const store = {
    async read() { return structuredClone(state); },
    async transaction(_name, mutate) { return mutate(state); }
  };
  const service = new ExperienceService({ store });
  const queried = await service.query({ projectId: 'project-1' });
  assert.equal(queried.items.length, 1);
  assert.equal(state.experiences.exp1.usage.count, 0);
  assert.equal(state.experiences.exp1.usage.lastUsedAt, null);

  const routed = await service.route({ projectId: 'project-1' });
  assert.equal(routed.items.length, 1);
  assert.equal(state.experiences.exp1.usage.count, 1);
  assert.ok(state.experiences.exp1.usage.lastUsedAt);
});

test('standalone fallback publishes behavior annotations for all tools', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-tool-annotations-'));
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
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 5000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  try {
    await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'annotations-test', version: '1.0.0' } });
    const listed = await request('tools/list', {});
    assertPublishedAnnotations(listed.tools);
  } finally {
    for (const item of pending.values()) clearTimeout(item.timer);
    child.stdin.end();
    child.kill('SIGTERM');
    await fs.rm(stateRoot, { recursive: true, force: true });
  }
});

test('official SDK publishes the same behavior annotations', { skip: !officialSdkAvailable }, async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-tool-annotations-sdk-'));
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/client'),
    import('@modelcontextprotocol/client/stdio')
  ]);
  const client = new Client({ name: 'annotations-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    env: { ...process.env, VETERAN_ENGINEER_STATE_DIR: stateRoot, VETERAN_MCP_REQUIRE_SDK: '1' },
    stderr: 'pipe'
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assertPublishedAnnotations(listed.tools);
  } finally {
    await client.close().catch(() => {});
    await fs.rm(stateRoot, { recursive: true, force: true });
  }
});
