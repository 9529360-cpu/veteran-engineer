import assert from 'node:assert/strict';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { LocalJsonStateBackend } from '../src/local-json-state-backend.mjs';
import { assertStateBackend } from '../src/state-backend-contract.mjs';
import { assertTransactionalStateBackend } from '../src/state-backend-transaction-contract.mjs';
import { cleanup, tempDir } from './helpers.mjs';
import { registerStateBackendConformance } from './state-backend-conformance.mjs';

registerStateBackendConformance({
  name: 'local-json state backend',
  create: async () => {
    const root = await tempDir('veteran-backend-contract-');
    const backend = await new LocalJsonStateBackend({ root }).init();
    return { root, backend, cleanup: () => cleanup(root) };
  },
  reopen: async ({ root }) => new LocalJsonStateBackend({ root }).init()
});

test('state backend contract fails closed for incomplete implementations', () => {
  assert.throws(
    () => assertStateBackend({ backendContract: 'veteran-state-backend-v1', backendKind: 'broken' }),
    (error) => error.code === 'STATE_BACKEND_CONTRACT_INVALID'
  );
  assert.throws(
    () => assertTransactionalStateBackend({
      backendContract: 'veteran-state-backend-v1',
      backendKind: 'base-only',
      init() {}, read() {}, transaction() {}, recordTimeline() {}, verifyAudit() {},
      artifactsDir: '/tmp/artifacts', worktreesDir: '/tmp/worktrees'
    }),
    (error) => error.code === 'STATE_BACKEND_TRANSACTION_CONTRACT_INVALID'
  );
});

test('Veteran app accepts a conforming injected state backend and rejects a non-conforming one', async () => {
  const root = await tempDir('veteran-backend-app-');
  try {
    const backend = new LocalJsonStateBackend({ root });
    const app = await createVeteranApp({ stateRoot: root, stateBackend: backend });
    assert.equal(app.store, backend);
    assert.equal(app.store.backendKind, 'local-json');

    await assert.rejects(
      createVeteranApp({ stateRoot: root, stateBackend: { init: async () => ({}) } }),
      (error) => error.code === 'STATE_BACKEND_CONTRACT_INVALID'
    );
  } finally {
    await cleanup(root);
  }
});

test('transactional backend revision changes only after a successful compare-and-commit', async () => {
  const root = await tempDir('veteran-backend-revision-');
  try {
    const backend = await new LocalJsonStateBackend({ root }).init();
    const first = await backend.readSnapshot();
    const repeated = await backend.readSnapshot();
    assert.equal(repeated.revision, first.revision);

    const result = await backend.compareAndCommit(first.revision, 'revision_success', (state) => {
      state.runtime.compareMarker = 'committed';
      return 'ok';
    }, { marker: 'committed' });
    assert.equal(result, 'ok');

    const after = await backend.readSnapshot();
    assert.notEqual(after.revision, first.revision);
    assert.equal(after.state.runtime.compareMarker, 'committed');
    assert.equal((await backend.verifyAudit()).ok, true);
  } finally {
    await cleanup(root);
  }
});

test('stale compare-and-commit fails closed without state or audit mutation', async () => {
  const root = await tempDir('veteran-backend-stale-');
  try {
    const backend = await new LocalJsonStateBackend({ root }).init();
    const stale = await backend.readSnapshot();
    await backend.transaction('advance_revision', (state) => { state.runtime.value = 1; });
    const before = await backend.readSnapshot();
    const beforeAudit = await backend.verifyAudit();

    await assert.rejects(
      backend.compareAndCommit(stale.revision, 'must_not_commit', (state) => { state.runtime.value = 999; }),
      (error) => error.code === 'STATE_REVISION_CONFLICT'
    );

    const after = await backend.readSnapshot();
    const afterAudit = await backend.verifyAudit();
    assert.equal(after.revision, before.revision);
    assert.equal(after.state.runtime.value, 1);
    assert.equal(afterAudit.entries, beforeAudit.entries);
    assert.equal(afterAudit.head, beforeAudit.head);
  } finally {
    await cleanup(root);
  }
});

test('concurrent compare-and-commit contenders admit exactly one winner for one revision', async () => {
  const root = await tempDir('veteran-backend-contenders-');
  try {
    const backend = await new LocalJsonStateBackend({ root }).init();
    await backend.transaction('counter_init', (state) => { state.runtime.casCounter = 0; });
    const snapshot = await backend.readSnapshot();
    const beforeAudit = await backend.verifyAudit();

    const contenders = await Promise.allSettled([
      backend.compareAndCommit(snapshot.revision, 'cas_winner_a', (state) => { state.runtime.casCounter += 1; return 'a'; }),
      backend.compareAndCommit(snapshot.revision, 'cas_winner_b', (state) => { state.runtime.casCounter += 1; return 'b'; })
    ]);
    const winners = contenders.filter((entry) => entry.status === 'fulfilled');
    const losers = contenders.filter((entry) => entry.status === 'rejected');
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.equal(losers[0].reason.code, 'STATE_REVISION_CONFLICT');

    const after = await backend.readSnapshot();
    const afterAudit = await backend.verifyAudit();
    assert.equal(after.state.runtime.casCounter, 1);
    assert.equal(afterAudit.entries, beforeAudit.entries + 1);
    assert.equal(afterAudit.ok, true);
  } finally {
    await cleanup(root);
  }
});
