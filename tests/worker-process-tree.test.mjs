import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { WorkerAdapter } from '../src/worker-adapter.mjs';
import { cleanup, processRunning, tempDir, waitForProcessStopped } from './helpers.mjs';

const project = { workerPolicy: { enabled: true, allowUnconfinedCustomWorkers: false } };
const mission = { id: 'M1' };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(file, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fs.access(file);
      return;
    } catch {
      await sleep(25);
    }
  }
  throw new Error(`Timed out waiting for ${file}`);
}

async function assertHeartbeatStopped(file) {
  await sleep(150);
  const before = (await fs.stat(file)).size;
  await sleep(250);
  const after = (await fs.stat(file)).size;
  assert.equal(after, before, 'worker descendant heartbeat must stop after lifecycle termination');
}

async function createProcessTreeFixture(root, name) {
  const heartbeat = path.join(root, `${name}-heartbeat.txt`);
  const pidFile = path.join(root, `${name}-grandchild.pid`);
  const grandchildSource = `const fs=require('node:fs');const file=${JSON.stringify(heartbeat)};fs.appendFileSync(file,'x');setInterval(()=>fs.appendFileSync(file,'x'),25);`;
  const parent = path.join(root, `${name}-parent.cjs`);
  await fs.writeFile(parent, `const fs=require('node:fs');const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(grandchildSource)}],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));setInterval(()=>{},1000);\n`);
  return { heartbeat, pidFile, parent };
}

async function cleanupGrandchild(pidFile) {
  try {
    const pid = Number(await fs.readFile(pidFile, 'utf8'));
    if (await processRunning(pid)) process.kill(pid, 'SIGKILL');
  } catch {}
}

async function runtimePaths(root, packetName) {
  const worktreePath = path.join(root, 'worktree');
  const artifactsPath = path.join(root, 'artifacts');
  await fs.mkdir(worktreePath, { recursive: true });
  await fs.mkdir(artifactsPath, { recursive: true });
  return { worktreePath, packetPath: path.join(artifactsPath, packetName) };
}

test('worker timeout terminates descendant processes and reports timeout ownership', { skip: process.platform === 'win32' }, async () => {
  const root = await tempDir('veteran-worker-tree-timeout-');
  const task = { id: 'T1', key: 'M1:T1', risk: 'low', writeSet: ['src'] };
  const fixture = await createProcessTreeFixture(root, 'timeout');
  try {
    const adapter = new WorkerAdapter();
    const runtime = await runtimePaths(root, 'timeout-packet.json');
    const result = await adapter.run({
      project,
      mission,
      task,
      worktreePath: runtime.worktreePath,
      packet: { task: task.id },
      packetPath: runtime.packetPath,
      config: { type: 'custom', command: process.execPath, args: [fixture.parent], timeoutMs: 300 }
    });
    assert.equal(result.termination?.reason, 'timeout');
    assert.equal(result.termination?.signal, 'SIGTERM');
    assert.equal(typeof result.termination?.requestedAt, 'string');
    assert.ok(result.durationMs >= 250);
    assert.deepEqual(adapter.snapshot(), []);
    await waitForFile(fixture.pidFile);
    await waitForFile(fixture.heartbeat);
    await assertHeartbeatStopped(fixture.heartbeat);
    const pid = Number(await fs.readFile(fixture.pidFile, 'utf8'));
    assert.equal(await waitForProcessStopped(pid), true, 'timeout must not leave the worker grandchild running');
  } finally {
    await cleanupGrandchild(fixture.pidFile);
    await cleanup(root);
  }
});

test('worker cancel terminates descendant processes and exposes live/cancel lifecycle state', { skip: process.platform === 'win32' }, async () => {
  const root = await tempDir('veteran-worker-tree-cancel-');
  const task = { id: 'T2', key: 'M1:T2', risk: 'low', writeSet: ['src'] };
  const fixture = await createProcessTreeFixture(root, 'cancel');
  try {
    const adapter = new WorkerAdapter();
    const runtime = await runtimePaths(root, 'cancel-packet.json');
    const run = adapter.run({
      project,
      mission,
      task,
      worktreePath: runtime.worktreePath,
      packet: { task: task.id },
      packetPath: runtime.packetPath,
      config: { type: 'custom', command: process.execPath, args: [fixture.parent], timeoutMs: 10_000 }
    });
    await waitForFile(fixture.pidFile);
    await waitForFile(fixture.heartbeat);
    const active = adapter.snapshot();
    assert.equal(active.length, 1);
    assert.equal(active[0].taskKey, task.key);
    assert.equal(active[0].runtimeNamespace, 'M1:T2:cancel-packet');
    assert.equal(active[0].termination, null);
    assert.equal(adapter.cancel(task.key), true);
    const terminating = adapter.snapshot();
    assert.equal(terminating[0].termination?.reason, 'operator-cancel');
    const result = await run;
    assert.equal(result.termination?.reason, 'operator-cancel');
    assert.equal(result.termination?.signal, 'SIGTERM');
    assert.deepEqual(adapter.snapshot(), []);
    await assertHeartbeatStopped(fixture.heartbeat);
    const pid = Number(await fs.readFile(fixture.pidFile, 'utf8'));
    assert.equal(await waitForProcessStopped(pid), true, 'cancel must not leave the worker grandchild running');
  } finally {
    await cleanupGrandchild(fixture.pidFile);
    await cleanup(root);
  }
});
