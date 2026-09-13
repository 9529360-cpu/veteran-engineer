import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { WorkerAdapter, buildWorkerInvocation } from '../src/worker-adapter.mjs';

const execFileAsync = promisify(execFile);
const image = process.env.VETERAN_CONTAINER_SMOKE_IMAGE;

if (!image) {
  throw new Error('VETERAN_CONTAINER_SMOKE_IMAGE is required and must be a digest-pinned image already present in the local Docker engine');
}

const workerSource = String.raw`
import fs from 'node:fs/promises';

async function blockedWrite(target) {
  try {
    await fs.writeFile(target, 'should-not-write\n');
    return false;
  } catch (error) {
    return ['EROFS', 'EACCES', 'EPERM'].includes(error.code);
  }
}

const packet = JSON.parse(await fs.readFile(process.env.VETERAN_TASK_PACKET, 'utf8'));
if (packet.mode === 'sleep') {
  await new Promise((resolve) => setTimeout(resolve, 60_000));
  process.exit(0);
}

await fs.mkdir('/workspace/smoke', { recursive: true });
await fs.writeFile('/workspace/smoke/output.txt', 'workspace-write-ok\n');
await fs.writeFile('/tmp/veteran-smoke.tmp', 'tmp-write-ok\n');

let networkBlocked = false;
try {
  await fetch('http://1.1.1.1', { signal: AbortSignal.timeout(1500) });
} catch {
  networkBlocked = true;
}

const result = {
  packetReadable: packet.mode === 'probe',
  workspaceWritable: (await fs.readFile('/workspace/smoke/output.txt', 'utf8')).trim() === 'workspace-write-ok',
  tmpWritable: (await fs.readFile('/tmp/veteran-smoke.tmp', 'utf8')).trim() === 'tmp-write-ok',
  rootfsBlocked: await blockedWrite('/veteran-rootfs-probe'),
  gitMetadataBlocked: await blockedWrite('/workspace/.git'),
  networkBlocked
};
await fs.writeFile('/workspace/smoke/result.json', JSON.stringify(result));
`;

async function docker(args, options = {}) {
  return execFileAsync('docker', args, { timeout: 10_000, maxBuffer: 2_000_000, ...options });
}

async function containerExists(name) {
  try {
    await docker(['inspect', name]);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(name, expected, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await containerExists(name)) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Container ${name} did not reach expected existence=${expected}`);
}

function config(timeoutMs = 20_000) {
  return {
    type: 'container',
    engine: 'docker',
    image,
    containerCommand: ['node', '/workspace/worker.mjs'],
    pidsLimit: 64,
    memoryMb: 256,
    cpus: 0.5,
    timeoutMs
  };
}

function project() {
  return { workerPolicy: { enabled: true, allowUnconfinedCustomWorkers: false } };
}

async function main() {
  await docker(['version']);
  await docker(['image', 'inspect', image]);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-container-smoke-'));
  const worktreePath = path.join(root, 'worktree');
  const artifacts = path.join(root, 'artifacts');
  await fs.mkdir(path.join(worktreePath, 'smoke'), { recursive: true });
  await fs.mkdir(artifacts, { recursive: true });
  await fs.writeFile(path.join(worktreePath, '.git'), 'gitdir: /host/not-mounted/gitdir\n');
  await fs.writeFile(path.join(worktreePath, 'worker.mjs'), workerSource);

  const adapter = new WorkerAdapter();
  const mission = { id: 'smoke-mission' };

  try {
    const probeTask = { id: 'probe', key: 'smoke:probe', risk: 'high', writeSet: ['smoke'] };
    const probePacketPath = path.join(artifacts, 'probe-dispatch.json');
    const probe = await adapter.run({
      project: project(), mission, task: probeTask, worktreePath,
      packet: { mode: 'probe' }, packetPath: probePacketPath, config: config()
    });
    assert.equal(probe.code, 0, `probe worker failed: ${probe.stderr}`);
    const result = JSON.parse(await fs.readFile(path.join(worktreePath, 'smoke', 'result.json'), 'utf8'));
    assert.deepEqual(result, {
      packetReadable: true,
      workspaceWritable: true,
      tmpWritable: true,
      rootfsBlocked: true,
      gitMetadataBlocked: true,
      networkBlocked: true
    });
    assert.equal(await fs.readFile(path.join(worktreePath, '.git'), 'utf8'), 'gitdir: /host/not-mounted/gitdir\n');

    const cancelTask = { id: 'cancel', key: 'smoke:cancel', risk: 'high', writeSet: ['smoke'] };
    const cancelPacketPath = path.join(artifacts, 'cancel-dispatch.json');
    const cancelInvocation = buildWorkerInvocation({ config: config(), worktreePath, packetPath: cancelPacketPath, task: cancelTask, mission });
    const cancelRun = adapter.run({
      project: project(), mission, task: cancelTask, worktreePath,
      packet: { mode: 'sleep' }, packetPath: cancelPacketPath, config: config()
    });
    await waitFor(cancelInvocation.container.name, true);
    assert.equal(adapter.cancel(cancelTask.key), true);
    await cancelRun;
    await waitFor(cancelInvocation.container.name, false);

    const timeoutTask = { id: 'timeout', key: 'smoke:timeout', risk: 'high', writeSet: ['smoke'] };
    const timeoutPacketPath = path.join(artifacts, 'timeout-dispatch.json');
    const timeoutConfig = config(700);
    const timeoutInvocation = buildWorkerInvocation({ config: timeoutConfig, worktreePath, packetPath: timeoutPacketPath, task: timeoutTask, mission });
    const timeoutResult = await adapter.run({
      project: project(), mission, task: timeoutTask, worktreePath,
      packet: { mode: 'sleep' }, packetPath: timeoutPacketPath, config: timeoutConfig
    });
    assert.notEqual(timeoutResult.code, 0, 'timeout worker must not report success');
    await waitFor(timeoutInvocation.container.name, false);

    console.log(JSON.stringify({
      ok: true,
      image,
      isolation: result,
      cancelCleanup: true,
      timeoutCleanup: true
    }));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

await main();
