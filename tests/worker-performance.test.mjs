import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import {
  selectWorkerForTask,
  workerPerformanceSnapshot,
  WORKER_SELECTION_CONTRACT
} from '../src/worker-performance.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

const command = { type: 'custom', command: process.execPath, args: ['-e', 'process.exit(0)'] };
function project(overrides = {}) {
  return {
    id: 'project-1',
    workerPolicy: {
      enabled: true,
      defaultWorker: 'bad',
      workers: { bad: command, good: command },
      adaptiveSelection: { enabled: true, candidates: ['bad', 'good'] },
      ...overrides
    }
  };
}
function task(overrides = {}) {
  return { id: 'T1', owner: 'src', worker: 'default', risk: 'low',
    writeSet: ['src/a.txt'], executionCapabilities: [], ...overrides };
}
function dispatch(workerKey, status, evidenceId, overrides = {}) {
  return {
    workerKey, status, evidenceId,
    runWorkers: true, workerSpawnConfirmed: true,
    endedAt: '2026-10-14T08:00:00.000Z',
    ...(status === 'integrated' ? { integrationSha: 'abc123' } : { error: { code: 'WORKER_FAILED' } }),
    ...overrides
  };
}
function state(entries = []) {
  const tasks = {};
  const evidence = {};
  for (let index = 0; index < entries.length; index++) {
    const item = entries[index];
    tasks['M:' + index] = {
      projectId: 'project-1', owner: item.owner || 'src',
      dispatches: item.dispatches
    };
    for (const run of item.dispatches) {
      if (run.evidenceId && item.hasEvidence !== false) evidence[run.evidenceId] = { id: run.evidenceId };
    }
  }
  return { tasks, evidence };
}

test('cold start respects an operator default; confirmed failures make a different eligible worker preferable', () => {
  const p = project();
  const t = task();
  const blank = selectWorkerForTask({ state: state(), project: p, task: t });
  assert.equal(blank.worker, 'bad');
  assert.equal(blank.mode, 'cold-start');
  assert.equal(blank.contract, WORKER_SELECTION_CONTRACT);
  const failed = state([{ dispatches: [dispatch('bad', 'failed', 'e-fail')] }]);
  const switched = selectWorkerForTask({ state: failed, project: p, task: t });
  assert.equal(switched.worker, 'good');
  assert.equal(switched.mode, 'evidence-ranking');
  assert.equal(switched.observations.find((entry) => entry.worker === 'bad').failed, 1);
  const recovered = state([
    { dispatches: [dispatch('bad', 'failed', 'e-fail')] },
    { dispatches: [dispatch('good', 'integrated', 'e-good')] }
  ]);
  assert.equal(selectWorkerForTask({ state: recovered, project: p, task: t }).worker, 'good');
});

test('supervisor-only, packet-only, cancelled, timeout and missing-evidence attempts cannot poison ranking', () => {
  const history = state([
    { dispatches: [dispatch('good', 'failed', 'never-started', { workerSpawnConfirmed: false })] },
    { dispatches: [dispatch('good', 'failed', 'e-cancel', { status: 'cancelled', error: { code: 'WORKER_CANCELLED' } })] },
    { dispatches: [dispatch('bad', 'failed', 'e-timeout', { error: { code: 'WORKER_TIMEOUT' } })] },
    { dispatches: [dispatch('good', 'integrated', 'e-unverified')], hasEvidence: false },
    { dispatches: [dispatch('good', 'integrated', 'e-packet', { runWorkers: false })] },
    { dispatches: [dispatch('bad', 'failed', 'e-real')] }
  ]);
  const p = workerPerformanceSnapshot({ state: history, projectId: 'project-1', owner: 'src', candidates: ['bad', 'good'] });
  assert.equal(p.workers.find((worker) => worker.worker === 'bad').samples, 1);
  assert.equal(p.workers.find((worker) => worker.worker === 'good').samples, 0);
  assert.deepEqual(p.workers.find((worker) => worker.worker === 'bad').evidenceIds, ['e-real']);
});

test('explicit task worker, consequential risk and disabled routing remain immutable', () => {
  const p = project();
  const history = state([{ dispatches: [dispatch('bad', 'failed', 'e-fail')] }]);
  assert.deepEqual(selectWorkerForTask({ state: history, project: p, task: task({ worker: 'bad' }) }).worker, 'bad');
  for (const risk of ['high', 'critical']) {
    const result = selectWorkerForTask({ state: history, project: p, task: task({ risk }) });
    assert.equal(result.worker, 'default');
    assert.equal(result.mode, 'risk-preserves-default');
  }
  const disabled = project({ adaptiveSelection: { enabled: false } });
  assert.equal(selectWorkerForTask({ state: history, project: disabled, task: task() }).mode, 'operator-default');
});

test('selection is limited to authorized, capable workers and never discovers Codex automatically', () => {
  const p = project({
    workers: {
      bad: command,
      unsafe: { type: 'custom-unconfined', command: process.execPath },
      good: command
    },
    adaptiveSelection: { enabled: true }
  });
  const history = state([{ dispatches: [dispatch('bad', 'failed', 'e-fail')] },
    { dispatches: [dispatch('unsafe', 'integrated', 'e-unsafe')] }]);
  const chosen = selectWorkerForTask({ state: history, project: p, task: task() });
  assert.equal(chosen.worker, 'good');
  assert.ok(chosen.observations.every((item) => item.worker !== 'unsafe'));
  assert.ok(chosen.observations.every((item) => item.worker !== 'codex'));
  const requiresContainer = task({ executionCapabilities: ['network-isolated'] });
  const gated = selectWorkerForTask({ state: history, project: p, task: requiresContainer });
  assert.equal(gated.worker, 'default');
  assert.equal(gated.mode, 'no-eligible-authorized-workers');
});

test('owner-local outcomes take precedence over unrelated project performance', () => {
  const history = state([
    { owner: 'tests', dispatches: [dispatch('bad', 'integrated', 'e-tests')] },
    { owner: 'src', dispatches: [dispatch('bad', 'failed', 'e-src')] }
  ]);
  const selection = selectWorkerForTask({ state: history, project: project(), task: task() });
  assert.equal(selection.evidenceScope, 'task-owner');
  assert.equal(selection.worker, 'good');
  const fallback = selectWorkerForTask({ state: history, project: project(), task: task({ owner: 'docs' }) });
  assert.equal(fallback.evidenceScope, 'project-fallback');
  assert.ok(fallback.observations.length === 2);
});

test('real runtime failure and manual retry switch independent child processes with durable evidence', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  try {
    const bad = path.join(root, 'bad.cjs');
    const good = path.join(root, 'good.cjs');
    await fs.writeFile(bad, 'process.exit(13);\n');
    await fs.writeFile(good, "const fs=require('node:fs'),p=require('node:path');fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src/a.txt'),'after\\n');\n");
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(path.join(stateRoot, 'operator.json'), JSON.stringify({
      defaults: { workerPolicy: {
        enabled: true, defaultWorker: 'bad',
        workers: {
          bad: { type: 'custom', command: process.execPath, args: [bad] },
          good: { type: 'custom', command: process.execPath, args: [good] }
        },
        adaptiveSelection: { enabled: true, candidates: ['bad', 'good'] }
      } }
    }));
    const app = await createVeteranApp({ stateRoot });
    const opened = await app.services.projectService.open({ repoPath: repo });
    const planned = await app.services.missionService.plan({
      projectId: opened.id, goal: 'bounded recovery', doneDefinition: 'integrated',
      tasks: [{ id: 'T1', owner: 'src', contract: 'replace src/a.txt',
        writeSet: ['src/a.txt'], dependencies: [], risk: 'low' }]
    });
    const missionId = planned.mission.id;
    const first = await app.services.workerOrchestrator.execute({ missionId, runWorkers: true });
    assert.equal(first.results[0].ok, false);
    assert.equal(first.results[0].worker, 'bad');
    const afterFailure = await app.services.missionService.status({ missionId });
    assert.equal(afterFailure.tasks[0].dispatches[0].workerKey, 'bad');
    assert.ok(afterFailure.tasks[0].dispatches[0].evidenceId);
    await app.services.workerOrchestrator.retryWorker({ missionId, taskId: 'T1' });
    const retried = await app.services.workerOrchestrator.execute({ missionId, runWorkers: true });
    assert.equal(retried.results[0].ok, true);
    assert.equal(retried.results[0].worker, 'good');
    const after = await app.services.missionService.status({ missionId });
    assert.equal(after.tasks[0].status, 'done');
    assert.equal(after.tasks[0].dispatches[1].workerKey, 'good');
    assert.ok(after.tasks[0].dispatches[1].evidenceId);
    assert.equal(after.agentTeam.members[0].worker, 'good');
    assert.equal(after.workerPerformance.workers.find((x) => x.worker === 'bad').failed, 1);
    assert.equal(after.workerPerformance.workers.find((x) => x.worker === 'good').integrated, 1);
  } finally {
    await cleanup(root);
  }
});
