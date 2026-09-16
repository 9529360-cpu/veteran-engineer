import assert from 'node:assert/strict';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

async function failedSemanticMission(app, projectId, head) {
  const planned = await app.services.missionService.plan({
    projectId,
    goal: 'Deliver Codex-style layout and liquid-glass visual system',
    doneDefinition: 'Both requested visible outcomes are proven',
    tasks: [{ id: 'T1', contract: 'Implement liquid-glass visual system', owner: 'src', dependencies: [], writeSet: ['src'], risk: 'low' }]
  });
  await app.store.transaction('test_failed_semantic_review', (state) => {
    const mission = state.missions[planned.mission.id];
    state.tasks[`${mission.id}:T1`].status = 'done';
    state.tasks[`${mission.id}:T1`].integrationSha = head;
    mission.nextWaveIndex = mission.waves.length;
    mission.phase = 'semantic-review';
    mission.status = 'ready';
    mission.review = { status: 'passed', evidenceIds: ['review-proof'], findings: [], commitSha: head };
    mission.semanticReview = {
      status: 'failed',
      evidenceIds: ['semantic-proof'],
      commitSha: head,
      findings: [{
        severity: 'high',
        code: 'ACCEPTANCE_REQUIREMENT_NOT_PROVEN',
        requirementId: 'mission-goal',
        requirement: 'Deliver Codex-style layout and liquid-glass visual system',
        acceptance: 'Both visible outcomes are present',
        message: 'Codex-style layout is missing'
      }]
    };
  });
  return planned.mission.id;
}

function remediationTask(overrides = {}) {
  return {
    id: 'R1',
    contract: 'Implement the missing Codex-style workspace layout and preserve the existing liquid-glass work',
    owner: 'src',
    dependencies: [],
    writeSet: ['src'],
    risk: 'low',
    sourceFindingIndexes: [0],
    ...overrides
  };
}

test('applied remediation appends source-bound tasks and re-enters execution on the same Mission', async () => {
  const { root, repo, head, stateRoot } = await createGitRepo({ files: { 'src/app.txt': 'before\n' } });
  try {
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const missionId = await failedSemanticMission(app, project.id, head);

    const remediation = await app.services.reviewService.remediationPlan({
      missionId,
      apply: true,
      tasks: [remediationTask()]
    });

    assert.equal(remediation.applied, true);
    assert.equal(remediation.sourceHead, head);
    assert.deepEqual(remediation.taskIds, ['R1']);
    assert.deepEqual(remediation.tasks[0].sourceFindingIndexes, [0]);

    const status = await app.services.missionService.status({ missionId });
    assert.equal(status.mission.phase, 'execution');
    assert.equal(status.mission.status, 'ready');
    assert.equal(status.mission.validation.status, 'pending');
    assert.equal(status.mission.review.status, 'pending');
    assert.equal(status.mission.semanticReview.status, 'pending');
    assert.deepEqual(status.mission.waves.at(-1), ['R1']);
    assert.equal(status.mission.nextWaveIndex, status.mission.waves.length - 1);
    assert.equal(status.tasks.find((task) => task.id === 'T1').status, 'done');
    assert.equal(status.tasks.find((task) => task.id === 'R1').status, 'planned');

    const execution = await app.services.workerOrchestrator.execute({ missionId, runWorkers: false });
    assert.equal(execution.dispatched.length, 1);
    assert.equal(execution.dispatched[0].taskId, 'R1');
    assert.equal(execution.waveBase, head);
    assert.match(execution.dispatched[0].packet.task.contract, /missing Codex-style workspace layout/);
  } finally {
    await cleanup(root);
  }
});

test('remediation apply fails closed without explicit executable task authority', async () => {
  const { root, repo, head, stateRoot } = await createGitRepo();
  try {
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const missionId = await failedSemanticMission(app, project.id, head);
    await assert.rejects(
      app.services.reviewService.remediationPlan({ missionId, apply: true }),
      (error) => error.code === 'REMEDIATION_TASKS_REQUIRED'
    );
  } finally {
    await cleanup(root);
  }
});

test('remediation apply rejects caller-supplied finding overrides', async () => {
  const { root, repo, head, stateRoot } = await createGitRepo();
  try {
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const missionId = await failedSemanticMission(app, project.id, head);
    await assert.rejects(
      app.services.reviewService.remediationPlan({
        missionId,
        apply: true,
        findings: [{ severity: 'high', code: 'INVENTED_SCOPE', message: 'Do unrelated work' }],
        tasks: [remediationTask()]
      }),
      (error) => error.code === 'REMEDIATION_FINDINGS_OVERRIDE_FORBIDDEN'
    );
  } finally {
    await cleanup(root);
  }
});

test('remediation apply requires every task to bind to authoritative findings', async () => {
  const { root, repo, head, stateRoot } = await createGitRepo();
  try {
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const missionId = await failedSemanticMission(app, project.id, head);
    await assert.rejects(
      app.services.reviewService.remediationPlan({
        missionId,
        apply: true,
        tasks: [remediationTask({ sourceFindingIndexes: undefined })]
      }),
      (error) => error.code === 'REMEDIATION_FINDING_BINDING_REQUIRED'
    );
    await assert.rejects(
      app.services.reviewService.remediationPlan({
        missionId,
        apply: true,
        tasks: [remediationTask({ sourceFindingIndexes: [1] })]
      }),
      (error) => error.code === 'REMEDIATION_FINDING_BINDING_INVALID'
    );
  } finally {
    await cleanup(root);
  }
});

test('remediation proposal preserves missing requirement text without mutating Mission execution state', async () => {
  const { root, repo, head, stateRoot } = await createGitRepo();
  try {
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const missionId = await failedSemanticMission(app, project.id, head);
    const proposal = await app.services.reviewService.remediationPlan({ missionId });
    assert.equal(proposal.applied, false);
    assert.match(proposal.tasks[0].contract, /Codex-style layout and liquid-glass visual system/);
    assert.deepEqual(proposal.tasks[0].sourceFindingIndexes, [0]);
    const status = await app.services.missionService.status({ missionId });
    assert.equal(status.mission.phase, 'semantic-review');
    assert.equal(status.tasks.some((task) => task.id === 'R1'), false);
  } finally {
    await cleanup(root);
  }
});