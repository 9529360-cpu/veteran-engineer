import assert from 'node:assert/strict';
import test from 'node:test';
import { assertStateBackend, STATE_BACKEND_CONTRACT } from '../src/state-backend-contract.mjs';

export function registerStateBackendConformance({ name, create, reopen }) {
  test(`${name}: declares and initializes the state backend v1 contract`, async () => {
    const fixture = await create();
    try {
      const backend = assertStateBackend(fixture.backend);
      assert.equal(backend.backendContract, STATE_BACKEND_CONTRACT);
      assert.equal(typeof backend.backendKind, 'string');
      assert.ok(backend.artifactsDir);
      assert.ok(backend.worktreesDir);
      const state = await backend.read();
      assert.equal(typeof state.schemaVersion, 'number');
      assert.ok(state.runtime);
      assert.ok(Array.isArray(state.runtime.timeline));
    } finally {
      await fixture.cleanup();
    }
  });

  test(`${name}: concurrent transactions serialize without lost updates`, async () => {
    const fixture = await create();
    try {
      await fixture.backend.transaction('counter_init', (state) => { state.runtime.counter = 0; });
      await Promise.all(Array.from({ length: 24 }, (_, index) => fixture.backend.transaction('counter_increment', async (state) => {
        const before = state.runtime.counter;
        if (index % 3 === 0) await new Promise((resolve) => setTimeout(resolve, 2));
        state.runtime.counter = before + 1;
      }, { index })));
      const state = await fixture.backend.read();
      assert.equal(state.runtime.counter, 24);
      const audit = await fixture.backend.verifyAudit();
      assert.equal(audit.ok, true);
      assert.ok(audit.entries >= 26);
    } finally {
      await fixture.cleanup();
    }
  });

  test(`${name}: failed mutators commit neither state nor audit event`, async () => {
    const fixture = await create();
    try {
      await fixture.backend.transaction('before_failure', (state) => { state.runtime.marker = 'stable'; });
      const beforeAudit = await fixture.backend.verifyAudit();
      await assert.rejects(
        fixture.backend.transaction('must_not_commit', (state) => {
          state.runtime.marker = 'corrupt';
          throw Object.assign(new Error('expected mutation failure'), { code: 'EXPECTED_FAILURE' });
        }),
        (error) => error.code === 'EXPECTED_FAILURE'
      );
      const state = await fixture.backend.read();
      const afterAudit = await fixture.backend.verifyAudit();
      assert.equal(state.runtime.marker, 'stable');
      assert.equal(afterAudit.ok, true);
      assert.equal(afterAudit.entries, beforeAudit.entries);
      assert.equal(afterAudit.head, beforeAudit.head);
    } finally {
      await fixture.cleanup();
    }
  });

  test(`${name}: timeline recording is durable through the backend`, async () => {
    const fixture = await create();
    try {
      await fixture.backend.recordTimeline({ type: 'conformance_event', missionId: 'M1' });
      const state = await fixture.backend.read();
      const event = state.runtime.timeline.at(-1);
      assert.equal(event.type, 'conformance_event');
      assert.equal(event.missionId, 'M1');
      assert.ok(event.at);
      assert.equal((await fixture.backend.verifyAudit()).ok, true);
    } finally {
      await fixture.cleanup();
    }
  });

  test(`${name}: restart reconciles orphaned started requests to unknown`, async () => {
    const fixture = await create();
    try {
      await fixture.backend.transaction('request_started', (state) => {
        state.requests.conformance_request = {
          requestId: 'conformance_request',
          operation: 'conformance',
          fingerprint: '{}',
          status: 'started',
          startedAt: new Date().toISOString(),
          completedAt: null,
          result: null,
          error: null
        };
      });
      const restarted = assertStateBackend(await reopen(fixture));
      const state = await restarted.read();
      assert.equal(state.requests.conformance_request.status, 'unknown');
      assert.ok(state.requests.conformance_request.reconciledAt);
      assert.equal((await restarted.verifyAudit()).ok, true);
    } finally {
      await fixture.cleanup();
    }
  });
}
