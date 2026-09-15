import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { StateStore } from '../src/state-store.mjs';
import { runProcess } from '../src/git.mjs';
import { tempDir, cleanup } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'increment-state.mjs');

test('cross-process state lock serializes concurrent JSON mutations without lost updates', async () => {
  const root = await tempDir('veteran-lock-');
  try {
    const store = await new StateStore({ root }).init();
    await Promise.all(Array.from({ length: 8 }, () => runProcess(process.execPath, [fixture, root], { timeoutMs: 20_000 })));
    const state = await store.read();
    assert.equal(state.runtime.counter, 8);
    const audit = await store.verifyAudit();
    assert.equal(audit.ok, true);
    assert.ok(audit.entries >= 9);
  } finally {
    await cleanup(root);
  }
});

test('state lock keeps stale ownership when the pid probe result is unknown', async () => {
  const root = await tempDir('veteran-lock-probe-');
  const lockPath = path.join(root, 'state.lock');
  const ownerPid = 999_999_999;
  const originalKill = process.kill;
  try {
    await fs.writeFile(lockPath, JSON.stringify({ pid: ownerPid, token: 'foreign-owner', acquiredAt: new Date(0).toISOString() }));
    const staleAt = new Date(Date.now() - 60_000);
    await fs.utimes(lockPath, staleAt, staleAt);
    process.kill = (pid, signal) => {
      if (pid === ownerPid && signal === 0) {
        const error = new Error('pid probe unavailable');
        error.code = 'EIO';
        throw error;
      }
      return originalKill.call(process, pid, signal);
    };

    const store = new StateStore({ root, lockTimeoutMs: 80, lockStaleMs: 1 });
    await assert.rejects(
      store.acquireLock(),
      (error) => error?.code === 'STATE_LOCK_TIMEOUT'
    );
    const persisted = JSON.parse(await fs.readFile(lockPath, 'utf8'));
    assert.equal(persisted.token, 'foreign-owner');
  } finally {
    process.kill = originalKill;
    await cleanup(root);
  }
});
