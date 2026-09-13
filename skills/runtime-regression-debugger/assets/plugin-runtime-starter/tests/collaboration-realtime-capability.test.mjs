import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const skillRoot = path.join(root, 'skills', 'runtime-regression-debugger');
const router = path.join(skillRoot, 'scripts', 'engineering_context_router.py');
const gate = path.join(skillRoot, 'scripts', 'collaboration_realtime_gate.py');
const reference = path.join(skillRoot, 'references', 'collaboration-realtime-product-engineering.md');

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

function runPython(script, args) {
  for (const executable of ['python3', 'python']) {
    const result = spawnSync(executable, [script, ...args], { cwd: root, encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

test('engineering context router treats collaboration/realtime as a first-class product surface', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill router is not present in this isolated gate fixture');
    return;
  }
  assert.equal(await exists(reference), true, 'Collaboration and Realtime Product Engineering reference must exist when routed');

  const direct = runPython(router, [
    '--signals',
    'collaboration,realtime-collaboration,presence,shared-state,collaborative-editing,optimistic-reconciliation,offline-collaboration,realtime-permissions,reconnect-recovery,event-ordering,collaboration-backpressure',
    '--max', '14',
    '--json'
  ]);
  assert.ok(direct);
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  const payload = JSON.parse(direct.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const refs = payload.references.map((entry) => entry.path);
  for (const expected of [
    'references/collaboration-realtime-product-engineering.md',
    'references/full-stack-product-engineering.md',
    'references/distributed-systems-consistency.md',
    'references/async-edge-job-patterns.md',
    'references/data-consistency-migration-patterns.md',
    'references/frontend-product-patterns.md',
    'references/security-multitenancy-patterns.md',
    'references/temporal-debugging-state-transitions.md'
  ]) assert.ok(refs.includes(expected), `expected route ${expected}`);

  const aliases = runPython(router, [
    '--signals',
    'collaborative-app,multi-user-collaboration,real-time-collaboration,presence-state,shared-document,co-editing,optimistic-ui-reconciliation,offline-editing,live-permissions,reconnect-resume,message-ordering,slow-consumer',
    '--max', '14',
    '--json'
  ]);
  assert.ok(aliases);
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  const aliasPayload = JSON.parse(aliases.stdout);
  assert.deepEqual(aliasPayload.unmatched_signals, []);
  assert.deepEqual(aliasPayload.signals, [
    'collaboration', 'collaboration', 'realtime-collaboration', 'presence', 'collaborative-editing',
    'collaborative-editing', 'optimistic-reconciliation', 'offline-collaboration', 'realtime-permissions',
    'reconnect-recovery', 'event-ordering', 'collaboration-backpressure'
  ]);

  const ambiguous = runPython(router, ['--signals', 'realtime,live,sync,websocket,socket,conflict', '--json']);
  assert.ok(ambiguous);
  assert.equal(ambiguous.status, 0, ambiguous.stderr || ambiguous.stdout);
  assert.deepEqual(JSON.parse(ambiguous.stdout).unmatched_signals, ['realtime', 'live', 'sync', 'websocket', 'socket', 'conflict']);
});

test('collaboration/realtime gate fails closed on incomplete shared-state contracts', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }
  assert.equal(await exists(reference), true, 'Collaboration and Realtime Product Engineering reference must exist with the gate');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-collab-'));
  try {
    const validPath = path.join(dir, 'valid.json');
    await fs.writeFile(validPath, JSON.stringify({
      experience: {
        user_outcome: 'Multiple authorized users see and edit shared state with truthful pending, conflict, offline and recovery states.',
        actors: ['editor-a', 'editor-b', 'offline-device'],
        shared_object_scope: 'workspace-scoped document plus ephemeral presence/cursor projection',
        degraded_behavior: 'when realtime delivery is unavailable the product shows stale/offline state and uses bounded resync rather than pretending to be live'
      },
      authority: {
        durable_state_owner: 'server document service owns committed content and monotonic document revision',
        authorization_owner: 'server checks current principal/tenant/document permission on every durable mutation and protected read',
        publication_owner: 'realtime layer publishes committed revision/events but cannot author durable document truth'
      },
      operations: {
        operation_identity: 'stable operation id is preserved across timeout, reconnect and replay',
        version_or_ordering: 'writes include base revision and server assigns authoritative resulting revision',
        duplicate_retry: 'same operation id is idempotent; unknown acknowledgement is reconciled before any new id is generated',
        optimistic_reconciliation: 'local pending state is replaced by committed/transformed result or explicit rejection/conflict without treating animation as success'
      },
      presence: {
        scope_and_identity: 'presence binds account plus session/device generation to one document scope',
        expiry_policy: 'heartbeat/lease expiry removes crashed or partitioned sessions without requiring a clean leave event',
        multi_device_behavior: 'multiple tabs/devices are distinct session generations but can be grouped by account for display'
      },
      connectivity: {
        reconnect_resume: 'client resumes from authoritative revision/cursor when possible and otherwise fetches a fresh snapshot',
        offline_policy: 'queue only explicitly queueable idempotent edits and preserve account/document/base-revision identity across restart',
        stale_generation_policy: 'events from replaced sockets/screens/sessions are ignored and queued work rechecks current account/permission before submit'
      },
      conflicts: {
        concurrent_update_policy: 'stale base revisions yield domain merge where safe or a visible conflict/reload path where intent cannot be preserved automatically',
        merge_or_reject_policy: 'simple records use conditional versions; richer merge algorithms are introduced only if required by document/offline semantics'
      },
      transport: {
        delivery_model: 'transport may duplicate/reorder across reconnect; client uses authoritative revision to detect stale/gap state',
        backpressure_policy: 'ephemeral presence can coalesce/drop, while durable update gaps force bounded disconnect/resync instead of unbounded queues',
        resync_policy: 'version gap or expired replay cursor triggers a snapshot resync that replaces stale local projections'
      },
      validation: {
        scenarios: ['concurrent-write', 'duplicate-retry', 'lost-ack', 'out-of-order', 'reconnect-gap', 'permission-revocation', 'offline-stale', 'presence-expiry', 'slow-consumer'],
        oracle: 'authoritative revision and durable state converge, all clients reconcile to it, and UI pending/conflict/offline/recovery state remains truthful'
      },
      observability: {
        operation_status: 'measure accepts/rejects/conflicts/unknown outcomes by bounded operation class and revision metadata',
        connection_health: 'measure reconnect/resume, forced snapshot resync, version gaps, presence lease expiry and slow-consumer disconnects',
        reconciliation_failures: 'correlate operation id, safe object id, committed revision and session generation without logging document content'
      },
      compatibility: {
        mixed_version_behavior: 'supported old/new clients can coexist; unknown additive messages degrade safely and old writes remain validated under current authority',
        schema_rollout: 'wire/document schema changes are additive or explicitly negotiated before old paths are removed',
        rollback: 'code rollback does not undo other users committed valid changes; snapshot/resync remains an escape hatch'
      }
    }), 'utf8');

    const valid = runPython(gate, [validPath, '--json']);
    assert.ok(valid);
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
    const validPayload = JSON.parse(valid.stdout);
    assert.equal(validPayload.gate_passed, true);
    assert.deepEqual(validPayload.blockers, []);

    const invalidPath = path.join(dir, 'invalid.json');
    await fs.writeFile(invalidPath, JSON.stringify({
      experience: { user_outcome: '', actors: [], shared_object_scope: true, degraded_behavior: '' },
      authority: {}, operations: {}, presence: {}, connectivity: {}, conflicts: {}, transport: {},
      validation: { scenarios: ['concurrent-write'], oracle: false },
      observability: {}, compatibility: {}
    }), 'utf8');

    const invalid = runPython(gate, [invalidPath, '--json']);
    assert.ok(invalid);
    assert.notEqual(invalid.status, 0);
    const invalidPayload = JSON.parse(invalid.stdout);
    assert.equal(invalidPayload.gate_passed, false);
    const codes = new Set(invalidPayload.blockers.map((item) => item.code));
    for (const code of [
      'EXPERIENCE_FIELD_REQUIRED', 'ACTORS_REQUIRED', 'AUTHORITY_FIELD_REQUIRED', 'OPERATIONS_FIELD_REQUIRED',
      'PRESENCE_FIELD_REQUIRED', 'CONNECTIVITY_FIELD_REQUIRED', 'CONFLICTS_FIELD_REQUIRED', 'TRANSPORT_FIELD_REQUIRED',
      'VALIDATION_SCENARIOS_INCOMPLETE', 'VALIDATION_FIELD_REQUIRED', 'OBSERVABILITY_FIELD_REQUIRED', 'COMPATIBILITY_FIELD_REQUIRED'
    ]) assert.ok(codes.has(code), `expected blocker ${code}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
