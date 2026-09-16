import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

const connectionString = process.env.VETERAN_TEST_POSTGRES_URL;
if (!connectionString) throw new Error('VETERAN_TEST_POSTGRES_URL is required for PostgreSQL integration tests');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(file, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fs.access(file);
      return;
    } catch {
      await sleep(25);
    }
  }
  throw new Error(`Timed out waiting for ${file}`);
}

function waitForExit(child, timeoutMs = 10_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return Promise.race([
    new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal }))),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for crashed PostgreSQL lease owner to exit')), timeoutMs))
  ]);
}

async function resumeAfterOwnerCrash(app, missionId, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await app.callTool('mission_resume', {
        requestId: `postgres-crash-recovery-resume-${attempt}`,
        missionId
      });
    } catch (error) {
      if (error?.code !== 'MISSION_EXECUTION_ACTIVE' || Date.now() >= deadline) throw error;
      await sleep(Math.min(50, Math.max(1, deadline - Date.now())));
    }
  }
}

test('PostgreSQL runtime crash releases the advisory mission lease before persisted executing work is reconciled', { skip: process.platform === 'win32', timeout: 120_000 }, async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'a\n' } });
  const instanceKey = `mission-crash-recovery-${process.pid}-${Date.now()}`;
  const readyFile = path.join(fixture.root, 'postgres-lease-owner.ready');
  const ownerStateRoot = path.join(fixture.root, 'postgres-owner-state');
  const observerStateRoot = path.join(fixture.root, 'postgres-observer-state');
  const restartedStateRoot = path.join(fixture.root, 'postgres-restarted-state');
  let bootstrap = null;
  let observer = null;
  let restarted = null;
  let child = null;
  try {
    bootstrap = await createVeteranApp({
      stateRoot: fixture.stateRoot,
      stateBackendConfig: { kind: 'postgres', connectionString, instanceKey }
    });
    const project = await bootstrap.callTool('project_open', {
      requestId: 'postgres-crash-recovery-open',
      repoPath: fixture.repo
    });
    const planned = await bootstrap.callTool('mission_plan', {
      requestId: 'postgres-crash-recovery-plan',
      projectId: project.id,
      goal: 'prove hosted mission recovery after runtime process loss',
      doneDefinition: 'a crashed PostgreSQL lease owner releases its advisory lock before uncertain persisted execution is reconciled',
      tasks: [{ id: 'T1', contract: 'own src/a.txt', owner: 'src/a.txt', dependencies: [], writeSet: ['src/a.txt'], risk: 'low' }]
    });
    const missionId = planned.mission.id;

    await bootstrap.store.transaction('test_seed_postgres_crashed_execution', (state) => {
      state.tasks[`${missionId}:T1`].status = 'executing';
      state.missions[missionId].status = 'executing';
    }, { missionId });
    await bootstrap.store.close();
    bootstrap = null;

    const appUrl = new URL('../src/app.mjs', import.meta.url).href;
    const childSource = `
      import fs from 'node:fs/promises';
      import { createVeteranApp } from ${JSON.stringify(appUrl)};
      const app = await createVeteranApp({
        stateRoot: ${JSON.stringify(ownerStateRoot)},
        stateBackendConfig: {
          kind: 'postgres',
          connectionString: ${JSON.stringify(connectionString)},
          instanceKey: ${JSON.stringify(instanceKey)}
        }
      });
      globalThis.__lease = await app.services.missionExecutionLeaseManager.acquire({
        missionId: ${JSON.stringify(missionId)},
        operation: 'postgres-crash-recovery-owner'
      });
      await fs.writeFile(${JSON.stringify(readyFile)}, String(process.pid));
      setInterval(() => {}, 1_000);
    `;
    child = spawn(process.execPath, ['--input-type=module', '-e', childSource], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'ignore', 'inherit']
    });
    await waitForFile(readyFile);
    assert.equal(Number(await fs.readFile(readyFile, 'utf8')), child.pid);

    observer = await createVeteranApp({
      stateRoot: observerStateRoot,
      stateBackendConfig: { kind: 'postgres', connectionString, instanceKey }
    });
    await assert.rejects(
      observer.callTool('mission_resume', {
        requestId: 'postgres-crash-recovery-resume-while-owner-live',
        missionId
      }),
      (error) => {
        assert.equal(error?.code, 'MISSION_EXECUTION_ACTIVE');
        assert.equal(error?.details?.backendKind, 'postgres');
        assert.equal(error?.details?.reason, 'advisory-lock-held');
        return true;
      }
    );
    let status = await observer.services.missionService.status({ missionId });
    assert.equal(status.mission.status, 'executing');
    assert.equal(status.tasks[0].status, 'executing');
    assert.equal(status.mission.interruption, null);
    await observer.store.close();
    observer = null;

    child.kill('SIGKILL');
    const crashed = await waitForExit(child);
    assert.equal(crashed.signal, 'SIGKILL');
    child = null;

    restarted = await createVeteranApp({
      stateRoot: restartedStateRoot,
      stateBackendConfig: { kind: 'postgres', connectionString, instanceKey }
    });
    const resumed = await resumeAfterOwnerCrash(restarted, missionId);
    assert.equal(resumed.status, 'blocked');
    assert.deepEqual(resumed.interruption.taskIds, ['T1']);

    status = await restarted.services.missionService.status({ missionId });
    assert.equal(status.mission.status, 'blocked');
    assert.equal(status.tasks[0].status, 'interrupted');
    assert.deepEqual(status.mission.interruption.taskIds, ['T1']);

    const readiness = await restarted.callTool('mission_readiness', { missionId });
    assert.equal(readiness.ready, false);
    assert.deepEqual(readiness.blockers.find((item) => item.code === 'RECONCILIATION_REQUIRED')?.taskIds, ['T1']);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await waitForExit(child).catch(() => {});
    }
    await Promise.all([
      bootstrap?.store?.close?.(),
      observer?.store?.close?.(),
      restarted?.store?.close?.()
    ].filter(Boolean).map((promise) => promise.catch(() => {})));
    await cleanup(fixture.root);
  }
});
