import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { REQUEST_ID_TOOL_NAMES, TOOL_NAMES, toolInputJsonSchema, toolRequiresRequestId } from '../src/tool-catalog.mjs';
import { cleanup, tempDir } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const server = path.join(root, 'mcp', 'server.mjs');

async function requestFallbackTools(stateRoot) {
  const child = spawn(process.execPath, [server], {
    cwd: root,
    env: { ...process.env, VETERAN_ENGINEER_STATE_DIR: stateRoot, VETERAN_MCP_FORCE_FALLBACK: '1' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let buffer = '';
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
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
      const item = pending.get(message.id);
      if (!item) continue;
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(Object.assign(new Error(message.error.message), { details: message.error }));
      else item.resolve(message.result);
    }
  });
  const request = (method, params = undefined) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}; stderr=${stderr.slice(0, 1000)}`));
    }, 10_000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`);
  });
  try {
    await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'schema-test', version: '1.0.0' } });
    return (await request('tools/list')).tools;
  } finally {
    for (const item of pending.values()) clearTimeout(item.timer);
    child.stdin.end();
    child.kill('SIGTERM');
  }
}

test('requestId catalog matches the runtime mutation gate for every public tool', async () => {
  const stateRoot = await tempDir('veteran-request-id-contract-');
  try {
    const app = await createVeteranApp({ stateRoot });
    assert.equal(TOOL_NAMES.length, 36);
    assert.equal(REQUEST_ID_TOOL_NAMES.length, 24);
    assert.deepEqual([...new Set(REQUEST_ID_TOOL_NAMES)].sort(), [...REQUEST_ID_TOOL_NAMES].sort());

    for (const name of TOOL_NAMES) {
      let requiresRequestIdAtRuntime = false;
      try {
        await app.callTool(name, {});
      } catch (error) {
        requiresRequestIdAtRuntime = error?.code === 'REQUEST_ID_REQUIRED';
      }
      assert.equal(
        toolRequiresRequestId(name),
        requiresRequestIdAtRuntime,
        `${name} requestId catalog/runtime contract drifted`
      );
      const schema = toolInputJsonSchema(name);
      assert.equal(schema.required?.includes('requestId') || false, requiresRequestIdAtRuntime, `${name} JSON schema drifted`);
    }
  } finally {
    await cleanup(stateRoot);
  }
});

test('fallback tools/list publishes requestId only for mutating tools', async () => {
  const stateRoot = await tempDir('veteran-request-id-mcp-');
  try {
    const tools = await requestFallbackTools(stateRoot);
    assert.equal(tools.length, 36);
    for (const tool of tools) {
      const required = tool.inputSchema?.required || [];
      const requiresRequestId = required.includes('requestId');
      assert.equal(requiresRequestId, toolRequiresRequestId(tool.name), `${tool.name} fallback schema drifted`);
      if (requiresRequestId) {
        assert.equal(tool.inputSchema.properties.requestId.type, 'string');
        assert.equal(tool.inputSchema.properties.requestId.minLength, 1);
      }
    }
    assert.equal(tools.find((tool) => tool.name === 'project_open').inputSchema.required.includes('requestId'), true);
    assert.equal(tools.find((tool) => tool.name === 'handoff_export').inputSchema.required.includes('requestId'), true);
    assert.equal((tools.find((tool) => tool.name === 'mission_status').inputSchema.required || []).includes('requestId'), false);
  } finally {
    await cleanup(stateRoot);
  }
});
