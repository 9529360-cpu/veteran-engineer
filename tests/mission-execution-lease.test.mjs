import assert from 'node:assert/strict';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

test('mission execution lease fences restart reconciliation across runtime instances', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'a\n' } });
  let lease = null;
  try {
    const app1 = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app1.callTool('project_open', {
      requestId: 'execution-lease-open',
      repoPath: fixture.repo
    });
    const planned = await app1.callTool('mission_plan', {
      requestId: 'execution-lease-plan',
      projectId: project.id,
      goal: 'keep one runtime authoritative for mission execution',
      doneDefinition: 'a second runtime cannot run restart reconciliation while execution authority is leased',
      tasks: [{ id: 'T1', contract: 'own src/a.txt', owner: 'src/a.txt', dependencies: [], writeSet: ['src/a.txt'], risk: 'low' }]
    });
    const missionId = planned.mission.id;
    const app2 = await createVeteranApp({ stateRoot: fixture.stateRoot });

    lease = await app1.services.missionExecutionLeaseManager.acquire({ missionId, operation: 'test-live-execution' });

    await assert.rejects(
      app2.callTool('mission_resume', {
        requestId: 'execution-lease-resume-blocked',
        missionId
      }),
      (error) => {
        assert.equal(error?.code, 'MISSION_EXECUTION_ACTIVE');
        assert.equal(error?.details?.missionId, missionId);
        assert.equal(error?.details?.backendKind, 'local-json');
        return true;
      }
    );

    const blockedStatus = await app2.services.missionService.status({ missionId });
    assert.equal(blockedStatus.mission.status, 'ready');
    assert.equal(blockedStatus.tasks[0].status, 'planned');
    assert.equal(blockedStatus.mission.interruption, null);

    await lease.release();
    lease = null;

    const resumed = await app2.callTool('mission_resume', {
      requestId: 'execution-lease-resume-after-release',
      missionId
    });
    assert.equal(resumed.status, 'ready');
    assert.equal(resumed.interruption, null);
  } finally {
    await lease?.release().catch(() => {});
    await cleanup(fixture.root);
  }
});
