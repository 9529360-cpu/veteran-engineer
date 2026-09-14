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
const frontend = path.join(skillRoot, 'references', 'frontend-product-patterns.md');
const reference = path.join(skillRoot, 'references', 'design-system-consistency-product-engineering.md');
const gate = path.join(skillRoot, 'scripts', 'design_system_consistency_gate.py');

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
  'token-drift',
  'duplicate-primitive',
  'variant-semantic-drift',
  'shared-primitive-regression',
  'long-content-pressure',
  'responsive-layout',
  'keyboard-focus',
  'accessibility-semantics',
  'legacy-consumer-migration',
  'intentional-exception'
];

function validManifest() {
  return {
    scope: {
      product_surfaces: ['project-dashboard', 'settings', 'billing'],
      design_language_owner: 'the existing product token and shared primitive package',
      user_impact: 'comparable actions and states currently diverge across active product surfaces, increasing scan cost and error risk',
      change_class: 'shared semantic token and primitive consistency migration',
      non_goals: 'no rebrand, typography replacement, new theme mode, or unrelated page redesign'
    },
    inventory: {
      token_sources: 'semantic CSS variables and generated platform token map are the current token authorities',
      primitive_sources: 'shared button, input, status, dialog, card, and focus-ring primitives own reusable mechanics',
      product_component_sources: 'domain wrappers compose primitives with product policy and workflow state',
      legacy_or_one_off_surfaces: 'settings and billing still contain old action/status styles plus one duplicate dialog implementation'
    },
    authority: {
      token_owner: 'semantic token source controls visual roles; raw values are not a second authority',
      primitive_owner: 'shared primitive package owns reusable interaction and accessibility mechanics',
      product_wrapper_owner: 'domain components own permissions, mutations, copy, analytics, and product-specific recovery',
      exception_owner: 'the owning product surface documents intentional semantic exceptions and their reevaluation trigger'
    },
    semantics: {
      state_model: 'rest, focus, active, disabled, loading, validation error, permission denied, success, and terminal failure remain distinct when product semantics differ',
      variant_contract: 'primary, secondary, destructive, warning, selected, and compact names have one documented meaning across shared consumers',
      content_constraints: 'primitives tolerate long localized content, representative identifiers, zoom, and compact layouts without changing meaning',
      accessibility_contract: 'names, roles, keyboard behavior, focus, errors, status announcements, contrast, and non-color cues remain equivalent across visual variants'
    },
    consistency: {
      drift_evidence: 'repository usage plus rendered review shows duplicate destructive buttons, raw status colors, and two semantically equivalent dialogs',
      canonical_pattern: 'migrate repeated roles to existing semantic tokens and shared primitives before adding any new abstraction',
      intentional_exception_policy: 'exceptions require a product/task reason, named owner, and permanent-or-temporary lifecycle instead of a styling preference',
      duplicate_primitive_policy: 'merge duplicates only when semantics truly match; product-specific behavior stays in wrappers rather than broadening primitives'
    },
    migration: {
      adoption_sequence: 'stabilize canonical contract, migrate representative dashboard/settings consumers, validate, expand adoption, then remove old props/tokens/styles',
      mixed_old_new_behavior: 'temporary compatibility aliases preserve one semantic meaning while old and new consumers coexist',
      legacy_cleanup: 'legacy action/status styles and duplicate dialog are deleted after active consumers and supported version windows are clear',
      rollback_or_forward_repair: 'code changes are reversible before removal; independently distributed consumer/version drift uses compatible forward repair rather than assuming atomic rollback'
    },
    verification: {
      representative_surfaces: ['project-dashboard', 'settings'],
      viewport_state_content_boundary: 'desktop and compact layouts cover typical/long content plus normal, loading, error, permission, and destructive-confirmation states',
      accessibility_checks: 'keyboard/focus, accessible names, error association, status semantics, contrast, and non-color cues are verified on shared consumers',
      rendered_evidence: 'real integrated dashboard and settings routes are rendered before/after with representative product data',
      visual_quality_boundary: 'material visual claims use the visual UI quality evidence matrix; component demos are supplemental evidence only',
      regression_oracle: 'canonical shared semantics remain stable and representative consumers preserve visible task completion without legacy drift'
    },
    lifecycle: {
      versioning_or_change_communication: 'breaking package or variant changes use the repository distribution/versioning contract; atomic app-only changes do not invent a distributed protocol',
      deprecation_owner: 'shared UI maintainers own temporary aliases and product owners own remaining legacy consumers',
      removal_condition: 'remove old tokens, props, styles, and duplicate primitives after searches and representative product validation prove no supported active consumer remains'
    },
    tests: {
      scenarios,
      oracle: 'one canonical owner expresses each genuinely shared UI semantic while intentional exceptions remain explicit and representative product surfaces preserve behavior, accessibility, and visual coherence'
    }
  };
}

test('frontend design-system routing links a dedicated product-wide consistency specialist', async (t) => {
  if (!(await exists(frontend))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  assert.equal(await exists(reference), true, 'design-system consistency specialist must exist');
  assert.equal(await exists(gate), true, 'design-system consistency gate must exist');

  const frontendText = await fs.readFile(frontend, 'utf8');
  assert.match(frontendText, /design-system-consistency-product-engineering\.md/);
  assert.match(frontendText, /product-wide drift/i);

  const specialist = await fs.readFile(reference, 'utf8');
  assert.match(specialist, /First decide whether the defect is local or systemic/);
  assert.match(specialist, /Tokens are semantic roles, not a bag of values/);
  assert.match(specialist, /Primitive versus product wrapper ownership/);
  assert.match(specialist, /Migrate without a visual flag day/);
  assert.match(specialist, /Shared changes need fanout-shaped validation/);
  assert.match(specialist, /Treat exceptions as owned decisions/);
});

test('design-system consistency gate accepts an evidence-backed shared UI migration contract', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-design-system-'));
  try {
    const manifest = path.join(dir, 'valid.json');
    await fs.writeFile(manifest, JSON.stringify(validManifest()), 'utf8');
    const result = runPython(gate, [manifest, '--json']);
    assert.ok(result);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gate_passed, true);
    assert.equal(payload.surface_count, 3);
    assert.equal(payload.representative_surface_count, 2);
    assert.equal(payload.scenario_count, scenarios.length);
    assert.deepEqual(payload.blockers, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('design-system consistency gate fails closed when authority, drift, migration, verification, or cleanup are unspecified', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const doc = validManifest();
  doc.scope.product_surfaces = [];
  doc.scope.non_goals = '';
  doc.inventory.legacy_or_one_off_surfaces = '';
  doc.authority.primitive_owner = false;
  doc.semantics.variant_contract = '';
  doc.consistency.drift_evidence = '';
  doc.consistency.intentional_exception_policy = '';
  doc.migration.mixed_old_new_behavior = '';
  doc.verification.representative_surfaces = [];
  doc.verification.rendered_evidence = '';
  doc.verification.regression_oracle = '';
  doc.lifecycle.removal_condition = '';
  doc.tests.scenarios = ['token-drift', 'duplicate-primitive'];
  doc.tests.oracle = '';

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-design-system-invalid-'));
  try {
    const manifest = path.join(dir, 'invalid.json');
    await fs.writeFile(manifest, JSON.stringify(doc), 'utf8');
    const result = runPython(gate, [manifest, '--json']);
    assert.ok(result);
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gate_passed, false);
    const codes = payload.blockers.map((item) => item.code);
    assert.ok(codes.includes('STRING_LIST_REQUIRED'));
    assert.ok(codes.includes('FIELD_REQUIRED'));
    assert.ok(codes.includes('REQUIRED_SCENARIOS_MISSING'));
    assert.ok(codes.includes('TEST_ORACLE_REQUIRED'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('design-system consistency gate rejects representative surfaces outside the declared product scope', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const doc = validManifest();
  doc.verification.representative_surfaces = ['project-dashboard', 'unowned-admin-console'];

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-design-system-scope-'));
  try {
    const manifest = path.join(dir, 'scope.json');
    await fs.writeFile(manifest, JSON.stringify(doc), 'utf8');
    const result = runPython(gate, [manifest, '--json']);
    assert.ok(result);
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gate_passed, false);
    const blocker = payload.blockers.find((item) => item.code === 'REPRESENTATIVE_SURFACE_SCOPE_INVALID');
    assert.ok(blocker);
    assert.match(blocker.message, /unowned-admin-console/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('design-system consistency gate rejects malformed sections and scenario types instead of coercing them', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-design-system-types-'));
  try {
    const manifest = path.join(dir, 'types.json');
    await fs.writeFile(manifest, JSON.stringify({
      scope: true,
      inventory: [],
      authority: 'tokens',
      semantics: null,
      consistency: 1,
      migration: false,
      verification: { representative_surfaces: 'dashboard' },
      lifecycle: [],
      tests: { scenarios: [true, 'token-drift'], oracle: 9 }
    }), 'utf8');
    const result = runPython(gate, [manifest, '--json']);
    assert.ok(result);
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gate_passed, false);
    const codes = payload.blockers.map((item) => item.code);
    assert.ok(codes.includes('SECTION_OBJECT_REQUIRED'));
    assert.ok(codes.includes('STRING_LIST_REQUIRED'));
    assert.ok(codes.includes('TEST_SCENARIOS_REQUIRED'));
    assert.ok(codes.includes('REQUIRED_SCENARIOS_MISSING'));
    assert.ok(codes.includes('TEST_ORACLE_REQUIRED'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
