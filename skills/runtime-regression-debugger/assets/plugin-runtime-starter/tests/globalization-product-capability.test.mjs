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
const gate = path.join(skillRoot, 'scripts', 'globalization_product_gate.py');
const reference = path.join(skillRoot, 'references', 'globalization-product-engineering.md');

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
    const result = spawnSync(executable, [script, ...args], { cwd: root, encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

test('engineering context router treats globalization as a first-class cross-client product surface', async (t) => {
  if (!(await exists(router))) {
    t.skip('source Skill router is not present in this isolated gate fixture');
    return;
  }
  assert.equal(await exists(reference), true, 'Globalization Product Engineering reference must exist when routed');

  const direct = runPython(router, [
    '--signals',
    'globalization,internationalization,localization,rtl,bidi,ime,timezone,locale-formatting,unicode-input',
    '--max', '10',
    '--json'
  ]);
  assert.ok(direct);
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  const payload = JSON.parse(direct.stdout);
  assert.deepEqual(payload.unmatched_signals, []);
  const refs = payload.references.map((entry) => entry.path);
  for (const expected of [
    'references/globalization-product-engineering.md',
    'references/full-stack-product-engineering.md',
    'references/frontend-product-patterns.md',
    'references/temporal-debugging-state-transitions.md'
  ]) {
    assert.ok(refs.includes(expected), `expected route ${expected}`);
  }

  const aliases = runPython(router, [
    '--signals',
    'i18n,internationalisation,l10n,localisation,right-to-left,bidirectional-text,bidi-text,input-method-editor,ime-composition,time-zone,timezone-handling,locale-aware-formatting,number-formatting,currency-formatting,unicode-text-input',
    '--max', '10',
    '--json'
  ]);
  assert.ok(aliases);
  assert.equal(aliases.status, 0, aliases.stderr || aliases.stdout);
  const aliasPayload = JSON.parse(aliases.stdout);
  assert.deepEqual(aliasPayload.unmatched_signals, []);
  assert.deepEqual(aliasPayload.signals, [
    'internationalization', 'internationalization', 'localization', 'localization',
    'rtl', 'bidi', 'bidi', 'ime', 'ime', 'timezone', 'timezone',
    'locale-formatting', 'locale-formatting', 'locale-formatting', 'unicode-input'
  ]);

  const ambiguous = runPython(router, ['--signals', 'translation,locale,time,date,formatting', '--json']);
  assert.ok(ambiguous);
  assert.equal(ambiguous.status, 0, ambiguous.stderr || ambiguous.stdout);
  assert.deepEqual(JSON.parse(ambiguous.stdout).unmatched_signals, ['translation', 'locale', 'time', 'date', 'formatting']);
});

test('globalization product gate covers locale, time, RTL, IME, data and rollout boundaries', async (t) => {
  if (!(await exists(gate))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }
  assert.equal(await exists(reference), true, 'Globalization Product Engineering reference must exist with the gate');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-globalization-'));
  try {
    const validPath = path.join(dir, 'valid.json');
    await fs.writeFile(validPath, JSON.stringify({
      experience: {
        user_outcome: 'Users can complete the same workflow in every supported locale without losing meaning or data.',
        supported_locales: ['en-US', 'ar', 'ja-JP'],
        fallback_locale: 'en-US',
        unsupported_locale_behavior: 'fall back visibly and preserve the user locale preference without corrupting content'
      },
      authority: {
        locale_resolution: 'signed-in account preference, then explicit device/browser locale, then product default',
        translation_catalog: 'versioned message catalog keyed by stable semantic message ids',
        formatting_owner: 'client presentation uses locale-aware formatters while APIs stay locale-neutral',
        persistence_scope: 'locale preference is account-scoped; per-document language stays document-scoped'
      },
      text: {
        message_key_policy: 'stable semantic ids; copy changes do not rename durable identifiers',
        interpolation_policy: 'typed named placeholders; translators do not concatenate sentence fragments',
        pluralization_policy: 'locale-aware plural/select rules rather than English singular/plural branching',
        fallback_policy: 'missing messages use the explicit fallback locale and emit observable diagnostics'
      },
      time: {
        timestamp_storage: 'store instants in UTC and preserve zone identifiers when wall-clock semantics matter',
        timezone_source: 'explicit user/account timezone wins over device inference when the workflow is account-scoped',
        dst_policy: 'test skipped and repeated local times and never infer duration from wall-clock subtraction',
        calendar_policy: 'use the product-supported calendar contract and locale-aware display formatting'
      },
      layout_input: {
        directionality_policy: 'derive LTR/RTL from resolved content locale and isolate mixed-direction identifiers',
        rtl_validation: 'mirror directional layout intentionally while preserving semantic icon and navigation behavior',
        ime_composition_policy: 'do not submit, validate, or transform partially composed IME text',
        unicode_policy: 'preserve Unicode text and apply normalization only where an explicit comparison/search contract requires it'
      },
      data: {
        locale_independent_identifiers: 'API enums, ids, keys, money minor units, and persisted machine values never depend on translated labels',
        server_client_format_boundary: 'server exchanges machine-stable values; localized formatting occurs at the presentation boundary unless server-rendered by contract',
        sorting_search_policy: 'user-visible sort/search follows the declared locale/collation policy while authorization and identity remain locale-independent'
      },
      validation: {
        representative_locales: ['en-US', 'ar', 'ja-JP'],
        scenarios: ['fallback', 'rtl', 'dst-transition', 'long-translation', 'ime-composition', 'plural-categories', 'mixed-direction-content'],
        oracle: 'visible meaning, persisted machine values, focus/order, and round-trip data remain correct under each locale scenario'
      },
      observability: {
        missing_translation: 'count missing message ids by release and locale without logging sensitive user text',
        formatting_failure: 'capture formatter/type failures with bounded locale metadata',
        fallback_usage: 'measure unexpected fallback-locale usage so incomplete catalogs are visible before broad rollout'
      },
      compatibility: {
        old_client_behavior: 'new server values remain machine-compatible with supported old clients and unknown labels degrade safely',
        catalog_rollout: 'catalog and application versions can overlap without making keys disappear mid-session',
        rollback: 'restore the previous known-good catalog/app configuration without rewriting durable localized user data'
      }
    }), 'utf8');

    const valid = runPython(gate, [validPath, '--json']);
    assert.ok(valid);
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
    const validPayload = JSON.parse(valid.stdout);
    assert.equal(validPayload.gate_passed, true);
    assert.deepEqual(validPayload.blockers, []);
    assert.equal(validPayload.counts.supported_locales, 3);

    const invalidPath = path.join(dir, 'invalid.json');
    await fs.writeFile(invalidPath, JSON.stringify({
      experience: { user_outcome: '', supported_locales: ['en-US'], fallback_locale: 'fr-FR', unsupported_locale_behavior: '' },
      authority: {},
      text: {},
      time: {},
      layout_input: { directionality_policy: '', rtl_validation: '', ime_composition_policy: true, unicode_policy: '' },
      data: {},
      validation: { representative_locales: [], scenarios: ['rtl'], oracle: '' },
      observability: {},
      compatibility: {}
    }), 'utf8');

    const invalid = runPython(gate, [invalidPath, '--json']);
    assert.ok(invalid);
    assert.notEqual(invalid.status, 0);
    const invalidPayload = JSON.parse(invalid.stdout);
    assert.equal(invalidPayload.gate_passed, false);
    const codes = new Set(invalidPayload.blockers.map((item) => item.code));
    for (const code of [
      'EXPERIENCE_FIELD_REQUIRED',
      'FALLBACK_LOCALE_UNSUPPORTED',
      'AUTHORITY_FIELD_REQUIRED',
      'TEXT_FIELD_REQUIRED',
      'TIME_FIELD_REQUIRED',
      'LAYOUT_INPUT_FIELD_REQUIRED',
      'DATA_FIELD_REQUIRED',
      'VALIDATION_LOCALES_REQUIRED',
      'VALIDATION_SCENARIOS_INCOMPLETE',
      'VALIDATION_ORACLE_REQUIRED',
      'OBSERVABILITY_FIELD_REQUIRED',
      'COMPATIBILITY_FIELD_REQUIRED'
    ]) {
      assert.ok(codes.has(code), `expected blocker ${code}`);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
