import assert from 'node:assert/strict';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { cleanup, tempDir } from './helpers.mjs';

test('semantic_review_run cannot review a candidate owned by another mission', async () => {
  const stateRoot = await tempDir('veteran-semantic-scope-');
  try {
    const app = await createVeteranApp({ stateRoot });
    await app.store.transaction('test_seed_semantic_scope', (state) => {
      state.projects['project-a'] = {
        id: 'project-a',
        repoPath: stateRoot,
        reviewerProvider: null,
        requireSemanticReview: false
      };
      state.missions['mission-a'] = {
        id: 'mission-a',
        projectId: 'project-a',
        candidateIds: [],
        mergeProposalIds: [],
        semanticReview: { status: 'pending', evidenceIds: [], findings: [] }
      };
      state.missions['mission-b'] = {
        id: 'mission-b',
        projectId: 'project-a',
        candidateIds: ['candidate-b'],
        mergeProposalIds: [],
        activeCandidateId: 'candidate-b',
        semanticReview: { status: 'pending', evidenceIds: [], findings: [] }
      };
      state.runtime.candidates = {
        'candidate-b': {
          id: 'candidate-b',
          projectId: 'project-a',
          missionId: 'mission-b',
          commitSha: 'b'.repeat(40),
          immutable: true
        }
      };
    });

    await assert.rejects(
      app.callTool('semantic_review_run', {
        requestId: 'semantic-review-cross-mission',
        missionId: 'mission-a',
        candidateId: 'candidate-b'
      }),
      (error) => error.code === 'CANDIDATE_NOT_FOUND'
    );

    const state = await app.store.read();
    assert.equal(state.missions['mission-a'].semanticReview.status, 'pending');
    assert.equal(Object.values(state.evidence).filter((item) => item.missionId === 'mission-a').length, 0);
  } finally {
    await cleanup(stateRoot);
  }
});
