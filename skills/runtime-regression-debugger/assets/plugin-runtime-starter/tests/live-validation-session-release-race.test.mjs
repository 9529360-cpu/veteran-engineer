import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { LiveValidationSessionManager } from '../src/live-validation-session-manager.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

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

async function bounded(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`Timed out waiting for ${label}`), {
      code: 'TEST_TIMEOUT',
      details: { label, timeoutMs }
    })), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function serviceFor(port) {
  return {
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
}

test('runtime release drains a live session that is still starting and fences new starts until cleanup completes', async () => {
  const port = await freePort();
  const serverSource = `const http=require('http');const port=Number(process.argv[2]);http.createServer((req,res)=>{res.statusCode=200;res.end('ok');}).listen(port,'127.0.0.1');`;
  const { root, repo, head, stateRoot } = await createGitRepo({
    files: {
      'src/a.txt': 'a\n',
      'server.cjs': serverSource
    }
  });
  let app = null;
  let manager = null;
  let acquiring = null;
  let continueReservation = null;
  try {
    app = await createVeteranApp({ stateRoot });
    let reservationReached;
    const reached = new Promise((resolve) => { reservationReached = resolve; });
    const proceed = new Promise((resolve) => { continueReservation = resolve; });
    let paused = false;
    const store = {
      backendKind: app.store.backendKind,
      worktreesDir: app.store.worktreesDir,
      transaction: async (...args) => {
        const result = await app.store.transaction(...args);
        if (!paused && args[0] === 'live_validation_session_reserved') {
          paused = true;
          reservationReached();
          await proceed;
        }
        return result;
      }
    };
    manager = new LiveValidationSessionManager({ store });
    const project = {
      id: 'project-release-race',
      repoPath: repo,
      runtimeFeedbackPolicy: { liveSession: true, liveSessionIdleMs: 60_000 }
    };
    const service = serviceFor(port);
    const input = {
      project,
      mission: { id: 'mission-release-race' },
      capability: 'live-product',
      commitSha: head,
      service
    };

    acquiring = manager.acquire(input);
    await bounded(reached, 5_000, 'durable live-session reservation');
    assert.equal(manager.snapshot().length, 0, 'durable reservation must be observable before the session enters the active map');

    let cleanupSettled = false;
    const releasing = manager.releaseAll({ reason: 'race-test-cleanup' }).then((value) => {
      cleanupSettled = true;
      return value;
    });

    await assert.rejects(
      bounded(manager.acquire({
        ...input,
        project: { ...project, id: 'project-release-race-blocked' },
        mission: { id: 'mission-release-race-blocked' }
      }), 5_000, 'runtime release fence rejection'),
      (error) => error.code === 'LIVE_VALIDATION_SESSION_RELEASE_IN_PROGRESS'
        && error.details?.scope === 'runtime'
    );
    assert.equal(cleanupSettled, false, 'runtime release must wait for the already-registered startup to settle');

    continueReservation();
    const [acquired, released] = await bounded(
      Promise.all([acquiring, releasing]),
      10_000,
      'live startup and release drain'
    );
    assert.equal(acquired.active, true, 'the startup may finish, but it must still be drained before cleanup returns');
    assert.equal(released.length, 1);
    assert.equal(manager.snapshot().length, 0);
    await assert.rejects(fs.access(acquired.worktreePath), /ENOENT|no such file/i);

    const state = await app.store.read();
    assert.equal(Object.keys(state.runtime?.liveValidationLeases?.sessions || {}).length, 0);
    assert.equal(Object.keys(state.runtime?.liveValidationLeases?.endpoints || {}).length, 0);

    const retry = await bounded(manager.acquire(input), 10_000, 'post-cleanup live-session acquire');
    assert.equal(retry.active, true, 'the release fence must open again after cleanup completes');
    assert.equal(manager.snapshot().length, 1);
  } finally {
    continueReservation?.();
    await bounded(acquiring?.catch(() => {}), 10_000, 'in-flight startup cleanup').catch(() => {});
    await bounded(manager?.releaseAll({ reason: 'test-cleanup' }) || Promise.resolve(), 10_000, 'manager cleanup').catch(() => {});
    await bounded(app?.services.liveSessionManager.releaseAll({ reason: 'test-cleanup' }) || Promise.resolve(), 10_000, 'app manager cleanup').catch(() => {});
    await cleanup(root);
  }
});
