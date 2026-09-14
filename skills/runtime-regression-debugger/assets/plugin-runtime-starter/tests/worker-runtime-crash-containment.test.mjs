import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { cleanup, tempDir } from './helpers.mjs';

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

async function waitForMissing(file, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fs.access(file);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    await sleep(25);
  }
  throw new Error(`Timed out waiting for ${file} to be removed`);
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
  assert.equal(after, before, 'worker heartbeat must stop after runtime parent death');
}

async function killIfAlive(pid) {
  try {
    if (Number.isInteger(pid) && pid > 0 && processAlive(pid)) process.kill(pid, 'SIGKILL');
  } catch {}
}

test('SIGKILL of the runtime parent cannot leave supervised worker descendants or disposable profile state running', { skip: process.platform === 'win32' }, async () => {
  const root = await tempDir('veteran-worker-runtime-crash-');
  const worktreePath = path.join(root, 'worktree');
  const artifactsPath = path.join(root, 'artifacts');
  const heartbeat = path.join(root, 'heartbeat.txt');
  const workerPidFile = path.join(root, 'worker.pid');
  const grandchildPidFile = path.join(root, 'grandchild.pid');
  const runtimeProfileRootFile = path.join(root, 'runtime-profile-root.txt');
  const workerReady = path.join(root, 'worker-ready.txt');
  const harnessReady = path.join(root, 'harness-ready.txt');
  const workerPath = path.join(root, 'worker-parent.cjs');
  const harnessPath = path.join(root, 'runtime-harness.mjs');
  let harness = null;
  let workerPid = null;
  let grandchildPid = null;
  let runtimeProfileRoot = null;
  try {
    await fs.mkdir(worktreePath, { recursive: true });
    await fs.mkdir(artifactsPath, { recursive: true });
    const grandchildSource = `const fs=require('node:fs');const file=${JSON.stringify(heartbeat)};fs.appendFileSync(file,'x');setInterval(()=>fs.appendFileSync(file,'x'),25);`;
    await fs.writeFile(workerPath, [
      "const fs=require('node:fs');",
      "const path=require('node:path');",
      "const {spawn}=require('node:child_process');",
      `fs.writeFileSync(${JSON.stringify(workerPidFile)}, String(process.pid));`,
      `fs.writeFileSync(${JSON.stringify(runtimeProfileRootFile)}, path.dirname(process.env.TMPDIR));`,
      `const child=spawn(process.execPath,['-e',${JSON.stringify(grandchildSource)}],{stdio:'ignore'});`,
      `fs.writeFileSync(${JSON.stringify(grandchildPidFile)}, String(child.pid));`,
      `fs.writeFileSync(${JSON.stringify(workerReady)}, 'ready\\n');`,
      'setInterval(()=>{},1000);'
    ].join('\n'));

    const adapterUrl = new URL('../src/worker-adapter.mjs', import.meta.url).href;
    await fs.writeFile(harnessPath, [
      `import { WorkerAdapter } from ${JSON.stringify(adapterUrl)};`,
      "import fs from 'node:fs/promises';",
      `const workerReady=${JSON.stringify(workerReady)};`,
      `const harnessReady=${JSON.stringify(harnessReady)};`,
      'const adapter=new WorkerAdapter();',
      `adapter.run({project:{workerPolicy:{enabled:true,allowUnconfinedCustomWorkers:false}},mission:{id:'M1'},task:{id:'T1',key:'M1:T1',risk:'low',writeSet:['src']},worktreePath:${JSON.stringify(worktreePath)},packet:{protocol:'veteran-worker-v1'},packetPath:${JSON.stringify(path.join(artifactsPath, 'packet.json'))},config:{type:'custom',command:process.execPath,args:[${JSON.stringify(workerPath)}],timeoutMs:30000}}).catch(()=>{});`,
      'for(let i=0;i<160;i+=1){try{await fs.access(workerReady);break;}catch{await new Promise((resolve)=>setTimeout(resolve,25));}}',
      'await fs.access(workerReady);',
      "await fs.writeFile(harnessReady,'ready\\n');",
      'setInterval(()=>{},1000);'
    ].join('\n'));

    harness = spawn(process.execPath, [harnessPath], { stdio: 'ignore', windowsHide: true });
    await waitForFile(harnessReady);
    await waitForFile(heartbeat);
    await waitForFile(runtimeProfileRootFile);
    workerPid = Number(await fs.readFile(workerPidFile, 'utf8'));
    grandchildPid = Number(await fs.readFile(grandchildPidFile, 'utf8'));
    runtimeProfileRoot = await fs.readFile(runtimeProfileRootFile, 'utf8');
    assert.equal(processAlive(workerPid), true);
    assert.equal(processAlive(grandchildPid), true);
    await fs.access(runtimeProfileRoot);

    harness.kill('SIGKILL');
    await new Promise((resolve) => harness.once('close', resolve));
    await waitForProcessExit(workerPid);
    await waitForProcessExit(grandchildPid);
    await waitForMissing(runtimeProfileRoot);
    await assertHeartbeatStopped(heartbeat);
  } finally {
    await killIfAlive(workerPid);
    await killIfAlive(grandchildPid);
    try { harness?.kill('SIGKILL'); } catch {}
    if (runtimeProfileRoot) await fs.rm(runtimeProfileRoot, { recursive: true, force: true }).catch(() => {});
    await cleanup(root);
  }
});
