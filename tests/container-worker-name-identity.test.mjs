import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContainerInvocation } from '../src/container-worker.mjs';

const config = {
  engine: 'docker',
  image: `example.invalid/veteran-worker@sha256:${'a'.repeat(64)}`,
  containerCommand: ['node', '/veteran/task.json']
};

const mission = { id: 'mission_12345678-1234-1234-1234-123456789abc' };
const task = { id: 'abcdefghij-shared-prefix-task' };

function invocation(packetPath, selectedTask = task) {
  return buildContainerInvocation({
    config,
    worktreePath: '/tmp/veteran-worktree',
    packetPath,
    task: selectedTask,
    mission
  });
}

test('container names retain dispatch identity inside the engine length limit', () => {
  const first = invocation('/tmp/dispatch_11111111-1111-1111-1111-111111111111.json');
  const second = invocation('/tmp/dispatch_22222222-2222-2222-2222-222222222222.json');
  const repeated = invocation('/tmp/dispatch_11111111-1111-1111-1111-111111111111.json');

  assert.notEqual(first.container.name, second.container.name, 'distinct dispatches must never collapse to one container name');
  assert.equal(first.container.name, repeated.container.name, 'container naming must remain deterministic for one dispatch identity');
  for (const value of [first.container.name, second.container.name]) {
    assert.ok(value.length <= 63, value);
    assert.match(value, /^[a-z0-9][a-z0-9_.-]*$/);
  }

  const nameIndex = first.args.indexOf('--name');
  assert.equal(first.args[nameIndex + 1], first.container.name);
});

test('container names also distinguish task identity when readable prefixes collide', () => {
  const packet = '/tmp/dispatch_33333333-3333-3333-3333-333333333333.json';
  const left = invocation(packet, { id: 'abcdefghij-left' });
  const right = invocation(packet, { id: 'abcdefghij-right' });
  assert.notEqual(left.container.name, right.container.name);
});
