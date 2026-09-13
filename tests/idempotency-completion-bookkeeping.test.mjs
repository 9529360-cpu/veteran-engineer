import assert from 'node:assert/strict';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { LocalJsonStateBackend } from '../src/local-json-state-backend.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

class CompletionBookkeepingFailureBackend extends LocalJsonStateBackend {
  constructor(options) {
    super(options);
    this.failNextRequestCompletion = false;
  }

  async transaction(eventType, mutator, auditSummary = {}) {
    if (this.failNextRequestCompletion && eventType === 'request_completed') {
      this.failNextRequestCompletion = false;
      const error = new Error('injected request completion bookkeeping failure');
      error.code = 'INJECTED_REQUEST_COMPLETION_FAILURE';
      throw error;
    }
    return super.transaction(eventType, mutator, auditSummary);
  }
}

test('successful mutation becomes unknown, never failed, when request completion bookkeeping cannot persist', async () => {
  const fixture = await createGitRepo();
  try {
    const backend = new CompletionBookkeepingFailureBackend({ root: fixture.stateRoot });
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot, stateBackend: backend });
    backend.failNextRequestCompletion = true;

    const args = { requestId: 'req-completion-bookkeeping-failure', repoPath: fixture.repo };
    await assert.rejects(
      app.callTool('project_open', args),
      (error) => error.code === 'REQUEST_OUTCOME_UNKNOWN'
        && error.details?.requestId === args.requestId
        && error.details?.causeCode === 'INJECTED_REQUEST_COMPLETION_FAILURE'
    );

    let state = await app.store.read();
    assert.equal(Object.values(state.projects).length, 1, 'the handler mutation already committed successfully');
    assert.equal(state.requests[args.requestId].status, 'unknown');
    assert.notEqual(state.requests[args.requestId].status, 'failed');

    await assert.rejects(
      app.callTool('project_open', args),
      (error) => error.code === 'REQUEST_OUTCOME_UNKNOWN'
    );
    state = await app.store.read();
    assert.equal(Object.values(state.projects).length, 1, 'the same requestId must never replay the successful mutation blindly');
  } finally {
    await cleanup(fixture.root);
  }
});
