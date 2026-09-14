import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

test('partial-wave checkpoints do not multiply feedback for projects outside live-session mode', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'a\n', 'src/b.txt': 'b\n' } });
  try {
    const worker = path.join(root, 'worker.cjs');
    await fs.writeFile(worker, `const fs=require('fs'),p=require('path');const id=process.env.VETERAN_TASK_ID;fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src',id==='T1'?'a.txt':'b.txt'),id==='T1'?'a1\\n':'b1\\n');`);
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({
      defaults: {
        validationCapabilities: [{
          name: 'product-command',
          command: [process.execPath, '-e', 'process.exit(0)']
        }],
        runtimeFeedbackCapabilities: ['product-command'],
        workerPolicy: {
          enabled: true,
          maxWorkers: 1,
          workers: { default: { type: 'custom', command: process.execPath, args: [worker] } }
        }
      }
    }, null, 2)}\n`);

    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    assert.notEqual(project.runtimeFeedbackPolicy?.liveSession, true);
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'preserve the original runtime feedback cadence outside live development',
      doneDefinition: 'partial capacity slices do not run extra observations unless live-session mode was explicitly enabled',
      tasks: [
        { id: 'T1', contract: 'change a', owner: 'a', dependencies: [], writeSet: ['src/a.txt'], risk: 'low' },
        { id: 'T2', contract: 'change b', owner: 'b', dependencies: [], writeSet: ['src/b.txt'], risk: 'low' }
      ]
    });
    assert.deepEqual(planned.mission.waves[0], ['T1', 'T2']);

    const first = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(first.results[0].taskId, 'T1');
    assert.equal(first.results[0].ok, true);
    assert.equal(Object.hasOwn(first, 'runtimeFeedbackCheckpoint'), false);
    assert.equal(Object.hasOwn(first, 'runtimeFeedback'), false);
    let status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.mission.nextWaveIndex, 0);
    assert.equal(status.mission.runtimeFeedback?.latestRound || null, null);
    assert.deepEqual(status.mission.runtimeFeedback?.rounds || [], []);

    const second = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(second.results[0].taskId, 'T2');
    assert.equal(second.results[0].ok, true);
    assert.equal(second.runtimeFeedback.recorded, true);
    assert.equal(second.runtimeFeedback.passed, true);
    assert.equal(second.runtimeFeedback.scope, undefined);
    status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.mission.nextWaveIndex, 1);
    assert.equal(status.mission.runtimeFeedback.rounds.length, 1, 'non-live projects keep one observation per completed wave');
  } finally {
    await cleanup(root);
  }
});
