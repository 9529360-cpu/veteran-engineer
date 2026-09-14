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

test('capability snapshot follows mission worktree source and fails closed when established source truth is unavailable', async () => {
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

    assert.equal(execution.capabilitySnapshot.observation.stage, 'post-execution');
    assert.equal(execution.capabilitySnapshot.observation.currentAtReturn, true);
    assert.equal(execution.capabilitySnapshot.sourceScope, 'mission-worktree');
    assert.deepEqual(execution.capabilitySnapshot.sourceAuthority, { expectedScope: 'mission-worktree', available: true });
    assert.equal(execution.capabilitySnapshot.sourceIdentity.head, integratedHead);
    assert.equal(execution.capabilitySnapshot.projectSourceIdentity.head, fixture.head);
    assert.equal(execution.capabilitySnapshot.activeLeases.length, 0);

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
    assert.deepEqual(snapshot.sourceAuthority, { expectedScope: 'mission-worktree', available: true });
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

    await fs.writeFile(path.join(missionPath, 'src', 'a.txt'), 'after\n');
    assert.equal((await sourceIdentity(missionPath)).dirty, false);
    await fs.rm(missionPath, { recursive: true, force: true });

    const unavailableReadiness = await app.handlers.mission_readiness({ missionId: planned.mission.id });
    const unavailableSnapshot = unavailableReadiness.capabilitySnapshot;
    assert.equal(unavailableSnapshot.sourceScope, 'mission-worktree-unavailable');
    assert.equal(unavailableSnapshot.sourceAuthority.expectedScope, 'mission-worktree');
    assert.equal(unavailableSnapshot.sourceAuthority.available, false);
    assert.equal(unavailableSnapshot.sourceAuthority.reason, 'mission-worktree-source-unavailable');
    assert.equal(typeof unavailableSnapshot.sourceAuthority.errorCode, 'string');
    assert.equal(unavailableSnapshot.sourceIdentity.head, null);
    assert.equal(unavailableSnapshot.sourceIdentity.dirty, true);
    assert.equal(unavailableSnapshot.sourceIdentity.unavailable, true);
    assert.equal(unavailableSnapshot.projectSourceIdentity.head, fixture.head);
    assert.equal(unavailableSnapshot.runtimeFeedback.sourceDirty, true);
    assert.equal(unavailableSnapshot.runtimeFeedback.sourceBoundToLiveHead, false);
    assert.equal(unavailableSnapshot.runtimeFeedback.sourceBoundToCurrentMissionHead, false);
  } finally {
    await cleanup(fixture.root);
  }
});
