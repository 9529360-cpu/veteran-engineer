import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { WorkerAdapter } from '../src/worker-adapter.mjs';
import { cleanup, tempDir } from './helpers.mjs';

const project = { workerPolicy: { enabled: true, allowUnconfinedCustomWorkers: false } };
const mission = { id: 'M1' };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(file, timeoutMs = 5_000) {
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

async function waitForProcessExit(pid, timeoutMs = 5_000) {
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
  assert.equal(after, before, 'background heartbeat must stop after the owning execution ends');
}

async function killIfAlive(pid) {
  try {
    if (Number.isInteger(pid) && pid > 0 && processAlive(pid)) process.kill(pid, 'SIGKILL');
  } catch {}
}

async function runtimePaths(root, packetName) {
  const worktreePath = path.join(root, 'worktree');
  const artifactsPath = path.join(root, 'artifacts');
  await fs.mkdir(worktreePath, { recursive: true });
  await fs.mkdir(artifactsPath, { recursive: true });
  return { worktreePath, packetPath: path.join(artifactsPath, packetName) };
}

test('SIGKILL of the trusted supervisor cannot orphan an already-running worker tree', { skip: process.platform === 'win32' }, async () => {
  const root = await tempDir('veteran-worker-supervisor-loss-');
  const runtime = await runtimePaths(root, 'supervisor-loss.json');
  const heartbeat = path.join(root, 'heartbeat.txt');
  const workerPidFile = path.join(root, 'worker.pid');
  const grandchildPidFile = path.join(root, 'grandchild.pid');
  const profileRootFile = path.join(root, 'profile-root.txt');
  const ready = path.join(root, 'ready.txt');
  const workerPath = path.join(root, 'worker-parent.cjs');
  let workerPid = null;
  let grandchildPid = null;
  let supervisorPid = null;
  let profileRoot = null;
  try {
    const grandchildSource = `const fs=require('node:fs');const file=${JSON.stringify(heartbeat)};fs.appendFileSync(file,'x');setInterval(()=>fs.appendFileSync(file,'x'),25);`;
    await fs.writeFile(workerPath, [
      "const fs=require('node:fs');",
      "const path=require('node:path');",
      "const {spawn}=require('node:child_process');",
      `fs.writeFileSync(${JSON.stringify(workerPidFile)},String(process.pid));`,
      `fs.writeFileSync(${JSON.stringify(profileRootFile)},path.dirname(process.env.TMPDIR));`,
      `const child=spawn(process.execPath,['-e',${JSON.stringify(grandchildSource)}],{stdio:'ignore'});`,
      `fs.writeFileSync(${JSON.stringify(grandchildPidFile)},String(child.pid));`,
      `fs.writeFileSync(${JSON.stringify(ready)},'ready\\n');`,
      'setInterval(()=>{},1000);'
    ].join('\n'));

    const adapter = new WorkerAdapter();
    const task = { id: 'T1', key: 'M1:T1', risk: 'low', writeSet: ['src'] };
    const run = adapter.run({
      project,
      mission,
      task,
      worktreePath: runtime.worktreePath,
      packet: { protocol: 'veteran-worker-v1' },
      packetPath: runtime.packetPath,
      config: { type: 'custom', command: process.execPath, args: [workerPath], timeoutMs: 30_000 }
    });

    await waitForFile(ready);
    await waitForFile(heartbeat);
    workerPid = Number(await fs.readFile(workerPidFile, 'utf8'));
    grandchildPid = Number(await fs.readFile(grandchildPidFile, 'utf8'));
    profileRoot = await fs.readFile(profileRootFile, 'utf8');
    const snapshot = adapter.snapshot();
    assert.equal(snapshot.length, 1);
    supervisorPid = snapshot[0].supervisorPid;
    assert.ok(Number.isInteger(supervisorPid) && supervisorPid > 0);
    assert.equal(processAlive(workerPid), true);
    assert.equal(processAlive(grandchildPid), true);

    process.kill(supervisorPid, 'SIGKILL');
    const result = await run;
    assert.notEqual(result.code, 0);
    assert.equal(result.signal, 'SIGKILL');
    await waitForProcessExit(workerPid);
    await waitForProcessExit(grandchildPid);
    await assertHeartbeatStopped(heartbeat);
  } finally {
    await killIfAlive(supervisorPid);
    await killIfAlive(workerPid);
    await killIfAlive(grandchildPid);
    if (profileRoot) await fs.rm(profileRoot, { recursive: true, force: true }).catch(() => {});
    await cleanup(root);
  }
});

test('successful worker exit reaps background descendants before adapter completion', { skip: process.platform === 'win32' }, async () => {
  const root = await tempDir('veteran-worker-background-reap-');
  const runtime = await runtimePaths(root, 'background-reap.json');
  const heartbeat = path.join(root, 'heartbeat.txt');
  const grandchildPidFile = path.join(root, 'grandchild.pid');
  const grandchildPath = path.join(root, 'background-child.cjs');
  const workerPath = path.join(root, 'worker-parent.cjs');
  let grandchildPid = null;
  try {
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
    const task = { id: 'T2', key: 'M1:T2', risk: 'low', writeSet: ['src'] };
    const result = await adapter.run({
      project,
      mission,
      task,
      worktreePath: runtime.worktreePath,
      packet: { protocol: 'veteran-worker-v1' },
      packetPath: runtime.packetPath,
      config: { type: 'custom', command: process.execPath, args: [workerPath], timeoutMs: 10_000 }
    });

    assert.equal(result.code, 0);
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
