import assert from 'node:assert/strict';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { LocalJsonStateBackend } from '../src/local-json-state-backend.mjs';
import { assertStateBackend } from '../src/state-backend-contract.mjs';
import { cleanup, tempDir } from './helpers.mjs';

function contractFixture(overrides = {}) {
  return {
    backendContract: 'veteran-state-backend-v1',
    backendKind: 'test-backend',
    init() {},
    read() {},
    transaction() {},
    recordTimeline() {},
    verifyAudit() {},
    artifactsDir: '/tmp/veteran-artifacts',
    worktreesDir: '/tmp/veteran-worktrees',
    ...overrides
  };
}

test('state backend contract rejects relative execution-local artifact and worktree paths', () => {
  for (const [key, value] of [['artifactsDir', 'artifacts'], ['worktreesDir', './worktrees']]) {
    assert.throws(
      () => assertStateBackend(contractFixture({ [key]: value })),
      (error) => error.code === 'STATE_BACKEND_CONTRACT_INVALID' && error.details?.path === key,
      `${key} must be absolute`
    );
  }

  assert.equal(assertStateBackend(contractFixture()).backendKind, 'test-backend');
});

test('createVeteranApp rejects an injected backend whose execution-local paths are relative', async () => {
  const root = await tempDir('veteran-state-backend-relative-path-');
  try {
    const backend = new LocalJsonStateBackend({ root });
    backend.artifactsDir = 'relative-artifacts';
    backend.worktreesDir = 'relative-worktrees';

    await assert.rejects(
      createVeteranApp({ stateRoot: root, stateBackend: backend }),
      (error) => error.code === 'STATE_BACKEND_CONTRACT_INVALID'
        && ['artifactsDir', 'worktreesDir'].includes(error.details?.path)
    );
  } finally {
    await cleanup(root);
  }
});
