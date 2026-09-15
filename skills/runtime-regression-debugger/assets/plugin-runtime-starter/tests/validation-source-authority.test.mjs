import assert from 'node:assert/strict';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { git } from '../src/git.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

const capability = {
  name: 'authority-check',
  command: [process.execPath, '-e', 'process.exit(0)']
};

function task(id) {
  return { id, contract: 'validation authority check', owner: 'README.md', dependencies: [], writeSet: ['README.md'], risk: 'low' };
}

async function plan(app, projectId, id) {
  return (await app.services.missionService.plan({
    projectId,
    goal: `validation authority ${id}`,
    doneDefinition: 'validation source remains bound',
    tasks: [task(id)]
  })).mission;
}

async function evidenceCount(app) {
  return Object.keys((await app.store.read()).evidence || {}).length;
}

test('anchored final validation can record evidence without racing mission validation authority', async () => {
  const fixture = await createGitRepo();
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.services.projectService.open({ repoPath: fixture.repo });
    await app.store.transaction('test_validation_capabilities', (state) => {
      state.projects[project.id].validationCapabilities = [capability];
    });
    const mission = await plan(app, project.id, 'A1');
    const missionWt = await app.services.worktreeManager.ensureMissionWorktree(project, mission);
    const commitSha = (await git(missionWt.path, ['rev-parse', 'HEAD'])).stdout.trim();
    const beforeEvidence = await evidenceCount(app);

    const result = await app.services.validationService.run({
      projectId: project.id,
      missionId: mission.id,
      capability: capability.name,
      sourceCommitSha: commitSha,
      recordMissionValidation: false
    });

    assert.equal(result.passed, true);
    assert.equal(result.commitSha, commitSha);
    const after = await app.services.missionService.status({ missionId: mission.id });
    assert.equal(after.mission.validation.status, 'pending');
    assert.deepEqual(after.mission.validation.evidenceIds, []);
    assert.equal(after.mission.validation.commitSha ?? null, null);
    assert.equal(await evidenceCount(app), beforeEvidence + 1);
  } finally {
    await cleanup(fixture.root);
  }
});

test('candidate validation rejects an anchored source identity that does not match the candidate', async () => {
  const fixture = await createGitRepo();
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.services.projectService.open({ repoPath: fixture.repo });
    await app.store.transaction('test_validation_capabilities', (state) => {
      state.projects[project.id].validationCapabilities = [capability];
    });
    const mission = await plan(app, project.id, 'A2');
    const candidateId = 'candidate_validation_authority';
    await app.store.transaction('test_candidate_seeded', (state) => {
      state.runtime.candidates ||= {};
      state.runtime.candidates[candidateId] = {
        id: candidateId,
        projectId: project.id,
        missionId: mission.id,
        commitSha: project.sourceIdentity.head,
        sourceHead: project.sourceIdentity.head
      };
    });
    const beforeEvidence = await evidenceCount(app);

    await assert.rejects(
      app.services.validationService.run({
        projectId: project.id,
        missionId: mission.id,
        candidateId,
        capability: capability.name,
        sourceCommitSha: '0000000000000000000000000000000000000000',
        recordMissionValidation: false
      }),
      (error) => error?.code === 'VALIDATION_SOURCE_IDENTITY_MISMATCH'
    );

    const after = await app.services.missionService.status({ missionId: mission.id });
    assert.equal(after.mission.validation.status, 'pending');
    assert.deepEqual(after.mission.validation.evidenceIds, []);
    assert.equal(await evidenceCount(app), beforeEvidence);
  } finally {
    await cleanup(fixture.root);
  }
});
