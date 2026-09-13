import assert from 'node:assert/strict';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { LocalJsonStateBackend } from '../src/local-json-state-backend.mjs';
import { assertStateBackend } from '../src/state-backend-contract.mjs';
import { assertTransactionalStateBackend } from '../src/state-backend-transaction-contract.mjs';
import { cleanup, tempDir } from './helpers.mjs';
import { registerStateBackendConformance } from './state-backend-conformance.mjs';
import { registerStateBackendTransactionConformance } from './state-backend-transaction-conformance.mjs';

async function createLocalBackendFixture() {
  const root = await tempDir('veteran-backend-contract-');
  const backend = await new LocalJsonStateBackend({ root }).init();
  return { root, backend, cleanup: () => cleanup(root) };
}

registerStateBackendConformance({
  name: 'local-json state backend',
  create: createLocalBackendFixture,
  reopen: async ({ root }) => new LocalJsonStateBackend({ root }).init()
});

registerStateBackendTransactionConformance({
  name: 'local-json transactional state backend',
  create: createLocalBackendFixture
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
