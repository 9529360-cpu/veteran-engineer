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

function workerConfig(marker) {
  return {
    type: 'custom',
    command: process.execPath,
    args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'spawned')`]
  };
}

test('mission-scoped drain cancels all matching execution claims without touching another mission', async () => {
  const root = await tempDir('veteran-worker-mission-drain-');
  try {
    const worktreePath = path.join(root, 'worktree');
    const artifactsPath = path.join(root, 'artifacts');
    await fs.mkdir(worktreePath, { recursive: true });
    await fs.mkdir(artifactsPath, { recursive: true });

    const adapter = new WorkerAdapter();
    const cases = [
      { missionId: 'M1', taskId: 'A', marker: path.join(root, 'm1-a.txt') },
      { missionId: 'M1', taskId: 'B', marker: path.join(root, 'm1-b.txt') },
      { missionId: 'M2', taskId: 'C', marker: path.join(root, 'm2-c.txt') }
    ];
    const runs = cases.map((item) => adapter.run({
      project,
      mission: { id: item.missionId },
      task: task(item.missionId, item.taskId),
      worktreePath,
      packet: { protocol: 'veteran-worker-v1' },
      packetPath: path.join(artifactsPath, `${item.missionId}-${item.taskId}.json`),
      config: workerConfig(item.marker)
    }));

    const before = adapter.snapshot();
    assert.equal(before.length, 3);
    assert.deepEqual(before.map((item) => [item.missionId, item.taskId, item.phase]), [
      ['M1', 'A', 'preparing'],
      ['M1', 'B', 'preparing'],
      ['M2', 'C', 'preparing']
    ]);

    const drained = adapter.cancelMission('M1');
    assert.equal(drained.requested, 2);
    assert.equal(drained.accepted, 2);
    assert.deepEqual(drained.tasks.map((item) => item.taskId).sort(), ['A', 'B']);

    const afterMissionDrain = adapter.snapshot();
    const m1 = afterMissionDrain.filter((item) => item.missionId === 'M1');
    const m2 = afterMissionDrain.find((item) => item.missionId === 'M2');
    assert.ok(m1.every((item) => item.phase === 'cancelling' && item.termination?.reason === 'operator-cancel'));
    assert.equal(m2.phase, 'preparing');
    assert.equal(m2.termination, null, 'mission-scoped drain must not cancel a different mission');

    assert.equal(adapter.cancel('M2:C'), true);
    const results = await Promise.all(runs);
    assert.ok(results.every((result) => result.pid === null));
    assert.ok(results.every((result) => result.termination?.reason === 'operator-cancel'));
    assert.deepEqual(adapter.snapshot(), []);
    for (const item of cases) {
      await assert.rejects(fs.access(item.marker), (error) => error.code === 'ENOENT');
    }
  } finally {
    await cleanup(root);
  }
});
