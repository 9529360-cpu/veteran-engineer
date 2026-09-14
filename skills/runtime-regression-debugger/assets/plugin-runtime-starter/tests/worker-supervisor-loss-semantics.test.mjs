import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

async function configureWorker(stateRoot) {
  await fs.mkdir(stateRoot, { recursive: true });
  await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({
    defaults: {
      workerPolicy: {
        enabled: true,
        maxWorkers: 1,
        workers: {
          default: { type: 'custom', command: process.execPath, args: ['-e', 'process.exit(0)'] }
        }
      }
    }
  }, null, 2)}\n`);
}

test('supervisor loss is durable worker failure but never project failed-assumption experience', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  try {
    await configureWorker(stateRoot);
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'supervisor loss semantics',
      doneDefinition: 'runtime failure remains retryable and does not become project experience',
      tasks: [{ id: 'T1', contract: 'exercise runtime failure handling', owner: 'src', dependencies: [], writeSet: ['src'], risk: 'low' }]
    });

    app.services.coreWorkerOrchestrator.workerAdapter = {
      async run() {
        const error = new Error('Worker supervisor exited before reporting the worker outcome');
        error.code = 'WORKER_SUPERVISOR_LOST';
        error.details = {
          runtimeNamespace: `${planned.mission.id}:T1:synthetic-supervisor-loss`,
          pid: 4242,
          supervisorPid: 4343,
          termination: { reason: 'supervisor-lost', signal: 'SIGTERM', forceKilled: false, forceSignal: null }
        };
        throw error;
      },
      cancel() { return false; },
      cancelMission(missionId) { return { missionId, fenced: true, requested: 0, accepted: 0, tasks: [] }; }
    };

    const result = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].ok, false);
    assert.equal(result.results[0].error.code, 'WORKER_SUPERVISOR_LOST');
    assert.equal(result.results[0].runtime.termination?.reason, 'supervisor-lost');

    const status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.tasks[0].status, 'failed');
    assert.equal(status.mission.status, 'blocked');
    const dispatch = status.tasks[0].dispatches.at(-1);
    assert.equal(dispatch.status, 'failed');
    assert.equal(dispatch.error?.code, 'WORKER_SUPERVISOR_LOST');
    assert.equal(dispatch.termination?.reason, 'supervisor-lost');

    const state = await app.store.read();
    const candidates = Object.values(state.experiences).filter((item) => item.projectId === project.id);
    assert.equal(candidates.length, 0);
    const failureEvent = state.runtime.timeline.findLast((event) => event.missionId === planned.mission.id && event.taskId === 'T1' && event.type === 'worker_failed');
    assert.equal(failureEvent?.code, 'WORKER_SUPERVISOR_LOST');
  } finally {
    await cleanup(root);
  }
});
