import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildStudioSite, buildVisualPack, normalizeStudioSiteSpec, normalizeVisualPackSpec } from '../src/native-studio-publisher.mjs';

function page(title) {
  return { title, sections: [{ type: 'hero', title, actions: [{ label: 'Start', href: '#' }] }] };
}

test('site builder normalizes one home route and bounded child routes', () => {
  const site = normalizeStudioSiteSpec({ name: 'Monster', pages: [{ slug: 'home', ...page('Home') }, { slug: 'About Us', ...page('About') }] });
  assert.equal(site.pages[0].route, '/');
  assert.equal(site.pages[1].route, '/about-us/');
  assert.equal(site.pages[1].directory, 'about-us');
});

test('site builder rejects duplicate normalized routes', () => {
  assert.throws(() => normalizeStudioSiteSpec({ pages: [{ slug: 'home', ...page('Home') }, { slug: 'About Us', ...page('A') }, { slug: 'about-us', ...page('B') }] }), (error) => error.code === 'STUDIO_SITE_ROUTE_DUPLICATE');
});

test('site builder emits deployable page directories and a site manifest', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-site-'));
  const result = await buildStudioSite({ name: 'Monster', pages: [{ slug: 'index', ...page('Home') }, { slug: 'docs', ...page('Docs') }] }, root);
  assert.equal(result.contract, 'veteran-native-studio-site-v1');
  assert.equal(result.pages.length, 2);
  await fs.access(path.join(root, 'index.html'));
  await fs.access(path.join(root, 'docs', 'index.html'));
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'site.json'), 'utf8'));
  assert.deepEqual(manifest.pages.map((item) => item.route), ['/', '/docs/']);
});

test('visual pack emits multiple portable SVG canvases with escaped copy', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-visual-'));
  const result = await buildVisualPack({ name: 'Launch Pack', brand: 'Monster', title: '<script>alert(1)</script>', subtitle: 'One source, many formats.', formats: ['square', 'story', 'og'] }, root);
  assert.equal(result.contract, 'veteran-native-studio-visual-pack-v1');
  assert.equal(result.files.length, 4);
  const svg = await fs.readFile(path.join(root, 'launch-pack-square.svg'), 'utf8');
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(svg, /width="1080" height="1080"/);
});

test('visual pack rejects unsupported formats instead of executing arbitrary renderers', () => {
  assert.throws(() => normalizeVisualPackSpec({ formats: ['pdf-shell'] }), (error) => error.code === 'STUDIO_VISUAL_FORMAT_UNSUPPORTED');
});
