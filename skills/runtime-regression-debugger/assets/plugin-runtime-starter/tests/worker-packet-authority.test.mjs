import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { WorkerAdapter, writeWorkerPacket } from '../src/worker-adapter.mjs';
import { cleanup, tempDir } from './helpers.mjs';

const project = { workerPolicy: { enabled: true, allowUnconfinedCustomWorkers: false } };
const mission = { id: 'M1' };
const task = { id: 'T1', key: 'M1:T1', risk: 'low', writeSet: ['src'] };

async function missing(target) {
  await assert.rejects(fs.access(target), (error) => error?.code === 'ENOENT');
}

test('adapter refuses to overwrite or remove an existing packet target before spawn', async () => {
  const root = await tempDir('veteran-worker-packet-exclusive-');
  try {
    const worktreePath = path.join(root, 'worktree');
    const packetRoot = path.join(root, 'artifacts');
    const packetPath = path.join(packetRoot, 'existing.json');
    const marker = path.join(root, 'spawned.txt');
    await fs.mkdir(worktreePath, { recursive: true });
    await fs.mkdir(packetRoot, { recursive: true });
    await fs.writeFile(packetPath, 'preexisting\n');

    const adapter = new WorkerAdapter();
    await assert.rejects(
      adapter.run({
        project,
        mission,
        task,
        worktreePath,
        packet: { protocol: 'veteran-worker-v1' },
        packetPath,
        packetRoot,
        config: {
          type: 'custom',
          command: process.execPath,
          args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'spawned')`]
        }
      }),
      (error) => error?.code === 'WORKER_PACKET_PATH_INVALID'
    );

    assert.equal(await fs.readFile(packetPath, 'utf8'), 'preexisting\n');
    await missing(marker);
    assert.deepEqual(adapter.snapshot(), []);
  } finally {
    await cleanup(root);
  }
});

test('packet writer rejects a symlinked packet-root child before writing outside the runtime artifacts root', async (t) => {
  const root = await tempDir('veteran-worker-packet-root-');
  try {
    const worktreePath = path.join(root, 'worktree');
    const packetRoot = path.join(root, 'artifacts');
    const outside = path.join(root, 'outside');
    const redirectedDir = path.join(packetRoot, 'worker-packets');
    const outsidePacket = path.join(outside, 'task.json');
    await fs.mkdir(worktreePath, { recursive: true });
    await fs.mkdir(packetRoot, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    try {
      await fs.symlink(outside, redirectedDir, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error?.code)) {
        t.skip('symlink/junction creation is unavailable in this Windows environment');
        return;
      }
      throw error;
    }

    await assert.rejects(
      writeWorkerPacket({
        worktreePath,
        packetPath: path.join(redirectedDir, 'task.json'),
        taskId: task.id,
        packet: { protocol: 'veteran-worker-v1' },
        packetRoot
      }),
      (error) => error?.code === 'WORKER_PACKET_PATH_INVALID'
    );
    await missing(outsidePacket);
  } finally {
    await cleanup(root);
  }
});

test('packet writer removes a file created before serialization fails and leaves the path reusable', async () => {
  const root = await tempDir('veteran-worker-packet-partial-');
  try {
    const worktreePath = path.join(root, 'worktree');
    const packetRoot = path.join(root, 'artifacts');
    const packetPath = path.join(packetRoot, 'task.json');
    await fs.mkdir(worktreePath, { recursive: true });
    await fs.mkdir(packetRoot, { recursive: true });

    await assert.rejects(
      writeWorkerPacket({
        worktreePath,
        packetPath,
        taskId: task.id,
        packet: { protocol: 'veteran-worker-v1', unserializable: 1n },
        packetRoot
      }),
      (error) => error instanceof TypeError
    );
    await missing(packetPath);

    const written = await writeWorkerPacket({
      worktreePath,
      packetPath,
      taskId: task.id,
      packet: { protocol: 'veteran-worker-v1', retry: true },
      packetRoot
    });
    assert.equal(written, packetPath);
    assert.deepEqual(JSON.parse(await fs.readFile(packetPath, 'utf8')), { protocol: 'veteran-worker-v1', retry: true });
  } finally {
    await cleanup(root);
  }
});
