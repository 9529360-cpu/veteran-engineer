import assert from 'node:assert/strict';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

async function planTwoTasks(app, projectId, suffix) {
  return app.callTool('mission_plan', {
    requestId: `execution-blockers-plan-${suffix}`,
    projectId,
    goal: `preserve execution blocker authority ${suffix}`,
    doneDefinition: 'mission status and readiness stay weaker than unresolved task blockers',
    tasks: [
      { id: 'T1', contract: 'own src/a.txt', owner: 'src/a.txt', dependencies: [], writeSet: ['src/a.txt'], risk: 'low' },
      { id: 'T2', contract: 'own src/b.txt', owner: 'src/b.txt', dependencies: [], writeSet: ['src/b.txt'], risk: 'low' }
    ]
  });
}

test('mission_readiness treats an active cancelled task as retry-required execution work', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'a\n', 'src/b.txt': 'b\n' } });
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.callTool('project_open', {
      requestId: 'execution-blockers-open-cancelled',
      repoPath: fixture.repo
    });
    const planned = await planTwoTasks(app, project.id, 'cancelled');
    const missionId = planned.mission.id;

    await app.store.transaction('test_seed_active_cancelled_task', (state) => {
      state.tasks[`${missionId}:T1`].status = 'cancelled';
      state.missions[missionId].status = 'ready';
    }, { missionId });

    const status = await app.services.missionService.status({ missionId });
    assert.equal(status.mission.status, 'blocked');
    const readiness = await app.callTool('mission_readiness', { missionId });
    assert.equal(readiness.ready, false);
    assert.deepEqual(readiness.blockers.find((item) => item.code === 'CANCELLED_TASKS')?.taskIds, ['T1']);
  } finally {
    await cleanup(fixture.root);
  }
});

test('mission_readiness is not ready while an execution task is still outstanding', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'a\n', 'src/b.txt': 'b\n' } });
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.callTool('project_open', {
      requestId: 'execution-blockers-open-outstanding',
      repoPath: fixture.repo
    });
    const planned = await planTwoTasks(app, project.id, 'outstanding');
    const missionId = planned.mission.id;

    await app.store.transaction('test_seed_outstanding_task', (state) => {
      state.tasks[`${missionId}:T1`].status = 'dispatched';
      state.missions[missionId].status = 'ready';
    }, { missionId });

    const readiness = await app.callTool('mission_readiness', { missionId });
    assert.equal(readiness.ready, false);
    assert.equal(readiness.status, 'ready');
    assert.deepEqual(readiness.blockers.find((item) => item.code === 'OUTSTANDING_TASKS')?.taskIds, ['T1']);
  } finally {
    await cleanup(fixture.root);
  }
});

test('mission status cannot report ready while failed or cancelled execution siblings remain', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'a\n', 'src/b.txt': 'b\n' } });
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.callTool('project_open', {
      requestId: 'execution-blockers-open-mixed',
      repoPath: fixture.repo
    });
    const planned = await planTwoTasks(app, project.id, 'mixed');
    const missionId = planned.mission.id;

    await app.store.transaction('test_seed_mixed_execution_blockers', (state) => {
      state.tasks[`${missionId}:T1`].status = 'interrupted';
      state.tasks[`${missionId}:T2`].status = 'failed';
      state.missions[missionId].status = 'blocked';
      state.missions[missionId].interruption = {
        requiresReconciliation: true,
        taskIds: ['T1'],
        detectedAt: new Date().toISOString()
      };
    }, { missionId });

    await app.callTool('worker_retry', {
      requestId: 'execution-blockers-retry-interrupted',
      missionId,
      taskId: 'T1'
    });

    let status = await app.services.missionService.status({ missionId });
    assert.equal(status.mission.status, 'blocked');
    assert.equal(status.tasks.find((task) => task.id === 'T2').status, 'failed');
    let readiness = await app.callTool('mission_readiness', { missionId });
    assert.equal(readiness.ready, false);
    assert.deepEqual(readiness.blockers.find((item) => item.code === 'FAILED_TASKS')?.taskIds, ['T2']);

    await app.store.transaction('test_swap_failed_for_cancelled_sibling', (state) => {
      state.tasks[`${missionId}:T2`].status = 'cancelled';
      state.missions[missionId].status = 'ready';
    }, { missionId });
    status = await app.services.missionService.status({ missionId });
    assert.equal(status.mission.status, 'blocked');
    readiness = await app.callTool('mission_readiness', { missionId });
    assert.equal(readiness.ready, false);
    assert.deepEqual(readiness.blockers.find((item) => item.code === 'CANCELLED_TASKS')?.taskIds, ['T2']);

    await app.callTool('worker_retry', {
      requestId: 'execution-blockers-retry-cancelled',
      missionId,
      taskId: 'T2'
    });
    status = await app.services.missionService.status({ missionId });
    assert.equal(status.mission.status, 'ready');
    readiness = await app.callTool('mission_readiness', { missionId });
    assert.equal(readiness.ready, true);
  } finally {
    await cleanup(fixture.root);
  }
});
