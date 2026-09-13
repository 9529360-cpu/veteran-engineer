import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertDurableOutcomeStateBackend,
  isStateCommitAuditOutcomeUnknown,
  STATE_BACKEND_DURABILITY_CONTRACT
} from '../src/state-backend-durability-contract.mjs';

export function registerStateBackendDurabilityConformance({ name, create, reopen, armFault, corruptAudit }) {
  test(`${name}: declares the durable-outcome backend v1 capability`, async () => {
    const fixture = await create();
    try {
      const backend = assertDurableOutcomeStateBackend(fixture.backend);
      assert.equal(backend.durabilityContract, STATE_BACKEND_DURABILITY_CONTRACT);
      assert.equal(typeof backend.reconcilePendingAudit, 'function');
    } finally {
      await fixture.cleanup();
    }
  });

  test(`${name}: state-committed audit gap reports unknown and is repaired exactly once`, async () => {
    const fixture = await create();
    try {
      const before = await fixture.backend.verifyAudit();
      assert.equal(before.ok, true);
      await armFault(fixture, 'after_state_commit_before_audit', 'durability_gap');
      await assert.rejects(
        fixture.backend.transaction('durability_gap', (state) => { state.runtime.durabilityConformanceGap = true; }, { probe: 'gap' }),
        (error) => isStateCommitAuditOutcomeUnknown(error)
      );
      const durableState = await fixture.backend.read();
      assert.equal(durableState.runtime.durabilityConformanceGap, true);
      const broken = await fixture.backend.verifyAudit();
      assert.equal(broken.ok, false);

      const restarted = assertDurableOutcomeStateBackend(await reopen(fixture));
      const repaired = await restarted.verifyAudit();
      assert.equal(repaired.ok, true);
      assert.equal(repaired.entries, before.entries + 1);
      const stable = await restarted.reconcilePendingAudit();
      assert.equal(stable.ok, true);
      assert.equal((await restarted.verifyAudit()).entries, repaired.entries);
    } finally {
      await fixture.cleanup();
    }
  });

  test(`${name}: audit-appended acknowledgement loss is not duplicated during reconciliation`, async () => {
    const fixture = await create();
    try {
      const before = await fixture.backend.verifyAudit();
      assert.equal(before.ok, true);
      await armFault(fixture, 'after_audit_append_before_ack', 'durability_ack_loss');
      await assert.rejects(
        fixture.backend.transaction('durability_ack_loss', (state) => { state.runtime.durabilityConformanceAck = true; }, { probe: 'ack-loss' }),
        (error) => isStateCommitAuditOutcomeUnknown(error)
      );
      const appended = await fixture.backend.verifyAudit();
      assert.equal(appended.ok, true);
      assert.equal(appended.entries, before.entries + 1);

      const restarted = assertDurableOutcomeStateBackend(await reopen(fixture));
      const reconciled = await restarted.verifyAudit();
      assert.equal(reconciled.ok, true);
      assert.equal(reconciled.entries, appended.entries);
      await restarted.reconcilePendingAudit();
      assert.equal((await restarted.verifyAudit()).entries, appended.entries);
    } finally {
      await fixture.cleanup();
    }
  });

  test(`${name}: audit corruption fails closed instead of being reconciled over`, async () => {
    const fixture = await create();
    try {
      await fixture.backend.transaction('durability_tamper_probe', (state) => { state.runtime.durabilityConformanceTamper = true; }, { probe: 'tamper' });
      await corruptAudit(fixture);
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
}
