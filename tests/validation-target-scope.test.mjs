import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { git } from '../src/git.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

const capability = {
  name: 'scope-check',
  command: [process.execPath, '-e', 'process.exit(0)']
};

function task(id) {
  return { id, contract: 'scope validation target', owner: 'README.md', dependencies: [], writeSet: ['README.md'], risk: 'low' };
}

async function plan(app, projectId, id) {
  return (await app.services.missionService.plan({
    projectId,
    goal: `validation scope ${id}`,
    doneDefinition: 'scope remains isolated',
    tasks: [task(id)]
  })).mission;
}

async function evidenceCount(app) {
  return Object.keys((await app.store.read()).evidence || {}).length;
}

test('validation_run rejects a mission owned by another project before evidence or mission mutation', async () => {
  const fixture = await createGitRepo();
  const clone = path.join(fixture.root, 'repo-clone');
  try {
    await git(fixture.root, ['clone', '-q', fixture.repo, clone]);
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const projectA = await app.services.projectService.open({ repoPath: fixture.repo });
    const projectB = await app.services.projectService.open({ repoPath: clone });
    await app.store.transaction('test_validation_capabilities', (state) => {
      state.projects[projectA.id].validationCapabilities = [capability];
      state.projects[projectB.id].validationCapabilities = [capability];
    });
    const missionB = await plan(app, projectB.id, 'B1');
    const beforeEvidence = await evidenceCount(app);

    await assert.rejects(
      () => app.callTool('validation_run', {
        requestId: 'validation-cross-project-mission',
        projectId: projectA.id,
        missionId: missionB.id,
        capability: capability.name
      }),
      (error) => error?.code === 'MISSION_NOT_FOUND'
    );

    const after = await app.services.missionService.status({ missionId: missionB.id });
    assert.equal(after.mission.validation.status, 'pending');
    assert.deepEqual(after.mission.validation.evidenceIds, []);
    assert.equal(await evidenceCount(app), beforeEvidence);
  } finally {
    await cleanup(fixture.root);
  }
});

test('validation_run rejects candidate and mission ids that name different missions', async () => {
  const fixture = await createGitRepo();
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.services.projectService.open({ repoPath: fixture.repo });
    await app.store.transaction('test_validation_capabilities', (state) => {
      state.projects[project.id].validationCapabilities = [capability];
    });
    const candidateMission = await plan(app, project.id, 'C1');
    const callerMission = await plan(app, project.id, 'C2');
    const candidateId = 'candidate_scope_binding';
    await app.store.transaction('test_candidate_seeded', (state) => {
      state.runtime.candidates ||= {};
      state.runtime.candidates[candidateId] = {
        id: candidateId,
        projectId: project.id,
        missionId: candidateMission.id,
        commitSha: project.sourceIdentity.head,
        sourceHead: project.sourceIdentity.head
      };
    });
    const beforeEvidence = await evidenceCount(app);

    await assert.rejects(
      () => app.callTool('validation_run', {
        requestId: 'validation-candidate-mission-mismatch',
        projectId: project.id,
        missionId: callerMission.id,
        candidateId,
        capability: capability.name
      }),
      (error) => error?.code === 'CANDIDATE_NOT_FOUND'
    );

    const candidateStatus = await app.services.missionService.status({ missionId: candidateMission.id });
    const callerStatus = await app.services.missionService.status({ missionId: callerMission.id });
    assert.equal(candidateStatus.mission.validation.status, 'pending');
    assert.equal(callerStatus.mission.validation.status, 'pending');
    assert.deepEqual(candidateStatus.mission.validation.evidenceIds, []);
    assert.deepEqual(callerStatus.mission.validation.evidenceIds, []);
    assert.equal(await evidenceCount(app), beforeEvidence);
  } finally {
    await cleanup(fixture.root);
  }
});
