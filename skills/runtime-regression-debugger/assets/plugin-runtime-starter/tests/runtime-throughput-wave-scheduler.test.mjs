import assert from 'node:assert/strict';
import test from 'node:test';
import { computeWaves } from '../src/mission-service.mjs';

function task(id, writeSet, dependencies = [], extra = {}) {
  return {
    id,
    contract: `contract ${id}`,
    owner: `owner ${id}`,
    dependencies,
    writeSet,
    runtimeResources: [],
    risk: 'low',
    ...extra
  };
}

test('runtime wave scheduler chooses the higher-throughput ready subset instead of lexical broad-owner priority', () => {
  const tasks = [
    task('A', ['src']),
    task('B', ['src/a.js']),
    task('C', ['src/b.js'])
  ];

  assert.deepEqual(computeWaves(tasks), [['B', 'C'], ['A']]);
});

test('runtime wave scheduler prefers an equally conflicting task that unlocks downstream work', () => {
  const tasks = [
    task('A', ['schema.json']),
    task('B', ['schema.json']),
    task('C', ['src/c.js'], ['B'])
  ];

  assert.deepEqual(computeWaves(tasks), [['B'], ['A', 'C']]);
});
