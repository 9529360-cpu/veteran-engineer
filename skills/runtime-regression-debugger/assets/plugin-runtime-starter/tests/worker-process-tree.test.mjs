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

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
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
    if (Number.isInteger(pid) && pid > 0 && processAlive(pid)) process.kill(pid, 'SIGKILL');
  } catch {}
}

test('worker timeout terminates descendant processes in the owned process group', { skip: process.platform === 'win32' }, async () => {
  const root = await tempDir('veteran-worker-tree-timeout-');
  const task = { id: 'T1', key: 'M1:T1', risk: 'low', writeSet: ['src'] };
  const fixture = await createProcessTreeFixture(root, 'timeout');
  try {
    const adapter = new WorkerAdapter();
    await adapter.run({
      project,
      mission,
      task,
      worktreePath: root,
      packet: { task: task.id },
      packetPath: path.join(root, 'timeout-packet.json'),
      config: { type: 'custom', command: process.execPath, args: [fixture.parent], timeoutMs: 300 }
    });
    await waitForFile(fixture.pidFile);
    await waitForFile(fixture.heartbeat);
    await assertHeartbeatStopped(fixture.heartbeat);
    const pid = Number(await fs.readFile(fixture.pidFile, 'utf8'));
    assert.equal(processAlive(pid), false, 'timeout must not leave the worker grandchild alive');
  } finally {
    await cleanupGrandchild(fixture.pidFile);
    await cleanup(root);
  }
});

test('worker cancel terminates descendant processes in the owned process group', { skip: process.platform === 'win32' }, async () => {
  const root = await tempDir('veteran-worker-tree-cancel-');
  const task = { id: 'T2', key: 'M1:T2', risk: 'low', writeSet: ['src'] };
  const fixture = await createProcessTreeFixture(root, 'cancel');
  try {
    const adapter = new WorkerAdapter();
    const run = adapter.run({
      project,
      mission,
      task,
      worktreePath: root,
      packet: { task: task.id },
      packetPath: path.join(root, 'cancel-packet.json'),
      config: { type: 'custom', command: process.execPath, args: [fixture.parent], timeoutMs: 10_000 }
    });
    await waitForFile(fixture.pidFile);
    await waitForFile(fixture.heartbeat);
    assert.equal(adapter.cancel(task.key), true);
    await run;
    await assertHeartbeatStopped(fixture.heartbeat);
    const pid = Number(await fs.readFile(fixture.pidFile, 'utf8'));
    assert.equal(processAlive(pid), false, 'cancel must not leave the worker grandchild alive');
  } finally {
    await cleanupGrandchild(fixture.pidFile);
    await cleanup(root);
  }
});
