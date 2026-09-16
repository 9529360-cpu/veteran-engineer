import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { createVeteranApp } from '../src/app.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(file, timeoutMs = 5_000) {
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

function waitForExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return Promise.race([
    new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal }))),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for crashed runtime process to exit')), timeoutMs))
  ]);
}

test('runtime crash releases stale mission lease before persisted executing work is reconciled as interrupted', { skip: process.platform === 'win32' }, async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'a\n' } });
  const readyFile = path.join(fixture.root, 'lease-owner.ready');
  let child = null;
  try {
    const bootstrap = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const project = await bootstrap.callTool('project_open', {
      requestId: 'crash-recovery-open',
      repoPath: fixture.repo
    });
    const planned = await bootstrap.callTool('mission_plan', {
      requestId: 'crash-recovery-plan',
      projectId: project.id,
      goal: 'prove mission recovery after runtime process loss',
      doneDefinition: 'a crashed lease owner is reaped before uncertain persisted execution is reconciled',
      tasks: [{ id: 'T1', contract: 'own src/a.txt', owner: 'src/a.txt', dependencies: [], writeSet: ['src/a.txt'], risk: 'low' }]
    });
    const missionId = planned.mission.id;

    await bootstrap.store.transaction('test_seed_crashed_execution', (state) => {
      state.tasks[`${missionId}:T1`].status = 'executing';
      state.missions[missionId].status = 'executing';
    }, { missionId });

    const appUrl = pathToFileURL(path.resolve('src/app.mjs')).href;
    const childSource = `
      import fs from 'node:fs/promises';
      import { createVeteranApp } from ${JSON.stringify(appUrl)};
      const app = await createVeteranApp({ stateRoot: ${JSON.stringify(fixture.stateRoot)} });
      await app.services.missionExecutionLeaseManager.acquire({ missionId: ${JSON.stringify(missionId)}, operation: 'crash-recovery-owner' });
      await fs.writeFile(${JSON.stringify(readyFile)}, String(process.pid));
      setInterval(() => {}, 1_000);
    `;
    child = spawn(process.execPath, ['--input-type=module', '-e', childSource], {
      cwd: process.cwd(),
      stdio: ['ignore', 'ignore', 'inherit']
    });
    await waitForFile(readyFile);
    assert.equal(Number(await fs.readFile(readyFile, 'utf8')), child.pid);

    const observer = await createVeteranApp({ stateRoot: fixture.stateRoot });
    await assert.rejects(
      observer.callTool('mission_resume', {
        requestId: 'crash-recovery-resume-while-owner-live',
        missionId
      }),
      (error) => {
        assert.equal(error?.code, 'MISSION_EXECUTION_ACTIVE');
        assert.equal(error?.details?.backendKind, 'local-json');
        assert.equal(error?.details?.owner?.pid, child.pid);
        return true;
      }
    );
    let status = await observer.services.missionService.status({ missionId });
    assert.equal(status.mission.status, 'executing');
    assert.equal(status.tasks[0].status, 'executing');
    assert.equal(status.mission.interruption, null);

    child.kill('SIGKILL');
    const crashed = await waitForExit(child);
    assert.equal(crashed.signal, 'SIGKILL');
    child = null;

    const restarted = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const resumed = await restarted.callTool('mission_resume', {
      requestId: 'crash-recovery-resume-after-owner-loss',
      missionId
    });
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
    await cleanup(fixture.root);
  }
});
