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

test('durable state commit with missing audit is detected and repaired on restart', async () => {
  const root = await tempDir('veteran-audit-gap-');
  let armed = false;
  try {
    const store = await new StateStore({
      root,
      faultInjector: async (stage, commit) => {
        if (armed && stage === 'after_state_commit_before_audit' && commit.eventType === 'gap_marker') {
          armed = false;
          const error = new Error('injected pre-audit crash');
          error.code = 'INJECTED_PRE_AUDIT_CRASH';
          throw error;
        }
      }
    }).init();
    armed = true;
    await assert.rejects(
      store.transaction('gap_marker', (state) => { state.runtime.gapMarker = 1; }, { marker: 1 }),
      (error) => error.code === 'STATE_COMMIT_AUDIT_OUTCOME_UNKNOWN' && error.stateCommitted === true && error.auditOutcome === 'unknown'
    );
    const durable = await store.read();
    assert.equal(durable.runtime.gapMarker, 1);
    const commitId = durable.runtime.durability.lastStateCommit.id;
    const beforeRepair = await store.verifyAudit();
    assert.equal(beforeRepair.ok, false);
    assert.equal(beforeRepair.reason, 'state-commit-audit-missing');
    assert.equal(beforeRepair.stateCommitId, commitId);

    const restarted = await new StateStore({ root }).init();
    const afterRepair = await restarted.verifyAudit();
    assert.equal(afterRepair.ok, true);
    const entries = (await fs.readFile(restarted.auditPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(entries.filter((entry) => entry.stateCommitId === commitId).length, 1);
  } finally {
    await cleanup(root);
  }
});

test('audit already appended before acknowledgement is reconciled without duplication', async () => {
  const root = await tempDir('veteran-audit-ack-');
  let armed = false;
  try {
    const store = await new StateStore({
      root,
      faultInjector: async (stage, commit) => {
        if (armed && stage === 'after_audit_append_before_ack' && commit.eventType === 'ack_marker') {
          armed = false;
          const error = new Error('injected post-audit crash');
          error.code = 'INJECTED_POST_AUDIT_CRASH';
          throw error;
        }
      }
    }).init();
    armed = true;
    await assert.rejects(
      store.transaction('ack_marker', (state) => { state.runtime.ackMarker = 1; }, { marker: 1 }),
      (error) => error.code === 'STATE_COMMIT_AUDIT_OUTCOME_UNKNOWN'
    );
    const state = await store.read();
    const commitId = state.runtime.durability.lastStateCommit.id;
    assert.equal((await store.verifyAudit()).ok, true);

    const restarted = await new StateStore({ root }).init();
    const entries = (await fs.readFile(restarted.auditPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(entries.filter((entry) => entry.stateCommitId === commitId).length, 1);
    assert.equal((await restarted.verifyAudit()).ok, true);
  } finally {
    await cleanup(root);
  }
});

test('next mutation reconciles a prior audit gap before committing new state', async () => {
  const root = await tempDir('veteran-audit-order-');
  let armed = false;
  try {
    const store = await new StateStore({
      root,
      faultInjector: async (stage, commit) => {
        if (armed && stage === 'after_state_commit_before_audit' && commit.eventType === 'first_gap') {
          armed = false;
          throw Object.assign(new Error('injected first gap'), { code: 'INJECTED_FIRST_GAP' });
        }
      }
    }).init();
    armed = true;
    await assert.rejects(store.transaction('first_gap', (state) => { state.runtime.sequence = ['first']; }), (error) => error.code === 'STATE_COMMIT_AUDIT_OUTCOME_UNKNOWN');
    await store.transaction('second_commit', (state) => { state.runtime.sequence.push('second'); });
    const state = await store.read();
    assert.deepEqual(state.runtime.sequence, ['first', 'second']);
    const entries = (await fs.readFile(store.auditPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    const firstIndex = entries.findIndex((entry) => entry.type === 'first_gap');
    const secondIndex = entries.findIndex((entry) => entry.type === 'second_commit');
    assert.ok(firstIndex >= 0);
    assert.ok(secondIndex > firstIndex);
    assert.equal((await store.verifyAudit()).ok, true);
  } finally {
    await cleanup(root);
  }
});