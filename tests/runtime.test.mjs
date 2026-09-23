import assert from 'node:assert/strict';
import test from 'node:test';
import { StateStore } from '../src/state-store.mjs';
import { LocalJsonStateBackend } from '../src/local-json-state-backend.mjs';
import { ExperienceService } from '../src/experience-service.mjs';
import { RuntimeService } from '../src/runtime-service.mjs';
import { MCP_TRANSPORT_MODES } from '../src/mcp-protocol-capability.mjs';
import { TOOL_NAMES } from '../src/tool-catalog.mjs';
import { beginRequest, replayOrThrow } from '../src/idempotency.mjs';
import { tempDir, cleanup } from './helpers.mjs';

test('runtime health reports explicit fallback and official SDK protocol capability', async () => {
  const root = await tempDir('veteran-runtime-');
  try {
    const store = await new StateStore({ root }).init();
    const exp = new ExperienceService({ store });
    const runtime = new RuntimeService({ store, experienceService: exp, protocolMode: MCP_TRANSPORT_MODES.STANDALONE_FALLBACK });
    let health = await runtime.health();
    assert.equal(health.toolCount, 36);
    assert.deepEqual(health.toolSurface, [...TOOL_NAMES]);
    assert.equal(health.surface.id, 'local-stdio');
    assert.equal(health.surface.contract, 'veteran-surface-capabilities-v1');
    assert.deepEqual(health.mcp.eras, ['legacy']);
    assert.deepEqual(health.mcp.protocols, ['2025-11-25']);
    runtime.setProtocolMode(MCP_TRANSPORT_MODES.OFFICIAL_SDK);
    health = await runtime.health();
    assert.deepEqual(health.mcp.eras, ['modern', 'legacy']);
    assert.deepEqual(health.mcp.protocols, ['2026-07-28', '2025-11-25']);
  } finally {
    await cleanup(root);
  }
});

test('unknown idempotent outcome is never replayed blindly', async () => {
  const root = await tempDir('veteran-idempotency-');
  try {
    const store = await new StateStore({ root }).init();
    await beginRequest(store, 'req-1', 'mutation', '{}');
    const restarted = await new StateStore({ root }).init();
    const state = await restarted.read();
    assert.equal(state.requests['req-1'].status, 'unknown');
    assert.throws(() => replayOrThrow(state.requests['req-1']), (error) => error.code === 'REQUEST_OUTCOME_UNKNOWN');
  } finally {
    await cleanup(root);
  }
});

test('app-level requestId replays completed mutations and rejects payload conflicts', async () => {
  const { createGitRepo } = await import('./helpers.mjs');
  const { createVeteranApp } = await import('../src/app.mjs');
  const fixture = await createGitRepo();
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const first = await app.callTool('project_open', { requestId: 'req-project-open', repoPath: fixture.repo });
    const replay = await app.callTool('project_open', { requestId: 'req-project-open', repoPath: fixture.repo });
    assert.deepEqual(replay, first);
    await assert.rejects(
      app.callTool('project_open', { requestId: 'req-project-open', repoPath: fixture.repo, name: 'different-payload' }),
      (error) => error.code === 'REQUEST_ID_CONFLICT'
    );
    const state = await app.store.read();
    assert.equal(Object.values(state.projects).length, 1);
    assert.equal(state.requests['req-project-open'].status, 'completed');
    assert.match(state.requests['req-project-open'].fingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.equal(state.requests['req-project-open'].fingerprint.includes(fixture.repo), false);
  } finally {
    await cleanup(fixture.root);
  }
});

test('app accepts legacy raw idempotency fingerprints for replay compatibility', async () => {
  const { createGitRepo } = await import('./helpers.mjs');
  const { createVeteranApp } = await import('../src/app.mjs');
  const { completeRequest } = await import('../src/idempotency.mjs');
  const { stableStringify } = await import('../src/util.mjs');
  const fixture = await createGitRepo();
  try {
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot });
    const payload = { repoPath: fixture.repo };
    await beginRequest(app.store, 'legacy-project-open', 'project_open', stableStringify(payload), 'legacy-admission');
    const legacyResult = { id: 'legacy-project', repoPath: fixture.repo };
    await completeRequest(app.store, 'legacy-project-open', legacyResult);
    const replay = await app.callTool('project_open', { requestId: 'legacy-project-open', ...payload });
    assert.deepEqual(replay, legacyResult);
  } finally {
    await cleanup(fixture.root);
  }
});

test('app resumes only its own request admission after pre-audit ambiguity is reconciled', async () => {
  const { createGitRepo } = await import('./helpers.mjs');
  const { createVeteranApp } = await import('../src/app.mjs');
  const fixture = await createGitRepo();
  let armed = false;
  try {
    const backend = new LocalJsonStateBackend({
      root: fixture.stateRoot,
      faultInjector: async (stage, commit) => {
        if (armed && stage === 'after_state_commit_before_audit' && commit.eventType === 'request_started') {
          armed = false;
          throw Object.assign(new Error('injected admission audit gap'), { code: 'INJECTED_ADMISSION_AUDIT_GAP' });
        }
      }
    });
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot, stateBackend: backend });
    armed = true;
    const args = { requestId: 'req-project-admission-gap', repoPath: fixture.repo };
    const result = await app.callTool('project_open', args);
    const state = await app.store.read();
    assert.equal(state.requests['req-project-admission-gap'].status, 'completed');
    assert.ok(state.requests['req-project-admission-gap'].admissionId);
    assert.deepEqual(state.requests['req-project-admission-gap'].result, result);
    assert.equal(Object.values(state.projects).length, 1);
    assert.equal((await app.store.verifyAudit()).ok, true);
  } finally {
    await cleanup(fixture.root);
  }
});

test('app marks request unknown instead of failed when handler state commit audit outcome is ambiguous', async () => {
  const { createGitRepo } = await import('./helpers.mjs');
  const { createVeteranApp } = await import('../src/app.mjs');
  const fixture = await createGitRepo();
  let armed = false;
  try {
    const backend = new LocalJsonStateBackend({
      root: fixture.stateRoot,
      faultInjector: async (stage, commit) => {
        if (armed && stage === 'after_state_commit_before_audit' && commit.eventType === 'project_opened') {
          armed = false;
          throw Object.assign(new Error('injected project audit gap'), { code: 'INJECTED_PROJECT_AUDIT_GAP' });
        }
      }
    });
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot, stateBackend: backend });
    armed = true;
    const args = { requestId: 'req-project-ambiguous', repoPath: fixture.repo };
    await assert.rejects(app.callTool('project_open', args), (error) => error.code === 'REQUEST_OUTCOME_UNKNOWN');
    const state = await app.store.read();
    assert.equal(Object.values(state.projects).length, 1);
    assert.equal(state.requests['req-project-ambiguous'].status, 'unknown');
    assert.equal((await app.store.verifyAudit()).ok, true);
    await assert.rejects(app.callTool('project_open', args), (error) => error.code === 'REQUEST_OUTCOME_UNKNOWN');
  } finally {
    await cleanup(fixture.root);
  }
});

test('app safely returns success when request completion audit ambiguity reconciles to completed', async () => {
  const { createGitRepo } = await import('./helpers.mjs');
  const { createVeteranApp } = await import('../src/app.mjs');
  const fixture = await createGitRepo();
  let armed = false;
  try {
    const backend = new LocalJsonStateBackend({
      root: fixture.stateRoot,
      faultInjector: async (stage, commit) => {
        if (armed && stage === 'after_state_commit_before_audit' && commit.eventType === 'request_completed') {
          armed = false;
          throw Object.assign(new Error('injected completion audit gap'), { code: 'INJECTED_COMPLETION_AUDIT_GAP' });
        }
      }
    });
    const app = await createVeteranApp({ stateRoot: fixture.stateRoot, stateBackend: backend });
    armed = true;
    const args = { requestId: 'req-project-completion-gap', repoPath: fixture.repo };
    const result = await app.callTool('project_open', args);
    const state = await app.store.read();
    assert.equal(state.requests['req-project-completion-gap'].status, 'completed');
    assert.deepEqual(state.requests['req-project-completion-gap'].result, result);
    assert.equal((await app.store.verifyAudit()).ok, true);
    const replay = await app.callTool('project_open', args);
    assert.deepEqual(replay, result);
  } finally {
    await cleanup(fixture.root);
  }
});