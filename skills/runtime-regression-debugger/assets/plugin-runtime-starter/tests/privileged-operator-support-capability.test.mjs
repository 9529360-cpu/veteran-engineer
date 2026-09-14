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
const gate = path.join(skillRoot, 'scripts', 'privileged_operator_support_gate.py');
const securityReference = path.join(skillRoot, 'references', 'security-multitenancy-patterns.md');
const reference = path.join(skillRoot, 'references', 'privileged-operator-support-product-engineering.md');

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

test('auth routing exposes privileged operator support specialist owner', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill router is not present in this isolated gate fixture');
    return;
  }
  assert.equal(await exists(securityReference), true);
  assert.equal(await exists(reference), true);

  const routed = runPython(router, ['--signals', 'auth', '--max', '5', '--json']);
  assert.ok(routed);
  assert.equal(routed.status, 0, routed.stderr || routed.stdout);
  const payload = JSON.parse(routed.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const refs = payload.references.map((entry) => entry.path);
  assert.ok(refs.includes('references/security-multitenancy-patterns.md'));

  const security = await fs.readFile(securityReference, 'utf8');
  assert.match(security, /privileged-operator-support-product-engineering\.md/);
  assert.match(security, /Privileged operator and support workflows/);
});

test('privileged operator support gate fails closed on scope approval and revocation gaps', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }
  assert.equal(await exists(reference), true);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-privileged-operator-'));
  try {
    const validPath = path.join(dir, 'valid.json');
    await fs.writeFile(validPath, JSON.stringify({
      schema: 'veteran-privileged-operator-support-v1',
      product: {
        operator_outcome: 'Support can diagnose and repair an authorized customer problem without hiding who acted, widening scope, or leaving stale privilege behind.',
        privileged_modes: ['view-only', 'assisted-action', 'impersonation', 'direct-privileged-mutation'],
        visible_states: 'requested/approved/active/expired/revoked/denied plus break-glass and impersonation indicators remain distinguishable'
      },
      authority: {
        operator_identity_owner: 'workforce identity provider owns the authenticated employee principal and employment state',
        subject_identity_owner: 'product account and tenant authorities own the affected customer identity and resources',
        policy_owner: 'privileged access policy evaluates operator, purpose, subject, action and risk',
        grant_owner: 'support access service owns scoped temporary grant/session identity and expiry',
        approval_owner: 'approval workflow owns independent approvals and emergency escalation',
        audit_owner: 'append-only security audit owns privileged lifecycle attribution'
      },
      entry: {
        purpose_binding: 'every grant is bound to a support case, incident or approved operational purpose',
        case_or_incident: 'case or incident identity is server-validated and carried through actions and jobs',
        step_up_authentication: 'privileged entry requires fresh workforce step-up appropriate to risk'
      },
      scope: {
        tenant_object_action: 'grant binds operator to exact tenant/account/object/action scope',
        read_write_separation: 'view-only grants cannot invoke mutation endpoints and mutation requires explicit capability',
        cross_tenant_boundary: 'tenant switch is explicit and clears cached/realtime/download context from the prior subject',
        deny_by_default: 'actions outside the issued grant fail closed even for internal administrators'
      },
      approval: {
        normal_path: 'low-risk access follows policy-defined approval or pre-approved role rules',
        high_risk_path: 'security/value/destructive actions require stronger independent approval or customer confirmation when policy requires',
        requester_approver_separation: 'requester cannot satisfy an independent-approver requirement',
        break_glass: 'emergency path requires stronger authentication, reason, narrow scope, short expiry, alerting and post-event review'
      },
      session: {
        grant_identity: 'each privileged session carries an immutable grant id plus operator and subject identity',
        expiry: 'absolute and idle expiry prevent indefinite ambient support access',
        impersonation_identity: 'server keeps operator and subject separate and UI shows persistent impersonation context',
        revocation: 'grant revocation invalidates support sessions independently of customer sessions'
      },
      actions: {
        authoritative_transition: 'support requests changes through the real account/org/billing/security authority instead of a shadow source of truth',
        irreversible_effects: 'destructive, credential, export and monetary effects define stronger approval and repair boundaries',
        async_effects: 'queued work carries operator/grant/subject/purpose identity and rechecks required access semantics',
        retry_unknown_outcome: 'non-idempotent support effects use request identity and reconcile timeout-after-commit before retry'
      },
      privacy: {
        redaction: 'support projections expose only data necessary for the purpose and preserve field-level redaction',
        secret_handling: 'passwords, tokens, recovery codes, private keys and reusable signed URLs are never revealed or logged',
        export_download_policy: 'bulk export/download/clipboard paths have explicit policy and audit coverage'
      },
      audit: {
        lifecycle_events: 'request/approve/deny/issue/renew/revoke/expire/impersonate/view/export/mutate/break-glass/job events are recorded',
        attribution: 'audit preserves operator, subject, tenant, grant, purpose, action, target, result and correlation identity',
        customer_visibility: 'customer consent, notification and access-history behavior is explicitly defined per support mode',
        anomaly_detection: 'security monitoring can identify unusual grants, cross-tenant activity, exports and override patterns'
      },
      recovery: {
        revocation_convergence: 'policy/employment/customer-consent revocation converges across tokens, tabs, caches, realtime and delegated sessions',
        queued_work_policy: 'product explicitly decides whether queued work cancels, pauses or may finish after grant revocation',
        legacy_bypass_removal: 'legacy ambient admin endpoints receive an owner and removal trigger so the scoped path is not bypassable forever'
      },
      observability: {
        grant_metrics: 'measure requests, approvals, denials, active duration, expiry and revocation without sensitive payloads',
        high_risk_activity: 'measure break-glass, impersonation, sensitive views/exports and privileged mutations',
        stale_access_detection: 'measure stale grants/sessions/jobs rejected after policy or employment changes',
        redaction_policy: 'logs and traces exclude customer secrets and unnecessary personal data'
      },
      compatibility: {
        legacy_admin_path: 'old ambient admin tools coexist only through an explicit migration window with equivalent or stronger audit controls',
        mixed_version_behavior: 'old/new consoles and APIs preserve grant identity and deny unsupported privileged capabilities',
        rollback_security_effects: 'software rollback does not resurrect revoked grants or undo completed privileged/customer mutations'
      },
      tests: {
        scenarios: [
          'missing-purpose', 'step-up-required', 'expired-grant-reuse', 'cross-tenant-scope',
          'readonly-mutation-denied', 'impersonation-attribution', 'requester-approver-separation',
          'break-glass-audited', 'queued-work-after-revocation', 'duplicate-high-risk-retry',
          'sensitive-export-scope', 'operator-revoked-active-session', 'legacy-admin-bypass'
        ],
        oracle: 'operator identity, subject scope, purpose, approval, effect authority, revocation and audit/customer evidence agree on the same privileged action'
      }
    }), 'utf8');

    const valid = runPython(gate, [validPath, '--json']);
    assert.ok(valid);
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
    assert.equal(JSON.parse(valid.stdout).gate_passed, true);

    const invalidPath = path.join(dir, 'invalid.json');
    await fs.writeFile(invalidPath, JSON.stringify({
      schema: 'veteran-privileged-operator-support-v1',
      product: { operator_outcome: '', privileged_modes: [], visible_states: true },
      authority: {}, entry: {}, scope: {}, approval: {}, session: {}, actions: {}, privacy: {}, audit: {}, recovery: {}, observability: {}, compatibility: {},
      tests: { scenarios: ['missing-purpose'], oracle: false }
    }), 'utf8');

    const invalid = runPython(gate, [invalidPath, '--json']);
    assert.ok(invalid);
    assert.notEqual(invalid.status, 0);
    const payload = JSON.parse(invalid.stdout);
    assert.equal(payload.gate_passed, false);
    const codes = new Set(payload.blockers.map((item) => item.code));
    for (const code of [
      'PRODUCT_FIELD_REQUIRED', 'PRIVILEGED_MODES_REQUIRED', 'AUTHORITY_FIELD_REQUIRED',
      'ENTRY_FIELD_REQUIRED', 'SCOPE_FIELD_REQUIRED', 'APPROVAL_FIELD_REQUIRED',
      'SESSION_FIELD_REQUIRED', 'ACTIONS_FIELD_REQUIRED', 'PRIVACY_FIELD_REQUIRED',
      'AUDIT_FIELD_REQUIRED', 'RECOVERY_FIELD_REQUIRED', 'OBSERVABILITY_FIELD_REQUIRED',
      'COMPATIBILITY_FIELD_REQUIRED', 'TEST_SCENARIOS_INCOMPLETE', 'TESTS_FIELD_REQUIRED'
    ]) assert.ok(codes.has(code), `expected blocker ${code}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
