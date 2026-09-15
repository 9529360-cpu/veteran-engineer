import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { TOOL_NAMES, toolInputJsonSchema } from '../src/tool-catalog.mjs';
import { TOOL_WORKFLOW_RELATIONS } from '../src/tool-workflow-relations.mjs';
import {
  TOOL_IDENTITY_SOURCES,
  TOOL_WORKFLOW_BINDINGS,
  TOOL_WORKFLOW_BINDINGS_META_KEY,
  TOOL_WORKFLOW_BINDINGS_SCHEMA,
  toolWorkflowBindingsMeta
} from '../src/tool-workflow-bindings.mjs';

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

function relation(from, to, kind = null) {
  return TOOL_WORKFLOW_BINDINGS[from].relations.find((edge) => edge.tool === to && (kind === null || edge.kind === kind));
}

function binding(from, to, target, kind = null) {
  return relation(from, to, kind)?.bindings.find((entry) => entry.target === target);
}

function assertPublishedBindings(tools) {
  assert.equal(tools.length, 34);
  for (const tool of tools) {
    assert.ok(TOOL_NAMES.includes(tool.name), `unexpected tool ${tool.name}`);
    assert.deepEqual(
      tool._meta?.[TOOL_WORKFLOW_BINDINGS_META_KEY],
      toolWorkflowBindingsMeta(tool.name)[TOOL_WORKFLOW_BINDINGS_META_KEY],
      `workflow binding metadata drift for ${tool.name}`
    );
  }
}

test('workflow bindings project the exact relation graph onto target input contracts', () => {
  assert.equal(TOOL_NAMES.length, 34);
  assert.equal(Object.keys(TOOL_IDENTITY_SOURCES).length, TOOL_NAMES.length);
  assert.equal(Object.keys(TOOL_WORKFLOW_BINDINGS).length, TOOL_NAMES.length);

  for (const name of TOOL_NAMES) {
    const workflow = TOOL_WORKFLOW_RELATIONS[name];
    const compiled = TOOL_WORKFLOW_BINDINGS[name];
    assert.equal(compiled.schema, TOOL_WORKFLOW_BINDINGS_SCHEMA, name);
    assert.equal(compiled.sourceTool, name, name);
    assert.equal(compiled.relations.length, workflow.relations.length, name);
    assert.equal(typeof compiled.copyPolicy, 'string', name);
    assert.ok(compiled.copyPolicy.includes('Never synthesize requestId'), name);

    for (let index = 0; index < workflow.relations.length; index += 1) {
      const edge = workflow.relations[index];
      const projected = compiled.relations[index];
      assert.equal(projected.tool, edge.tool, `${name}[${index}] target`);
      assert.equal(projected.kind, edge.kind, `${name}[${index}] kind`);
      const targetSchema = toolInputJsonSchema(edge.tool);
      const boundTargets = new Set();
      for (const item of projected.bindings) {
        assert.ok(Object.hasOwn(targetSchema.properties || {}, item.target), `${name} -> ${edge.tool}.${item.target}`);
        assert.ok(['arguments', 'structuredContent'].includes(item.source), `${name} -> ${edge.tool}.${item.target}`);
        assert.ok(item.pointer.startsWith('/'), `${name} -> ${edge.tool}.${item.target}`);
        assert.equal(item.mode, 'if-present-non-null', `${name} -> ${edge.tool}.${item.target}`);
        assert.notEqual(item.target, 'requestId', `${name} -> ${edge.tool} must not carry requestId`);
        assert.equal(boundTargets.has(item.target), false, `${name} -> ${edge.tool}.${item.target} duplicate`);
        boundTargets.add(item.target);
      }
      const expectedUnbound = (targetSchema.required || []).filter((required) => !boundTargets.has(required));
      assert.deepEqual(projected.unboundRequired, expectedUnbound, `${name} -> ${edge.tool} unbound required`);
    }
  }
});

test('workflow bindings expose safe identity carry without inventing selected-task or business inputs', () => {
  assert.deepEqual(binding('project_open', 'mission_plan', 'projectId', 'next'), {
    target: 'projectId', source: 'structuredContent', pointer: '/id', mode: 'if-present-non-null'
  });
  assert.deepEqual(relation('project_open', 'mission_plan', 'next').unboundRequired, ['requestId', 'goal', 'doneDefinition']);

  assert.deepEqual(binding('mission_plan', 'mission_execute', 'missionId', 'next'), {
    target: 'missionId', source: 'structuredContent', pointer: '/mission/id', mode: 'if-present-non-null'
  });
  assert.deepEqual(relation('mission_plan', 'mission_execute', 'next').unboundRequired, ['requestId']);

  assert.deepEqual(binding('mission_status', 'mission_readiness', 'missionId', 'next'), {
    target: 'missionId', source: 'structuredContent', pointer: '/mission/id', mode: 'if-present-non-null'
  });
  assert.deepEqual(relation('mission_status', 'mission_readiness', 'next').unboundRequired, []);

  assert.ok(binding('mission_execute', 'worker_retry', 'missionId', 'recover'));
  assert.equal(binding('mission_execute', 'worker_retry', 'taskId', 'recover'), undefined);
  assert.deepEqual(relation('mission_execute', 'worker_retry', 'recover').unboundRequired, ['requestId', 'taskId']);

  assert.ok(binding('candidate_refresh', 'candidate_status', 'missionId', 'inspect'));
  assert.deepEqual(binding('candidate_refresh', 'candidate_status', 'candidateId', 'inspect'), {
    target: 'candidateId', source: 'structuredContent', pointer: '/candidate/id', mode: 'if-present-non-null'
  });

  assert.deepEqual(binding('experience_commit', 'experience_review', 'experienceId', 'next'), {
    target: 'experienceId', source: 'structuredContent', pointer: '/id', mode: 'if-present-non-null'
  });
  assert.deepEqual(relation('experience_commit', 'experience_review', 'next').unboundRequired, ['requestId', 'action']);

  assert.equal(binding('experience_audit', 'experience_review', 'experienceId', 'next'), undefined);
  assert.deepEqual(relation('experience_audit', 'experience_review', 'next').unboundRequired, ['requestId', 'experienceId', 'action']);
});

test('standalone fallback publishes workflow bindings for all public tools', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-tool-workflow-bindings-'));
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
    await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'workflow-bindings-test', version: '1.0.0' } });
    const listed = await request('tools/list', {});
    assertPublishedBindings(listed.tools);
  } finally {
    for (const item of pending.values()) clearTimeout(item.timer);
    child.stdin.end();
    child.kill('SIGTERM');
    await fs.rm(stateRoot, { recursive: true, force: true });
  }
});

test('official SDK publishes the same workflow bindings', { skip: !officialSdkAvailable }, async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-tool-workflow-bindings-sdk-'));
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/client'),
    import('@modelcontextprotocol/client/stdio')
  ]);
  const client = new Client({ name: 'workflow-bindings-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    cwd: root,
    env: { ...process.env, VETERAN_ENGINEER_STATE_DIR: stateRoot, VETERAN_MCP_REQUIRE_SDK: '1' },
    stderr: 'pipe'
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assertPublishedBindings(listed.tools);
  } finally {
    await client.close().catch(() => {});
    await fs.rm(stateRoot, { recursive: true, force: true });
  }
});
