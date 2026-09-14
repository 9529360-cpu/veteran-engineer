import assert from 'node:assert/strict';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

test('mission interruption authority survives repeated resume and partial worker retry', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'a\n', 'src/b.txt': 'b\n' } });
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.callTool('project_open', {
      requestId: 'interruption-open',
      repoPath: fixture.repo
    });
    const planned = await app.callTool('mission_plan', {
      requestId: 'interruption-plan',
      projectId: project.id,
      goal: 'preserve interruption authority',
      doneDefinition: 'every interrupted task remains an explicit blocker until reconciled',
      tasks: [
        { id: 'T1', contract: 'own src/a.txt', owner: 'src/a.txt', dependencies: [], writeSet: ['src/a.txt'], risk: 'low' },
        { id: 'T2', contract: 'own src/b.txt', owner: 'src/b.txt', dependencies: [], writeSet: ['src/b.txt'], risk: 'low' }
      ]
    });
    const missionId = planned.mission.id;

    await app.store.transaction('test_seed_uncertain_workers', (state) => {
      state.tasks[`${missionId}:T1`].status = 'executing';
      state.tasks[`${missionId}:T2`].status = 'executing';
      state.missions[missionId].status = 'executing';
    }, { missionId });

    const firstResume = await app.callTool('mission_resume', {
      requestId: 'interruption-resume-1',
      missionId
    });
    assert.equal(firstResume.status, 'blocked');
    assert.deepEqual(firstResume.interruption.taskIds, ['T1', 'T2']);
    const detectedAt = firstResume.interruption.detectedAt;

    const secondResume = await app.callTool('mission_resume', {
      requestId: 'interruption-resume-2',
      missionId
    });
    assert.equal(secondResume.status, 'blocked');
    assert.deepEqual(secondResume.interruption.taskIds, ['T1', 'T2']);
    assert.equal(secondResume.interruption.detectedAt, detectedAt);

    let readiness = await app.callTool('mission_readiness', { missionId });
    assert.equal(readiness.ready, false);
    assert.deepEqual(readiness.blockers.find((item) => item.code === 'RECONCILIATION_REQUIRED')?.taskIds, ['T1', 'T2']);

    await app.callTool('worker_retry', {
      requestId: 'interruption-retry-1',
      missionId,
      taskId: 'T1'
    });
    let status = await app.services.missionService.status({ missionId });
    assert.equal(status.mission.status, 'blocked');
    assert.deepEqual(status.mission.interruption.taskIds, ['T2']);
    assert.equal(status.tasks.find((task) => task.id === 'T1').status, 'planned');
    assert.equal(status.tasks.find((task) => task.id === 'T2').status, 'interrupted');

    readiness = await app.callTool('mission_readiness', { missionId });
    assert.equal(readiness.ready, false);
    assert.deepEqual(readiness.blockers.find((item) => item.code === 'RECONCILIATION_REQUIRED')?.taskIds, ['T2']);

    await app.callTool('worker_retry', {
      requestId: 'interruption-retry-2',
      missionId,
      taskId: 'T2'
    });
    status = await app.services.missionService.status({ missionId });
    assert.equal(status.mission.status, 'ready');
    assert.equal(status.mission.interruption, null);
    assert.equal(status.tasks.every((task) => task.status === 'planned'), true);
  } finally {
    await cleanup(fixture.root);
  }
});
