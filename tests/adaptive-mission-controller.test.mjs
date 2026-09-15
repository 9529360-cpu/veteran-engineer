import assert from 'node:assert/strict';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { assessTaskRisk, compileMissionExecutionStrategy } from '../src/adaptive-mission-strategy.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

function task(id, writeSet, extra = {}) {
  return {
    id,
    contract: `change ${writeSet.join(',')}`,
    owner: `owner:${id}`,
    dependencies: [],
    writeSet,
    ...extra
  };
}

test('adaptive task risk preserves explicit authority and infers meaningful engineering weight', () => {
  assert.deepEqual(assessTaskRisk({ explicitRisk: 'critical', writeSet: ['src/a.js'] }), {
    risk: 'critical',
    source: 'explicit',
    signals: []
  });

  const broad = assessTaskRisk({ writeSet: ['.'] });
  assert.equal(broad.risk, 'high');
  assert.equal(broad.source, 'inferred');
  assert.ok(broad.signals.includes('broad-write-set'));

  const validated = assessTaskRisk({ writeSet: ['src/a.js'], validationCapability: 'browser-e2e' });
  assert.equal(validated.risk, 'medium');
  assert.ok(validated.signals.includes('validation-boundary-required'));

  const light = compileMissionExecutionStrategy({
    tasks: [{ id: 'T1', risk: 'low', riskAssessment: { source: 'inferred' } }],
    waves: [['T1']],
    project: { workerPolicy: { maxWorkers: 4 } },
    riskEnvelope: 'medium'
  });
  assert.equal(light.taskClass, 'light');
  assert.equal(light.effectiveRisk, 'low');
  assert.equal(light.riskEnvelopeSource, 'baseline');
  assert.equal(light.concurrency.maxConcurrentWorkers, 1);

  const highRisk = compileMissionExecutionStrategy({
    tasks: ['T1', 'T2', 'T3', 'T4'].map((id) => ({ id, risk: 'high', riskAssessment: { source: 'explicit' } })),
    waves: [['T1', 'T2', 'T3', 'T4']],
    project: { workerPolicy: { maxWorkers: 4 } },
    riskEnvelope: 'medium'
  });
  assert.equal(highRisk.taskClass, 'heavy');
  assert.equal(highRisk.effectiveRisk, 'high');
  assert.equal(highRisk.concurrency.structuralParallelism, 4);
  assert.equal(highRisk.concurrency.maxConcurrentWorkers, 2);
  assert.equal(highRisk.concurrency.riskShaped, true);
  assert.ok(highRisk.reasons.includes('risk-shaped-concurrency'));

  const consequential = compileMissionExecutionStrategy({
    tasks: [
      { id: 'T1', risk: 'low', riskAssessment: { source: 'inferred' } },
      { id: 'T2', risk: 'low', riskAssessment: { source: 'inferred' } }
    ],
    waves: [['T1', 'T2']],
    project: { workerPolicy: { maxWorkers: 4 } },
    riskEnvelope: 'critical'
  });
  assert.equal(consequential.taskClass, 'consequential');
  assert.equal(consequential.effectiveRisk, 'critical');
  assert.equal(consequential.executionMode, 'serial-mission');
  assert.equal(consequential.concurrency.maxConcurrentWorkers, 1);
  assert.equal(consequential.concurrency.riskShaped, true);
});

test('mission planning preserves explicit medium risk envelope authority', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'a\n' } });
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.callTool('project_open', {
      requestId: 'adaptive-envelope-project',
      repoPath: fixture.repo
    });

    const baseline = await app.callTool('mission_plan', {
      requestId: 'adaptive-envelope-baseline',
      projectId: project.id,
      goal: 'baseline low-risk mission',
      doneDefinition: 'strategy stays light by default',
      tasks: [task('T1', ['src/a.txt'])]
    });
    assert.equal(baseline.mission.executionStrategy.riskEnvelope, 'medium');
    assert.equal(baseline.mission.executionStrategy.riskEnvelopeSource, 'baseline');
    assert.equal(baseline.mission.executionStrategy.taskClass, 'light');
    assert.equal(baseline.mission.executionStrategy.validation.mode, 'focused');

    const explicit = await app.callTool('mission_plan', {
      requestId: 'adaptive-envelope-explicit',
      projectId: project.id,
      goal: 'explicit medium-risk mission',
      doneDefinition: 'explicit operator envelope is preserved',
      riskEnvelope: 'medium',
      tasks: [task('T1', ['src/a.txt'])]
    });
    assert.equal(explicit.mission.executionStrategy.riskEnvelope, 'medium');
    assert.equal(explicit.mission.executionStrategy.riskEnvelopeSource, 'explicit');
    assert.equal(explicit.mission.executionStrategy.effectiveRisk, 'medium');
    assert.equal(explicit.mission.executionStrategy.taskClass, 'moderate');
    assert.equal(explicit.mission.executionStrategy.validation.mode, 'cross-boundary');
    assert.ok(explicit.mission.executionStrategy.reasons.includes('explicit-risk-envelope:medium'));
  } finally {
    await cleanup(fixture.root);
  }
});

test('mission planning refreshes project context and records adaptive parallel strategy', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'a\n', 'src/b.txt': 'b\n' } });
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.services.projectService.open({ repoPath: fixture.repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'change independent owners',
      doneDefinition: 'both changes are ready',
      tasks: [task('T1', ['src/a.txt']), task('T2', ['src/b.txt'])]
    });

    assert.equal(planned.mission.executionStrategy.contract, 'veteran-adaptive-mission-v1');
    assert.equal(planned.mission.executionStrategy.taskClass, 'moderate');
    assert.equal(planned.mission.executionStrategy.executionMode, 'parallel-mission');
    assert.equal(planned.mission.executionStrategy.maxWaveWidth, 2);
    assert.equal(planned.mission.executionStrategy.riskEnvelopeSource, 'baseline');
    assert.equal(planned.mission.executionStrategy.concurrency.maxConcurrentWorkers, 2);
    assert.deepEqual(planned.mission.executionStrategy.inferredRiskTasks, ['T1', 'T2']);
    assert.equal(planned.mission.projectContinuity.activeMissionCount, 0);
    assert.equal(planned.tasks[0].riskAssessment.source, 'inferred');

    const readiness = await app.services.missionService.readiness({ missionId: planned.mission.id });
    assert.equal(readiness.executionStrategy.executionMode, 'parallel-mission');
    assert.equal(readiness.projectContinuity.contract, 'veteran-adaptive-mission-v1');
  } finally {
    await cleanup(fixture.root);
  }
});

test('size-heavy missions use the full safe structural dispatch budget', async () => {
  const fixture = await createGitRepo({
    files: Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((name) => [`src/${name}.txt`, `${name}\n`]))
  });
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.services.projectService.open({ repoPath: fixture.repo });
    await app.store.transaction('test_adaptive_worker_budget', (state) => {
      state.projects[project.id].workerPolicy = {
        ...(state.projects[project.id].workerPolicy || {}),
        maxWorkers: 4
      };
    }, { projectId: project.id });

    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'change five independent owners',
      doneDefinition: 'all independent changes are dispatched safely at available structural parallelism',
      tasks: ['a', 'b', 'c', 'd', 'e'].map((name, index) => task(`T${index + 1}`, [`src/${name}.txt`]))
    });

    assert.equal(planned.mission.executionStrategy.taskClass, 'heavy');
    assert.equal(planned.mission.executionStrategy.effectiveRisk, 'low');
    assert.equal(planned.mission.executionStrategy.concurrency.configuredMaxWorkers, 4);
    assert.equal(planned.mission.executionStrategy.concurrency.structuralParallelism, 4);
    assert.equal(planned.mission.executionStrategy.concurrency.maxConcurrentWorkers, 4);
    assert.equal(planned.mission.executionStrategy.concurrency.riskShaped, false);
    assert.ok(planned.mission.executionStrategy.reasons.includes('size-heavy-full-parallelism'));

    const dispatch = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: false });
    assert.equal(dispatch.dispatched.length, 4);
    assert.deepEqual(dispatch.dispatched.map((item) => item.taskId), ['T1', 'T2', 'T3', 'T4']);
  } finally {
    await cleanup(fixture.root);
  }
});

test('same-project active write overlap is visible at planning and blocked before dispatch', async () => {
  const fixture = await createGitRepo({ files: { 'src/shared.txt': 'before\n' } });
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await app.services.projectService.open({ repoPath: fixture.repo });
    const first = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'first owner',
      doneDefinition: 'first owner dispatched',
      tasks: [task('T1', ['src/shared.txt'])]
    });
    const firstDispatch = await app.services.workerOrchestrator.execute({ missionId: first.mission.id, runWorkers: false });
    assert.equal(firstDispatch.dispatched.length, 1);
    assert.equal(firstDispatch.dispatched[0].taskId, 'T1');

    const second = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'second owner',
      doneDefinition: 'second owner does not race first',
      tasks: [task('T2', ['src/shared.txt'])]
    });
    assert.equal(second.mission.projectContinuity.activeMissionCount, 1);
    assert.equal(second.mission.executionStrategy.coordination.requiresCoordination, true);
    assert.equal(second.mission.executionStrategy.coordination.plannedProjectWriteConflicts[0].conflictingMissionId, first.mission.id);

    const blocked = await app.services.workerOrchestrator.execute({ missionId: second.mission.id, runWorkers: false });
    assert.equal(blocked.reason, 'capability-preflight-blocked');
    assert.equal(blocked.blocked[0].reason, 'project-write-conflict');
    assert.equal(blocked.blocked[0].conflicts[0].missionId, first.mission.id);
  } finally {
    await cleanup(fixture.root);
  }
});
