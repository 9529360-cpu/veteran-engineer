import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { tempDir, cleanup } from './helpers.mjs';

test('runtime_cleanup preserves the durable active task worktree even when the task id is normalized on disk', async () => {
  const stateRoot = await tempDir('veteran-cleanup-active-');
  try {
    const app = await createVeteranApp({ stateRoot });
    const mission = { id: 'mission-cleanup', status: 'ready' };
    const task = { id: 'A/B', missionId: mission.id, status: 'dispatched' };
    const activeWorktree = app.services.worktreeManager.taskPath(mission, task);
    const activeName = path.basename(activeWorktree);
    const missionName = `mission-${mission.id}`;
    const missionWorktree = path.join(app.store.worktreesDir, missionName);
    const orphanName = 'task-orphan-cleanup';
    const orphanWorktree = path.join(app.store.worktreesDir, orphanName);

    assert.ok(activeName.includes('A-B'));
    await fs.mkdir(activeWorktree, { recursive: true });
    await fs.mkdir(missionWorktree, { recursive: true });
    await fs.mkdir(orphanWorktree, { recursive: true });

    await app.store.transaction('test_seed_runtime_cleanup', (state) => {
      state.missions[mission.id] = { ...mission };
      state.tasks[`${mission.id}:${task.id}`] = {
        ...task,
        key: `${mission.id}:${task.id}`,
        dispatches: [{ id: 'dispatch-cleanup', worktreePath: activeWorktree }]
      };
    });

    const result = await app.callTool('runtime_cleanup', {
      requestId: 'runtime-cleanup-active-worktree',
      apply: true
    });

    assert.deepEqual(result.orphans, [orphanName]);
    assert.deepEqual(result.removed, [orphanName]);
    await fs.access(activeWorktree);
    await fs.access(missionWorktree);
    await assert.rejects(fs.access(orphanWorktree), (error) => error.code === 'ENOENT');
  } finally {
    await cleanup(stateRoot);
  }
});
