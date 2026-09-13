import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

function task(id) {
  return { id, contract: 'bounded no-op worker', owner: 'root', dependencies: [], writeSet: [], risk: 'low' };
}

test('global worker admission is atomically reserved across runtime instances', async () => {
  const { root, repo, stateRoot } = await createGitRepo();
  try {
    const worker = path.join(root, 'sleep-worker.cjs');
    await fs.writeFile(worker, `setTimeout(()=>process.exit(0),350);\n`);
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({ defaults: { workerPolicy: { enabled: true, maxWorkers: 1, workers: { default: { type: 'custom', command: process.execPath, args: [worker] } } } } }, null, 2)}\n`);
    const app1 = await createVeteranApp({ stateRoot });
    const project = await app1.services.projectService.open({ repoPath: repo });
    const m1 = await app1.services.missionService.plan({ projectId: project.id, goal: 'm1', doneDefinition: 'done', tasks: [task('T1')] });
    const m2 = await app1.services.missionService.plan({ projectId: project.id, goal: 'm2', doneDefinition: 'done', tasks: [task('T1')] });
    const app2 = await createVeteranApp({ stateRoot });

    const [r1, r2] = await Promise.all([
      app1.services.workerOrchestrator.execute({ missionId: m1.mission.id, runWorkers: true }),
      app2.services.workerOrchestrator.execute({ missionId: m2.mission.id, runWorkers: true })
    ]);
    const results = [r1, r2];
    assert.equal(results.filter((r) => r.reason === 'global-worker-admission-full').length, 1);
    assert.equal(results.filter((r) => Array.isArray(r.results) && r.results[0]?.ok === true).length, 1);
    const state = await app1.store.read();
    const executing = Object.values(state.tasks).filter((item) => ['admitted', 'executing', 'cancelling'].includes(item.status));
    assert.equal(executing.length, 0);
    const done = Object.values(state.tasks).filter((item) => item.status === 'done');
    const planned = Object.values(state.tasks).filter((item) => item.status === 'planned');
    assert.equal(done.length, 1);
    assert.equal(planned.length, 1);
  } finally {
    await cleanup(root);
  }
});
