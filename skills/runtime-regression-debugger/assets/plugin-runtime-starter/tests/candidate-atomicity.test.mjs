import assert from 'node:assert/strict';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { git } from '../src/git.mjs';
import { LocalJsonStateBackend } from '../src/local-json-state-backend.mjs';
import { STATE_COMMIT_AUDIT_OUTCOME_UNKNOWN } from '../src/state-backend-durability-contract.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

class CandidateFaultBackend extends LocalJsonStateBackend {
  constructor(options) {
    super(options);
    this.candidateFault = null;
  }

  async transaction(eventType, mutator, auditSummary = {}) {
    if (eventType === 'candidate_created' && this.candidateFault === 'ordinary-before-commit') {
      this.candidateFault = null;
      const error = new Error('injected candidate state failure before commit');
      error.code = 'INJECTED_CANDIDATE_STATE_FAILURE';
      throw error;
    }
    const result = await super.transaction(eventType, mutator, auditSummary);
    if (eventType === 'candidate_created' && this.candidateFault === 'unknown-after-commit') {
      this.candidateFault = null;
      const error = new Error('injected candidate commit acknowledgement ambiguity');
      error.code = STATE_COMMIT_AUDIT_OUTCOME_UNKNOWN;
      error.stateCommitted = true;
      error.auditOutcome = 'unknown';
      error.requiresReconciliation = true;
      throw error;
    }
    return result;
  }
}

async function planCandidateMission(app, repo, suffix) {
  const project = await app.callTool('project_open', {
    requestId: `candidate-atomic-project-${suffix}`,
    repoPath: repo
  });
  const planned = await app.callTool('mission_plan', {
    requestId: `candidate-atomic-plan-${suffix}`,
    projectId: project.id,
    goal: `candidate atomicity ${suffix}`,
    doneDefinition: 'candidate identity and evidence stay aligned with durable state',
    tasks: [{
      id: 'T1',
      contract: 'preserve the candidate atomicity fixture',
      owner: 'src',
      dependencies: [],
      writeSet: ['src'],
      risk: 'low'
    }]
  });
  return { project, missionId: planned.mission.id };
}

async function candidateRefs(repo) {
  const result = await git(repo, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/veteran/candidates/']);
  return result.stdout.trim() ? result.stdout.trim().split(/\r?\n/).map((line) => {
    const [ref, object] = line.split(' ');
    return { ref, object };
  }) : [];
}

function candidateEvidence(state) {
  return Object.values(state.evidence).filter((item) => item.type === 'candidate');
}

test('ordinary candidate state failure rolls back the Git ref and leaves no candidate evidence', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'base\n' } });
  try {
    const backend = new CandidateFaultBackend({ root: fixture.stateRoot });
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot, stateBackend: backend });
    const { missionId } = await planCandidateMission(app, fixture.repo, 'ordinary');
    backend.candidateFault = 'ordinary-before-commit';

    await assert.rejects(
      app.callTool('candidate_refresh', {
        requestId: 'candidate-atomic-refresh-ordinary',
        missionId
      }),
      (error) => error.code === 'INJECTED_CANDIDATE_STATE_FAILURE'
    );

    const state = await app.store.read();
    assert.deepEqual(await candidateRefs(fixture.repo), [], 'failed candidate state commit must not leave an unowned Git ref');
    assert.equal(Object.keys(state.runtime.candidates || {}).length, 0);
    assert.equal(candidateEvidence(state).length, 0, 'candidate evidence must share the candidate durable commit boundary');
    assert.equal(state.missions[missionId].activeCandidateId, null);
    assert.deepEqual(state.missions[missionId].candidateIds, []);
  } finally {
    await cleanup(fixture.root);
  }
});

test('unknown candidate commit outcome preserves the Git ref and co-committed candidate evidence', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'base\n' } });
  try {
    const backend = new CandidateFaultBackend({ root: fixture.stateRoot });
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot, stateBackend: backend });
    const { missionId } = await planCandidateMission(app, fixture.repo, 'unknown');
    backend.candidateFault = 'unknown-after-commit';

    await assert.rejects(
      app.callTool('candidate_refresh', {
        requestId: 'candidate-atomic-refresh-unknown',
        missionId
      }),
      (error) => error.code === 'REQUEST_OUTCOME_UNKNOWN'
    );

    const state = await app.store.read();
    const candidates = Object.values(state.runtime.candidates || {});
    const evidence = candidateEvidence(state);
    const refs = await candidateRefs(fixture.repo);
    assert.equal(candidates.length, 1, 'the candidate state was durably committed before acknowledgement became ambiguous');
    assert.equal(evidence.length, 1, 'candidate evidence must be co-committed with candidate state');
    assert.equal(state.missions[missionId].activeCandidateId, candidates[0].id);
    assert.deepEqual(state.missions[missionId].candidateIds, [candidates[0].id]);
    assert.equal(refs.length, 1, 'unknown outcome must not delete a ref that durable state may own');
    assert.equal(refs[0].ref, candidates[0].ref);
    assert.equal(refs[0].object, candidates[0].commitSha);
    assert.equal(state.requests['candidate-atomic-refresh-unknown'].status, 'unknown');
  } finally {
    await cleanup(fixture.root);
  }
});
