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
const gate = path.join(skillRoot, 'scripts', 'progressive_delivery_gate.py');
const reference = path.join(skillRoot, 'references', 'feature-flag-progressive-delivery-product-engineering.md');
const operability = path.join(skillRoot, 'references', 'operability-control-plane-contract.md');

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
  'stable-assignment',
  'cross-tenant',
  'stale-config',
  'kill-switch',
  'old-client-new-server',
  'server-client-divergence',
  'percentage-ramp',
  'flag-dependency',
  'full-rollout-cleanup'
];

function validManifest() {
  return {
    flag: {
      id: 'project-search-v2',
      purpose: 'progressively expose the new search implementation while preserving a fast stop path',
      owner: 'search product runtime control plane',
      value_contract: 'boolean enabled/disabled with versioned evaluation rules',
      default_behavior: 'serve the existing search implementation when no valid current decision is available'
    },
    evaluation: {
      authority: 'server-side workspace-scoped evaluation before selecting the search implementation',
      subject_identity: 'stable workspace id',
      tenant_scope: 'workspace id is resolved from authenticated tenant context, never caller-supplied flag scope',
      stickiness: 'a workspace remains in the same cohort for one rollout generation',
      version_or_generation: 'flag definition generation plus application build identity',
      stale_config_behavior: 'use bounded last-known-good config, then fall back to the old compatible implementation'
    },
    rollout: {
      stages: ['off', 'internal', 'canary', '5-percent', '25-percent', '100-percent', 'cleanup'],
      advance_criteria: 'advance only after reliability and product guardrails pass for the current cohort',
      pause_criteria: 'pause on guardrail uncertainty, stale control-plane data, or unexplained cohort skew',
      rollback_criteria: 'reverse exposure when error or latency guardrails exceed the approved bound',
      kill_switch: 'trusted server-side override forces the existing implementation for new requests',
      kill_propagation: 'all online evaluators converge within the bounded config propagation window and expose propagation health'
    },
    compatibility: {
      old_client_new_server: 'old clients continue using the stable API contract when the server selects either implementation',
      new_client_old_server: 'new clients tolerate absence of the optional rollout metadata and use the old contract',
      mixed_worker_config: 'workers capture or re-evaluate one explicit rollout generation according to job semantics',
      data_schema_overlap: 'both implementations read/write the additive compatible schema until cleanup'
    },
    dependencies: {
      precedence: 'global kill override > tenant support override > rollout cohort rule > default',
      invalid_or_missing_config: 'reject invalid config and retain bounded last-known-good or compatible default behavior'
    },
    lifecycle: {
      full_adoption_condition: '100% exposure remains healthy through the required observation window with no old-version blocker',
      removal_condition: 'remove the flag after old clients/workers no longer require the compatibility path and rollback no longer depends on it',
      cleanup_owner: 'search product team owns flag, branch, override, telemetry, and compatibility cleanup'
    },
    observability: {
      decision_correlation: 'correlate flag id/generation, workspace cohort, effective value, evaluator build, and request outcome',
      distribution_health: 'compare effective value distribution with configured cohorts and alert on unexplained skew',
      staleness_health: 'measure evaluator config age and last successful control-plane refresh',
      override_audit: 'audit override creator, exact scope, creation time, expiry, and removal'
    },
    tests: {
      scenarios,
      oracle: 'the effective runtime behavior matches the authoritative flag decision while preserving isolation, compatibility, stop, and cleanup semantics'
    }
  };
}

test('feature rollout routes through analytics and operability, which links the progressive delivery specialist', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }
  assert.equal(await exists(reference), true, 'progressive delivery reference must exist');
  assert.equal(await exists(gate), true, 'progressive delivery gate must exist');

  const routed = runPython(router, ['--signals', 'feature-rollout', '--max', '7', '--json']);
  assert.ok(routed, 'Python is required to validate the Skill context router');
  assert.equal(routed.status, 0, routed.stderr || routed.stdout);
  const payload = JSON.parse(routed.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const paths = payload.references.map((entry) => entry.path);
  assert.ok(paths.includes('references/product-analytics-experimentation.md'));
  assert.ok(paths.includes('references/operability-control-plane-contract.md'));

  const operabilityText = await fs.readFile(operability, 'utf8');
  assert.match(operabilityText, /feature-flag-progressive-delivery-product-engineering\.md/);
  assert.match(operabilityText, /Analytics\/experiment assignment is evidence about exposure/);

  const specialist = await fs.readFile(reference, 'utf8');
  assert.match(specialist, /A feature flag is production control-plane state, not a harmless boolean/);
  assert.match(specialist, /Stable subject identity and stickiness/);
  assert.match(specialist, /Kill switch semantics/);
  assert.match(specialist, /Mixed-version clients and services/);
  assert.match(specialist, /Lifecycle and deletion/);
});

test('progressive delivery gate accepts a complete runtime flag contract', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-progressive-delivery-'));
  try {
    const manifest = path.join(dir, 'valid.json');
    await fs.writeFile(manifest, JSON.stringify(validManifest()), 'utf8');
    const result = runPython(gate, [manifest, '--json']);
    assert.ok(result);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gate_passed, true);
    assert.deepEqual(payload.blockers, []);
    assert.equal(payload.flag_id, 'project-search-v2');
    assert.equal(payload.stage_count, 7);
    assert.equal(payload.scenario_count, scenarios.length);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('progressive delivery gate fails closed on missing authorities, compatibility, lifecycle, and scenarios', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const doc = validManifest();
  doc.flag.owner = '';
  doc.evaluation.authority = false;
  doc.evaluation.tenant_scope = '';
  doc.rollout.stages = [];
  doc.rollout.kill_propagation = '';
  doc.compatibility.old_client_new_server = '';
  doc.dependencies.invalid_or_missing_config = '';
  doc.lifecycle.removal_condition = '';
  doc.observability.staleness_health = '';
  doc.tests.scenarios = ['stable-assignment', 'kill-switch'];
  doc.tests.oracle = '';

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-progressive-delivery-invalid-'));
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
    assert.ok(codes.includes('ROLLOUT_STAGES_REQUIRED'));
    assert.ok(codes.includes('REQUIRED_SCENARIOS_MISSING'));
    assert.ok(codes.includes('TEST_ORACLE_REQUIRED'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('progressive delivery gate rejects malformed sections instead of coercing them', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-progressive-delivery-types-'));
  try {
    const manifest = path.join(dir, 'types.json');
    await fs.writeFile(manifest, JSON.stringify({
      flag: true,
      evaluation: [],
      rollout: '10-percent',
      compatibility: null,
      dependencies: 1,
      lifecycle: false,
      observability: [],
      tests: { scenarios: [true, 'kill-switch'], oracle: 7 }
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
