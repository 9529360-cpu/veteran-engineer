import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { LocalJsonStateBackend } from '../src/local-json-state-backend.mjs';
import { registerStateBackendDurabilityConformance } from './state-backend-durability-conformance.mjs';
import { cleanup, tempDir } from './helpers.mjs';

async function createLocalDurabilityFixture() {
  const root = await tempDir('veteran-durability-contract-');
  const control = { fault: null };
  const backend = await new LocalJsonStateBackend({
    root,
    faultInjector: async (stage, commit) => {
      const fault = control.fault;
      if (!fault || fault.stage !== stage || fault.eventType !== commit.eventType) return;
      control.fault = null;
      const error = new Error(`injected durability conformance fault at ${stage}`);
      error.code = 'INJECTED_DURABILITY_CONFORMANCE_FAULT';
      throw error;
    }
  }).init();
  return { root, backend, control, cleanup: () => cleanup(root) };
}

registerStateBackendDurabilityConformance({
  name: 'local-json durable outcome backend',
  create: createLocalDurabilityFixture,
  reopen: async ({ root }) => new LocalJsonStateBackend({ root }).init(),
  armFault: async (fixture, stage, eventType) => {
    fixture.control.fault = { stage, eventType };
  },
  corruptAudit: async (fixture) => {
    const lines = (await fs.readFile(fixture.backend.auditPath, 'utf8')).trim().split('\n');
    const last = JSON.parse(lines.at(-1));
    last.summary = { ...last.summary, durabilityConformanceTampered: true };
    lines[lines.length - 1] = JSON.stringify(last);
    await fs.writeFile(fixture.backend.auditPath, `${lines.join('\n')}\n`);
  }
});

test('Veteran app rejects a transactional backend that lacks durable-outcome capability', async () => {
  const root = await tempDir('veteran-durability-app-');
  try {
    const transactionOnly = {
      backendContract: 'veteran-state-backend-v1',
      transactionContract: 'veteran-state-transaction-v1',
      backendKind: 'transaction-only-test',
      artifactsDir: `${root}/artifacts`,
      worktreesDir: `${root}/worktrees`,
      async init() { return this; },
      async read() { return {}; },
      async transaction() {},
      async recordTimeline() {},
      async verifyAudit() { return { ok: true, entries: 0, head: null }; },
      async readSnapshot() { return { state: {}, revision: 'test' }; },
      async compareAndCommit() {}
    };
    await assert.rejects(
      createVeteranApp({ stateRoot: root, stateBackend: transactionOnly }),
      (error) => error.code === 'STATE_BACKEND_DURABILITY_CONTRACT_INVALID'
    );
  } finally {
    await cleanup(root);
  }
});
