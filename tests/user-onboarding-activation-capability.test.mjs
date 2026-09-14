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
const stewardship = path.join(skillRoot, 'references', 'proactive-product-stewardship.md');
const reference = path.join(skillRoot, 'references', 'user-onboarding-activation-product-engineering.md');
const gate = path.join(skillRoot, 'scripts', 'onboarding_activation_gate.py');

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function runPython(script, args) {
  for (const executable of ['python3', 'python']) {
    const result = spawnSync(executable, [script, ...args], {
      cwd: root,
      encoding: 'utf8'
    });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

const scenarios = [
  'first-time-user',
  'resume-after-exit',
  'duplicate-submit',
  'cross-device-resume',
  'cross-tenant-isolation',
  'invited-existing-workspace',
  'permission-role-change',
  'async-prerequisite-failure',
  'timeout-after-success',
  'existing-user-migration',
  'empty-vs-not-configured',
  'reentry-after-prerequisite-loss'
];

function validManifest() {
  return {
    experience: {
      target_population: 'new workspace administrators plus invited members who still lack the first successful project outcome',
      first_value: 'create or join a real workspace project and reach one successful project run',
      completion_semantics: 'completion is derived from authoritative workspace/project facts, not from clicking through the checklist',
      next_destination: 'the real project workspace with the next useful action visible'
    },
    scope: {
      subject_scope: 'workspace-scoped progress with user-scoped education where appropriate',
      eligibility_owner: 'server-side workspace/account eligibility derived from role, existing product state, and product policy',
      onboarding_version: 'workspace-activation-v2'
    },
    authority: {
      progress_owner: 'durable workspace setup facts plus derived user progress projection',
      completion_owner: 'project domain after the first successful real project run',
      activation_owner: 'server-side derived first-value fact emitted after authoritative success',
      client_projection: 'client renders current server progress and may store only presentation-only tooltip dismissal locally'
    },
    steps: {
      required_optional_policy: 'workspace/project prerequisites are required; education and optional customization remain optional',
      prerequisite_model: 'workspace membership -> project creation/access -> required configuration -> first successful run',
      alternate_paths: 'invited users can satisfy workspace setup from existing state and enter directly at their first unmet prerequisite',
      skip_dismiss_policy_source: 'product policy allows dismissing education but not bypassing required setup; no implicit skip policy is invented'
    },
    continuity: {
      stable_identity: 'workspace id + onboarding version, with user id only for user-specific education state',
      resume_reentry: 'resume at the first unmet authoritative prerequisite; completed facts are not replayed',
      cross_device: 'durable progress is reconstructed from server state on every device',
      cross_tenant: 'each workspace has independent onboarding state and no global user completion leaks across tenants'
    },
    recovery: {
      duplicate_retry: 'duplicate submits reuse idempotent domain operations or reconcile from authoritative state',
      timeout_after_success: 'client refetches/reconciles before offering the action again',
      async_prerequisite: 'accepted background work remains processing until authoritative completion and exposes retry/correction states',
      reset_safety: 'resetting guidance never deletes projects, integrations, or other real user data'
    },
    compatibility: {
      existing_user_migration: 'existing product state maps to satisfied prerequisites; users are not reset merely because the checklist is new',
      mixed_client_behavior: 'old clients ignore additive onboarding projection fields while server-owned setup truth remains compatible',
      role_permission_change: 'progress is recalculated against the new role; unauthorized steps become dependency guidance rather than dead actions'
    },
    measurement: {
      activation_event_or_fact: 'first successful project run derived from the authoritative project result',
      time_to_value: 'measure from eligibility/start to first authoritative successful project outcome',
      progress_events: 'emit only decision-useful step/resume/abandonment events with onboarding version and stable subject identity',
      guardrails: 'setup errors, support burden, permission failures, cancellations, and accessibility failures'
    },
    quality: {
      accessibility: 'keyboard, focus, progress semantics, error association, reduced motion, and screen-reader state updates are verified',
      localization: 'long translated copy, locale formatting, RTL where supported, and content versioning are handled',
      empty_state_semantics: 'distinguish not-configured, filtered-zero, loading, permission denied, failed load, and truly empty states'
    },
    lifecycle: {
      reentry_condition: 're-enter only when an authoritative prerequisite is lost or a new material capability has an explicit onboarding policy',
      cleanup_owner: 'product team owns removal of temporary tours, old progress versions, sample data, experiments, and compatibility paths',
      deprecated_version_cleanup: 'old progress versions are migrated or retired after supported client/version windows close'
    },
    tests: {
      scenarios,
      oracle: 'users reach first value exactly when authoritative product state proves it, and progress resumes safely without cross-tenant or duplicate side effects'
    }
  };
}

test('proactive product stewardship links the user onboarding and activation specialist', async (t) => {
  if (!(await exists(stewardship))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  assert.equal(await exists(reference), true, 'user onboarding specialist must exist');
  assert.equal(await exists(gate), true, 'onboarding activation gate must exist');

  const stewardshipText = await fs.readFile(stewardship, 'utf8');
  assert.match(stewardshipText, /user-onboarding-activation-product-engineering\.md/);
  assert.match(stewardshipText, /activation as an authoritative product outcome/i);

  const specialist = await fs.readFile(reference, 'utf8');
  assert.match(specialist, /Onboarding is not a slideshow, checklist, or one-time modal/);
  assert.match(specialist, /Start from first value, not tutorial completion/);
  assert.match(specialist, /Separate setup, education, and activation/);
  assert.match(specialist, /Empty states as onboarding surfaces/);
  assert.match(specialist, /Cross-device and cross-session continuity/);
  assert.match(specialist, /Existing-user and migration behavior/);
});

test('onboarding activation gate accepts a complete first-value contract', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-onboarding-activation-'));
  try {
    const manifest = path.join(dir, 'valid.json');
    await fs.writeFile(manifest, JSON.stringify(validManifest()), 'utf8');
    const result = runPython(gate, [manifest, '--json']);
    assert.ok(result);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gate_passed, true);
    assert.equal(payload.onboarding_version, 'workspace-activation-v2');
    assert.equal(payload.scenario_count, scenarios.length);
    assert.deepEqual(payload.blockers, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('onboarding activation gate fails closed when product truth, continuity, recovery, or migration are unspecified', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const doc = validManifest();
  doc.experience.first_value = '';
  doc.scope.subject_scope = '';
  doc.authority.activation_owner = false;
  doc.steps.skip_dismiss_policy_source = '';
  doc.continuity.cross_tenant = '';
  doc.recovery.timeout_after_success = '';
  doc.compatibility.existing_user_migration = '';
  doc.measurement.activation_event_or_fact = '';
  doc.quality.empty_state_semantics = '';
  doc.lifecycle.deprecated_version_cleanup = '';
  doc.tests.scenarios = ['first-time-user', 'resume-after-exit'];
  doc.tests.oracle = '';

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-onboarding-invalid-'));
  try {
    const manifest = path.join(dir, 'invalid.json');
    await fs.writeFile(manifest, JSON.stringify(doc), 'utf8');
    const result = runPython(gate, [manifest, '--json']);
    assert.ok(result);
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gate_passed, false);
    const codes = payload.blockers.map((item) => item.code);
    assert.ok(codes.includes('FIELD_REQUIRED'));
    assert.ok(codes.includes('REQUIRED_SCENARIOS_MISSING'));
    assert.ok(codes.includes('TEST_ORACLE_REQUIRED'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('onboarding activation gate rejects malformed section types instead of coercing them', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-onboarding-types-'));
  try {
    const manifest = path.join(dir, 'types.json');
    await fs.writeFile(manifest, JSON.stringify({
      experience: true,
      scope: [],
      authority: 'client',
      steps: null,
      continuity: 1,
      recovery: false,
      compatibility: [],
      measurement: {},
      quality: 'good',
      lifecycle: [],
      tests: { scenarios: [true, 'first-time-user'], oracle: 9 }
    }), 'utf8');
    const result = runPython(gate, [manifest, '--json']);
    assert.ok(result);
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gate_passed, false);
    const codes = payload.blockers.map((item) => item.code);
    assert.ok(codes.includes('SECTION_OBJECT_REQUIRED'));
    assert.ok(codes.includes('TEST_SCENARIOS_REQUIRED'));
    assert.ok(codes.includes('REQUIRED_SCENARIOS_MISSING'));
    assert.ok(codes.includes('TEST_ORACLE_REQUIRED'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
