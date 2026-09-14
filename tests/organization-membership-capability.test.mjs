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
const gate = path.join(skillRoot, 'scripts', 'organization_membership_gate.py');
const securityReference = path.join(skillRoot, 'references', 'security-multitenancy-patterns.md');
const reference = path.join(skillRoot, 'references', 'organization-membership-product-engineering.md');

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

test('auth and tenant routing exposes the organization membership specialist owner', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill router is not present in this isolated gate fixture');
    return;
  }
  assert.equal(await exists(securityReference), true);
  assert.equal(await exists(reference), true);

  const routed = runPython(router, ['--signals', 'auth,tenant', '--max', '6', '--json']);
  assert.ok(routed);
  assert.equal(routed.status, 0, routed.stderr || routed.stdout);
  const payload = JSON.parse(routed.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const refs = payload.references.map((entry) => entry.path);
  assert.ok(refs.includes('references/security-multitenancy-patterns.md'));

  const security = await fs.readFile(securityReference, 'utf8');
  assert.match(security, /organization-membership-product-engineering\.md/);
  assert.match(security, /Organization and membership lifecycle/);
});

test('organization membership gate fails closed on incomplete lifecycle and authority contracts', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }
  assert.equal(await exists(reference), true);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-org-membership-'));
  try {
    const validPath = path.join(dir, 'valid.json');
    await fs.writeFile(validPath, JSON.stringify({
      product: {
        user_outcome: 'Authorized people join and leave the correct organization with current roles and no stale access.',
        organization_model: 'multi-tenant SaaS with owners, members, guests, teams and managed directory memberships',
        membership_classes: ['owner', 'member', 'guest', 'managed'],
        visible_states: 'invited/active/suspended/removed/expired/provisioning-error are distinct when access or recovery differs'
      },
      authority: {
        identity_owner: 'identity service owns the principal independent of tenant membership',
        organization_owner: 'organization aggregate owns tenant existence/status and owner invariants',
        membership_owner: 'tenant-scoped membership record owns lifecycle state',
        role_policy_owner: 'trusted policy owner maps current membership to actions',
        directory_sync_owner: 'SCIM/directory reconciliation owns managed external inputs without bypassing tenant invariants',
        resource_ownership_owner: 'resource domains own transfer/orphan behavior for departing members'
      },
      invitation: {
        invitation_identity: 'stable tenant-scoped invitation id and generation survive retry/resend',
        recipient_binding: 'acceptance binds verified intended identity without exposing invite secrets',
        role_scope: 'invite binds tenant and approved role/team/guest scope',
        expiry_revocation: 'expiry/revoke/replacement invalidate older invite generations',
        acceptance_recheck: 'accept rechecks tenant status, policy, current membership and invite generation before mutation'
      },
      membership: {
        stable_identity: 'membership uses stable tenant+principal identity rather than mutable email',
        state_machine: 'invited/active/suspended/removed/expired transitions and recovery are explicit',
        role_change: 'role mutation is authorized, versioned and audited',
        suspend_remove: 'suspend/remove has effective time and stale jobs cannot undo it',
        guest_expiry: 'guest expiry is durable, idempotent and extension-aware',
        reactivation: 'reactivation is an explicit authorized transition rather than implicit resurrection'
      },
      ownership: {
        owner_transfer: 'current owner authority and successor membership are proven before transfer',
        last_owner_guard: 'final recoverable owner cannot be removed without approved successor/recovery',
        resource_transfer: 'each resource domain defines transfer/retain/archive behavior during removal',
        orphan_policy: 'untransferable resources enter a safe tenant-scoped recovery state'
      },
      authorization: {
        membership_generation: 'sessions/caches/jobs carry generation or re-read current membership before privileged effects',
        request_authorization: 'trusted boundary checks principal+tenant+action+resource',
        cache_invalidation: 'role/membership changes invalidate tenant-scoped authorization projections',
        job_reauthorization: 'async work re-establishes current membership and resource permission before effects',
        session_revocation: 'suspend/remove revokes or refreshes affected sessions without breaking unrelated tenants'
      },
      provisioning: {
        external_identity: 'directory external ids map to stable internal principal+tenant membership under one connection scope',
        group_mapping: 'group-to-role/team mapping is versioned and mapping changes reconcile explicitly',
        source_precedence: 'manual versus managed membership/role precedence and exceptions are explicit',
        deprovision: 'deprovision honors last-owner/resource-transfer/session-revocation invariants',
        reconciliation: 'periodic sync detects missing/duplicate/stale/cross-scope membership drift'
      },
      tests: {
        scenarios: ['duplicate-invite-accept', 'revoked-invite', 'expired-invite', 'cross-tenant-invite', 'role-change-stale-session', 'remove-member-stale-job', 'last-owner-removal', 'resource-transfer-on-removal', 'scim-out-of-order', 'scim-reactivation', 'group-mapping-change', 'guest-expiry', 'multi-org-session-isolation'],
        oracle: 'identity, membership, role policy, sessions/caches/jobs, external directory state and resource ownership converge without stale or cross-tenant access'
      },
      observability: {
        membership_transition_correlation: 'correlate actor, tenant, principal, invite/provision request and membership generation',
        authorization_staleness: 'measure stale-session/cache/job denials and propagation latency after membership/role changes',
        provisioning_drift: 'measure directory/group drift, reconciliation repairs and deprovision backlog',
        redaction_policy: 'logs exclude invitation tokens, auth secrets and unnecessary directory attributes'
      },
      compatibility: {
        mixed_version_behavior: 'old/new clients, workers, token claims and membership schemas coexist through versioned contracts',
        membership_schema_migration: 'legacy role/membership identifiers remain interpretable until readers and queued work migrate',
        directory_migration: 'IdP/SCIM migration preserves stable internal membership identity with bounded reconciliation windows',
        rollback_external_effects: 'software rollback is separate from accepted invites, revoked sessions and external deprovisioning already issued'
      }
    }), 'utf8');

    const valid = runPython(gate, [validPath, '--json']);
    assert.ok(valid);
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
    assert.equal(JSON.parse(valid.stdout).gate_passed, true);

    const invalidPath = path.join(dir, 'invalid.json');
    await fs.writeFile(invalidPath, JSON.stringify({
      product: { user_outcome: '', organization_model: true, membership_classes: [], visible_states: '' },
      authority: {}, invitation: {}, membership: {}, ownership: {}, authorization: {}, provisioning: {},
      tests: { scenarios: ['revoked-invite'], oracle: false }, observability: {}, compatibility: {}
    }), 'utf8');

    const invalid = runPython(gate, [invalidPath, '--json']);
    assert.ok(invalid);
    assert.notEqual(invalid.status, 0);
    const invalidPayload = JSON.parse(invalid.stdout);
    assert.equal(invalidPayload.gate_passed, false);
    const codes = new Set(invalidPayload.blockers.map((item) => item.code));
    for (const code of [
      'PRODUCT_FIELD_REQUIRED', 'MEMBERSHIP_CLASSES_REQUIRED', 'AUTHORITY_FIELD_REQUIRED',
      'INVITATION_FIELD_REQUIRED', 'MEMBERSHIP_FIELD_REQUIRED', 'OWNERSHIP_FIELD_REQUIRED',
      'AUTHORIZATION_FIELD_REQUIRED', 'PROVISIONING_FIELD_REQUIRED', 'TEST_SCENARIOS_INCOMPLETE',
      'TESTS_FIELD_REQUIRED', 'OBSERVABILITY_FIELD_REQUIRED', 'COMPATIBILITY_FIELD_REQUIRED'
    ]) assert.ok(codes.has(code), `expected blocker ${code}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
