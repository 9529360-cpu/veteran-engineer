import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContainerInvocation, validateContainerWorkerConfig } from '../src/container-worker.mjs';
import { buildWorkerInvocation, enforceWorkerPolicy } from '../src/worker-adapter.mjs';

const digestImage = `example.invalid/veteran-worker@sha256:${'a'.repeat(64)}`;
const project = { workerPolicy: { enabled: true, allowUnconfinedCustomWorkers: false } };
const task = { id: 'T1', key: 'M1:T1', risk: 'high', writeSet: ['src'] };
const mission = { id: 'M1' };

test('container worker invocation is fail-closed and host-isolated by default', () => {
  const config = {
    type: 'container',
    engine: 'docker',
    image: digestImage,
    containerCommand: ['node', '/opt/worker.mjs'],
    envAllowlist: ['WORKER_TOKEN'],
    pidsLimit: 64,
    memoryMb: 512,
    cpus: 0.5
  };
  assert.doesNotThrow(() => enforceWorkerPolicy(project, task, config), 'confined container workers may execute high-risk scoped tasks');
  const invocation = buildContainerInvocation({
    config,
    worktreePath: '/tmp/task-worktree',
    packetPath: '/tmp/artifacts/task.json',
    task,
    mission
  });
  assert.equal(invocation.command, 'docker');
  assert.equal(invocation.container.engine, 'docker');
  assert.match(invocation.container.name, /^veteran-m1-t1-/);
  const nameIndex = invocation.args.indexOf('--name');
  assert.equal(invocation.args[nameIndex + 1], invocation.container.name);
  assert.deepEqual(invocation.args.slice(0, 4), ['run', '--rm', '--network', 'none']);
  assert.ok(invocation.args.includes('--read-only'));
  assert.ok(invocation.args.includes('ALL'));
  assert.ok(invocation.args.includes('no-new-privileges'));
  assert.ok(invocation.args.includes('/tmp:rw,noexec,nosuid,size=64m'));
  assert.ok(invocation.args.includes('type=bind,source=/tmp/task-worktree,target=/workspace'));
  assert.ok(invocation.args.includes('type=bind,source=/tmp/task-worktree/.git,target=/workspace/.git,readonly'));
  assert.ok(invocation.args.includes('type=bind,source=/tmp/artifacts/task.json,target=/veteran/task.json,readonly'));
  assert.ok(invocation.args.includes('VETERAN_TASK_PACKET=/veteran/task.json'));
  assert.ok(invocation.args.includes('WORKER_TOKEN'));
  assert.equal(invocation.args.at(-3), digestImage);
  assert.deepEqual(invocation.args.slice(-2), ['node', '/opt/worker.mjs']);

  const routed = buildWorkerInvocation({ config, worktreePath: '/tmp/task-worktree', packetPath: '/tmp/artifacts/task.json', task, mission });
  assert.deepEqual(routed, invocation);
});

test('container worker refuses mutable images, unknown engines, and unsafe path encoding', () => {
  assert.throws(
    () => validateContainerWorkerConfig({ type: 'container', image: 'example.invalid/worker:latest', containerCommand: ['worker'] }),
    (error) => error.code === 'CONTAINER_WORKER_IMAGE_UNPINNED'
  );
  assert.throws(
    () => validateContainerWorkerConfig({ type: 'container', engine: 'sh', image: digestImage, containerCommand: ['worker'] }),
    (error) => error.code === 'CONTAINER_WORKER_ENGINE_BLOCKED'
  );
  assert.throws(
    () => validateContainerWorkerConfig({ type: 'container', image: digestImage, containerCommand: ['worker'], envAllowlist: ['DOCKER_HOST'] }),
    (error) => error.code === 'CONTAINER_WORKER_CONFIG_INVALID'
  );
  assert.throws(
    () => buildContainerInvocation({ config: { type: 'container', image: digestImage, containerCommand: ['worker'] }, worktreePath: '/tmp/has,comma', packetPath: '/tmp/task.json', task, mission }),
    (error) => error.code === 'CONTAINER_WORKER_PATH_UNSUPPORTED'
  );
});

test('custom-unconfined remains blocked for high-risk tasks while container is not treated as unconfined', () => {
  assert.throws(
    () => enforceWorkerPolicy({ workerPolicy: { enabled: true, allowUnconfinedCustomWorkers: true } }, task, { type: 'custom-unconfined', command: 'worker' }),
    (error) => error.code === 'UNCONFINED_WORKER_RISK_BLOCKED'
  );
  assert.doesNotThrow(() => enforceWorkerPolicy(project, task, { type: 'container', image: digestImage, containerCommand: ['worker'] }));
});
