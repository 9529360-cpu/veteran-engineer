import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { WorkerAdapter } from '../src/worker-adapter.mjs';
import { cleanup, tempDir } from './helpers.mjs';

const project = { workerPolicy: { enabled: true, allowUnconfinedCustomWorkers: false } };

function task(missionId, taskId) {
  return { id: taskId, key: `${missionId}:${taskId}`, risk: 'low', writeSet: ['src'] };
}

test('mission cancellation fence blocks future claims even when no worker existed at drain time', async () => {
  const root = await tempDir('veteran-worker-mission-fence-');
  try {
    const worktreePath = path.join(root, 'worktree');
    const artifactsPath = path.join(root, 'artifacts');
    const m1Marker = path.join(root, 'm1-spawned.txt');
    const m2Marker = path.join(root, 'm2-spawned.txt');
    await fs.mkdir(worktreePath, { recursive: true });
    await fs.mkdir(artifactsPath, { recursive: true });

    const adapter = new WorkerAdapter();
    const drained = adapter.cancelMission('M1');
    assert.deepEqual(drained, { missionId: 'M1', fenced: true, requested: 0, accepted: 0, tasks: [] });

    const m1Packet = path.join(artifactsPath, 'm1.json');
    const m1 = await adapter.run({
      project,
      mission: { id: 'M1' },
      task: task('M1', 'A'),
      worktreePath,
      packet: { protocol: 'veteran-worker-v1' },
      packetPath: m1Packet,
      config: {
        type: 'custom',
        command: process.execPath,
        args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(m1Marker)}, 'spawned')`]
      }
    });
    assert.equal(m1.pid, null);
    assert.equal(m1.termination?.reason, 'operator-cancel');
    assert.deepEqual(adapter.snapshot(), []);
    await assert.rejects(fs.access(m1Marker), (error) => error.code === 'ENOENT');
    await assert.rejects(fs.access(m1Packet), (error) => error.code === 'ENOENT');

    const m2 = await adapter.run({
      project,
      mission: { id: 'M2' },
      task: task('M2', 'B'),
      worktreePath,
      packet: { protocol: 'veteran-worker-v1' },
      packetPath: path.join(artifactsPath, 'm2.json'),
      config: {
        type: 'custom',
        command: process.execPath,
        args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(m2Marker)}, 'spawned')`]
      }
    });
    assert.equal(m2.code, 0);
    assert.equal(m2.termination, null);
    assert.equal(await fs.readFile(m2Marker, 'utf8'), 'spawned');
  } finally {
    await cleanup(root);
  }
});
