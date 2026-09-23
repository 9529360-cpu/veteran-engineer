import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runProcess } from '../src/git.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const handshake = path.join(root, 'scripts', 'mcp-handshake.mjs');
const server = path.join(root, 'mcp', 'server.mjs');

function hasPackage(name) {
  try {
    createRequire(import.meta.url).resolve(name);
    return true;
  } catch {
    return false;
  }
}

const officialSdkAvailable = hasPackage('@modelcontextprotocol/client') && hasPackage('@modelcontextprotocol/server') && hasPackage('@modelcontextprotocol/core') && hasPackage('zod');

async function tempState() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'veteran-mcp-test-'));
}

test('standalone fallback performs real legacy handshake with exact 36-tool surface', async () => {
  const state = await tempState();
  try {
    const result = await runProcess(process.execPath, [handshake, '--server', server, '--mode', 'legacy', '--force-fallback', '--expect-tools', '36', '--state-root', state], { cwd: root });
    const report = JSON.parse(result.stdout.trim());
    assert.equal(report.ok, true);
    assert.equal(report.era, 'legacy');
    assert.equal(report.protocolVersion, '2025-11-25');
    assert.equal(report.toolCount, 36);
    assert.equal(report.runtime.mcp.implementation, 'standalone-fallback');
    assert.deepEqual(report.runtime.mcp.eras, ['legacy']);
  } finally {
    await fs.rm(state, { recursive: true, force: true });
  }
});

test('standalone fallback rejects modern server/discover instead of pretending to implement 2026 wire', async () => {
  const state = await tempState();
  const child = spawn(process.execPath, [server], {
    cwd: root,
    env: { ...process.env, VETERAN_ENGINEER_STATE_DIR: state, VETERAN_MCP_FORCE_FALLBACK: '1' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  try {
    child.stdout.setEncoding('utf8');
    let buffer = '';
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for server/discover rejection')), 5000);
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        const index = buffer.indexOf('\n');
        if (index < 0) return;
        clearTimeout(timer);
        resolve(JSON.parse(buffer.slice(0, index)));
      });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: {} })}\n`);
    const message = await response;
    assert.equal(message.error.code, -32601);
    assert.equal(message.error.message, 'Method not found');
  } finally {
    child.stdin.end();
    child.kill('SIGTERM');
    await fs.rm(state, { recursive: true, force: true });
  }
});

test('pinned official SDK 2026-era handshake passes when pinned SDK packages are installed', { skip: !officialSdkAvailable }, async () => {
  const state = await tempState();
  try {
    const result = await runProcess(process.execPath, [handshake, '--server', server, '--mode', 'modern-pinned', '--require-sdk', '--require-server-sdk', '--stateful', '--expect-tools', '36', '--state-root', state], { cwd: root, timeoutMs: 45_000 });
    const report = JSON.parse(result.stdout.trim());
    assert.equal(report.era, 'modern');
    assert.equal(report.toolCount, 36);
    assert.equal(report.stateful.tool, 'project_open');
    assert.ok(report.stateful.projectId);
    assert.equal(report.runtime.mcp.implementation, 'official-sdk');
    assert.deepEqual(report.runtime.mcp.eras, ['modern', 'legacy']);
  } finally {
    await fs.rm(state, { recursive: true, force: true });
  }
});

test('modern official client auto-negotiates safely down to legacy fallback', { skip: !officialSdkAvailable }, async () => {
  const state = await tempState();
  try {
    const result = await runProcess(process.execPath, [handshake, '--server', server, '--mode', 'auto', '--require-sdk', '--force-fallback', '--expect-tools', '36', '--state-root', state], { cwd: root, timeoutMs: 45_000 });
    const report = JSON.parse(result.stdout.trim());
    assert.equal(report.era, 'legacy');
    assert.equal(report.runtime.mcp.implementation, 'standalone-fallback');
    const pinned = await runProcess(process.execPath, [handshake, '--server', server, '--mode', 'modern-pinned', '--require-sdk', '--force-fallback', '--expect-tools', '36', '--state-root', state], { cwd: root, timeoutMs: 45_000, allowFailure: true });
    assert.notEqual(pinned.code, 0, 'modern pin must fail against standalone fallback');
  } finally {
    await fs.rm(state, { recursive: true, force: true });
  }
});

test('standalone fallback reaches mission_execute(runWorkers=true) end to end through MCP', async () => {
  const { createGitRepo, cleanup } = await import('./helpers.mjs');
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  const worker = path.join(fixture.root, 'mcp-worker.cjs');
  await fs.writeFile(worker, `const fs=require('fs'),p=require('path');fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','a.txt'),'mcp-change\\n');\n`);
  await fs.mkdir(fixture.stateRoot, { recursive: true });
  await fs.writeFile(path.join(fixture.stateRoot, 'operator.json'), `${JSON.stringify({ defaults: { workerPolicy: { enabled: true, maxWorkers: 1, workers: { default: { type: 'custom', command: process.execPath, args: [worker] } } } } }, null, 2)}\n`);
  const child = spawn(process.execPath, [server], {
    cwd: root,
    env: { ...process.env, VETERAN_ENGINEER_STATE_DIR: fixture.stateRoot, VETERAN_MCP_FORCE_FALLBACK: '1' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let buffer = '';
  let nextId = 1;
  const pending = new Map();
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (;;) {
      const i = buffer.indexOf('\n');
      if (i < 0) break;
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const item = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(item.timer);
        if (msg.error) item.reject(Object.assign(new Error(msg.error.message), { data: msg.error }));
        else item.resolve(msg.result);
      }
    }
  });
  const request = (method, params = undefined) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout: ${method}`)); }, 10_000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`);
  });
  const call = async (name, args) => {
    const result = await request('tools/call', { name, arguments: args });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  };
  try {
    await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'mcp-e2e', version: '1.0.0' } });
    const project = await call('project_open', { requestId: 'mcp-open', repoPath: fixture.repo });
    const planned = await call('mission_plan', {
      requestId: 'mcp-plan',
      projectId: project.id,
      goal: 'MCP worker smoke',
      doneDefinition: 'worker mutation integrated into mission worktree',
      tasks: [{ id: 'T1', contract: 'change src/a.txt', owner: 'src', dependencies: [], writeSet: ['src'], risk: 'low' }]
    });
    const executed = await call('mission_execute', { requestId: 'mcp-execute', missionId: planned.mission.id, runWorkers: true });
    assert.equal(executed.results[0].ok, true);
    assert.ok(executed.results[0].commitSha);
    const status = await call('mission_status', { missionId: planned.mission.id });
    assert.equal(status.tasks[0].status, 'done');
    assert.equal(await fs.readFile(path.join(fixture.repo, 'src/a.txt'), 'utf8'), 'before\n');
  } finally {
    for (const item of pending.values()) clearTimeout(item.timer);
    child.stdin.end();
    child.kill('SIGTERM');
    await cleanup(fixture.root);
  }
});
