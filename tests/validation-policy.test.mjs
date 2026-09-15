import assert from 'node:assert/strict';
import test from 'node:test';
import { projectPolicy } from '../src/operator-config.mjs';

test('validation concurrency budget defaults to four and supports bounded project override', () => {
  assert.equal(projectPolicy({}, '/repo').validationPolicy.maxParallel, 4);
  const policy = projectPolicy({
    defaults: { validationPolicy: { maxParallel: 3 } },
    projects: { '/repo': { validationPolicy: { maxParallel: 2 } } }
  }, '/repo');
  assert.equal(policy.validationPolicy.maxParallel, 2);
});

test('validation concurrency budget rejects coercion and unbounded values', () => {
  for (const value of ['4', 0, 17]) {
    assert.throws(
      () => projectPolicy({ defaults: { validationPolicy: { maxParallel: value } } }, '/repo'),
      (error) => error.code === 'OPERATOR_CONFIG_INVALID' && error.details?.path === 'defaults.validationPolicy.maxParallel'
    );
  }
});
