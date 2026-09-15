import assert from 'node:assert/strict';
import test from 'node:test';
import { compileMissionExecutionStrategy } from '../src/adaptive-mission-strategy.mjs';
import { projectPolicy } from '../src/operator-config.mjs';

function lowRiskTask(id) {
  return { id, risk: 'low', riskAssessment: { source: 'inferred' } };
}

test('enabled workers default to four safe slots while explicit operator limits remain authoritative', () => {
  const aggressiveDefault = projectPolicy({ defaults: { workerPolicy: { enabled: true } } }, '/repo');
  assert.equal(aggressiveDefault.workerPolicy.enabled, true);
  assert.equal(aggressiveDefault.workerPolicy.maxWorkers, 4);

  const strategy = compileMissionExecutionStrategy({
    tasks: ['T1', 'T2', 'T3', 'T4'].map(lowRiskTask),
    waves: [['T1', 'T2', 'T3', 'T4']],
    project: { workerPolicy: aggressiveDefault.workerPolicy },
    riskEnvelope: 'medium'
  });
  assert.equal(strategy.concurrency.configuredMaxWorkers, 4);
  assert.equal(strategy.concurrency.structuralParallelism, 4);
  assert.equal(strategy.concurrency.maxConcurrentWorkers, 4);

  const bounded = projectPolicy({ defaults: { workerPolicy: { enabled: true, maxWorkers: 1 } } }, '/repo');
  assert.equal(bounded.workerPolicy.maxWorkers, 1);
});

test('worker execution remains opt-in despite the higher default capacity', () => {
  const policy = projectPolicy({}, '/repo');
  assert.equal(policy.workerPolicy.enabled, false);
  assert.equal(policy.workerPolicy.maxWorkers, 4);
});
