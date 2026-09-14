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
const reference = path.join(skillRoot, 'references', 'visual-ui-quality-assurance-product-engineering.md');
const gate = path.join(skillRoot, 'scripts', 'visual_quality_gate.py');

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

function validManifest() {
  return {
    surface: {
      id: 'project-dashboard',
      platform: 'web',
      user_goal: 'Understand project status and choose the next action without scanning competing controls.',
      source_build: 'candidate-sha-123',
      design_system_or_baseline: 'existing dashboard shell, spacing tokens, button hierarchy, and status patterns'
    },
    evidence: {
      rendered: true,
      visual_regression: false,
      data_or_fixture: 'representative project fixture with normal, empty, long-name, and error data available',
      render_tool_or_boundary: 'real dashboard route in browser with authenticated fixture session',
      baseline: 'before evidence shows equal-weight actions and compact-width wrapping',
      result: 'after evidence shows one clear primary action, stable wrapping, and preserved product states'
    },
    coverage: {
      viewports: ['desktop', 'compact'],
      states: ['normal', 'error'],
      content_cases: ['typical', 'long-content'],
      input_modes: ['pointer', 'keyboard']
    },
    matrix: [
      {
        viewport: 'desktop',
        state: 'normal',
        content_case: 'typical',
        input_mode: 'pointer',
        evidence: 'rendered desktop populated state after the hierarchy change',
        finding: 'primary action is dominant, cards align to the spacing rhythm, and no unexpected overflow is visible',
        result: 'pass'
      },
      {
        viewport: 'compact',
        state: 'error',
        content_case: 'long-content',
        input_mode: 'keyboard',
        evidence: 'rendered compact error state with long project name and visible keyboard focus',
        finding: 'action row reflows without clipping, error recovery stays visible, and focus follows task order',
        result: 'pass'
      }
    ],
    acceptance: {
      visual_hierarchy: 'page context and one primary action are immediately legible; destructive/secondary actions are de-emphasized',
      layout_density: 'spacing, alignment, whitespace, and card density remain coherent under typical and long content',
      typography_color: 'heading/body/status roles are consistent with product tokens and preserve contrast',
      component_consistency: 'existing buttons, cards, status and spacing tokens are reused instead of one-off primitives',
      interaction_feedback: 'hover/focus/loading/error feedback does not shift or hide the primary workflow',
      responsive_behavior: 'compact layout reflows without clipped labels, hidden primary action, or accidental horizontal page scroll',
      accessibility_presentation: 'visible focus, non-color status cues, readable errors, and visual/task order remain aligned',
      copy_content: 'labels and error recovery use product language rather than implementation terminology'
    },
    regression: {
      focused_oracle: 'component and interaction tests preserve action semantics and error recovery',
      visible_oracle: 'rendered desktop and compact evidence satisfy the declared matrix and acceptance rules',
      real_boundary_oracle: 'the real route remains wired to authenticated project data and server error behavior'
    },
    completion_claim: 'rendered-validated',
    limitations: 'visual regression baselines are not yet automated; this claim is rendered validation only'
  };
}

test('proactive stewardship links a dedicated visual UI quality specialist', async (t) => {
  if (!(await exists(stewardship))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  assert.equal(await exists(reference), true, 'visual UI QA specialist must exist');
  assert.equal(await exists(gate), true, 'visual quality gate must exist');

  const stewardshipText = await fs.readFile(stewardship, 'utf8');
  assert.match(stewardshipText, /visual-ui-quality-assurance-product-engineering\.md/);
  assert.match(stewardshipText, /scripts\/visual_quality_gate\.py/);

  const specialist = await fs.readFile(reference, 'utf8');
  assert.match(specialist, /technically work but are confusing, brittle, inconsistent, or visibly unfinished/);
  assert.match(specialist, /Content pressure is part of visual correctness/);
  assert.match(specialist, /Viewport and responsive matrix/);
  assert.match(specialist, /State matrix/);
  assert.match(specialist, /Visual regression automation/);
  assert.match(specialist, /A pixel diff is evidence, not the product contract/);
});

test('visual quality gate accepts a rendered evidence matrix with explicit coverage', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-visual-quality-'));
  try {
    const manifest = path.join(dir, 'valid.json');
    await fs.writeFile(manifest, JSON.stringify(validManifest()), 'utf8');
    const result = runPython(gate, [manifest, '--json']);
    assert.ok(result);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gate_passed, true);
    assert.equal(payload.rendered, true);
    assert.equal(payload.matrix_cases, 2);
    assert.equal(payload.completion_claim, 'rendered-validated');
    assert.deepEqual(payload.blockers, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('visual quality gate permits lower-boundary work when rendering is unavailable but caps the completion claim', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const doc = validManifest();
  doc.evidence.rendered = false;
  doc.evidence.baseline = '';
  doc.evidence.result = '';
  doc.evidence.limitation = 'browser execution is unavailable in the current environment';
  doc.completion_claim = 'focused-validated';
  doc.regression.visible_oracle = 'rendered verification remains pending and is not claimed';

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-visual-quality-lower-'));
  try {
    const manifest = path.join(dir, 'lower.json');
    await fs.writeFile(manifest, JSON.stringify(doc), 'utf8');
    const result = runPython(gate, [manifest, '--json']);
    assert.ok(result);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gate_passed, true);
    assert.equal(payload.rendered, false);
    assert.equal(payload.completion_claim, 'focused-validated');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('visual quality gate fails closed on unevidenced coverage, unresolved visual failures, and overclaiming', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const doc = validManifest();
  doc.evidence.rendered = false;
  doc.evidence.limitation = '';
  doc.coverage.viewports.push('medium');
  doc.matrix[1].result = 'fail';
  doc.matrix[1].finding = '';
  doc.acceptance.responsive_behavior = '';
  doc.regression.visible_oracle = '';
  doc.completion_claim = 'rendered-validated';
  doc.limitations = '';

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-visual-quality-invalid-'));
  try {
    const manifest = path.join(dir, 'invalid.json');
    await fs.writeFile(manifest, JSON.stringify(doc), 'utf8');
    const result = runPython(gate, [manifest, '--json']);
    assert.ok(result);
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gate_passed, false);
    const codes = payload.blockers.map((item) => item.code);
    assert.ok(codes.includes('RENDER_LIMITATION_REQUIRED'));
    assert.ok(codes.includes('MATRIX_EVIDENCE_REQUIRED'));
    assert.ok(codes.includes('UNRESOLVED_VISUAL_FAILURE'));
    assert.ok(codes.includes('COVERAGE_NOT_EVIDENCED'));
    assert.ok(codes.includes('ACCEPTANCE_FIELD_REQUIRED'));
    assert.ok(codes.includes('REGRESSION_ORACLE_REQUIRED'));
    assert.ok(codes.includes('RENDERED_CLAIM_UNPROVEN'));
    assert.ok(codes.includes('LIMITATIONS_REQUIRED'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('visual quality gate requires a reviewed baseline before claiming visual regression validation', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const doc = validManifest();
  doc.evidence.visual_regression = true;
  doc.evidence.baseline_review = '';
  doc.completion_claim = 'visual-regression-validated';

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-visual-quality-baseline-'));
  try {
    const manifest = path.join(dir, 'baseline.json');
    await fs.writeFile(manifest, JSON.stringify(doc), 'utf8');
    const result = runPython(gate, [manifest, '--json']);
    assert.ok(result);
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gate_passed, false);
    assert.ok(payload.blockers.some((item) => item.code === 'BASELINE_REVIEW_REQUIRED'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
