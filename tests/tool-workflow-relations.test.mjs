import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { TOOL_NAMES } from '../src/tool-catalog.mjs';
import {
  TOOL_WORKFLOW_META_KEY,
  TOOL_WORKFLOW_RELATIONS,
  TOOL_WORKFLOW_SCHEMA,
  toolWorkflowMeta
} from '../src/tool-workflow-relations.mjs';

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

function relation(from, to, kind) {
  return TOOL_WORKFLOW_RELATIONS[from].relations.find((edge) => edge.tool === to && edge.kind === kind);
}

function assertPublishedWorkflow(tools) {
  assert.equal(tools.length, 34);
  for (const tool of tools) {
    assert.ok(TOOL_NAMES.includes(tool.name), `unexpected tool ${tool.name}`);
    assert.deepEqual(
      tool._meta?.[TOOL_WORKFLOW_META_KEY],
      toolWorkflowMeta(tool.name)[TOOL_WORKFLOW_META_KEY],
      `workflow metadata drift for ${tool.name}`
    );
  }
}

test('workflow relations cover the exact 34-tool public surface with valid discoverability metadata', () => {
  assert.equal(TOOL_NAMES.length, 34);
  assert.equal(Object.keys(TOOL_WORKFLOW_RELATIONS).length, TOOL_NAMES.length);
  for (const name of TOOL_NAMES) {
    const workflow = TOOL_WORKFLOW_RELATIONS[name];
    assert.equal(workflow.schema, TOOL_WORKFLOW_SCHEMA, name);
    assert.equal(typeof workflow.group, 'string', name);
    assert.ok(workflow.group.length > 0, name);
    assert.ok(Array.isArray(workflow.scopeKeys), name);
    assert.ok(Array.isArray(workflow.relations), name);
    assert.ok(workflow.relations.length > 0, name);
    const meta = toolWorkflowMeta(name);
    assert.deepEqual(Object.keys(meta), [TOOL_WORKFLOW_META_KEY], name);
    assert.equal(meta[TOOL_WORKFLOW_META_KEY], workflow, name);
    for (const edge of workflow.relations) {
      assert.ok(TOOL_NAMES.includes(edge.tool), `${name} -> ${edge.tool}`);
      assert.ok(['next', 'inspect', 'recover', 'refresh', 'alternate'].includes(edge.kind), `${name} -> ${edge.tool}`);
      assert.equal(typeof edge.when, 'string', `${name} -> ${edge.tool}`);
      assert.ok(edge.when.length > 0, `${name} -> ${edge.tool}`);
    }
  }
});

test('workflow relations make the primary operator journeys and recovery paths discoverable', () => {
  assert.ok(relation('project_open', 'mission_plan', 'next'));
  assert.ok(relation('project_open', 'project_snapshot', 'refresh'));
  assert.ok(relation('mission_plan', 'mission_execute', 'next'));
  assert.ok(relation('mission_execute', 'mission_readiness', 'next'));
  assert.equal(relation('mission_execute', 'mission_advance', 'next'), undefined);
  assert.ok(relation('mission_execute', 'worker_retry', 'recover'));
  assert.ok(relation('mission_status', 'mission_resume', 'recover'));
  assert.ok(relation('mission_advance', 'mission_resume', 'recover'));
  assert.ok(relation('mission_advance', 'remediation_plan', 'recover'));
  assert.ok(relation('review_run', 'semantic_review_run', 'next'));
  assert.ok(relation('semantic_review_run', 'candidate_preflight', 'next'));
  assert.ok(relation('candidate_preflight', 'candidate_refresh', 'recover'));
  assert.ok(relation('candidate_status', 'handoff_export', 'next'));
  assert.ok(relation('experience_commit', 'experience_review', 'next'));
  assert.ok(relation('experience_challenge', 'experience_review', 'next'));
  assert.ok(relation('runtime_health', 'runtime_integrity', 'inspect'));
  assert.ok(relation('runtime_integrity', 'runtime_maintenance', 'recover'));
});

test('standalone fallback publishes workflow relations for all public tools', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-tool-workflow-'));
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
    await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'workflow-test', version: '1.0.0' } });
    const listed = await request('tools/list', {});
    assertPublishedWorkflow(listed.tools);
  } finally {
    for (const item of pending.values()) clearTimeout(item.timer);
    child.stdin.end();
    child.kill('SIGTERM');
    await fs.rm(stateRoot, { recursive: true, force: true });
  }
});

test('official SDK publishes the same workflow relations', { skip: !officialSdkAvailable }, async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-tool-workflow-sdk-'));
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/client'),
    import('@modelcontextprotocol/client/stdio')
  ]);
  const client = new Client({ name: 'workflow-test', version: '1.0.0' });
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
    assertPublishedWorkflow(listed.tools);
  } finally {
    await client.close().catch(() => {});
    await fs.rm(stateRoot, { recursive: true, force: true });
  }
});