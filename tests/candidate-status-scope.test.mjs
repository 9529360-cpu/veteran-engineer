import assert from 'node:assert/strict';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { cleanup, tempDir } from './helpers.mjs';

test('candidate_status cannot read a candidate owned by another mission', async () => {
  const stateRoot = await tempDir('veteran-candidate-scope-');
  try {
    const app = await createVeteranApp({ stateRoot });
    await app.store.transaction('test_seed_candidates', (state) => {
      state.missions['mission-a'] = {
        id: 'mission-a',
        projectId: 'project-a',
        activeCandidateId: 'candidate-a'
      };
      state.missions['mission-b'] = {
        id: 'mission-b',
        projectId: 'project-b',
        activeCandidateId: 'candidate-b'
      };
      state.runtime.candidates = {
        'candidate-a': {
          id: 'candidate-a',
          projectId: 'project-a',
          missionId: 'mission-a',
          commitSha: 'a'.repeat(40),
          immutable: true
        },
        'candidate-b': {
          id: 'candidate-b',
          projectId: 'project-b',
          missionId: 'mission-b',
          commitSha: 'b'.repeat(40),
          immutable: true
        }
      };
    });

    const active = await app.callTool('candidate_status', { missionId: 'mission-a' });
    assert.equal(active.candidate.id, 'candidate-a');

    const explicit = await app.callTool('candidate_status', {
      missionId: 'mission-b',
      candidateId: 'candidate-b'
    });
    assert.equal(explicit.candidate.id, 'candidate-b');

    await assert.rejects(
      app.callTool('candidate_status', {
        missionId: 'mission-a',
        candidateId: 'candidate-b'
      }),
      (error) => error.code === 'CANDIDATE_NOT_FOUND'
    );
  } finally {
    await cleanup(stateRoot);
  }
});
