import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { StateStore } from '../src/state-store.mjs';
import { tempDir, cleanup } from './helpers.mjs';

async function withStore(fn) {
  const root = await tempDir('veteran-state-');
  try {
    const store = await new StateStore({ root }).init();
    await fn(store, root);
  } finally {
    await cleanup(root);
  }
}

test('state store writes atomically and audit chain verifies', async () => {
  await withStore(async (store) => {
    await store.transaction('set_marker', (state) => { state.runtime.marker = 1; }, { marker: 1 });
    await store.transaction('set_marker', (state) => { state.runtime.marker = 2; }, { marker: 2 });
    const state = await store.read();
    assert.equal(state.runtime.marker, 2);
    const audit = await store.verifyAudit();
    assert.equal(audit.ok, true);
    assert.ok(audit.entries >= 3);
  });
});

test('state store recovers from backup when primary JSON is corrupt', async () => {
  await withStore(async (store) => {
    await store.transaction('first', (state) => { state.runtime.value = 'first'; });
    await store.transaction('second', (state) => { state.runtime.value = 'second'; });
    await fs.writeFile(store.statePath, '{broken-json');
    const recovered = await store.read();
    assert.equal(recovered.runtime.value, 'first');
    const reparsed = JSON.parse(await fs.readFile(store.statePath, 'utf8'));
    assert.equal(reparsed.runtime.value, 'first');
  });
});

test('startup converts orphaned started idempotency outcomes to unknown', async () => {
  const root = await tempDir('veteran-unknown-');
  try {
    const first = await new StateStore({ root }).init();
    await first.transaction('request_started', (state) => {
      state.requests.req1 = { requestId: 'req1', operation: 'x', fingerprint: '{}', status: 'started', startedAt: new Date().toISOString(), completedAt: null, result: null, error: null };
    });
    const second = await new StateStore({ root }).init();
    const state = await second.read();
    assert.equal(state.requests.req1.status, 'unknown');
    assert.ok(state.requests.req1.reconciledAt);
  } finally {
    await cleanup(root);
  }
});

test('audit tampering is detected', async () => {
  await withStore(async (store) => {
    await store.transaction('marker', (state) => { state.runtime.marker = true; });
    const lines = (await fs.readFile(store.auditPath, 'utf8')).trim().split('\n');
    const last = JSON.parse(lines.at(-1));
    last.summary = { tampered: true };
    lines[lines.length - 1] = JSON.stringify(last);
    await fs.writeFile(store.auditPath, `${lines.join('\n')}\n`);
    const audit = await store.verifyAudit();
    assert.equal(audit.ok, false);
    assert.equal(audit.reason, 'hash-mismatch');
  });
});
