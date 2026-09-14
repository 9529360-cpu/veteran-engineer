import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { WorkerAdapter } from '../src/worker-adapter.mjs';
import { cleanup, tempDir } from './helpers.mjs';

const project = { workerPolicy: { enabled: true, allowUnconfinedCustomWorkers: false } };
const mission = { id: 'M1' };
const task = { id: 'T1', key: 'M1:T1', risk: 'low', writeSet: ['src'] };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(file, timeoutMs = 4_000) {
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

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForProcessExit(pid, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return;
    await sleep(25);
  }
  throw new Error(`Timed out waiting for process ${pid} to exit`);
}

async function assertHeartbeatStopped(file) {
  await sleep(150);
  const before = (await fs.stat(file)).size;
  await sleep(250);
  const after = (await fs.stat(file)).size;
  assert.equal(after, before, 'worker descendant heartbeat must stop after worker execution ends');
}

async function killIfAlive(pid) {
  try {
    if (Number.isInteger(pid) && pid > 0 && processAlive(pid)) process.kill(pid, 'SIGKILL');
  } catch {}
}

test('unexpected supervisor SIGKILL fails closed and drains the real worker tree', { skip: process.platform === 'win32' }, async () => {
  const root = await tempDir('veteran-worker-supervisor-loss-');
  const worktreePath = path.join(root, 'worktree');
  const artifactsPath = path.join(root, 'artifacts');
  const heartbeat = path.join(root, 'heartbeat.txt');
  const grandchildPidFile = path.join(root, 'grandchild.pid');
  const workerPath = path.join(root, 'worker-parent.cjs');
  let workerPid = null;
  let grandchildPid = null;
  let supervisorPid = null;
  try {
    await fs.mkdir(worktreePath, { recursive: true });
    await fs.mkdir(artifactsPath, { recursive: true });
    const grandchildSource = `const fs=require('node:fs');const file=${JSON.stringify(heartbeat)};fs.appendFileSync(file,'x');setInterval(()=>fs.appendFileSync(file,'x'),25);`;
    await fs.writeFile(workerPath, [
      "const fs=require('node:fs');",
      "const {spawn}=require('node:child_process');",
      `const child=spawn(process.execPath,['-e',${JSON.stringify(grandchildSource)}],{stdio:'ignore'});`,
      `fs.writeFileSync(${JSON.stringify(grandchildPidFile)},String(child.pid));`,
      'setInterval(()=>{},1000);'
    ].join('\n'));

    const adapter = new WorkerAdapter();
    const run = adapter.run({
      project,
      mission,
      task,
      worktreePath,
      packet: { protocol: 'veteran-worker-v1' },
      packetPath: path.join(artifactsPath, 'packet.json'),
      packetRoot: artifactsPath,
      config: { type: 'custom', command: process.execPath, args: [workerPath], timeoutMs: 30_000 }
    });

    await waitForFile(grandchildPidFile);
    await waitForFile(heartbeat);
    const active = adapter.snapshot();
    assert.equal(active.length, 1);
    workerPid = active[0].pid;
    supervisorPid = active[0].supervisorPid;
    grandchildPid = Number(await fs.readFile(grandchildPidFile, 'utf8'));
    assert.equal(processAlive(workerPid), true);
    assert.equal(processAlive(grandchildPid), true);
    assert.equal(processAlive(supervisorPid), true);

    process.kill(supervisorPid, 'SIGKILL');
    await assert.rejects(run, (error) => {
      assert.equal(error?.code, 'WORKER_SUPERVISOR_LOST');
      assert.equal(error?.details?.pid, workerPid);
      assert.equal(error?.details?.supervisorPid, supervisorPid);
      assert.equal(error?.details?.termination?.reason, 'supervisor-lost');
      return true;
    });

    await waitForProcessExit(workerPid);
    await waitForProcessExit(grandchildPid);
    await assertHeartbeatStopped(heartbeat);
    assert.deepEqual(adapter.snapshot(), []);
  } finally {
    await killIfAlive(supervisorPid);
    await killIfAlive(workerPid);
    await killIfAlive(grandchildPid);
    await cleanup(root);
  }
});

test('successful worker exit reaps background descendants before adapter completion', { skip: process.platform === 'win32' }, async () => {
  const root = await tempDir('veteran-worker-background-reap-');
  const worktreePath = path.join(root, 'worktree');
  const artifactsPath = path.join(root, 'artifacts');
  const heartbeat = path.join(root, 'heartbeat.txt');
  const grandchildPidFile = path.join(root, 'grandchild.pid');
  const grandchildPath = path.join(root, 'background-child.cjs');
  const workerPath = path.join(root, 'worker-parent.cjs');
  let grandchildPid = null;
  try {
    await fs.mkdir(worktreePath, { recursive: true });
    await fs.mkdir(artifactsPath, { recursive: true });
    await fs.writeFile(grandchildPath, [
      "const fs=require('node:fs');",
      `fs.writeFileSync(${JSON.stringify(grandchildPidFile)},String(process.pid));`,
      `fs.appendFileSync(${JSON.stringify(heartbeat)},'x');`,
      `setInterval(()=>fs.appendFileSync(${JSON.stringify(heartbeat)},'x'),25);`,
      "if(process.send)process.send('ready');"
    ].join('\n'));
    await fs.writeFile(workerPath, [
      "const {fork}=require('node:child_process');",
      `const child=fork(${JSON.stringify(grandchildPath)},[],{stdio:['ignore','ignore','ignore','ipc']});`,
      "child.once('message',()=>process.exit(0));"
    ].join('\n'));

    const adapter = new WorkerAdapter();
    const result = await adapter.run({
      project,
      mission,
      task: { id: 'T2', key: 'M1:T2', risk: 'low', writeSet: ['src'] },
      worktreePath,
      packet: { protocol: 'veteran-worker-v1' },
      packetPath: path.join(artifactsPath, 'packet.json'),
      packetRoot: artifactsPath,
      config: { type: 'custom', command: process.execPath, args: [workerPath], timeoutMs: 10_000 }
    });

    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    await waitForFile(grandchildPidFile);
    await waitForFile(heartbeat);
    grandchildPid = Number(await fs.readFile(grandchildPidFile, 'utf8'));
    await waitForProcessExit(grandchildPid);
    await assertHeartbeatStopped(heartbeat);
    assert.deepEqual(adapter.snapshot(), []);
  } finally {
    await killIfAlive(grandchildPid);
    await cleanup(root);
  }
});
