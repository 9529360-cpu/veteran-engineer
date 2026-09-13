import assert from 'node:assert/strict';
import test from 'node:test';

export function registerStateBackendTransactionConformance({ name, create }) {
  test(`${name}: revision changes only after a successful compare-and-commit`, async () => {
    const fixture = await create();
    try {
      const first = await fixture.backend.readSnapshot();
      const repeated = await fixture.backend.readSnapshot();
      assert.equal(repeated.revision, first.revision);

      const result = await fixture.backend.compareAndCommit(first.revision, 'revision_success', (state) => {
        state.runtime.compareMarker = 'committed';
        return 'ok';
      }, { marker: 'committed' });
      assert.equal(result, 'ok');

      const after = await fixture.backend.readSnapshot();
      assert.notEqual(after.revision, first.revision);
      assert.equal(after.state.runtime.compareMarker, 'committed');
      assert.equal((await fixture.backend.verifyAudit()).ok, true);
    } finally {
      await fixture.cleanup();
    }
  });

  test(`${name}: stale compare-and-commit fails closed without state or audit mutation`, async () => {
    const fixture = await create();
    try {
      const stale = await fixture.backend.readSnapshot();
      await fixture.backend.transaction('advance_revision', (state) => { state.runtime.value = 1; });
      const before = await fixture.backend.readSnapshot();
      const beforeAudit = await fixture.backend.verifyAudit();

      await assert.rejects(
        fixture.backend.compareAndCommit(stale.revision, 'must_not_commit', (state) => { state.runtime.value = 999; }),
        (error) => error.code === 'STATE_REVISION_CONFLICT'
      );

      const after = await fixture.backend.readSnapshot();
      const afterAudit = await fixture.backend.verifyAudit();
      assert.equal(after.revision, before.revision);
      assert.equal(after.state.runtime.value, 1);
      assert.equal(afterAudit.entries, beforeAudit.entries);
      assert.equal(afterAudit.head, beforeAudit.head);
    } finally {
      await fixture.cleanup();
    }
  });

  test(`${name}: concurrent compare-and-commit contenders admit exactly one winner for one revision`, async () => {
    const fixture = await create();
    try {
      await fixture.backend.transaction('counter_init', (state) => { state.runtime.casCounter = 0; });
      const snapshot = await fixture.backend.readSnapshot();
      const beforeAudit = await fixture.backend.verifyAudit();

      const contenders = await Promise.allSettled([
        fixture.backend.compareAndCommit(snapshot.revision, 'cas_winner_a', (state) => { state.runtime.casCounter += 1; return 'a'; }),
        fixture.backend.compareAndCommit(snapshot.revision, 'cas_winner_b', (state) => { state.runtime.casCounter += 1; return 'b'; })
      ]);
      const winners = contenders.filter((entry) => entry.status === 'fulfilled');
      const losers = contenders.filter((entry) => entry.status === 'rejected');
      assert.equal(winners.length, 1);
      assert.equal(losers.length, 1);
      assert.equal(losers[0].reason.code, 'STATE_REVISION_CONFLICT');

      const after = await fixture.backend.readSnapshot();
      const afterAudit = await fixture.backend.verifyAudit();
      assert.equal(after.state.runtime.casCounter, 1);
      assert.equal(afterAudit.entries, beforeAudit.entries + 1);
      assert.equal(afterAudit.ok, true);
    } finally {
      await fixture.cleanup();
    }
  });
}
