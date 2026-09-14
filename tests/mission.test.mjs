import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { StateStore } from '../src/state-store.mjs';
import { ProjectService } from '../src/project-service.mjs';
import { MissionService, computeWaves, runtimeResourcesConflict } from '../src/mission-service.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

function task(id, writeSet, dependencies = [], runtimeResources = []) {
  return { id, contract: `contract ${id}`, owner: `owner ${id}`, writeSet, dependencies, runtimeResources, risk: 'low' };
}

test('mission planner builds dependency/write-conflict safe waves', async () => {
  const tasks = [task('A', ['src/a']), task('B', ['docs']), task('C', ['src/a']), task('D', ['src/d'], ['A'])];
  assert.deepEqual(computeWaves(tasks), [['A', 'B'], ['C', 'D']]);
});

test('mission planner serializes tasks that claim the same mutable runtime resource', async () => {
  const tasks = [
    task('A', ['src/a'], [], ['db:test']),
    task('B', ['src/b'], [], ['db:test']),
    task('C', ['src/c'], [], ['cache:isolated'])
  ];
  assert.equal(runtimeResourcesConflict(tasks[0].runtimeResources, tasks[1].runtimeResources), true);
  assert.equal(runtimeResourcesConflict(tasks[0].runtimeResources, tasks[2].runtimeResources), false);
  assert.deepEqual(computeWaves(tasks), [['A', 'C'], ['B']]);
});

test('mission planning persists normalized runtime resource claims and rejects unsafe claims', async () => {
  const { root, repo, stateRoot } = await createGitRepo();
  try {
    const store = await new StateStore({ root: stateRoot }).init();
    const projects = new ProjectService({ store });
    const missions = new MissionService({ store, projectService: projects });
    const project = await projects.open({ repoPath: repo });
    const planned = await missions.plan({
      projectId: project.id,
      goal: 'isolate runtime state',
      doneDefinition: 'tasks declare mutable runtime resources',
      tasks: [task('A', ['a'], [], ['db:test', 'cache:tenant-a', 'db:test'])]
    });
    assert.deepEqual(planned.tasks[0].runtimeResources, ['cache:tenant-a', 'db:test']);
    await assert.rejects(
      missions.plan({
        projectId: project.id,
        goal: 'bad runtime claim',
        doneDefinition: 'rejected',
        tasks: [task('B', ['b'], [], ['db:test with spaces'])]
      }),
      (error) => error.code === 'TASK_RUNTIME_RESOURCES_INVALID'
    );
  } finally {
    await cleanup(root);
  }
});

test('mission planning rejects cycles', async () => {
  const { root, repo, stateRoot } = await createGitRepo();
  try {
    const store = await new StateStore({ root: stateRoot }).init();
    const projects = new ProjectService({ store });
    const missions = new MissionService({ store, projectService: projects });
    const project = await projects.open({ repoPath: repo });
    await assert.rejects(
      missions.plan({ projectId: project.id, goal: 'g', doneDefinition: 'd', tasks: [task('A', ['a'], ['B']), task('B', ['b'], ['A'])] }),
      (error) => error.code === 'MISSION_DAG_CYCLE'
    );
  } finally {
    await cleanup(root);
  }
});

test('dirty source checkout blocks mission planning', async () => {
  const { root, repo, stateRoot } = await createGitRepo();
  try {
    const store = await new StateStore({ root: stateRoot }).init();
    const projects = new ProjectService({ store });
    const missions = new MissionService({ store, projectService: projects });
    const project = await projects.open({ repoPath: repo });
    await fs.writeFile(path.join(repo, 'dirty.txt'), 'dirty\n');
    await assert.rejects(
      missions.plan({ projectId: project.id, goal: 'g', doneDefinition: 'd', tasks: [task('A', ['dirty.txt'])] }),
      (error) => error.code === 'DIRTY_SOURCE_BLOCKED' && error.details.includes('dirty.txt')
    );
  } finally {
    await cleanup(root);
  }
});