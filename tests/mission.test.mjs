import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { StateStore } from '../src/state-store.mjs';
import { ProjectService } from '../src/project-service.mjs';
import { MissionService, computeWaves } from '../src/mission-service.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

function task(id, writeSet, dependencies = []) {
  return { id, contract: `contract ${id}`, owner: `owner ${id}`, writeSet, dependencies, risk: 'low' };
}

test('mission planner builds dependency/write-conflict safe waves', async () => {
  const tasks = [task('A', ['src/a']), task('B', ['docs']), task('C', ['src/a']), task('D', ['src/d'], ['A'])];
  assert.deepEqual(computeWaves(tasks), [['A', 'B'], ['C', 'D']]);
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
