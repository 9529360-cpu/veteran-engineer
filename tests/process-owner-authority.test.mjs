import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import {
  acquireRemoteRepository,
  normalizeRemoteRepositoryUrl
} from '../src/repository-acquisition.mjs';
import {
  currentProcessOwner,
  inspectProcessOwner,
  parseLinuxProcessStat,
  processOwnerFromRecord
} from '../src/process-owner.mjs';
import { StateStore } from '../src/state-store.mjs';
import { sha256 } from '../src/util.mjs';
import { cleanup, createGitRepo, tempDir } from './helpers.mjs';

async function replacementIdentityForCurrentProcess() {
  const owner = await currentProcessOwner();
  if (process.platform !== 'linux' || !owner.startToken) return null;
  return { ...owner, startToken: owner.startToken === '0' ? '1' : '0' };
}

async function assertMissing(file) {
  await assert.rejects(fs.access(file), (error) => error?.code === 'ENOENT');
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

test('process owner identity parses Linux starttime and degrades malformed nested metadata to the legacy pid', async () => {
  const fields = ['S', ...Array(18).fill('0'), '424242'];
  assert.deepEqual(
    parseLinuxProcessStat(`123 (worker ) name) ${fields.join(' ')}`),
    { state: 'S', startToken: '424242' }
  );

  const current = await currentProcessOwner();
  assert.equal(current.pid, process.pid);
  const running = await inspectProcessOwner(current);
  assert.equal(running.status, 'running');

  const degraded = processOwnerFromRecord({
    pid: process.pid,
    processOwner: { pid: 'corrupt', startToken: 'not-a-number' }
  });
  assert.equal(degraded.pid, process.pid);
  assert.equal(degraded.startToken, undefined);
  assert.equal((await inspectProcessOwner(degraded)).status, 'running');

  const replacement = await replacementIdentityForCurrentProcess();
  if (replacement) {
    const replaced = await inspectProcessOwner(replacement);
    assert.equal(replaced.status, 'replaced');
    assert.equal(replaced.reason, 'pid-reused');
  }
});

test('state lock reclaims an aged lock from a replaced process identity without treating the recycled pid as authority', async (t) => {
  const replacement = await replacementIdentityForCurrentProcess();
  if (!replacement) return t.skip('Linux process start identity is required for deterministic PID-reuse proof');
  const root = await tempDir('veteran-process-owner-state-');
  try {
    const store = await new StateStore({ root, lockTimeoutMs: 1_000, lockStaleMs: 5 }).init();
    await fs.writeFile(store.lockPath, JSON.stringify({
      pid: process.pid,
      processOwner: replacement,
      token: 'recycled-pid-state-lock',
      acquiredAt: new Date(Date.now() - 60_000).toISOString()
    }));
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(store.lockPath, old, old);

    const release = await store.acquireLock();
    try {
      const acquired = JSON.parse(await fs.readFile(store.lockPath, 'utf8'));
      assert.notEqual(acquired.token, 'recycled-pid-state-lock');
      assert.equal(acquired.pid, process.pid);
      assert.equal(acquired.processOwner?.startToken, (await currentProcessOwner()).startToken);
    } finally {
      await release();
    }
    await assertMissing(store.lockPath);
  } finally {
    await cleanup(root);
  }
});

test('mission execution lease rejects a live legacy pid but reclaims the same pid when the process start identity proves replacement', async (t) => {
  const replacement = await replacementIdentityForCurrentProcess();
  if (!replacement) return t.skip('Linux process start identity is required for deterministic PID-reuse proof');
  const root = await tempDir('veteran-process-owner-mission-');
  let app = null;
  let acquired = null;
  try {
    app = await createVeteranApp({ stateRoot: root });
    const missionId = 'mission-process-owner-authority';
    const leaseDir = path.join(app.store.root, 'execution-leases');
    const lockPath = path.join(leaseDir, `mission-${sha256(missionId).slice(0, 40)}.lock`);
    await fs.mkdir(leaseDir, { recursive: true });

    await fs.writeFile(lockPath, JSON.stringify({
      pid: process.pid,
      processOwner: replacement,
      token: 'recycled-pid-mission-lease',
      missionId,
      acquiredAt: new Date().toISOString()
    }));
    acquired = await app.services.missionExecutionLeaseManager.acquire({ missionId, operation: 'pid-reuse-proof' });
    assert.notEqual(acquired.leaseId, 'recycled-pid-mission-lease');
    await acquired.release();
    acquired = null;

    await fs.writeFile(lockPath, JSON.stringify({
      pid: process.pid,
      token: 'legacy-live-mission-lease',
      missionId,
      acquiredAt: new Date().toISOString()
    }));
    await assert.rejects(
      app.services.missionExecutionLeaseManager.acquire({ missionId, operation: 'legacy-live-proof' }),
      (error) => error?.code === 'MISSION_EXECUTION_ACTIVE'
    );
  } finally {
    await acquired?.release().catch(() => {});
    await cleanup(root);
  }
});

test('managed repository lock reclaims an aged record whose pid belongs to a different process instance', async (t) => {
  const replacement = await replacementIdentityForCurrentProcess();
  if (!replacement) return t.skip('Linux process start identity is required for deterministic PID-reuse proof');
  const fixture = await createGitRepo({ files: { 'README.md': 'process-owner\n' } });
  try {
    const managedRoot = path.join(fixture.root, 'managed-projects');
    await fs.mkdir(managedRoot, { recursive: true });
    const repoUrl = pathToFileURL(fixture.repo).href;
    const normalized = normalizeRemoteRepositoryUrl(repoUrl);
    const key = sha256(normalized.canonicalUrl).slice(0, 20);
    const lockPath = path.join(managedRoot, `.repo-${key}.lock`);
    await fs.writeFile(lockPath, JSON.stringify({
      pid: process.pid,
      processOwner: replacement,
      token: 'recycled-pid-repository-lock',
      acquiredAt: new Date(Date.now() - 600_000).toISOString()
    }));
    const old = new Date(Date.now() - 600_000);
    await fs.utimes(lockPath, old, old);

    const acquired = await acquireRemoteRepository({ repoUrl, managedRoot, refresh: false });
    assert.equal(acquired.managed, true);
    assert.equal(acquired.reused, false);
    await fs.access(path.join(acquired.repoPath, 'README.md'));
    await assertMissing(lockPath);
  } finally {
    await cleanup(fixture.root);
  }
});

test('live validation reaps a durable session lease when the pid was reused by another process instance', async (t) => {
  const replacement = await replacementIdentityForCurrentProcess();
  if (!replacement) return t.skip('Linux process start identity is required for deterministic PID-reuse proof');
  const port = await freePort();
  const serverSource = `const http=require('http');const port=Number(process.argv[2]);http.createServer((req,res)=>{res.statusCode=200;res.end('ok');}).listen(port,'127.0.0.1');`;
  const fixture = await createGitRepo({ files: { 'README.md': 'live\n', 'server.cjs': serverSource } });
  let app = null;
  try {
    app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const storedProject = await app.services.projectService.open({ repoPath: fixture.repo });
    const project = {
      ...storedProject,
      runtimeFeedbackPolicy: { liveSession: true, liveSessionIdleMs: 60_000 }
    };
    const mission = { id: 'mission-process-owner-live' };
    const capability = 'live-process-owner';
    const key = `${project.id}:${mission.id}:${capability}`;
    const worktreeName = `live-validation-${sha256(key).slice(0, 24)}`;
    const endpointLeaseKey = `loopback-http:${port}`;
    const stale = {
      key,
      sessionKey: key,
      sessionId: 'stale-live-session',
      projectId: project.id,
      missionId: mission.id,
      capability,
      worktreeName,
      endpointLeaseKey,
      endpointOrigin: `http://127.0.0.1:${port}`,
      pid: process.pid,
      processOwner: replacement,
      reservedAt: new Date().toISOString()
    };
    await app.store.transaction('test_seed_recycled_live_lease', (state) => {
      state.runtime.liveValidationLeases = {
        sessions: { [key]: stale },
        endpoints: { [endpointLeaseKey]: { ...stale } }
      };
    });

    const service = {
      command: [process.execPath, 'server.cjs', String(port)],
      cwd: '.',
      readiness: {
        url: `http://127.0.0.1:${port}/health`,
        method: 'GET',
        statuses: [200],
        timeoutMs: 5_000,
        intervalMs: 50,
        requestTimeoutMs: 1_000
      },
      shutdownGraceMs: 500,
      logLimitBytes: 16 * 1024
    };
    const acquired = await app.services.liveSessionManager.acquire({
      project,
      mission,
      capability,
      commitSha: fixture.head,
      service
    });
    assert.equal(acquired.enabled, true);
    assert.equal(acquired.active, true);
    assert.notEqual(acquired.sessionId, 'stale-live-session');

    const state = await app.store.read();
    const current = state.runtime.liveValidationLeases.sessions[key];
    assert.equal(current.pid, process.pid);
    assert.notEqual(current.sessionId, 'stale-live-session');
    assert.equal(current.processOwner?.startToken, (await currentProcessOwner()).startToken);
  } finally {
    await app?.services.liveSessionManager.releaseAll({ reason: 'process-owner-test-cleanup' }).catch(() => {});
    await cleanup(fixture.root);
  }
});
