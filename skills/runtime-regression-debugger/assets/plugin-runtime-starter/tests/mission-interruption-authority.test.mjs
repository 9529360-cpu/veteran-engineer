import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
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


test('mission resume refuses to reconcile while this runtime still owns mission execution', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'a\n' } });
  let releaseWorkerRun;
  let workerRunEntered;
  let app = null;
  let execution = null;
  try {
    const worker = path.join(fixture.root, 'resume-guard-worker.cjs');
    await fs.writeFile(worker, 'process.exit(0);\n');
    await fs.mkdir(fixture.stateRoot, { recursive: true });
    await fs.writeFile(path.join(fixture.stateRoot, 'operator.json'), `${JSON.stringify({
      defaults: {
        workerPolicy: {
          enabled: true,
          maxWorkers: 1,
          workers: { default: { type: 'custom', command: process.execPath, args: [worker], timeoutMs: 10_000 } }
        }
      }
    }, null, 2)}\n`);

    app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.callTool('project_open', {
      requestId: 'resume-active-open',
      repoPath: fixture.repo
    });
    const planned = await app.callTool('mission_plan', {
      requestId: 'resume-active-plan',
      projectId: project.id,
      goal: 'keep live runtime execution authoritative',
      doneDefinition: 'restart reconciliation never steals ownership from an active mission_execute call',
      tasks: [{ id: 'T1', contract: 'run worker', owner: 'src/a.txt', dependencies: [], writeSet: ['src/a.txt'], risk: 'low' }]
    });
    const missionId = planned.mission.id;

    const originalRun = app.services.workerAdapter.run.bind(app.services.workerAdapter);
    const entered = new Promise((resolve) => { workerRunEntered = resolve; });
    const gate = new Promise((resolve) => { releaseWorkerRun = resolve; });
    app.services.workerAdapter.run = async (...args) => {
      workerRunEntered();
      await gate;
      return originalRun(...args);
    };

    execution = app.callTool('mission_execute', {
      requestId: 'resume-active-execute',
      missionId,
      runWorkers: true
    });
    await entered;

    const before = await app.services.missionService.status({ missionId });
    assert.equal(before.tasks[0].status, 'executing');
    assert.deepEqual(app.services.workerAdapter.snapshot(), [], 'guard must cover the pre-claim executing window, not only live WorkerAdapter claims');

    await assert.rejects(
      app.callTool('mission_resume', {
        requestId: 'resume-active-attempt',
        missionId
      }),
      (error) => {
        assert.equal(error?.code, 'MISSION_EXECUTION_ACTIVE');
        assert.equal(error?.details?.activeExecutionCalls, 1);
        return true;
      }
    );

    const after = await app.services.missionService.status({ missionId });
    assert.equal(after.tasks[0].status, 'executing');
    assert.equal(after.mission.interruption, null);

    releaseWorkerRun();
    const completed = await execution;
    assert.equal(completed.results[0].ok, true);
    const final = await app.services.missionService.status({ missionId });
    assert.equal(final.tasks[0].status, 'done');

    const marker = path.join(fixture.root, 'resume-live-claim.marker');
    await fs.writeFile(worker, `const fs=require('fs');fs.writeFileSync(${JSON.stringify(marker)},'live\\n');setInterval(()=>{},1000);`);
    const second = await app.callTool('mission_plan', {
      requestId: 'resume-live-plan',
      projectId: project.id,
      goal: 'guard a live WorkerAdapter claim',
      doneDefinition: 'restart reconciliation refuses a worker still owned by this runtime',
      tasks: [{ id: 'T2', contract: 'hold worker', owner: 'src/a.txt', dependencies: [], writeSet: ['src/a.txt'], risk: 'low' }]
    });
    const liveMissionId = second.mission.id;
    let liveExecution = app.services.workerOrchestrator.execute({ missionId: liveMissionId, runWorkers: true });
    const deadline = Date.now() + 5_000;
    while (true) {
      try {
        await fs.access(marker);
        break;
      } catch {
        if (Date.now() >= deadline) throw new Error('Timed out waiting for live WorkerAdapter claim');
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    const activeWorkers = app.services.workerAdapter.snapshot().filter((item) => item.missionId === liveMissionId);
    assert.equal(activeWorkers.length, 1);
    assert.equal(activeWorkers[0].phase, 'running');

    await assert.rejects(
      app.callTool('mission_resume', {
        requestId: 'resume-live-attempt',
        missionId: liveMissionId
      }),
      (error) => {
        assert.equal(error?.code, 'MISSION_EXECUTION_ACTIVE');
        assert.equal(error?.details?.activeExecutionCalls, 0);
        assert.deepEqual(error?.details?.workers.map((item) => item.taskId), ['T2']);
        return true;
      }
    );

    await app.callTool('mission_cancel', {
      requestId: 'resume-live-cancel',
      missionId: liveMissionId,
      reason: 'test-cleanup'
    });
    await assert.rejects(
      app.callTool('mission_resume', {
        requestId: 'resume-cancelled-attempt',
        missionId: liveMissionId
      }),
      (error) => error?.code === 'MISSION_CANCELLED'
    );
    await liveExecution;
    liveExecution = null;
  } finally {
    releaseWorkerRun?.();
    if (execution) await execution.catch(() => {});
    if (app) {
      for (const worker of app.services.workerAdapter.snapshot()) app.services.workerAdapter.cancel(worker.taskKey);
    }
    await cleanup(fixture.root);
  }
});
