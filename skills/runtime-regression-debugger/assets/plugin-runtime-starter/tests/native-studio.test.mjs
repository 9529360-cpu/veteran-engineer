import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { auditStudioProject, auditStudioSpec, buildStudioProject, normalizeStudioSpec } from '../src/native-studio.mjs';

function sampleSpec(overrides = {}) {
  return {
    name: 'Monster Studio',
    title: 'Build without subscriptions',
    description: 'A portable design and site artifact.',
    navigation: [{ label: 'Features', href: '#features' }, { label: 'Unsafe', href: 'javascript:alert(1)' }],
    tokens: { colors: { background: '#0b1020', surface: '#121a2f', text: '#f7f9fc', muted: '#aeb8cc', accent: '#7c9cff', accentText: '#071024' } },
    sections: [
      { type: 'hero', id: 'top', eyebrow: 'Native', title: '<script>alert(1)</script>', body: 'Design, build, and audit locally.', actions: [{ label: 'Start', href: '#features' }] },
      { type: 'feature-grid', id: 'features', title: 'Capabilities', items: [{ badge: 'FREE', title: 'Open files', body: 'HTML, CSS, SVG, JSON.' }, { title: 'Portable', body: 'No vendor lock-in.' }] },
      { type: 'stats', items: [{ value: '0', label: 'Paid APIs required' }] },
      { type: 'split', title: 'Own the artifact', bullets: ['Editable source', 'Responsive output'] },
      { type: 'cta', title: 'Ship it', actions: [{ label: 'Open', href: '#top' }] },
      { type: 'footer', title: 'Monster Studio', links: [{ label: 'Top', href: '#top' }] }
    ],
    ...overrides
  };
}

test('native studio normalizes bounded open design specs and neutralizes unsafe links', () => {
  const spec = normalizeStudioSpec(sampleSpec());
  assert.equal(spec.contract, 'veteran-native-studio-v1');
  assert.equal(spec.navigation[1].href, '#');
  assert.equal(spec.sections.length, 6);
});

test('native studio rejects unsupported arbitrary section execution', () => {
  assert.throws(() => normalizeStudioSpec(sampleSpec({ sections: [{ type: 'raw-html', body: '<script />' }] })), (error) => error.code === 'STUDIO_SECTION_UNSUPPORTED');
});

test('native studio builds portable HTML/CSS/SVG/JSON artifacts and escapes content', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-studio-'));
  const result = await buildStudioProject(sampleSpec(), root);
  assert.equal(result.contract, 'veteran-native-studio-v1');
  assert.deepEqual(result.files.map((item) => item.path).sort(), ['audit.json', 'design-system.svg', 'design-tokens.css', 'index.html', 'studio.json', 'styles.css']);
  const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  const css = await fs.readFile(path.join(root, 'styles.css'), 'utf8');
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /prefers-reduced-motion/);
  const audit = await auditStudioProject(root);
  assert.equal(typeof audit.ok, 'boolean');
  assert.ok(audit.metrics.textContrast > 4.5);
});

test('native studio audit catches low text and action contrast', () => {
  const audit = auditStudioSpec(sampleSpec({
    tokens: { colors: { background: '#ffffff', surface: '#ffffff', text: '#eeeeee', muted: '#eeeeee', accent: '#ffffff', accentText: '#eeeeee' } }
  }));
  assert.equal(audit.ok, false);
  const codes = new Set(audit.findings.map((item) => item.code));
  assert.ok(codes.has('TEXT_CONTRAST_LOW'));
  assert.ok(codes.has('ACTION_CONTRAST_LOW'));
});
