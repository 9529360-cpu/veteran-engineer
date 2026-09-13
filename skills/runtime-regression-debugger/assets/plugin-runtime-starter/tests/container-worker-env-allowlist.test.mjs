import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContainerInvocation, validateContainerWorkerConfig } from '../src/container-worker.mjs';

const digestImage = `example.invalid/veteran-worker@sha256:${'b'.repeat(64)}`;
const baseConfig = { type: 'container', image: digestImage, containerCommand: ['worker'] };
const task = { id: 'T1' };
const mission = { id: 'M1' };

function invalidAllowlist(value) {
  return () => validateContainerWorkerConfig({ ...baseConfig, envAllowlist: value });
}

test('container worker rejects non-array environment allowlists instead of iterating coercible values', () => {
  for (const value of ['WORKER_TOKEN', null, { 0: 'WORKER_TOKEN', length: 1 }, new Set(['WORKER_TOKEN'])]) {
    assert.throws(
      invalidAllowlist(value),
      (error) => error.code === 'CONTAINER_WORKER_CONFIG_INVALID',
      `envAllowlist ${String(value)} must fail closed`
    );
  }
});

test('container worker accepts an explicit environment array and forwards each key as one entry', () => {
  const validated = validateContainerWorkerConfig({ ...baseConfig, envAllowlist: ['WORKER_TOKEN', 'CI_JOB_ID'] });
  assert.deepEqual(validated.envAllowlist, ['WORKER_TOKEN', 'CI_JOB_ID']);

  const invocation = buildContainerInvocation({
    config: validated,
    worktreePath: '/tmp/task-worktree',
    packetPath: '/tmp/task.json',
    task,
    mission
  });
  const forwarded = [];
  for (let index = 0; index < invocation.args.length - 1; index += 1) {
    if (invocation.args[index] === '--env') forwarded.push(invocation.args[index + 1]);
  }
  assert.ok(forwarded.includes('WORKER_TOKEN'));
  assert.ok(forwarded.includes('CI_JOB_ID'));
  assert.equal(forwarded.includes('W'), false, 'a string allowlist must never be decomposed into characters');
});
