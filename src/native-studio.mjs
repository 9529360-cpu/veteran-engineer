import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const NATIVE_STUDIO_CONTRACT = 'veteran-native-studio-v1';
const SECTION_TYPES = new Set(['hero', 'feature-grid', 'stats', 'split', 'cta', 'footer']);
const MAX_SECTIONS = 24;
const MAX_ITEMS = 24;
const MAX_TEXT = 4000;

function codedError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function text(value, fallback = '', max = MAX_TEXT) {
  const result = value === undefined || value === null ? fallback : String(value).trim();
  if (result.length > max) throw codedError(`Studio text exceeds ${max} characters`, 'STUDIO_TEXT_TOO_LONG');
  return result;
}

function boundedArray(value, label, max = MAX_ITEMS) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw codedError(`${label} must be an array`, 'STUDIO_SPEC_INVALID', { label });
  if (value.length > max) throw codedError(`${label} exceeds ${max} items`, 'STUDIO_SPEC_INVALID', { label, max });
  return value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeXml(value) {
  return escapeHtml(value);
}

function safeHref(raw) {
  const value = text(raw, '#', 2048);
  if (!value) return '#';
  if (value.startsWith('#') || value.startsWith('/') || value.startsWith('./') || value.startsWith('../')) return value;
  try {
    const url = new URL(value);
    if (['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) return value;
  } catch {}
  return '#';
}

function color(value, fallback) {
  const candidate = text(value, fallback, 80);
  if (/^#[0-9a-fA-F]{3,8}$/.test(candidate)) return candidate;
  if (/^(rgb|hsl)a?\([^)]+\)$/.test(candidate)) return candidate;
  if (/^[a-zA-Z]+$/.test(candidate)) return candidate;
  return fallback;
}

function normalizeAction(raw = {}) {
  return {
    label: text(raw.label, ''),
    href: safeHref(raw.href || '#'),
    style: raw.style === 'secondary' ? 'secondary' : 'primary'
  };
}

function normalizeSection(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw codedError(`Section ${index + 1} must be an object`, 'STUDIO_SPEC_INVALID', { index });
  }
  const type = text(raw.type);
  if (!SECTION_TYPES.has(type)) {
    throw codedError(`Unsupported studio section type: ${type || '<empty>'}`, 'STUDIO_SECTION_UNSUPPORTED', { index, type });
  }
  const base = {
    id: text(raw.id, `section-${index + 1}`, 120).replace(/[^a-zA-Z0-9_-]+/g, '-'),
    type,
    eyebrow: text(raw.eyebrow),
    title: text(raw.title),
    body: text(raw.body)
  };
  if (type === 'hero' || type === 'cta') {
    base.actions = boundedArray(raw.actions, `sections[${index}].actions`, 3).map(normalizeAction).filter((item) => item.label);
  }
  if (type === 'feature-grid') {
    base.items = boundedArray(raw.items, `sections[${index}].items`).map((item = {}) => ({
      badge: text(item.badge, '', 80),
      title: text(item.title),
      body: text(item.body)
    }));
  }
  if (type === 'stats') {
    base.items = boundedArray(raw.items, `sections[${index}].items`).map((item = {}) => ({
      value: text(item.value, '', 80),
      label: text(item.label, '', 240)
    }));
  }
  if (type === 'split') {
    base.bullets = boundedArray(raw.bullets, `sections[${index}].bullets`).map((item) => text(item, '', 500)).filter(Boolean);
    base.panel = {
      label: text(raw.panel?.label, 'Live artifact', 120),
      value: text(raw.panel?.value, 'Open, editable, portable', 240),
      note: text(raw.panel?.note, 'No paid design account required.', 500)
    };
  }
  if (type === 'footer') {
    base.links = boundedArray(raw.links, `sections[${index}].links`).map((item = {}) => ({ label: text(item.label), href: safeHref(item.href) })).filter((item) => item.label);
  }
  return base;
}

export function normalizeStudioSpec(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw codedError('Studio spec must be an object', 'STUDIO_SPEC_INVALID');
  }
  const name = text(raw.name, 'veteran-studio-project', 120);
  const title = text(raw.title, name, 240);
  const description = text(raw.description, '', 600);
  const tokens = raw.tokens && typeof raw.tokens === 'object' && !Array.isArray(raw.tokens) ? raw.tokens : {};
  const colors = tokens.colors && typeof tokens.colors === 'object' && !Array.isArray(tokens.colors) ? tokens.colors : {};
  const navigation = boundedArray(raw.navigation, 'navigation', 10).map((item = {}) => ({
    label: text(item.label, '', 120),
    href: safeHref(item.href)
  })).filter((item) => item.label);
  const sections = boundedArray(raw.sections, 'sections', MAX_SECTIONS).map(normalizeSection);
  if (!sections.length) throw codedError('Studio spec requires at least one section', 'STUDIO_SPEC_INVALID');
  return {
    contract: NATIVE_STUDIO_CONTRACT,
    name,
    title,
    description,
    tokens: {
      colors: {
        background: color(colors.background, '#0b1020'),
        surface: color(colors.surface, '#121a2f'),
        surfaceAlt: color(colors.surfaceAlt, '#18233d'),
        text: color(colors.text, '#f7f9fc'),
        muted: color(colors.muted, '#aeb8cc'),
        accent: color(colors.accent, '#7c9cff'),
        accentText: color(colors.accentText, '#071024'),
        border: color(colors.border, '#2a3758')
      },
      fontFamily: text(tokens.fontFamily, 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', 300),
      radius: text(tokens.radius, '22px', 40),
      maxWidth: text(tokens.maxWidth, '1120px', 40),
      density: ['compact', 'comfortable', 'spacious'].includes(tokens.density) ? tokens.density : 'comfortable'
    },
    navigation,
    sections
  };
}

function actionHtml(action) {
  return `<a class="button ${action.style === 'secondary' ? 'button-secondary' : ''}" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>`;
}

function heading(section) {
  return `${section.eyebrow ? `<p class="eyebrow">${escapeHtml(section.eyebrow)}</p>` : ''}${section.title ? `<h2>${escapeHtml(section.title)}</h2>` : ''}${section.body ? `<p class="lede">${escapeHtml(section.body)}</p>` : ''}`;
}

function sectionHtml(section) {
  if (section.type === 'hero') {
    return `<section id="${escapeHtml(section.id)}" class="section hero"><div class="hero-copy">${section.eyebrow ? `<p class="eyebrow">${escapeHtml(section.eyebrow)}</p>` : ''}<h1>${escapeHtml(section.title)}</h1>${section.body ? `<p class="lede">${escapeHtml(section.body)}</p>` : ''}<div class="actions">${section.actions.map(actionHtml).join('')}</div></div><div class="hero-art" aria-hidden="true"><div class="orb orb-one"></div><div class="orb orb-two"></div><div class="hero-card"><span>Veteran Native Studio</span><strong>Design -> code -> proof</strong><small>Open files. No subscription lock-in.</small></div></div></section>`;
  }
  if (section.type === 'feature-grid') {
    return `<section id="${escapeHtml(section.id)}" class="section"><div class="section-heading">${heading(section)}</div><div class="feature-grid">${section.items.map((item) => `<article class="card">${item.badge ? `<span class="badge">${escapeHtml(item.badge)}</span>` : ''}<h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p></article>`).join('')}</div></section>`;
  }
  if (section.type === 'stats') {
    return `<section id="${escapeHtml(section.id)}" class="section stats">${section.items.map((item) => `<div class="stat"><strong>${escapeHtml(item.value)}</strong><span>${escapeHtml(item.label)}</span></div>`).join('')}</section>`;
  }
  if (section.type === 'split') {
    return `<section id="${escapeHtml(section.id)}" class="section split"><div>${heading(section)}${section.bullets.length ? `<ul class="checklist">${section.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}</div><aside class="panel"><span>${escapeHtml(section.panel.label)}</span><strong>${escapeHtml(section.panel.value)}</strong><p>${escapeHtml(section.panel.note)}</p></aside></section>`;
  }
  if (section.type === 'cta') {
    return `<section id="${escapeHtml(section.id)}" class="section cta"><div>${heading(section)}</div><div class="actions">${section.actions.map(actionHtml).join('')}</div></section>`;
  }
  return `<footer id="${escapeHtml(section.id)}" class="footer"><div><strong>${escapeHtml(section.title)}</strong>${section.body ? `<p>${escapeHtml(section.body)}</p>` : ''}</div><nav aria-label="Footer">${section.links.map((item) => `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`).join('')}</nav></footer>`;
}

function htmlDocument(spec) {
  const nav = spec.navigation.length ? `<nav aria-label="Primary">${spec.navigation.map((item) => `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`).join('')}</nav>` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(spec.description)}">
  <title>${escapeHtml(spec.title)}</title>
  <link rel="stylesheet" href="./design-tokens.css">
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header"><a class="brand" href="#">${escapeHtml(spec.name)}</a>${nav}</header>
  <main id="main">${spec.sections.map(sectionHtml).join('\n')}</main>
</body>
</html>
`;
}

function tokenCss(spec) {
  const c = spec.tokens.colors;
  const gap = spec.tokens.density === 'compact' ? '18px' : spec.tokens.density === 'spacious' ? '36px' : '26px';
  return `:root {
  --studio-bg: ${c.background};
  --studio-surface: ${c.surface};
  --studio-surface-alt: ${c.surfaceAlt};
  --studio-text: ${c.text};
  --studio-muted: ${c.muted};
  --studio-accent: ${c.accent};
  --studio-accent-text: ${c.accentText};
  --studio-border: ${c.border};
  --studio-font: ${spec.tokens.fontFamily};
  --studio-radius: ${spec.tokens.radius};
  --studio-max: ${spec.tokens.maxWidth};
  --studio-gap: ${gap};
}
`;
}

function mainCss() {
  return `* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--studio-bg); color: var(--studio-text); font-family: var(--studio-font); line-height: 1.6; }
a { color: inherit; }
.skip-link { position: fixed; left: 12px; top: 12px; z-index: 20; transform: translateY(-180%); background: var(--studio-text); color: var(--studio-bg); padding: 8px 12px; border-radius: 10px; }
.skip-link:focus { transform: translateY(0); }
.site-header { width: min(calc(100% - 32px), var(--studio-max)); margin: 0 auto; min-height: 72px; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.brand { font-weight: 800; text-decoration: none; letter-spacing: -0.02em; }
.site-header nav, .footer nav { display: flex; flex-wrap: wrap; gap: 18px; }
.site-header nav a, .footer nav a { color: var(--studio-muted); text-decoration: none; }
.site-header nav a:hover, .site-header nav a:focus-visible, .footer nav a:hover, .footer nav a:focus-visible { color: var(--studio-text); }
main, .footer { width: min(calc(100% - 32px), var(--studio-max)); margin: 0 auto; }
.section { padding: clamp(56px, 8vw, 108px) 0; }
.hero { min-height: min(760px, calc(100vh - 72px)); display: grid; grid-template-columns: 1.08fr 0.92fr; align-items: center; gap: clamp(36px, 7vw, 88px); }
h1, h2, h3, p { margin-top: 0; }
h1 { font-size: clamp(3rem, 7vw, 6.8rem); line-height: 0.96; letter-spacing: -0.055em; margin-bottom: 28px; }
h2 { font-size: clamp(2rem, 4vw, 3.7rem); line-height: 1.05; letter-spacing: -0.04em; margin-bottom: 18px; }
h3 { font-size: 1.15rem; margin-bottom: 8px; }
.eyebrow { color: var(--studio-accent); text-transform: uppercase; letter-spacing: 0.14em; font-weight: 800; font-size: 0.78rem; }
.lede { max-width: 64ch; color: var(--studio-muted); font-size: clamp(1.05rem, 1.8vw, 1.3rem); }
.actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
.button { display: inline-flex; min-height: 46px; align-items: center; justify-content: center; padding: 0 18px; border-radius: 999px; background: var(--studio-accent); color: var(--studio-accent-text); text-decoration: none; font-weight: 800; border: 1px solid var(--studio-accent); }
.button-secondary { background: transparent; color: var(--studio-text); border-color: var(--studio-border); }
.hero-art { position: relative; min-height: 430px; display: grid; place-items: center; overflow: hidden; border: 1px solid var(--studio-border); border-radius: calc(var(--studio-radius) * 1.4); background: radial-gradient(circle at 30% 20%, color-mix(in srgb, var(--studio-accent) 30%, transparent), transparent 35%), var(--studio-surface); }
.orb { position: absolute; width: 180px; height: 180px; border-radius: 50%; filter: blur(5px); background: var(--studio-accent); opacity: .22; }
.orb-one { top: 7%; left: 4%; }
.orb-two { bottom: 8%; right: 8%; transform: scale(.68); }
.hero-card { width: min(82%, 380px); padding: 26px; border-radius: var(--studio-radius); background: color-mix(in srgb, var(--studio-surface-alt) 88%, transparent); border: 1px solid var(--studio-border); display: grid; gap: 10px; box-shadow: 0 30px 80px rgba(0,0,0,.24); }
.hero-card span, .hero-card small { color: var(--studio-muted); }
.hero-card strong { font-size: 1.45rem; }
.section-heading { max-width: 760px; margin-bottom: 34px; }
.feature-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--studio-gap); }
.card, .panel { padding: clamp(20px, 3vw, 30px); border: 1px solid var(--studio-border); border-radius: var(--studio-radius); background: var(--studio-surface); }
.card p, .panel p { color: var(--studio-muted); margin-bottom: 0; }
.badge { display: inline-flex; margin-bottom: 24px; color: var(--studio-accent); font-weight: 800; font-size: .8rem; }
.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; background: var(--studio-border); padding: 1px; border-radius: var(--studio-radius); overflow: hidden; }
.stat { background: var(--studio-surface); padding: 28px; display: grid; gap: 8px; }
.stat strong { font-size: clamp(2rem, 4vw, 3.4rem); line-height: 1; }
.stat span { color: var(--studio-muted); }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(36px, 6vw, 80px); align-items: center; }
.checklist { padding: 0; list-style: none; display: grid; gap: 12px; }
.checklist li { padding-left: 28px; position: relative; }
.checklist li::before { content: '✓'; position: absolute; left: 0; color: var(--studio-accent); font-weight: 900; }
.panel { min-height: 280px; display: flex; flex-direction: column; justify-content: end; }
.panel span { color: var(--studio-accent); }
.panel strong { font-size: clamp(2rem, 4vw, 3.2rem); line-height: 1.05; margin: 12px 0; }
.cta { display: flex; justify-content: space-between; gap: 36px; align-items: end; border-top: 1px solid var(--studio-border); }
.cta > div:first-child { max-width: 720px; }
.footer { min-height: 160px; padding: 40px 0 64px; border-top: 1px solid var(--studio-border); display: flex; justify-content: space-between; gap: 32px; }
.footer p { color: var(--studio-muted); max-width: 58ch; }
:focus-visible { outline: 3px solid var(--studio-accent); outline-offset: 4px; }
@media (max-width: 820px) {
  .site-header { align-items: flex-start; padding: 18px 0; }
  .site-header nav { justify-content: flex-end; }
  .hero, .split { grid-template-columns: 1fr; }
  .hero { min-height: auto; padding-top: 72px; }
  .feature-grid { grid-template-columns: 1fr 1fr; }
  .stats { grid-template-columns: 1fr 1fr; }
  .cta, .footer { align-items: flex-start; flex-direction: column; }
}
@media (max-width: 560px) {
  .site-header { flex-direction: column; }
  .site-header nav { justify-content: flex-start; gap: 12px 16px; }
  .feature-grid, .stats { grid-template-columns: 1fr; }
  .hero-art { min-height: 320px; }
  .section { padding: 52px 0; }
}
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }
`;
}

function designBoardSvg(spec) {
  const c = spec.tokens.colors;
  const swatches = Object.entries(c).slice(0, 7).map(([name, value], index) => {
    const x = 56 + (index % 4) * 180;
    const y = 242 + Math.floor(index / 4) * 122;
    return `<rect x="${x}" y="${y}" width="152" height="64" rx="14" fill="${escapeXml(value)}"/><text x="${x}" y="${y + 88}" class="label">${escapeXml(name)}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="820" height="560" viewBox="0 0 820 560" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(spec.title)} design system</title><desc id="desc">Portable Veteran Native Studio design tokens and typography board.</desc>
  <style>.bg{fill:${escapeXml(c.background)}}.title{fill:${escapeXml(c.text)};font:700 38px system-ui}.body{fill:${escapeXml(c.muted)};font:20px system-ui}.label{fill:${escapeXml(c.text)};font:14px system-ui}</style>
  <rect class="bg" width="820" height="560" rx="28"/><text x="56" y="76" class="title">${escapeXml(spec.title)}</text><text x="56" y="112" class="body">Veteran Native Studio - open design system</text>
  <text x="56" y="188" class="title" style="font-size:24px">Color tokens</text>${swatches}
  <text x="56" y="500" class="body">Typography: ${escapeXml(spec.tokens.fontFamily)}</text><text x="56" y="532" class="body">Radius: ${escapeXml(spec.tokens.radius)}  |  Max width: ${escapeXml(spec.tokens.maxWidth)}</text>
</svg>`;
}

function parseHex(value) {
  const source = String(value || '');
  if (!/^#[0-9a-fA-F]{6}$/.test(source)) return null;
  return [1, 3, 5].map((start) => Number.parseInt(source.slice(start, start + 2), 16));
}

function luminance(rgb) {
  if (!rgb) return null;
  const channels = rgb.map((value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(left, right) {
  const a = luminance(parseHex(left));
  const b = luminance(parseHex(right));
  if (a === null || b === null) return null;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function auditStudioSpec(raw) {
  const spec = raw?.contract === NATIVE_STUDIO_CONTRACT ? raw : normalizeStudioSpec(raw);
  const findings = [];
  const textContrast = contrast(spec.tokens.colors.text, spec.tokens.colors.background);
  const mutedContrast = contrast(spec.tokens.colors.muted, spec.tokens.colors.background);
  const buttonContrast = contrast(spec.tokens.colors.accentText, spec.tokens.colors.accent);
  if (textContrast !== null && textContrast < 4.5) findings.push({ severity: 'error', code: 'TEXT_CONTRAST_LOW', message: `Primary text contrast is ${textContrast.toFixed(2)}:1; target at least 4.5:1.` });
  if (mutedContrast !== null && mutedContrast < 4.5) findings.push({ severity: 'warning', code: 'MUTED_CONTRAST_LOW', message: `Muted text contrast is ${mutedContrast.toFixed(2)}:1; review body-copy usage.` });
  if (buttonContrast !== null && buttonContrast < 4.5) findings.push({ severity: 'error', code: 'ACTION_CONTRAST_LOW', message: `Primary action contrast is ${buttonContrast.toFixed(2)}:1; target at least 4.5:1.` });
  if (spec.navigation.length > 7) findings.push({ severity: 'warning', code: 'NAV_DENSITY_HIGH', message: 'Primary navigation has more than seven items; consider grouping or progressive disclosure.' });
  for (const section of spec.sections) {
    if (section.type === 'hero' && section.actions.length > 2) findings.push({ severity: 'warning', code: 'HERO_ACTION_COMPETITION', message: 'Hero has more than two actions; primary hierarchy may be diluted.', sectionId: section.id });
    if (section.type === 'feature-grid' && section.items.length > 9) findings.push({ severity: 'warning', code: 'FEATURE_GRID_DENSE', message: 'Feature grid has more than nine items; scan cost may be high.', sectionId: section.id });
  }
  return {
    contract: 'veteran-native-studio-audit-v1',
    ok: !findings.some((item) => item.severity === 'error'),
    findings,
    metrics: { textContrast, mutedContrast, buttonContrast, sectionCount: spec.sections.length, navigationCount: spec.navigation.length }
  };
}

async function writeFileWithHash(target, content) {
  await fs.writeFile(target, content, 'utf8');
  return { path: path.basename(target), bytes: Buffer.byteLength(content), sha256: crypto.createHash('sha256').update(content).digest('hex') };
}

export async function buildStudioProject(raw, outputDir) {
  const spec = normalizeStudioSpec(raw);
  const target = path.resolve(outputDir);
  await fs.mkdir(target, { recursive: true });
  const files = [];
  files.push(await writeFileWithHash(path.join(target, 'studio.json'), `${JSON.stringify(spec, null, 2)}\n`));
  files.push(await writeFileWithHash(path.join(target, 'design-tokens.css'), tokenCss(spec)));
  files.push(await writeFileWithHash(path.join(target, 'styles.css'), mainCss()));
  files.push(await writeFileWithHash(path.join(target, 'index.html'), htmlDocument(spec)));
  files.push(await writeFileWithHash(path.join(target, 'design-system.svg'), designBoardSvg(spec)));
  const audit = auditStudioSpec(spec);
  files.push(await writeFileWithHash(path.join(target, 'audit.json'), `${JSON.stringify(audit, null, 2)}\n`));
  return { contract: NATIVE_STUDIO_CONTRACT, outputDir: target, files, audit };
}

export async function auditStudioProject(projectDir) {
  const target = path.resolve(projectDir);
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(path.join(target, 'studio.json'), 'utf8'));
  } catch (error) {
    throw codedError('Studio project is missing a readable studio.json', 'STUDIO_PROJECT_INVALID', { cause: error?.code || 'ERROR' });
  }
  return auditStudioSpec(raw);
}
