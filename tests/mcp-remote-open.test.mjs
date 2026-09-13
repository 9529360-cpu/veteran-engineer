import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runProcess } from '../src/git.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const server = path.join(root, 'mcp', 'server.mjs');

function createRpcClient(child) {
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
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(Object.assign(new Error(message.error.message), { data: message.error }));
      else waiter.resolve(message.result);
    }
  });
  return {
    request(method, params = undefined) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`timeout waiting for ${method}`));
        }, 10_000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`);
      });
    },
    close() {
      for (const waiter of pending.values()) clearTimeout(waiter.timer);
      pending.clear();
    }
  };
}

test('standalone MCP project_open accepts repoUrl and creates a managed checkout', async () => {
  const fixture = await createGitRepo();
  const bare = path.join(fixture.root, 'remote.git');
  await runProcess('git', ['clone', '--bare', fixture.repo, bare], { cwd: fixture.root });
  const repoUrl = pathToFileURL(bare).href;
  const child = spawn(process.execPath, [server], {
    cwd: root,
    env: { ...process.env, VETERAN_ENGINEER_STATE_DIR: fixture.stateRoot, VETERAN_MCP_FORCE_FALLBACK: '1' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const rpc = createRpcClient(child);
  try {
    await rpc.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'remote-open-test', version: '1.0.0' } });
    const response = await rpc.request('tools/call', {
      name: 'project_open',
      arguments: { requestId: 'mcp-remote-open', repoUrl }
    });
    assert.equal(response.isError, undefined, JSON.stringify(response));
    const project = JSON.parse(response.content[0].text);
    assert.equal(project.remoteUrl, repoUrl);
    assert.equal(project.sourceKind, 'managed-remote');
    assert.equal(project.checkout.reused, false);
    assert.ok(project.repoPath.startsWith(path.join(fixture.stateRoot, 'projects')));
    assert.equal(await fs.readFile(path.join(project.repoPath, 'README.md'), 'utf8'), 'hello\n');
  } finally {
    rpc.close();
    child.stdin.end();
    child.kill('SIGTERM');
    await cleanup(fixture.root);
  }
});
