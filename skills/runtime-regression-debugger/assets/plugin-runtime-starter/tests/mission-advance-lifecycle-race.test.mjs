import assert from 'node:assert/strict';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { cleanup, tempDir } from './helpers.mjs';

const CANDIDATE_ID = 'candidate-race';
const CANDIDATE_COMMIT = 'candidate-commit';
const SOURCE_HEAD = 'source-head';
const MISSION_HEAD = 'mission-head';

async function seedAdvanceState({ app, stateRoot, phase, requiredValidationCapabilities = [] }) {
  const missionId = `mission-${phase.replaceAll('-', '_')}`;
  const projectId = `project-${phase.replaceAll('-', '_')}`;
  const validationReady = phase !== 'validation';
  const reviewReady = !['validation', 'review'].includes(phase);
  const semanticReady = !['validation', 'review', 'semantic-review'].includes(phase);

  await app.store.transaction('test_seed_mission_advance_lifecycle_race', (state) => {
    state.projects[projectId] = {
      id: projectId,
      repoPath: stateRoot,
      requireValidation: false,
      requiredValidationCapabilities
    };
    state.missions[missionId] = {
      id: missionId,
      projectId,
      goal: 'preserve terminal lifecycle authority',
      doneDefinition: 'late advance writes cannot revive the mission',
      baseSourceIdentity: { head: 'base-head' },
      status: 'ready',
      phase,
      validation: {
        status: validationReady ? 'passed' : 'pending',
        evidenceIds: validationReady ? ['validation-evidence'] : [],
        commitSha: validationReady ? CANDIDATE_COMMIT : null
      },
      review: {
        status: reviewReady ? 'passed' : 'pending',
        evidenceIds: reviewReady ? ['review-evidence'] : [],
        findings: [],
        commitSha: reviewReady ? CANDIDATE_COMMIT : null
      },
      semanticReview: {
        status: semanticReady ? 'passed' : 'pending',
        evidenceIds: semanticReady ? ['semantic-evidence'] : [],
        findings: [],
        commitSha: semanticReady ? CANDIDATE_COMMIT : null
      },
      candidateIds: [CANDIDATE_ID],
      activeCandidateId: CANDIDATE_ID,
      mergeProposalIds: [],
      activeMergeProposalId: null,
      interruption: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    };
    state.runtime.candidates ||= {};
    state.runtime.candidates[CANDIDATE_ID] = {
      id: CANDIDATE_ID,
      projectId,
      missionId,
      commitSha: CANDIDATE_COMMIT,
      sourceHead: SOURCE_HEAD,
      missionHead: MISSION_HEAD,
      ref: 'refs/heads/veteran/candidate/race',
      immutable: true
    };
  }, { missionId, phase });

  return { missionId, projectId };
}

async function cancelMission(app, missionId) {
  await app.services.missionService.cancel({ missionId, reason: 'test-race' });
}

const cancellationScenarios = [
  {
    name: 'validation skipped',
    phase: 'validation',
    forbiddenEvent: 'mission_validation_skipped',
    configure({ app, missionId }) {
      app.services.evidenceService.record = async () => {
        await cancelMission(app, missionId);
        return { id: 'validation-skipped-evidence' };
      };
    },
    assertState({ mission }) {
      assert.equal(mission.validation.status, 'pending');
    }
  },
  {
    name: 'validation aggregate',
    phase: 'validation',
    requiredValidationCapabilities: ['unit'],
    forbiddenEvent: 'mission_validation_passed',
    configure({ app, missionId }) {
      app.services.missionAdvanceService.runValidationPlan = async () => {
        await cancelMission(app, missionId);
        return {
          plan: { maxParallel: 1, batches: [{ tier: 0, capabilities: ['unit'] }] },
          results: [{ capability: 'unit', passed: true, evidenceId: 'validation-evidence', commitSha: CANDIDATE_COMMIT }],
          deferredCapabilities: [],
          stoppedAfterBatch: null
        };
      };
    },
    assertState({ mission }) {
      assert.equal(mission.validation.status, 'pending');
    }
  },
  {
    name: 'deterministic review',
    phase: 'review',
    forbiddenEvent: 'mission_review_passed',
    configure({ app, missionId }) {
      app.services.reviewService.deterministic = async () => {
        await app.store.transaction('test_review_proof_finished_before_cancel', (state) => {
          const mission = state.missions[missionId];
          mission.review = { status: 'passed', evidenceIds: ['review-race-evidence'], findings: [], commitSha: CANDIDATE_COMMIT };
        }, { missionId });
        await cancelMission(app, missionId);
        return { passed: true, head: CANDIDATE_COMMIT, evidenceId: 'review-race-evidence' };
      };
    },
    assertState({ mission }) {
      assert.equal(mission.review.status, 'passed', 'completed diagnostic proof may remain recorded');
    }
  },
  {
    name: 'semantic review',
    phase: 'semantic-review',
    forbiddenEvent: 'mission_semantic_review_passed',
    configure({ app, missionId }) {
      app.services.reviewService.semantic = async () => {
        await app.store.transaction('test_semantic_proof_finished_before_cancel', (state) => {
          const mission = state.missions[missionId];
          mission.semanticReview = { status: 'passed', evidenceIds: ['semantic-race-evidence'], findings: [], commitSha: CANDIDATE_COMMIT };
        }, { missionId });
        await cancelMission(app, missionId);
        return { passed: true, head: CANDIDATE_COMMIT, evidenceId: 'semantic-race-evidence' };
      };
    },
    assertState({ mission }) {
      assert.equal(mission.semanticReview.status, 'passed', 'completed diagnostic proof may remain recorded');
    }
  },
  {
    name: 'candidate promotion',
    phase: 'candidate',
    forbiddenEvent: 'mission_candidate_ready',
    configure({ app, missionId }) {
      app.services.candidateService.preflight = async () => {
        await cancelMission(app, missionId);
        return { ready: false, sourceHead: SOURCE_HEAD, missionHead: MISSION_HEAD };
      };
    }
  },
  {
    name: 'finalize proposal',
    phase: 'finalize',
    forbiddenEvent: 'mission_finalize_proposed',
    configure({ app, missionId }) {
      app.services.candidateService.preflight = async () => {
        await cancelMission(app, missionId);
        return { ready: false, sourceHead: SOURCE_HEAD, sourceBranch: 'main', missionHead: MISSION_HEAD };
      };
    },
    assertState({ mission, state }) {
      assert.equal(mission.activeMergeProposalId, null);
      assert.deepEqual(mission.mergeProposalIds, []);
      assert.deepEqual(Object.values(state.runtime.mergeProposals || {}).filter((proposal) => proposal.missionId === mission.id), []);
    }
  }
];

for (const scenario of cancellationScenarios) {
  test(`mission advance cannot revive a cancelled mission after ${scenario.name}`, async () => {
    const stateRoot = await tempDir('veteran-mission-advance-race-');
    try {
      const app = await createVeteranApp({ stateRoot });
      const { missionId } = await seedAdvanceState({
        app,
        stateRoot,
        phase: scenario.phase,
        requiredValidationCapabilities: scenario.requiredValidationCapabilities || []
      });
      scenario.configure({ app, missionId });

      await assert.rejects(
        app.services.missionAdvanceService.advance({ missionId }),
        (error) => error?.code === 'MISSION_CANCELLED'
      );

      const state = await app.store.read();
      const mission = state.missions[missionId];
      assert.equal(mission.status, 'cancelled');
      assert.equal(mission.phase, scenario.phase, 'late advance state must not cross the cancelled phase boundary');
      assert.equal(
        state.runtime.timeline.some((event) => event.missionId === missionId && event.type === scenario.forbiddenEvent),
        false,
        `${scenario.forbiddenEvent} must not commit after cancellation`
      );
      scenario.assertState?.({ mission, state });
    } finally {
      await cleanup(stateRoot);
    }
  });
}

test('mission advance cannot overwrite reconciliation authority after async review completes', async () => {
  const stateRoot = await tempDir('veteran-mission-advance-reconciliation-race-');
  try {
    const app = await createVeteranApp({ stateRoot });
    const { missionId } = await seedAdvanceState({ app, stateRoot, phase: 'review' });
    app.services.reviewService.deterministic = async () => {
      await app.store.transaction('test_reconciliation_required_during_review', (state) => {
        const mission = state.missions[missionId];
        mission.status = 'blocked';
        mission.interruption = {
          requiresReconciliation: true,
          taskIds: ['T1'],
          detectedAt: '2026-01-01T00:00:01.000Z'
        };
      }, { missionId });
      return { passed: true, head: CANDIDATE_COMMIT, evidenceId: 'review-evidence' };
    };

    await assert.rejects(
      app.services.missionAdvanceService.advance({ missionId }),
      (error) => error?.code === 'RECONCILIATION_REQUIRED'
    );

    const state = await app.store.read();
    const mission = state.missions[missionId];
    assert.equal(mission.status, 'blocked');
    assert.equal(mission.phase, 'review');
    assert.equal(mission.interruption?.requiresReconciliation, true);
    assert.equal(
      state.runtime.timeline.some((event) => event.missionId === missionId && event.type === 'mission_review_passed'),
      false
    );
  } finally {
    await cleanup(stateRoot);
  }
});
