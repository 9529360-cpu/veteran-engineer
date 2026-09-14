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
const autonomousReference = path.join(skillRoot, 'references', 'autonomous-repository-engineering.md');
const stewardshipReference = path.join(skillRoot, 'references', 'proactive-product-stewardship.md');
const gate = path.join(skillRoot, 'scripts', 'product_stewardship_gate.py');

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

test('broad repository ownership explicitly includes proactive product and UI stewardship', async (t) => {
  if (!(await exists(autonomousReference))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  assert.equal(await exists(stewardshipReference), true, 'proactive stewardship reference must exist');
  assert.equal(await exists(gate), true, 'product stewardship gate must exist');

  const autonomous = await fs.readFile(autonomousReference, 'utf8');
  const stewardship = await fs.readFile(stewardshipReference, 'utf8');

  assert.match(autonomous, /broad product ownership/i);
  assert.match(autonomous, /product-quality sweep/i);
  assert.match(autonomous, /references\/proactive-product-stewardship\.md/);
  assert.match(autonomous, /visual hierarchy/i);
  assert.match(autonomous, /subjective taste/i);

  assert.match(stewardship, /rendered experience is part of the owned system/i);
  assert.match(stewardship, /Visual hierarchy/);
  assert.match(stewardship, /Responsive behavior/);
  assert.match(stewardship, /Accessibility/);
  assert.match(stewardship, /Content and terminology/);
  assert.match(stewardship, /Do not replace a coherent visual language for fashion or personal taste alone/);
});

test('product stewardship gate accepts an evidence-backed UI improvement sweep', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-product-stewardship-'));
  try {
    const manifest = path.join(dir, 'valid.json');
    await fs.writeFile(manifest, JSON.stringify({
      product_goal: 'Make the active dashboard easier to understand and operate without changing product policy.',
      authorization_scope: 'Broad repository-local product improvement; ordinary reversible UI and code changes are authorized.',
      scope_boundary: 'Preserve billing, permissions, brand identity, and production release policy.',
      surfaces: [
        {
          id: 'dashboard',
          kind: 'web-ui',
          user_goal: 'Understand current project health and choose the next action.',
          evidence: 'Rendered route shows equal visual weight for primary and secondary actions and wraps poorly at tablet width.',
          checks: {
            visual_hierarchy: 'Primary action competes with four secondary actions.',
            interaction_states: 'Loading, empty, and error states exist but error recovery is visually weak.',
            responsive: 'Action row wraps into two uneven lines at representative tablet width.',
            accessibility: 'Keyboard order is coherent and visible focus is present.',
            copy_content: 'Two action labels use implementation terminology rather than user outcomes.',
            design_consistency: 'Existing button and spacing tokens can fix the issue without a new component system.'
          }
        }
      ],
      candidates: [
        {
          id: 'dashboard-action-hierarchy',
          category: 'experience',
          evidence: 'Rendered hierarchy and tablet layout make the primary action hard to identify.',
          user_impact: 'Users must scan several equal-weight actions before finding the intended next step.',
          action: 'fix',
          reason: 'High-frequency surface, clear before/after criterion, small reversible change.'
        },
        {
          id: 'replace-component-library',
          category: 'design-system',
          evidence: 'Current component library is coherent and already owns the needed tokens.',
          user_impact: 'No demonstrated user benefit.',
          action: 'no-change',
          reason: 'A library replacement would be taste-driven churn.'
        }
      ],
      prioritization_basis: 'Prioritize user friction and frequency first, then evidence confidence, reversibility, and implementation cost.',
      selection: {
        next_candidate_id: 'dashboard-action-hierarchy',
        why_now: 'It is the highest-impact evidence-backed issue on the active product surface.'
      },
      validation: {
        focused_oracle: 'Component and interaction tests prove primary/secondary semantics and state behavior.',
        visible_or_boundary_oracle: 'Render the real dashboard at desktop and tablet widths and verify hierarchy, wrapping, focus, loading, empty, and error states.'
      }
    }), 'utf8');

    const result = runPython(gate, [manifest, '--json']);
    assert.ok(result, 'Python is required to validate Product Stewardship manifests');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gate_passed, true);
    assert.deepEqual(payload.blockers, []);
    assert.equal(payload.counts.ui_surfaces, 1);
    assert.equal(payload.counts.fix_candidates, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('product stewardship gate permits an evidence-backed no-change decision', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-product-stewardship-nochange-'));
  try {
    const manifest = path.join(dir, 'nochange.json');
    await fs.writeFile(manifest, JSON.stringify({
      product_goal: 'Review the settings surface for the next safe improvement.',
      authorization_scope: 'Broad repository-local product improvement.',
      scope_boundary: 'No brand or product-policy changes.',
      surfaces: [
        {
          id: 'settings',
          kind: 'web-ui',
          user_goal: 'Understand and update account preferences.',
          evidence: 'Rendered settings surface is coherent across representative states and widths.',
          checks: {
            visual_hierarchy: 'Section hierarchy is clear.',
            interaction_states: 'Save, disabled, loading, success, and error states are explicit.',
            responsive: 'No clipping or unusable control widths at representative viewports.',
            accessibility: 'Labels, focus order, and keyboard operation are coherent.',
            copy_content: 'Labels match product terminology.',
            design_consistency: 'Shared settings components and tokens are used consistently.'
          }
        }
      ],
      candidates: [
        {
          id: 'settings-redesign',
          category: 'experience',
          evidence: 'No user-facing defect or inconsistent pattern was found.',
          user_impact: 'No demonstrated improvement from changing the current layout.',
          action: 'no-change',
          reason: 'Redesign would be subjective churn without product evidence.'
        }
      ],
      prioritization_basis: 'Prefer evidence-backed user impact over visual novelty.',
      selection: {
        next_candidate_id: 'none',
        why_now: 'No evidence-backed UI fix outranks other product work.',
        no_change_reason: 'The inspected surface already satisfies the current product contract.'
      },
      validation: {
        focused_oracle: 'Existing settings interaction tests remain green.',
        visible_or_boundary_oracle: 'Representative settings states were rendered and inspected.'
      }
    }), 'utf8');

    const result = runPython(gate, [manifest, '--json']);
    assert.ok(result);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gate_passed, true);
    assert.equal(payload.counts.fix_candidates, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('product stewardship gate fails closed on unsupported or unevidenced UI initiative', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-product-stewardship-invalid-'));
  try {
    const manifest = path.join(dir, 'invalid.json');
    await fs.writeFile(manifest, JSON.stringify({
      product_goal: 'Make it prettier.',
      authorization_scope: 'Broad product improvement.',
      scope_boundary: '',
      surfaces: [
        {
          id: 'home',
          kind: 'web-ui',
          user_goal: 'Find the main action.',
          evidence: '',
          checks: {
            visual_hierarchy: 'Maybe change the colors.'
          }
        }
      ],
      candidates: [
        {
          id: 'new-theme',
          category: 'design-system',
          evidence: '',
          user_impact: '',
          action: 'fix',
          reason: ''
        }
      ],
      prioritization_basis: '',
      selection: {
        next_candidate_id: 'missing',
        why_now: ''
      },
      validation: {}
    }), 'utf8');

    const result = runPython(gate, [manifest, '--json']);
    assert.ok(result);
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gate_passed, false);
    const codes = payload.blockers.map((item) => item.code);
    assert.ok(codes.includes('SWEEP_CONTEXT_INCOMPLETE'));
    assert.ok(codes.includes('SURFACE_EVIDENCE_INCOMPLETE'));
    assert.ok(codes.includes('UI_QUALITY_CHECK_INCOMPLETE'));
    assert.ok(codes.includes('CANDIDATE_EVIDENCE_INCOMPLETE'));
    assert.ok(codes.includes('PRIORITIZATION_BASIS_REQUIRED'));
    assert.ok(codes.includes('NEXT_CANDIDATE_INVALID'));
    assert.ok(codes.includes('SELECTION_RATIONALE_REQUIRED'));
    assert.ok(codes.includes('VALIDATION_ORACLE_REQUIRED'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
