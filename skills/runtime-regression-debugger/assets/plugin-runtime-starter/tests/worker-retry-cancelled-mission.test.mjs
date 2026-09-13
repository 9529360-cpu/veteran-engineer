import assert from 'node:assert/strict';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

async function planOneTask(app, projectId, suffix) {
  return app.callTool('mission_plan', {
    requestId: `worker-retry-plan-${suffix}`,
    projectId,
    goal: `worker retry state ${suffix}`,
    doneDefinition: 'mission state remains authoritative',
    tasks: [{
      id: 'T1',
      contract: 'own src/a.txt',
      owner: 'src/a.txt',
      dependencies: [],
      writeSet: ['src/a.txt'],
      risk: 'low'
    }]
  });
}

test('worker retry cannot revive an operator-cancelled mission', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.callTool('project_open', {
      requestId: 'worker-retry-cancel-open',
      repoPath: fixture.repo
    });
    const planned = await planOneTask(app, project.id, 'cancelled');
    const missionId = planned.mission.id;

    await app.callTool('mission_cancel', {
      requestId: 'worker-retry-cancel-mission',
      missionId,
      reason: 'operator-stop'
    });
    let status = await app.services.missionService.status({ missionId });
    assert.equal(status.mission.status, 'cancelled');
    assert.equal(status.tasks[0].status, 'cancelled');

    await assert.rejects(
      app.callTool('worker_retry', {
        requestId: 'worker-retry-cancel-attempt',
        missionId,
        taskId: 'T1'
      }),
      (error) => error?.code === 'MISSION_CANCELLED'
    );

    status = await app.services.missionService.status({ missionId });
    assert.equal(status.mission.status, 'cancelled');
    assert.equal(status.tasks[0].status, 'cancelled');
    const timeline = await app.services.missionService.timeline({ missionId });
    assert.equal(timeline.some((event) => event.type === 'worker_retry_scheduled'), false);
  } finally {
    await cleanup(fixture.root);
  }
});

test('worker retry still resets a failed task on an active mission', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.callTool('project_open', {
      requestId: 'worker-retry-active-open',
      repoPath: fixture.repo
    });
    const planned = await planOneTask(app, project.id, 'active');
    const missionId = planned.mission.id;

    await app.store.transaction('test_seed_worker_failure', (state) => {
      state.tasks[`${missionId}:T1`].status = 'failed';
      state.missions[missionId].status = 'blocked';
    }, { missionId });

    const retried = await app.callTool('worker_retry', {
      requestId: 'worker-retry-active-attempt',
      missionId,
      taskId: 'T1'
    });
    assert.equal(retried.status, 'planned');

    const status = await app.services.missionService.status({ missionId });
    assert.equal(status.mission.status, 'ready');
    assert.equal(status.tasks[0].status, 'planned');
    assert.equal(status.tasks[0].admission, null);
    const timeline = await app.services.missionService.timeline({ missionId });
    assert.equal(timeline.filter((event) => event.type === 'worker_retry_scheduled').length, 1);
  } finally {
    await cleanup(fixture.root);
  }
});
