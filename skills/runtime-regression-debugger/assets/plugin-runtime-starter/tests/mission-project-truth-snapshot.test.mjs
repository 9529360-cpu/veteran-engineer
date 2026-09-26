import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { MISSION_PROJECT_TRUTH_CONTRACT } from '../src/mission-service.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

const packageJson = `${JSON.stringify({
  name: 'mission-truth-fixture',
  version: '1.0.0',
  private: true,
  packageManager: 'npm@10.0.0',
  scripts: {
    dev: 'node dev-server.mjs',
    check: 'node --check src/a.txt',
    test: 'node --test'
  }
}, null, 2)}\n`;
const packageLock = `${JSON.stringify({
  name: 'mission-truth-fixture',
  version: '1.0.0',
  lockfileVersion: 3,
  requires: true,
  packages: { '': { name: 'mission-truth-fixture', version: '1.0.0' } }
}, null, 2)}\n`;

async function setup() {
  const fixture = await createGitRepo({
    files: {
      'package.json': packageJson,
      'package-lock.json': packageLock,
      'src/a.txt': 'a\n'
    }
  });
  const worker = path.join(fixture.root, 'worker.cjs');
  await fs.writeFile(worker, 'process.exit(0);\n');
  await fs.mkdir(fixture.stateRoot, { recursive: true });
  await fs.writeFile(path.join(fixture.stateRoot, 'operator.json'), `${JSON.stringify({
    defaults: {
      workerPolicy: {
        enabled: true,
        maxWorkers: 1,
        workers: { default: { type: 'custom', command: process.execPath, args: [worker] } }
      }
    }
  }, null, 2)}\n`);
  const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
  const project = await app.services.projectService.open({ repoPath: fixture.repo });
  const planned = await app.services.missionService.plan({
    projectId: project.id,
    goal: 'execute from frozen repository truth',
    doneDefinition: 'later project snapshots cannot replace Mission planning truth',
    tasks: [{ id: 'T1', contract: 'observe frozen truth', owner: 'src', dependencies: [], writeSet: [], risk: 'low' }]
  });
  return { ...fixture, app, project, mission: planned.mission };
}

const bootstrapAuthorization = {
  execute: true,
  allowNetwork: true,
  allowThirdPartyCode: true,
  envAllowlist: []
};

test('Mission freezes authority-bound project truth and workers keep using it after later project snapshot drift', async () => {
  const fixture = await setup();
  try {
    const truth = fixture.mission.projectTruth;
    assert.equal(truth.contract, MISSION_PROJECT_TRUTH_CONTRACT);
    assert.equal(truth.sourceIdentity.head, fixture.mission.baseSourceIdentity.head);
    assert.equal(truth.environmentSourceIdentity.head, fixture.mission.baseSourceIdentity.head);
    assert.deepEqual(truth.environmentProfile.runtimeFamilies, ['node']);
    assert.deepEqual(truth.bootstrapPlan.steps[0].command, ['npm', 'ci']);
    assert.equal(truth.commandPlan.contract, 'veteran-project-command-plan-v1');
    assert.equal(truth.commandPlan.status, 'discovery-only');
    assert.deepEqual(truth.commandPlan.start[0].command, ['npm', 'run', 'dev']);

    const fakeBootstrapPlan = {
      contract: 'veteran-project-bootstrap-plan-v1',
      status: 'planned',
      blockers: [],
      manualInstructions: [],
      steps: [{
        id: 'node:pnpm',
        owner: 'node',
        runtimeFamily: 'node',
        packageManager: 'pnpm',
        command: ['pnpm', 'install', '--frozen-lockfile'],
        riskClass: 'dependency-install',
        requiresNetwork: true,
        executesThirdPartyCode: true,
        reason: 'test-only mutable project drift'
      }]
    };

    const originalSnapshot = fixture.app.services.projectService.snapshot.bind(fixture.app.services.projectService);
    let snapshotCalls = 0;
    fixture.app.services.projectService.snapshot = async (args) => {
      snapshotCalls += 1;
      const refreshed = await originalSnapshot(args);
      return { ...refreshed, bootstrapPlan: fakeBootstrapPlan };
    };

    let executedPlan = null;
    fixture.app.services.coreWorkerOrchestrator.bootstrapExecutor = {
      async prepare({ plan }) {
        executedPlan = structuredClone(plan);
        return { status: 'completed', contract: 'test-bootstrap-result-v1', steps: [] };
      }
    };

    const result = await fixture.app.callTool('mission_execute', {
      requestId: 'mission-truth-frozen-bootstrap',
      missionId: fixture.mission.id,
      runWorkers: true,
      bootstrapAuthorization
    });

    assert.ok(snapshotCalls >= 1, 'execution should still refresh live project state for freshness checks');
    assert.equal(result.results[0].ok, true);
    assert.deepEqual(executedPlan.steps[0].command, ['npm', 'ci'], 'execution must use Mission truth instead of the later mutable project plan');
    assert.notDeepEqual(executedPlan.steps[0].command, fakeBootstrapPlan.steps[0].command);

    const status = await fixture.app.services.missionService.status({ missionId: fixture.mission.id });
    const packet = status.tasks[0].dispatches.at(-1).packet;
    assert.equal(packet.mission.projectTruth.contract, MISSION_PROJECT_TRUTH_CONTRACT);
    assert.deepEqual(packet.mission.projectTruth.bootstrapPlan.steps[0].command, ['npm', 'ci']);
    assert.deepEqual(packet.mission.projectTruth.commandPlan.start[0].command, ['npm', 'run', 'dev']);

    const evidence = await fixture.app.services.evidenceService.query({ missionId: fixture.mission.id, taskId: 'T1', type: 'bootstrap' });
    assert.equal(evidence.length, 1);
    assert.match(evidence[0].summary, /completed/);
  } finally {
    await cleanup(fixture.root);
  }
});

test('Mission execution fails closed if frozen project truth source identity is corrupted', async () => {
  const fixture = await setup();
  try {
    await fixture.app.store.transaction('test_corrupt_mission_truth', (state) => {
      state.missions[fixture.mission.id].projectTruth.sourceIdentity.head = '0'.repeat(40);
    }, { missionId: fixture.mission.id });

    await assert.rejects(
      fixture.app.services.coreWorkerOrchestrator.execute({ missionId: fixture.mission.id, runWorkers: false }),
      (error) => error.code === 'MISSION_PROJECT_TRUTH_CORRUPT'
        && error.details.projectTruthSourceHead === '0'.repeat(40)
        && error.details.missionBaseHead === fixture.mission.baseSourceIdentity.head
    );

    const readiness = await fixture.app.services.missionService.readiness({ missionId: fixture.mission.id });
    assert.equal(readiness.ready, false);
    assert.ok(readiness.blockers.some((item) => item.code === 'MISSION_PROJECT_TRUTH_CORRUPT'));
  } finally {
    await cleanup(fixture.root);
  }
});
