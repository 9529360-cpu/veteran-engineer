import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { git } from '../src/git.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

test('mission_readiness withdraws operator merge after source advances past the proposal', async () => {
  const { root, repo, head, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'base\n' } });
  try {
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const missionId = 'mission-readiness-proposal';

    await app.store.transaction('test_seed_merge_proposal_readiness', (state) => {
      state.missions[missionId] = {
        id: missionId,
        projectId: project.id,
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

    let readiness = await app.callTool('mission_readiness', { missionId });
    assert.equal(readiness.ready, true);
    assert.equal(readiness.operatorActionRequired, true);
    assert.equal(readiness.nextAction, 'operator-merge');

    await fs.writeFile(path.join(repo, 'late-drift.txt'), 'drift\n');
    await git(repo, ['add', 'late-drift.txt']);
    await git(repo, ['commit', '-m', 'late drift']);
    const liveHead = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();

    readiness = await app.callTool('mission_readiness', { missionId });
    assert.equal(readiness.ready, false);
    assert.equal(readiness.operatorActionRequired, false);
    assert.equal(readiness.nextAction, 'candidate-refresh');
    const stale = readiness.blockers.find((item) => item.code === 'MERGE_PROPOSAL_SOURCE_STALE');
    assert.ok(stale);
    assert.equal(stale.mergeProposalId, 'proposal-a');
    assert.equal(stale.expectedSourceHead, head);
    assert.equal(stale.liveSourceHead, liveHead);
  } finally {
    await cleanup(root);
  }
});
