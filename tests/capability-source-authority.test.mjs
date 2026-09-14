import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { sourceIdentity } from '../src/git.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

async function configureWorker(stateRoot, workerScript) {
  await fs.mkdir(stateRoot, { recursive: true });
  await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({
    defaults: {
      workerPolicy: {
        enabled: true,
        maxWorkers: 1,
        workers: {
          default: { type: 'custom', command: process.execPath, args: [workerScript] }
        }
      }
    }
  }, null, 2)}\n`);
}

test('capability snapshot follows mission worktree source and invalidates feedback when that source becomes dirty', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  try {
    const worker = path.join(fixture.root, 'worker.cjs');
    await fs.writeFile(worker, `const fs=require('fs'),p=require('path');fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','a.txt'),'after\\n');\n`);
    await configureWorker(fixture.stateRoot, worker);

    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.services.projectService.open({ repoPath: fixture.repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'advance mission source without moving project checkout',
      doneDefinition: 'capability sensing follows the integrated mission head',
      tasks: [{
        id: 'A',
        contract: 'change src/a.txt',
        owner: 'src',
        dependencies: [],
        writeSet: ['src'],
        risk: 'low'
      }]
    });

    const execution = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(execution.results[0].ok, true);

    const status = await app.services.missionService.status({ missionId: planned.mission.id });
    const integratedHead = status.tasks[0].integrationSha;
    assert.ok(integratedHead);

    const projectIdentity = await sourceIdentity(fixture.repo);
    assert.equal(projectIdentity.head, fixture.head);
    assert.notEqual(projectIdentity.head, integratedHead);

    const missionPath = app.services.worktreeManager.missionPath(status.mission);
    const missionIdentity = await sourceIdentity(missionPath);
    assert.equal(missionIdentity.head, integratedHead);
    assert.equal(missionIdentity.dirty, false);

    await app.store.transaction('test_capability_feedback_source', (state) => {
      state.missions[planned.mission.id].runtimeFeedback = {
        contract: 'veteran-runtime-feedback-v1',
        latestRound: {
          commitSha: integratedHead,
          scope: 'wave',
          passed: true,
          aggregateEvidenceId: 'evidence-current-mission-head'
        }
      };
    }, { missionId: planned.mission.id, integratedHead });

    const readiness = await app.handlers.mission_readiness({ missionId: planned.mission.id });
    const snapshot = readiness.capabilitySnapshot;
    assert.equal(snapshot.sourceScope, 'mission-worktree');
    assert.equal(snapshot.sourceIdentity.head, integratedHead);
    assert.equal(snapshot.sourceIdentity.dirty, false);
    assert.equal(snapshot.projectSourceIdentity.head, fixture.head);
    assert.equal(snapshot.runtimeFeedback.sourceHead, integratedHead);
    assert.equal(snapshot.runtimeFeedback.sourceDirty, false);
    assert.equal(snapshot.runtimeFeedback.sourceBoundToLiveHead, true);
    assert.equal(snapshot.runtimeFeedback.sourceBoundToCurrentMissionHead, true);

    await fs.writeFile(path.join(missionPath, 'src', 'a.txt'), 'dirty-after-feedback\n');
    const dirtyReadiness = await app.handlers.mission_readiness({ missionId: planned.mission.id });
    const dirtySnapshot = dirtyReadiness.capabilitySnapshot;
    assert.equal(dirtySnapshot.sourceScope, 'mission-worktree');
    assert.equal(dirtySnapshot.sourceIdentity.head, integratedHead);
    assert.equal(dirtySnapshot.sourceIdentity.dirty, true);
    assert.equal(dirtySnapshot.runtimeFeedback.sourceDirty, true);
    assert.equal(dirtySnapshot.runtimeFeedback.sourceBoundToLiveHead, false);
    assert.equal(dirtySnapshot.runtimeFeedback.sourceBoundToCurrentMissionHead, false);
  } finally {
    await cleanup(fixture.root);
  }
});
