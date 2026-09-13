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
const gate = path.join(skillRoot, 'scripts', 'accessibility_product_gate.py');
const reference = path.join(skillRoot, 'references', 'accessibility-product-engineering.md');

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

test('engineering context router treats accessibility as a first-class cross-client product surface', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill router is not present in this isolated gate fixture');
    return;
  }
  assert.equal(await exists(reference), true, 'Accessibility Product Engineering reference must exist when routed');

  const direct = runPython(router, [
    '--signals',
    'accessibility,screen-reader,keyboard-navigation,focus-management,reduced-motion,high-contrast,assistive-technology,accessible-form,aria,mobile-accessibility,desktop-accessibility',
    '--max', '12',
    '--json'
  ]);
  assert.ok(direct);
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  const payload = JSON.parse(direct.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const refs = payload.references.map((entry) => entry.path);
  for (const expected of [
    'references/accessibility-product-engineering.md',
    'references/full-stack-product-engineering.md',
    'references/frontend-product-patterns.md',
    'references/mobile-product-engineering.md',
    'references/host-shell-platform-patterns.md'
  ]) assert.ok(refs.includes(expected), `expected route ${expected}`);

  const aliases = runPython(router, [
    '--signals',
    'a11y,screenreader,keyboard-accessibility,focus-trap,prefers-reduced-motion,forced-colors,assistive-tech,form-accessibility,wai-aria,ios-accessibility,android-accessibility,electron-accessibility',
    '--max', '12',
    '--json'
  ]);
  assert.ok(aliases);
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  const aliasPayload = JSON.parse(aliases.stdout);
  assert.deepEqual(aliasPayload.unmatched_signals, []);
  assert.deepEqual(aliasPayload.signals, [
    'accessibility', 'screen-reader', 'keyboard-navigation', 'focus-management',
    'reduced-motion', 'high-contrast', 'assistive-technology', 'accessible-form',
    'aria', 'mobile-accessibility', 'mobile-accessibility', 'desktop-accessibility'
  ]);

  const ambiguous = runPython(router, ['--signals', 'keyboard,focus,contrast,motion,label,button', '--json']);
  assert.ok(ambiguous);
  assert.equal(ambiguous.status, 0, ambiguous.stderr || ambiguous.stdout);
  assert.deepEqual(JSON.parse(ambiguous.stdout).unmatched_signals, ['keyboard', 'focus', 'contrast', 'motion', 'label', 'button']);
});

test('accessibility product gate fails closed on incomplete modality contracts', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }
  assert.equal(await exists(reference), true, 'Accessibility Product Engineering reference must exist with the gate');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-a11y-'));
  try {
    const validPath = path.join(dir, 'valid.json');
    await fs.writeFile(validPath, JSON.stringify({
      experience: {
        user_outcome: 'Users can perceive, navigate, operate, understand, and recover from the workflow across supported input and assistive modes.',
        surfaces: ['web', 'mobile'],
        assistive_modes: ['keyboard-only', 'screen-reader', 'zoom-reflow', 'reduced-motion'],
        degraded_behavior: 'unsupported assistive/platform combinations retain an explicit equivalent path instead of silently hiding the action'
      },
      semantics: {
        native_control_policy: 'use native semantic controls first and add custom semantics only when the platform primitive cannot express the behavior',
        name_role_state: 'interactive controls expose a stable accessible name, role, value/state, and relevant disabled/expanded/selected semantics',
        structure_relationships: 'headings, landmarks, labels, descriptions, groups, tables and relationships reflect the visual and interaction hierarchy'
      },
      navigation: {
        keyboard_operation: 'required actions are available without pointer-only gestures and shortcuts do not steal expected typing/navigation keys',
        focus_order: 'sequential focus follows task order and does not enter hidden or inert content',
        focus_transitions: 'dialogs, route changes, async replacement and error recovery move or restore focus only under an explicit owner'
      },
      feedback: {
        status_updates: 'important async completion and state changes are exposed without requiring visual polling',
        error_feedback: 'errors are programmatically associated with the affected field or action and include a perceivable recovery path',
        loading_progress: 'busy and progress states expose meaningful status while preserving current interaction context'
      },
      visual_motion: {
        non_color_cues: 'color is never the sole carrier of required state or validation meaning',
        zoom_reflow: 'content and controls remain operable under supported text scaling, zoom and reflow without clipped required actions',
        contrast_policy: 'text, controls, focus indicators and required graphics remain distinguishable across supported themes and contrast modes',
        motion_policy: 'nonessential animation respects reduced-motion preferences and required meaning has a non-motion signal'
      },
      input: {
        pointer_touch: 'targets remain operable across supported pointer and touch precision and do not require hover-only discovery',
        gesture_alternatives: 'complex, path-based, multi-pointer, drag or device-motion gestures have an equivalent simple control when required',
        timing_policy: 'timeouts and transient content expose the declared extension, pause or recovery behavior instead of expiring critical work silently'
      },
      content: {
        form_labels_errors: 'inputs have durable labels and instructions; validation errors identify the issue and recovery path',
        media_alternatives: 'supported media has meaning-appropriate alternatives, or the contract explicitly records non-applicability'
      },
      validation: {
        representative_modes: ['keyboard-only', 'screen-reader', 'zoom-reflow'],
        scenarios: ['keyboard-only', 'screen-reader', 'focus-transition', 'dynamic-update', 'zoom-reflow', 'non-color-cue', 'reduced-motion'],
        automated_oracle: 'semantic roles, names, states, focusability and deterministic accessibility checks fail on contract regressions',
        manual_oracle: 'representative assistive-technology runs prove end-to-end completion with correct reading, focus, action and recovery order'
      },
      compatibility: {
        component_contract: 'shared components preserve semantic and focus behavior across variants instead of reimplementing it per feature',
        platform_differences: 'web, mobile and desktop use platform-native accessibility semantics where behavior differs',
        rollback: 'a regression can revert component or feature behavior without deleting user data or trapping users on an inaccessible route'
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
      experience: { user_outcome: '', surfaces: [], assistive_modes: ['screen-reader'], degraded_behavior: false },
      semantics: {}, navigation: {}, feedback: {}, visual_motion: {}, input: {}, content: {},
      validation: { representative_modes: [], scenarios: ['screen-reader'], automated_oracle: '', manual_oracle: true },
      compatibility: {}
    }), 'utf8');
    const invalid = runPython(gate, [invalidPath, '--json']);
    assert.ok(invalid);
    assert.notEqual(invalid.status, 0);
    const invalidPayload = JSON.parse(invalid.stdout);
    assert.equal(invalidPayload.gate_passed, false);
    const codes = new Set(invalidPayload.blockers.map((item) => item.code));
    for (const code of [
      'EXPERIENCE_FIELD_REQUIRED', 'ACCESSIBILITY_SURFACES_REQUIRED', 'SEMANTICS_FIELD_REQUIRED',
      'NAVIGATION_FIELD_REQUIRED', 'FEEDBACK_FIELD_REQUIRED', 'VISUAL_MOTION_FIELD_REQUIRED',
      'INPUT_FIELD_REQUIRED', 'CONTENT_FIELD_REQUIRED', 'VALIDATION_MODES_REQUIRED',
      'VALIDATION_SCENARIOS_INCOMPLETE', 'VALIDATION_FIELD_REQUIRED', 'COMPATIBILITY_FIELD_REQUIRED'
    ]) assert.ok(codes.has(code), `expected blocker ${code}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
