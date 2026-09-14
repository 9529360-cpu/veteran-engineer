import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { WorkerAdapter } from '../src/worker-adapter.mjs';
import { cleanup, tempDir } from './helpers.mjs';

const project = { workerPolicy: { enabled: true, allowUnconfinedCustomWorkers: false } };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(20);
  }
  throw new Error('Timed out waiting for worker lifecycle state');
}

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

function longWorkerConfig(marker) {
  return {
    type: 'custom',
    command: process.execPath,
    args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'running'); setInterval(() => {}, 1000)`],
    timeoutMs: 10_000
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

test('mission-scoped drain terminates running workers while leaving another mission running', async () => {
  const root = await tempDir('veteran-worker-mission-running-drain-');
  let adapter = null;
  try {
    const worktreePath = path.join(root, 'worktree');
    const artifactsPath = path.join(root, 'artifacts');
    await fs.mkdir(worktreePath, { recursive: true });
    await fs.mkdir(artifactsPath, { recursive: true });

    adapter = new WorkerAdapter();
    const cases = [
      { missionId: 'M1', taskId: 'A', marker: path.join(root, 'running-m1-a.txt') },
      { missionId: 'M1', taskId: 'B', marker: path.join(root, 'running-m1-b.txt') },
      { missionId: 'M2', taskId: 'C', marker: path.join(root, 'running-m2-c.txt') }
    ];
    const runs = cases.map((item) => adapter.run({
      project,
      mission: { id: item.missionId },
      task: task(item.missionId, item.taskId),
      worktreePath,
      packet: { protocol: 'veteran-worker-v1' },
      packetPath: path.join(artifactsPath, `running-${item.missionId}-${item.taskId}.json`),
      config: longWorkerConfig(item.marker)
    }));

    await waitFor(() => {
      const snapshot = adapter.snapshot();
      return snapshot.length === 3 && snapshot.every((item) => item.phase === 'running' && Number.isInteger(item.pid));
    });
    await Promise.all(cases.map((item) => fs.access(item.marker)));

    const drained = adapter.cancelMission('M1');
    assert.equal(drained.requested, 2);
    assert.equal(drained.accepted, 2);

    const afterDrain = adapter.snapshot();
    const m1 = afterDrain.filter((item) => item.missionId === 'M1');
    const m2 = afterDrain.find((item) => item.missionId === 'M2');
    assert.ok(m1.every((item) => item.phase === 'terminating' && item.termination?.reason === 'operator-cancel'));
    assert.equal(m2.phase, 'running');
    assert.equal(m2.termination, null);

    const m1Results = await Promise.all([runs[0], runs[1]]);
    assert.ok(m1Results.every((result) => Number.isInteger(result.pid)));
    assert.ok(m1Results.every((result) => result.termination?.reason === 'operator-cancel'));

    const survivor = adapter.snapshot();
    assert.equal(survivor.length, 1);
    assert.equal(survivor[0].taskKey, 'M2:C');
    assert.equal(survivor[0].phase, 'running');
    await fs.access(cases[2].marker);

    assert.equal(adapter.cancel('M2:C'), true);
    const m2Result = await runs[2];
    assert.equal(m2Result.termination?.reason, 'operator-cancel');
    assert.deepEqual(adapter.snapshot(), []);
  } finally {
    adapter?.cancelMission('M1');
    adapter?.cancelMission('M2');
    await sleep(50);
    await cleanup(root);
  }
});
