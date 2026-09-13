import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { EvidenceService } from '../src/evidence-service.mjs';
import { StateStore } from '../src/state-store.mjs';
import { tempDir, cleanup } from './helpers.mjs';

async function withEvidenceService(prefix, fn) {
  const root = await tempDir(prefix);
  try {
    const store = await new StateStore({ root }).init();
    const service = new EvidenceService({ store });
    await fn({ root, store, service });
  } finally {
    await cleanup(root);
  }
}

test('evidence validates attachments before creating artifact files', async () => {
  await withEvidenceService('veteran-evidence-input-', async ({ store, service }) => {
    await assert.rejects(
      service.record({ projectId: 'p1', type: 'test', summary: 'invalid attachments', artifact: 'must not be written', attachments: 'not-an-array' }),
      (error) => error instanceof TypeError
    );
    assert.deepEqual(await fs.readdir(store.artifactsDir), []);
    assert.equal(Object.keys((await store.read()).evidence).length, 0);
  });
});

test('evidence removes staged artifact files when durable state does not commit', async () => {
  await withEvidenceService('veteran-evidence-rollback-', async ({ store, service }) => {
    const originalTransaction = store.transaction.bind(store);
    store.transaction = async (eventType, ...args) => {
      if (eventType === 'evidence_recorded') {
        throw Object.assign(new Error('simulated evidence state failure'), { code: 'SIMULATED_EVIDENCE_STATE_FAILURE' });
      }
      return originalTransaction(eventType, ...args);
    };

    await assert.rejects(
      service.record({
        projectId: 'p1',
        type: 'test',
        summary: 'rollback staged files',
        artifact: 'primary artifact',
        attachments: [{ name: 'trace.log', content: 'attachment body' }]
      }),
      (error) => error.code === 'SIMULATED_EVIDENCE_STATE_FAILURE'
    );
    assert.deepEqual(await fs.readdir(store.artifactsDir), []);
    assert.equal(Object.keys((await store.read()).evidence).length, 0);
  });
});

test('evidence preserves files when state commit is durable but acknowledgement is unknown', async () => {
  await withEvidenceService('veteran-evidence-durable-', async ({ root, store, service }) => {
    const originalTransaction = store.transaction.bind(store);
    store.transaction = async (eventType, ...args) => {
      const result = await originalTransaction(eventType, ...args);
      if (eventType === 'evidence_recorded') {
        const error = new Error('simulated durable evidence acknowledgement loss');
        error.code = 'STATE_COMMIT_AUDIT_OUTCOME_UNKNOWN';
        error.stateCommitted = true;
        throw error;
      }
      return result;
    };

    await assert.rejects(
      service.record({
        projectId: 'p1',
        type: 'test',
        summary: 'preserve durable evidence files',
        artifact: 'durable primary artifact',
        attachments: [{ name: 'trace.log', content: 'durable attachment' }]
      }),
      (error) => error.code === 'STATE_COMMIT_AUDIT_OUTCOME_UNKNOWN' && error.stateCommitted === true
    );

    const state = await store.read();
    const records = Object.values(state.evidence);
    assert.equal(records.length, 1);
    const record = records[0];
    assert.equal(await fs.readFile(path.join(root, record.artifactPointer), 'utf8'), 'durable primary artifact');
    assert.equal(record.attachments.length, 1);
    assert.equal(await fs.readFile(path.join(root, record.attachments[0].artifactPointer), 'utf8'), 'durable attachment');
  });
});
