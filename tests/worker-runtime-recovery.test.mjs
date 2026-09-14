import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { StateStore } from '../src/state-store.mjs';
import { ProjectService } from '../src/project-service.mjs';
import { MissionService } from '../src/mission-service.mjs';
import { EvidenceService } from '../src/evidence-service.mjs';
import { WorktreeManager } from '../src/worktree-manager.mjs';
import { WorkerAdapter } from '../src/worker-adapter.mjs';
import { WorkerOrchestrator } from '../src/worker-orchestrator.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

async function buildRuntime(fixture) {
  const store = await new StateStore({ root: fixture.stateRoot }).init();
  const projectService = new ProjectService({ store });
  const missionService = new MissionService({ store, projectService });
  const evidenceService = new EvidenceService({ store });
  const worktreeManager = new WorktreeManager({ store });
  const workerAdapter = new WorkerAdapter();
  const orchestrator = new WorkerOrchestrator({ store, projectService, missionService, worktreeManager, workerAdapter, evidenceService });
  const project = await projectService.open({ repoPath: fixture.repo });
  return { store, missionService, worktreeManager, orchestrator, project };
}

async function planTask(rt, id) {
  return rt.missionService.plan({
    projectId: rt.project.id,
    goal: `recover ${id}`,
    doneDefinition: `${id} recovery preserves execution truth`,
    tasks: [{
      id,
      contract: `update src/a.txt for ${id}`,
      owner: 'src/a.txt',
      dependencies: [],
      writeSet: ['src/a.txt'],
      risk: 'low'
    }]
  });
}

async function markInterrupted(rt, missionId, taskId, dispatchStatus) {
  await rt.store.transaction('test_worker_interrupted', (state) => {
    const task = state.tasks[`${missionId}:${taskId}`];
    const mission = state.missions[missionId];
    task.status = 'interrupted';
    task.updatedAt = new Date().toISOString();
    task.dispatches.at(-1).status = dispatchStatus;
    mission.status = 'blocked';
    mission.interruption = { requiresReconciliation: true, taskIds: [taskId], detectedAt: new Date().toISOString() };
    mission.updatedAt = new Date().toISOString();
  }, { missionId, taskId, dispatchStatus });
}

test('restart reconciliation refuses to auto-integrate partial writes from an interrupted runtime-managed worker', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  try {
    const rt = await buildRuntime(fixture);
    const planned = await planTask(rt, 'T1');
    const missionId = planned.mission.id;
    const dispatched = await rt.orchestrator.execute({ missionId, runWorkers: false });
    const first = dispatched.dispatched[0];
    await fs.writeFile(path.join(first.worktreePath, 'src/a.txt'), 'partial\n');
    await markInterrupted(rt, missionId, 'T1', 'executing');

    await assert.rejects(
      rt.orchestrator.resumeWorker({ missionId, taskId: 'T1' }),
      (error) => {
        assert.equal(error?.code, 'WORKER_RECONCILIATION_REQUIRED');
        assert.equal(error?.details?.dispatchId, first.dispatchId);
        assert.equal(error?.details?.dispatchStatus, 'executing');
        assert.deepEqual(error?.details?.changedPaths, ['src/a.txt']);
        assert.equal(error?.details?.reason, 'runtime-managed-outcome-unknown');
        return true;
      }
    );

    const blocked = await rt.missionService.status({ missionId });
    assert.equal(blocked.tasks[0].status, 'interrupted');
    assert.equal(blocked.mission.nextWaveIndex, 0);
    assert.equal(await fs.readFile(path.join(first.worktreePath, 'src/a.txt'), 'utf8'), 'partial\n', 'partial worktree is preserved for explicit inspection');
    assert.equal(await fs.readFile(path.join(fixture.repo, 'src/a.txt'), 'utf8'), 'before\n', 'user checkout must remain untouched');

    await rt.orchestrator.retryWorker({ missionId, taskId: 'T1' });
    const retried = await rt.orchestrator.execute({ missionId, runWorkers: false });
    assert.equal(retried.dispatched.length, 1);
    assert.equal(await fs.readFile(path.join(retried.dispatched[0].worktreePath, 'src/a.txt'), 'utf8'), 'before\n', 'explicit retry recreates the task worktree from the wave base instead of reusing partial writes');
  } finally {
    await cleanup(fixture.root);
  }
});

test('interrupted external-ready results retain the existing explicit commit path', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  try {
    const rt = await buildRuntime(fixture);
    const planned = await planTask(rt, 'EXT');
    const missionId = planned.mission.id;
    const dispatched = await rt.orchestrator.execute({ missionId, runWorkers: false });
    const first = dispatched.dispatched[0];
    await fs.writeFile(path.join(first.worktreePath, 'src/a.txt'), 'external-complete\n');
    await markInterrupted(rt, missionId, 'EXT', 'ready');

    const resumed = await rt.orchestrator.resumeWorker({ missionId, taskId: 'EXT' });
    assert.equal(typeof resumed.commitSha, 'string');
    assert.equal(resumed.waveAdvanced, true);

    const status = await rt.missionService.status({ missionId });
    assert.equal(status.tasks[0].status, 'done');
    assert.equal(status.mission.nextWaveIndex, 1);
    assert.equal(status.mission.status, 'ready');
    assert.equal(status.mission.interruption, null);
    assert.equal(await fs.readFile(path.join(fixture.repo, 'src/a.txt'), 'utf8'), 'before\n', 'external recovery still integrates only into the mission worktree');
  } finally {
    await cleanup(fixture.root);
  }
});
