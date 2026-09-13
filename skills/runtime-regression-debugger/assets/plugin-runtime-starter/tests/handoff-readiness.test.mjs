import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { git } from '../src/git.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

test('handoff_export carries live readiness instead of treating mission phase as a safe action', async () => {
  const { root, repo, head, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'base\n' } });
  try {
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const missionId = 'mission-handoff-readiness';

    await app.store.transaction('test_seed_handoff_readiness', (state) => {
      state.missions[missionId] = {
        id: missionId,
        projectId: project.id,
        goal: 'export a resumable handoff',
        doneDefinition: 'handoff reflects the live safe next action',
        status: 'awaiting-operator-merge',
        phase: 'finalize',
        baseSourceIdentity: project.sourceIdentity,
        currentSourceIdentity: project.sourceIdentity,
        activeCandidateId: 'candidate-a',
        candidateIds: ['candidate-a'],
        activeMergeProposalId: 'proposal-a',
        mergeProposalIds: ['proposal-a'],
        interruption: null
      };
      state.runtime.candidates ||= {};
      state.runtime.candidates['candidate-a'] = {
        id: 'candidate-a',
        projectId: project.id,
        missionId,
        commitSha: head,
        sourceHead: head,
        immutable: true
      };
      state.runtime.mergeProposals ||= {};
      state.runtime.mergeProposals['proposal-a'] = {
        id: 'proposal-a',
        missionId,
        candidateId: 'candidate-a',
        status: 'proposed',
        expectedSourceHead: head
      };
    });

    let exported = await app.callTool('handoff_export', { missionId });
    assert.equal(exported.handoff.readiness.ready, true);
    assert.equal(exported.handoff.readiness.operatorActionRequired, true);
    assert.equal(exported.handoff.nextSafeAction, 'operator-merge');

    let artifact = JSON.parse(await fs.readFile(path.join(stateRoot, exported.artifactPointer), 'utf8'));
    assert.equal(artifact.nextSafeAction, 'operator-merge');
    assert.equal(artifact.readiness.activeMergeProposalId, 'proposal-a');

    await fs.writeFile(path.join(repo, 'late-drift.txt'), 'drift\n');
    await git(repo, ['add', 'late-drift.txt']);
    await git(repo, ['commit', '-m', 'late drift']);

    exported = await app.callTool('handoff_export', { missionId });
    assert.equal(exported.handoff.readiness.ready, false);
    assert.equal(exported.handoff.readiness.operatorActionRequired, false);
    assert.equal(exported.handoff.nextSafeAction, 'candidate-refresh');
    assert.ok(exported.handoff.readiness.blockers.some((item) => item.code === 'MERGE_PROPOSAL_SOURCE_STALE'));

    artifact = JSON.parse(await fs.readFile(path.join(stateRoot, exported.artifactPointer), 'utf8'));
    assert.equal(artifact.nextSafeAction, 'candidate-refresh');
    assert.ok(artifact.readiness.blockers.some((item) => item.code === 'MERGE_PROPOSAL_SOURCE_STALE'));
  } finally {
    await cleanup(root);
  }
});
