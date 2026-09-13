import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { assertDurableOutcomeStateBackend } from '../src/state-backend-durability-contract.mjs';
import { PostgresStateBackend } from '../src/postgres-state-backend.mjs';
import { cleanup, tempDir } from './helpers.mjs';
import { registerStateBackendConformance } from './state-backend-conformance.mjs';
import { registerStateBackendTransactionConformance } from './state-backend-transaction-conformance.mjs';

const connectionString = process.env.VETERAN_TEST_POSTGRES_URL;
if (!connectionString) throw new Error('VETERAN_TEST_POSTGRES_URL is required for PostgreSQL integration tests');

function instanceKey(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function createPostgresFixture({ faultInjector = null, prefix = 'conformance' } = {}) {
  const root = await tempDir('veteran-postgres-backend-');
  const key = instanceKey(prefix);
  const backends = [];
  const backend = await new PostgresStateBackend({ root, connectionString, instanceKey: key, faultInjector }).init();
  backends.push(backend);
  return {
    root,
    instanceKey: key,
    backend,
    backends,
    cleanup: async () => {
      await Promise.all(backends.map((item) => item.close().catch(() => {})));
      await cleanup(root);
    }
  };
}

async function reopenPostgresFixture(fixture) {
  const backend = await new PostgresStateBackend({
    root: fixture.root,
    connectionString,
    instanceKey: fixture.instanceKey
  }).init();
  fixture.backends.push(backend);
  return backend;
}

registerStateBackendConformance({
  name: 'postgres state backend',
  create: () => createPostgresFixture({ prefix: 'base' }),
  reopen: reopenPostgresFixture
});

registerStateBackendTransactionConformance({
  name: 'postgres transactional state backend',
  create: () => createPostgresFixture({ prefix: 'transaction' })
});

test('postgres durability capability keeps state and audit atomic and resolves acknowledgement loss by commit identity', async () => {
  const control = { eventType: null };
  const fixture = await createPostgresFixture({
    prefix: 'ack-loss',
    faultInjector: async (stage, commit) => {
      if (stage !== 'after_db_commit_before_ack' || commit.eventType !== control.eventType) return;
      control.eventType = null;
      const error = new Error('simulated PostgreSQL commit acknowledgement loss');
      error.code = 'SIMULATED_POSTGRES_ACK_LOSS';
      throw error;
    }
  });
  try {
    assertDurableOutcomeStateBackend(fixture.backend);
    const before = await fixture.backend.verifyAudit();
    control.eventType = 'postgres_ack_loss';
    const result = await fixture.backend.transaction('postgres_ack_loss', (state) => {
      state.runtime.postgresAckLoss = 'committed';
      return 'known-result';
    }, { probe: 'ack-loss' });
    assert.equal(result, 'known-result');

    const state = await fixture.backend.read();
    assert.equal(state.runtime.postgresAckLoss, 'committed');
    const after = await fixture.backend.verifyAudit();
    assert.equal(after.ok, true);
    assert.equal(after.entries, before.entries + 1);
    await fixture.backend.reconcilePendingAudit();
    assert.equal((await fixture.backend.verifyAudit()).entries, after.entries);
  } finally {
    await fixture.cleanup();
  }
});

test('postgres reconciliation repairs a missing latest audit exactly once without rewriting state', async () => {
  const fixture = await createPostgresFixture({ prefix: 'repair' });
  try {
    await fixture.backend.transaction('postgres_repair_probe', (state) => {
      state.runtime.postgresRepairProbe = true;
    }, { probe: 'repair' });
    const snapshot = await fixture.backend.readSnapshot();
    const commitId = snapshot.state.runtime.durability.lastStateCommit.id;
    const before = await fixture.backend.verifyAudit();
    assert.equal(before.ok, true);

    await fixture.backend.pool.query(
      'DELETE FROM veteran_engineer_audit WHERE instance_key = $1 AND state_commit_id = $2',
      [fixture.instanceKey, commitId]
    );
    const broken = await fixture.backend.verifyAudit();
    assert.equal(broken.ok, false);
    assert.equal(broken.reason, 'state-commit-audit-missing');

    const repaired = await fixture.backend.reconcilePendingAudit();
    assert.equal(repaired.repaired, true);
    assert.equal((await fixture.backend.verifyAudit()).ok, true);
    const after = await fixture.backend.readSnapshot();
    assert.equal(after.revision, snapshot.revision);
    assert.equal(after.state.runtime.postgresRepairProbe, true);

    const stable = await fixture.backend.reconcilePendingAudit();
    assert.equal(stable.repaired, false);
    assert.equal((await fixture.backend.verifyAudit()).entries, before.entries);
  } finally {
    await fixture.cleanup();
  }
});

test('postgres audit tampering fails closed instead of being reconciled over', async () => {
  const fixture = await createPostgresFixture({ prefix: 'tamper' });
  try {
    await fixture.backend.transaction('postgres_tamper_probe', (state) => {
      state.runtime.postgresTamperProbe = true;
    }, { probe: 'tamper' });
    const commitId = (await fixture.backend.read()).runtime.durability.lastStateCommit.id;
    await fixture.backend.pool.query(
      `UPDATE veteran_engineer_audit SET summary = '{"tampered":true}'::jsonb WHERE instance_key = $1 AND state_commit_id = $2`,
      [fixture.instanceKey, commitId]
    );
    const audit = await fixture.backend.verifyAudit();
    assert.equal(audit.ok, false);
    await assert.rejects(
      fixture.backend.reconcilePendingAudit(),
      (error) => error.code === 'STATE_AUDIT_INTEGRITY_FAILURE'
    );
  } finally {
    await fixture.cleanup();
  }
});

test('Veteran app can select PostgreSQL through the explicit programmatic backend boundary', async () => {
  const root = await tempDir('veteran-postgres-app-');
  const key = instanceKey('app');
  let app;
  try {
    app = await createVeteranApp({
      stateRoot: root,
      stateBackendConfig: { kind: 'postgres', connectionString, instanceKey: key }
    });
    assert.equal(app.store.backendKind, 'postgres');
    const health = await app.callTool('runtime_health');
    assert.equal(health.stateReadable, true);
    assert.equal(health.audit.ok, true);
  } finally {
    await app?.store?.close?.().catch(() => {});
    await cleanup(root);
  }
});
