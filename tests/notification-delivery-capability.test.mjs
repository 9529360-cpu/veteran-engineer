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
const gate = path.join(skillRoot, 'scripts', 'notification_delivery_gate.py');
const reference = path.join(skillRoot, 'references', 'notification-delivery-product-engineering.md');

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

test('engineering context router treats notification delivery as a first-class product surface', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill router is not present in this isolated gate fixture');
    return;
  }
  assert.equal(await exists(reference), true, 'Notification Delivery Product Engineering reference must exist when routed');

  const direct = runPython(router, [
    '--signals',
    'notification-delivery,email-notification,sms-notification,push-notification,in-app-notification,notification-preferences,notification-scheduling,notification-template,notification-dedupe,delivery-receipts,webhook-delivery,notification-fanout',
    '--max', '16',
    '--json'
  ]);
  assert.ok(direct);
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  const payload = JSON.parse(direct.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const refs = payload.references.map((entry) => entry.path);
  for (const expected of [
    'references/notification-delivery-product-engineering.md',
    'references/async-edge-job-patterns.md',
    'references/mobile-product-engineering.md',
    'references/frontend-product-patterns.md',
    'references/privacy-data-lifecycle-engineering.md',
    'references/temporal-debugging-state-transitions.md',
    'references/globalization-product-engineering.md',
    'references/dependency-outcome-degradation.md',
    'references/api-backend-patterns.md',
    'references/security-multitenancy-patterns.md',
    'references/performance-scale-patterns.md'
  ]) assert.ok(refs.includes(expected), `expected route ${expected}`);

  const aliases = runPython(router, [
    '--signals',
    'notification,notifications,transactional-email,email-delivery,text-message-notification,sms-delivery,mobile-push,push-message,inapp-notification,notification-settings,notification-schedule,notification-templates,notification-deduplication,delivery-status,outbound-webhook,notification-broadcast',
    '--max', '16',
    '--json'
  ]);
  assert.ok(aliases);
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  const aliasPayload = JSON.parse(aliases.stdout);
  assert.deepEqual(aliasPayload.unmatched_signals, []);
  assert.deepEqual(aliasPayload.signals, [
    'notification-delivery', 'notification-delivery', 'email-notification', 'email-notification',
    'sms-notification', 'sms-notification', 'push-notification', 'push-notification',
    'in-app-notification', 'notification-preferences', 'notification-scheduling', 'notification-template',
    'notification-dedupe', 'delivery-receipts', 'webhook-delivery', 'notification-fanout'
  ]);

  const ambiguous = runPython(router, ['--signals', 'email,sms,push,message,webhook,template,broadcast', '--json']);
  assert.ok(ambiguous);
  assert.equal(ambiguous.status, 0, ambiguous.stderr || ambiguous.stdout);
  assert.deepEqual(JSON.parse(ambiguous.stdout).unmatched_signals, ['email', 'sms', 'push', 'message', 'webhook', 'template', 'broadcast']);
});

test('notification delivery gate fails closed on incomplete authority and delivery contracts', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }
  assert.equal(await exists(reference), true, 'Notification Delivery Product Engineering reference must exist with the gate');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-notification-delivery-'));
  try {
    const validPath = path.join(dir, 'valid.json');
    await fs.writeFile(validPath, JSON.stringify({
      experience: {
        user_outcome: 'Users and authorized external endpoints receive timely, deduplicated notifications with truthful delivery state and recoverable failures.',
        purpose: 'transactional workspace events, reminders and integration notifications',
        notification_classes: ['in-app', 'mobile-push', 'email', 'sms', 'outbound-webhook'],
        visible_states: 'scheduled/suppressed/attempting/accepted/delivered-or-visible/failed/expired/reconciling are distinct when action differs'
      },
      authority: {
        trigger_owner: 'domain event owner decides whether the business transition warrants one logical notification',
        recipient_owner: 'trusted service resolves tenant/user/device/address/endpoint from authoritative account and integration state',
        preference_policy_owner: 'notification class and channel policy plus current user/integration preference decide eligibility',
        send_time_freshness: 'workers re-check current recipient, preference, suppression and resource authority before irreversible provider handoff'
      },
      identity: {
        logical_intent: 'stable tenant+recipient+class+business-object-version identity owns one logical outcome across retries',
        dedupe_key: 'duplicate triggers converge on the same logical intent and do not create duplicate sends',
        attempt_identity: 'each provider/channel attempt has a unique id bound to the logical intent and provider receipt',
        version_or_generation: 'queued work binds trigger/template/recipient generation so stale attempts fail closed after supersession'
      },
      rendering: {
        template_version: 'intent binds a compatible versioned template and validates all required variables before send',
        locale_fallback: 'recipient locale uses the globalization fallback authority and queued old intents remain renderable',
        action_target: 'deep links and webhook targets are validated and re-authorized at consumption rather than trusted from payload',
        sensitive_content_policy: 'lock-screen, subject, SMS, logs and provider metadata expose only approved bounded content'
      },
      scheduling: {
        schedule_authority: 'durable schedule owns earliest/latest send time and stable notification identity',
        timezone_quiet_hours: 'local-time reminders use explicit timezone/DST and approved quiet-hours behavior',
        expiry_staleness: 'stale reminders expire instead of being sent after their business event is no longer useful',
        cancel_reschedule: 'cancellation/reschedule increments generation and queued stale work cannot send the superseded intent'
      },
      delivery: {
        channel_policy: 'channel selection/fallback follows notification class, recipient capability, priority and current preference',
        provider_handoff: 'provider call records attempt identity and normalized accepted/transient/permanent/unknown outcome',
        retry_unknown_outcome: 'timeout-after-acceptance reconciles the existing attempt or provider id before another logical send',
        rate_limit_backpressure: 'bounded retry/backoff/jitter, provider quotas and priority queues prevent retry storms and starvation',
        failover_or_fallback: 'provider failover creates another attempt under the same logical intent and cannot bypass dedupe/preferences',
        endpoint_security: 'webhook endpoints/signatures and provider callbacks are authenticated, scoped, replay-bounded and secret-safe'
      },
      outcomes: {
        provider_receipts: 'duplicate/out-of-order callbacks bind attempt identity and cannot regress a newer terminal product state',
        permanent_destination_failure: 'invalid token/bounce/permanent endpoint failure suppresses only the affected destination and is observable',
        partial_fanout: 'audience snapshot and per-recipient outcome allow resume without resending members already completed',
        user_visible_completion: 'completion wording matches channel evidence: in-app visibility may be authoritative while provider acceptance is not human read proof'
      },
      tests: {
        scenarios: ['duplicate-trigger', 'unknown-provider-outcome', 'provider-throttle', 'permanent-destination-failure', 'preference-revoked-before-send', 'stale-scheduled-notification', 'partial-fanout', 'out-of-order-receipt', 'template-version-rollout', 'cross-tenant-recipient', 'provider-failover', 'account-device-switch'],
        oracle: 'logical intent, current eligibility, attempt/receipt state, user-visible projection and provider side effects agree after retry/replay/failure'
      },
      observability: {
        intent_attempt_correlation: 'trace business trigger to logical intent, attempt, provider receipt and user-visible projection using stable ids',
        provider_outcomes: 'measure acceptance, throttling, transient/permanent failures, invalid destinations, callback lag and unknown reconciliation',
        queue_suppression_health: 'measure queue age, schedule lateness, retry depth, suppression reasons, fanout progress and stale-generation rejection',
        redaction_policy: 'logs and evidence exclude raw tokens, webhook secrets, credentials, signed capabilities and sensitive message bodies'
      },
      compatibility: {
        mixed_version_behavior: 'old/new producers, workers, clients, event schemas and provider callbacks coexist through additive/versioned contracts',
        template_or_provider_migration: 'queued intents remain renderable and provider/token migrations preserve stable logical notification identity',
        rollback_external_effects: 'software rollback is separate from irreversible email/SMS/push/webhook effects already accepted externally'
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
      experience: { user_outcome: '', purpose: true, notification_classes: [], visible_states: '' },
      authority: {}, identity: {}, rendering: {}, scheduling: {}, delivery: {}, outcomes: {},
      tests: { scenarios: ['duplicate-trigger'], oracle: false },
      observability: {}, compatibility: {}
    }), 'utf8');

    const invalid = runPython(gate, [invalidPath, '--json']);
    assert.ok(invalid);
    assert.notEqual(invalid.status, 0);
    const invalidPayload = JSON.parse(invalid.stdout);
    assert.equal(invalidPayload.gate_passed, false);
    const codes = new Set(invalidPayload.blockers.map((item) => item.code));
    for (const code of [
      'EXPERIENCE_FIELD_REQUIRED', 'NOTIFICATION_CLASSES_REQUIRED', 'AUTHORITY_FIELD_REQUIRED',
      'IDENTITY_FIELD_REQUIRED', 'RENDERING_FIELD_REQUIRED', 'SCHEDULING_FIELD_REQUIRED',
      'DELIVERY_FIELD_REQUIRED', 'OUTCOMES_FIELD_REQUIRED', 'TEST_SCENARIOS_INCOMPLETE',
      'TESTS_FIELD_REQUIRED', 'OBSERVABILITY_FIELD_REQUIRED', 'COMPATIBILITY_FIELD_REQUIRED'
    ]) assert.ok(codes.has(code), `expected blocker ${code}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
