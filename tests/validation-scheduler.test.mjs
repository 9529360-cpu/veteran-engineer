import assert from 'node:assert/strict';
import test from 'node:test';
import { planValidationBatches } from '../src/validation-scheduler.mjs';

function command(name, extras = {}) {
  return { name, command: ['node', '--version'], ...extras };
}

test('parallel validation fills bounded batches with independent cheap capabilities', () => {
  const planned = planValidationBatches({
    required: ['a', 'b', 'c', 'd', 'e'],
    catalog: ['a', 'b', 'c', 'd', 'e'].map((name) => command(name)),
    maxParallel: 3,
    projectId: 'p',
    missionId: 'm'
  });
  assert.equal(planned.maxParallel, 3);
  assert.deepEqual(planned.batches, [
    { tier: 0, capabilities: ['a', 'b', 'c'] },
    { tier: 0, capabilities: ['d', 'e'] }
  ]);
});

test('validation reuses coordination and runtime resource semantics to serialize conflicts only', () => {
  const planned = planValidationBatches({
    required: ['db-a', 'db-b', 'free'],
    catalog: [
      command('db-a', { coordinationKeys: ['integration-db'] }),
      command('db-b', { coordinationKeys: ['integration-db'] }),
      command('free')
    ],
    maxParallel: 3,
    projectId: 'p',
    missionId: 'm'
  });
  assert.deepEqual(planned.batches, [
    { tier: 0, capabilities: ['db-a', 'free'] },
    { tier: 0, capabilities: ['db-b'] }
  ]);
});

test('service readiness ports are inferred as global exclusive resources', () => {
  const planned = planValidationBatches({
    required: ['service-a', 'service-b', 'service-c'],
    catalog: [
      command('service-a', { service: { readiness: { url: 'http://127.0.0.1:4311/health' } } }),
      command('service-b', { service: { readiness: { url: 'http://localhost:4311/ready' } } }),
      command('service-c', { service: { readiness: { url: 'http://127.0.0.1:4312/health' } } })
    ],
    maxParallel: 3,
    projectId: 'p',
    missionId: 'm'
  });
  assert.deepEqual(planned.batches, [
    { tier: 1, capabilities: ['service-a', 'service-c'] },
    { tier: 1, capabilities: ['service-b'] }
  ]);
});

test('cheap command validation is scheduled before service and browser or observability work', () => {
  const planned = planValidationBatches({
    required: ['browser', 'service', 'lint', 'observe'],
    catalog: [
      { name: 'browser', browser: { command: ['browser'] } },
      command('service', { service: { readiness: { url: 'http://127.0.0.1:4100/health' } } }),
      command('lint'),
      { name: 'observe', observability: { command: ['observe'] } }
    ],
    maxParallel: 4,
    projectId: 'p',
    missionId: 'm'
  });
  assert.deepEqual(planned.batches, [
    { tier: 0, capabilities: ['lint'] },
    { tier: 1, capabilities: ['service'] },
    { tier: 2, capabilities: ['browser', 'observe'] }
  ]);
});

test('missing required capability fails closed before scheduling work', () => {
  assert.throws(
    () => planValidationBatches({ required: ['lint', 'ghost'], catalog: [command('lint')] }),
    (error) => error.code === 'VALIDATION_CAPABILITY_NOT_FOUND' && error.details?.missing?.[0] === 'ghost'
  );
});
