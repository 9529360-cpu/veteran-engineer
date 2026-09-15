import assert from 'node:assert/strict';
import test from 'node:test';
import { MissionAdvanceService } from '../src/mission-advance.mjs';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function harness({ capabilities, required, runValidation, maxParallel = 4 }) {
  const project = {
    id: 'project-1',
    validationCapabilities: capabilities,
    requiredValidationCapabilities: required,
    validationPolicy: { maxParallel },
    requireValidation: true
  };
  const mission = {
    id: 'mission-1',
    projectId: project.id,
    phase: 'validation',
    status: 'ready',
    activeCandidateId: 'candidate-1',
    validation: { status: 'pending', evidenceIds: [], commitSha: null },
    review: { status: 'pending', evidenceIds: [], commitSha: null },
    semanticReview: { status: 'pending', evidenceIds: [], commitSha: null }
  };
  const state = {
    missions: { [mission.id]: mission },
    runtime: {
      candidates: {
        'candidate-1': {
          id: 'candidate-1',
          projectId: project.id,
          missionId: mission.id,
          commitSha: 'commit-abc'
        }
      },
      timeline: []
    }
  };
  const store = {
    async read() { return state; },
    async transaction(_name, mutate) { return mutate(state); }
  };
  const service = new MissionAdvanceService({
    store,
    projectService: { async get(id) { assert.equal(id, project.id); return project; } },
    missionService: { async status({ missionId }) { assert.equal(missionId, mission.id); return { mission: state.missions[missionId], tasks: [] }; } },
    worktreeManager: {},
    workerOrchestrator: {},
    validationService: { run: runValidation },
    reviewService: {},
    candidateService: {},
    evidenceService: { async record() { throw new Error('unexpected synthetic validation evidence'); } }
  });
  return { service, state, mission, project };
}

function command(name, extras = {}) {
  return { name, command: [process.execPath, '-e', 'process.exit(0)'], ...extras };
}

function passedResult(input, evidenceId = `e-${input.capability}`) {
  return {
    purpose: 'final-validation',
    passed: true,
    capability: input.capability,
    commitSha: input.sourceCommitSha,
    evidenceId,
    exitCode: 0,
    failureStage: null
  };
}

test('mission validation overlaps safe capabilities while aggregating evidence in required order', async () => {
  let active = 0;
  let maxActive = 0;
  const seen = [];
  const { service, mission } = harness({
    required: ['slow', 'fast'],
    capabilities: [command('slow'), command('fast')],
    maxParallel: 2,
    runValidation: async (input) => {
      seen.push(input);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(input.capability === 'slow' ? 40 : 5);
      active -= 1;
      return passedResult(input);
    }
  });

  const result = await service.advance({ missionId: mission.id });

  assert.equal(maxActive, 2);
  assert.deepEqual(result.results.map((item) => item.capability), ['slow', 'fast']);
  assert.deepEqual(result.validationPlan.batches, [{ tier: 0, capabilities: ['slow', 'fast'] }]);
  assert.equal(result.nextPhase, 'review');
  assert.equal(mission.phase, 'review');
  assert.equal(mission.validation.status, 'passed');
  assert.equal(mission.validation.commitSha, 'commit-abc');
  assert.deepEqual(mission.validation.evidenceIds, ['e-slow', 'e-fast']);
  assert.equal(seen.length, 2);
  for (const input of seen) {
    assert.equal(input.sourceCommitSha, 'commit-abc');
    assert.equal(input.recordMissionValidation, false);
  }
});

test('mission validation drains a failing safe batch and does not start later expensive work', async () => {
  const called = [];
  let slowPassFinished = false;
  const { service, mission } = harness({
    required: ['slow-pass', 'fast-fail', 'browser-later'],
    capabilities: [
      command('slow-pass'),
      command('fast-fail'),
      { name: 'browser-later', browser: { command: ['browser-provider'] } }
    ],
    maxParallel: 2,
    runValidation: async (input) => {
      called.push(input.capability);
      if (input.capability === 'slow-pass') {
        await delay(40);
        slowPassFinished = true;
        return passedResult(input, 'e-pass');
      }
      if (input.capability === 'fast-fail') {
        await delay(5);
        return { purpose: 'final-validation', passed: false, capability: input.capability, commitSha: input.sourceCommitSha, evidenceId: 'e-fail', exitCode: 2, failureStage: 'validation-command' };
      }
      throw new Error('expensive validation should not have started');
    }
  });

  const result = await service.advance({ missionId: mission.id });

  assert.equal(slowPassFinished, true);
  assert.deepEqual(called.sort(), ['fast-fail', 'slow-pass']);
  assert.equal(result.blocked, true);
  assert.equal(result.cancelPolicy, 'drain-in-flight');
  assert.deepEqual(result.deferredCapabilities, ['browser-later']);
  assert.deepEqual(result.results.map((item) => item.capability), ['slow-pass', 'fast-fail']);
  assert.equal(mission.phase, 'validation');
  assert.equal(mission.validation.status, 'failed');
  assert.equal(mission.validation.commitSha, 'commit-abc');
  assert.deepEqual(mission.validation.evidenceIds, ['e-pass', 'e-fail']);
});

test('mission validation fills a freed slot with newly unblocked work before a long sibling completes', async () => {
  const called = [];
  let slowFinished = false;
  let nextDbStartedBeforeSlowFinished = false;
  const { service, mission } = harness({
    required: ['slow-free', 'fast-db', 'next-db'],
    capabilities: [
      command('slow-free'),
      command('fast-db', { coordinationKeys: ['integration-db'] }),
      command('next-db', { coordinationKeys: ['integration-db'] })
    ],
    maxParallel: 2,
    runValidation: async (input) => {
      called.push(input.capability);
      if (input.capability === 'slow-free') {
        await delay(50);
        slowFinished = true;
        return passedResult(input);
      }
      if (input.capability === 'fast-db') {
        await delay(5);
        return passedResult(input);
      }
      nextDbStartedBeforeSlowFinished = !slowFinished;
      await delay(5);
      return passedResult(input);
    }
  });

  const result = await service.advance({ missionId: mission.id });

  assert.equal(nextDbStartedBeforeSlowFinished, true);
  assert.deepEqual(called, ['slow-free', 'fast-db', 'next-db']);
  assert.deepEqual(result.validationPlan.batches, [
    { tier: 0, capabilities: ['slow-free', 'fast-db'] },
    { tier: 0, capabilities: ['next-db'] }
  ]);
  assert.deepEqual(result.results.map((item) => item.capability), ['slow-free', 'fast-db', 'next-db']);
  assert.equal(mission.validation.status, 'passed');
});

test('mission validation stops sliding admission after failure while draining already active work', async () => {
  const called = [];
  let slowFinished = false;
  const { service, mission } = harness({
    required: ['slow-free', 'fast-fail-db', 'next-db'],
    capabilities: [
      command('slow-free'),
      command('fast-fail-db', { coordinationKeys: ['integration-db'] }),
      command('next-db', { coordinationKeys: ['integration-db'] })
    ],
    maxParallel: 2,
    runValidation: async (input) => {
      called.push(input.capability);
      if (input.capability === 'slow-free') {
        await delay(40);
        slowFinished = true;
        return passedResult(input);
      }
      if (input.capability === 'fast-fail-db') {
        await delay(5);
        return { ...passedResult(input), passed: false, exitCode: 2, failureStage: 'validation-command' };
      }
      throw new Error('new validation must not start after failure is observed');
    }
  });

  const result = await service.advance({ missionId: mission.id });

  assert.equal(slowFinished, true);
  assert.deepEqual(called, ['slow-free', 'fast-fail-db']);
  assert.equal(result.blocked, true);
  assert.equal(result.cancelPolicy, 'drain-in-flight');
  assert.deepEqual(result.deferredCapabilities, ['next-db']);
  assert.deepEqual(result.results.map((item) => item.capability), ['slow-free', 'fast-fail-db']);
  assert.equal(mission.validation.status, 'failed');
});
