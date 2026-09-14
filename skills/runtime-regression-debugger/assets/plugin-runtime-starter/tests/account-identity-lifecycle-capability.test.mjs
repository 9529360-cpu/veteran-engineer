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
const gate = path.join(skillRoot, 'scripts', 'account_identity_lifecycle_gate.py');
const securityReference = path.join(skillRoot, 'references', 'security-multitenancy-patterns.md');
const reference = path.join(skillRoot, 'references', 'account-identity-lifecycle-product-engineering.md');

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

test('auth routing exposes the account identity lifecycle specialist owner', async (t) => {
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
  assert.match(security, /account-identity-lifecycle-product-engineering\.md/);
  assert.match(security, /Account and identity lifecycle/);
});

test('account identity lifecycle gate fails closed on incomplete credential and recovery contracts', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }
  assert.equal(await exists(reference), true);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-account-id-'));
  try {
    const validPath = path.join(dir, 'valid.json');
    await fs.writeFile(validPath, JSON.stringify({
      product: {
        user_outcome: 'A verified person can create, secure, recover, change and close exactly one intended account without stale access or recovery takeover.',
        account_model: 'one stable internal account identity may have multiple verified contacts and authentication factors/providers',
        credential_classes: ['password', 'passkey', 'totp', 'recovery-code', 'oidc-link'],
        visible_states: 'pending-verification/active/recovery-pending/locked/closing/closed remain distinct where security or recovery differs'
      },
      authority: {
        account_owner: 'internal account aggregate owns stable identity and terminal state',
        contact_verification_owner: 'verified contact authority owns email/phone verification generation and status',
        credential_owner: 'credential registry owns factors and their generations',
        session_owner: 'session service owns active sessions and token generations',
        recovery_owner: 'recovery state machine owns reset proof, generation and completion',
        identity_link_owner: 'link registry owns external-provider-to-internal-account bindings'
      },
      registration: {
        signup_identity: 'stable signup intent separates unverified contact from durable account identity',
        contact_verification: 'verification tokens are purpose/account/contact/generation bound with expiry and single-use semantics',
        duplicate_account: 'duplicate contacts or provider identities reconcile without silent account creation or merge',
        enumeration_resistance: 'public responses and rate limits avoid unnecessary account-existence disclosure',
        activation: 'activation requires current verification evidence and stale generations cannot replay'
      },
      credentials: {
        password_change: 'password change requires current proof/step-up and invalidates superseded credential generation',
        passkey_webauthn: 'passkeys bind RP/origin/account credential ids and have replacement/revocation semantics',
        mfa_enrollment: 'factor enrollment requires authenticated step-up and verifies the factor before it becomes recovery-capable',
        recovery_codes: 'recovery codes are one-way verified, single-use and regeneration revokes the prior set',
        credential_rotation: 'credential replacement defines session and recovery consequences'
      },
      recovery: {
        initiation: 'recovery intent has stable account-scoped generation with bounded rate/expiry and enumeration-safe initiation',
        proof: 'completion requires approved proof independent of attacker-controlled new destination',
        step_up: 'high-risk recovery uses approved additional proof where policy requires it',
        revocation_cooldown: 'new/replayed/replaced recovery generations and sensitive-change review/cooldown are explicit',
        post_recovery: 'successful recovery revokes or refreshes affected sessions/factors and uses independently trusted notification when policy requires'
      },
      linking: {
        provider_binding: 'external provider subject is bound to one internal account under issuer/client scope',
        reauthentication: 'link/unlink requires current account reauthentication or equivalent step-up',
        collision_merge: 'provider/contact collision refuses implicit account merge and enters explicit recovery/support policy',
        unlink_last_factor: 'unlink cannot strand the account without an approved factor/recovery path',
        tenant_scope: 'identity linking does not infer organization membership or cross-tenant authorization'
      },
      sessions: {
        generation: 'sessions/tokens carry account and credential/session generation sufficient to reject superseded state',
        device_visibility: 'relevant sessions/devices can be identified and revoked without exposing secrets',
        revocation: 'password/recovery/closure/security events define which sessions refresh or terminate',
        sensitive_reauth: 'credential/link/recovery/closure operations require fresh authentication appropriate to risk',
        token_rotation: 'refresh/token rotation prevents replay from extending superseded security state'
      },
      closure: {
        account_close: 'closure has explicit authorization, effective state and cancellation/recovery semantics if supported',
        membership_resource_handoff: 'organization memberships and user-owned resources use their own handoff/removal lifecycle',
        credential_provider_cleanup: 'credentials, provider links, recovery tokens and sessions are revoked/cleaned with retry/reconciliation',
        data_lifecycle: 'privacy export/retention/deletion rules delegate to privacy lifecycle authority with explicit completion boundary',
        final_signout: 'closed account cannot retain an active session or be resurrected by stale verification/recovery/provider callbacks'
      },
      tests: {
        scenarios: ['duplicate-signup', 'expired-verification', 'account-enumeration', 'mfa-enrollment-race', 'lost-primary-factor', 'recovery-token-replay', 'recovery-session-revocation', 'passkey-replacement', 'provider-link-collision', 'unlink-last-factor', 'stale-session-after-password-change', 'cross-account-recovery', 'account-closure-with-active-session', 'stale-verification-after-contact-change'],
        oracle: 'account/contact/credential/recovery/link/session authorities agree on the same internal identity and stale tokens or sessions cannot regain access'
      },
      observability: {
        identity_transition_correlation: 'correlate signup/verification/credential/link/recovery/session/closure transitions using secret-safe stable ids',
        recovery_risk: 'measure recovery retries/replay/lockout/collision outcomes without logging secrets',
        session_credential_drift: 'measure sessions rejected or refreshed due to credential/account generation changes',
        redaction_policy: 'logs exclude passwords, reset tokens, recovery codes, WebAuthn challenges, session tokens and unnecessary personal data'
      },
      compatibility: {
        mixed_version_behavior: 'old/new clients, token claims and credential schemas coexist through explicit versions/generations',
        credential_migration: 'password/passkey/MFA migrations preserve account identity and bounded old-factor acceptance/removal',
        identity_provider_migration: 'provider migration preserves internal identity while issuer/subject bindings reconcile explicitly',
        rollback_external_effects: 'software rollback does not undo emails sent, sessions revoked, provider links changed or credentials invalidated'
      }
    }), 'utf8');

    const valid = runPython(gate, [validPath, '--json']);
    assert.ok(valid);
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
    assert.equal(JSON.parse(valid.stdout).gate_passed, true);

    const invalidPath = path.join(dir, 'invalid.json');
    await fs.writeFile(invalidPath, JSON.stringify({
      product: { user_outcome: '', account_model: true, credential_classes: [], visible_states: '' },
      authority: {}, registration: {}, credentials: {}, recovery: {}, linking: {}, sessions: {}, closure: {},
      tests: { scenarios: ['duplicate-signup'], oracle: false }, observability: {}, compatibility: {}
    }), 'utf8');

    const invalid = runPython(gate, [invalidPath, '--json']);
    assert.ok(invalid);
    assert.notEqual(invalid.status, 0);
    const invalidPayload = JSON.parse(invalid.stdout);
    assert.equal(invalidPayload.gate_passed, false);
    const codes = new Set(invalidPayload.blockers.map((item) => item.code));
    for (const code of [
      'PRODUCT_FIELD_REQUIRED', 'CREDENTIAL_CLASSES_REQUIRED', 'AUTHORITY_FIELD_REQUIRED',
      'REGISTRATION_FIELD_REQUIRED', 'CREDENTIALS_FIELD_REQUIRED', 'RECOVERY_FIELD_REQUIRED',
      'LINKING_FIELD_REQUIRED', 'SESSIONS_FIELD_REQUIRED', 'CLOSURE_FIELD_REQUIRED',
      'TEST_SCENARIOS_INCOMPLETE', 'TESTS_FIELD_REQUIRED', 'OBSERVABILITY_FIELD_REQUIRED',
      'COMPATIBILITY_FIELD_REQUIRED'
    ]) assert.ok(codes.has(code), `expected blocker ${code}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
