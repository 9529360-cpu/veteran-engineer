import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildStudioProject } from './native-studio.mjs';

export const NATIVE_STUDIO_SITE_CONTRACT = 'veteran-native-studio-site-v1';
export const NATIVE_STUDIO_VISUAL_PACK_CONTRACT = 'veteran-native-studio-visual-pack-v1';

const MAX_PAGES = 16;
const MAX_FORMATS = 8;
const MAX_TEXT = 4000;
const VISUAL_FORMATS = Object.freeze({
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
  og: { width: 1200, height: 630 },
  banner: { width: 1600, height: 900 },
  poster: { width: 1600, height: 2000 }
});

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

function boundedArray(value, label, max) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw codedError(`${label} must be an array`, 'STUDIO_SPEC_INVALID', { label });
  if (value.length > max) throw codedError(`${label} exceeds ${max} items`, 'STUDIO_SPEC_INVALID', { label, max });
  return value;
}

function safeSlug(value, index) {
  const raw = text(value, index === 0 ? 'index' : `page-${index + 1}`, 120).toLowerCase();
  const normalized = raw.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized || ['index', 'home'].includes(normalized)) return index === 0 ? 'index' : normalized || `page-${index + 1}`;
  return normalized;
}

function normalizeColors(raw = {}) {
  const safe = (value, fallback) => {
    const candidate = text(value, fallback, 64);
    return /^#[0-9a-fA-F]{3,8}$/.test(candidate) || /^[a-zA-Z]+$/.test(candidate) ? candidate : fallback;
  };
  return {
    background: safe(raw.background, '#0b1020'),
    surface: safe(raw.surface, '#121a2f'),
    text: safe(raw.text, '#f7f9fc'),
    muted: safe(raw.muted, '#aeb8cc'),
    accent: safe(raw.accent, '#7c9cff'),
    accentText: safe(raw.accentText, '#071024')
  };
}

function mergeTokens(siteTokens = {}, pageTokens = {}) {
  const siteColors = siteTokens.colors && typeof siteTokens.colors === 'object' ? siteTokens.colors : {};
  const pageColors = pageTokens.colors && typeof pageTokens.colors === 'object' ? pageTokens.colors : {};
  return { ...siteTokens, ...pageTokens, colors: { ...siteColors, ...pageColors } };
}

export function normalizeStudioSiteSpec(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw codedError('Studio site spec must be an object', 'STUDIO_SITE_INVALID');
  const sourcePages = boundedArray(raw.pages, 'pages', MAX_PAGES);
  const pagesInput = sourcePages.length ? sourcePages : [{ slug: 'index', title: raw.title, description: raw.description, sections: raw.sections }];
  const routes = new Set();
  const pages = pagesInput.map((page, index) => {
    if (!page || typeof page !== 'object' || Array.isArray(page)) throw codedError(`Page ${index + 1} must be an object`, 'STUDIO_SITE_INVALID', { index });
    const slug = safeSlug(page.slug, index);
    const isHome = index === 0 && ['index', 'home'].includes(slug);
    const route = isHome ? '/' : `/${slug}/`;
    if (routes.has(route)) throw codedError(`Duplicate studio site route: ${route}`, 'STUDIO_SITE_ROUTE_DUPLICATE', { route });
    routes.add(route);
    const sections = page.sections ?? (index === 0 ? raw.sections : undefined);
    if (!Array.isArray(sections) || sections.length === 0) throw codedError(`Page ${route} requires sections`, 'STUDIO_SITE_PAGE_INVALID', { route });
    return {
      slug: isHome ? 'index' : slug,
      route,
      directory: isHome ? '.' : slug,
      spec: {
        name: text(page.name, raw.name || 'veteran-studio-site', 120),
        title: text(page.title, raw.title || page.name || 'Veteran Studio', 240),
        description: text(page.description, raw.description || '', 600),
        navigation: page.navigation ?? raw.navigation ?? [],
        tokens: mergeTokens(raw.tokens || {}, page.tokens || {}),
        sections
      }
    };
  });
  return { contract: NATIVE_STUDIO_SITE_CONTRACT, name: text(raw.name, 'veteran-studio-site', 120), pages };
}

function containedTarget(root, directory) {
  const target = path.resolve(root, directory);
  const resolvedRoot = path.resolve(root);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw codedError('Studio output escaped the requested root', 'STUDIO_OUTPUT_ESCAPE', { directory });
  }
  return target;
}

async function writeWithHash(target, content, root = path.dirname(target)) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
  return {
    path: path.relative(root, target).split(path.sep).join('/'),
    bytes: Buffer.byteLength(content),
    sha256: crypto.createHash('sha256').update(content).digest('hex')
  };
}

export async function buildStudioSite(raw, outputDir) {
  const site = normalizeStudioSiteSpec(raw);
  const root = path.resolve(outputDir);
  await fs.mkdir(root, { recursive: true });
  const pages = [];
  for (const page of site.pages) {
    const pageDir = containedTarget(root, page.directory);
    const built = await buildStudioProject(page.spec, pageDir);
    pages.push({ slug: page.slug, route: page.route, directory: page.directory, files: built.files, audit: built.audit });
  }
  const manifest = { contract: NATIVE_STUDIO_SITE_CONTRACT, name: site.name, pages: pages.map(({ slug, route, directory, audit }) => ({ slug, route, directory, auditOk: audit.ok })) };
  const manifestFile = await writeWithHash(path.join(root, 'site.json'), `${JSON.stringify(manifest, null, 2)}\n`, root);
  return { contract: NATIVE_STUDIO_SITE_CONTRACT, outputDir: root, pages, files: [manifestFile], ok: pages.every((page) => page.audit.ok) };
}

function escapeXml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function wrapText(value, maxChars, maxLines) {
  const source = text(value);
  if (!source) return [];
  const words = source.includes(' ') ? source.split(/\s+/) : [...source];
  const lines = [];
  let current = '';
  for (const word of words) {
    const glue = source.includes(' ') && current ? ' ' : '';
    const next = `${current}${glue}${word}`;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    } else current = next;
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines && words.join(source.includes(' ') ? ' ' : '').length > lines.join('').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/…$/, '').slice(0, Math.max(1, maxChars - 1))}…`;
  }
  return lines;
}

function visualSvg(spec, format) {
  const { width, height } = VISUAL_FORMATS[format];
  const colors = normalizeColors(spec.colors || spec.tokens?.colors || {});
  const eyebrow = text(spec.eyebrow, '', 160);
  const title = text(spec.title, 'Veteran Native Studio', 400);
  const subtitle = text(spec.subtitle ?? spec.description, '', 600);
  const footer = text(spec.footer, spec.brand || '', 180);
  const titleSize = Math.round(Math.min(width, height) * (format === 'story' || format === 'poster' ? 0.082 : 0.07));
  const bodySize = Math.round(titleSize * 0.34);
  const pad = Math.round(Math.min(width, height) * 0.075);
  const maxChars = format === 'story' || format === 'poster' ? 20 : 28;
  const titleLines = wrapText(title, maxChars, format === 'story' || format === 'poster' ? 5 : 3);
  const subtitleLines = wrapText(subtitle, Math.round(maxChars * 1.5), 4);
  const titleStart = Math.round(height * 0.34);
  const titleTspans = titleLines.map((line, index) => `<tspan x="${pad}" dy="${index === 0 ? 0 : titleSize * 1.05}">${escapeXml(line)}</tspan>`).join('');
  const subtitleStart = titleStart + Math.max(1, titleLines.length) * titleSize * 1.1 + bodySize * 1.8;
  const subtitleTspans = subtitleLines.map((line, index) => `<tspan x="${pad}" dy="${index === 0 ? 0 : bodySize * 1.45}">${escapeXml(line)}</tspan>`).join('');
  const accentWidth = Math.round(width * 0.22);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(title)}</title><desc id="desc">Portable Veteran Native Studio ${escapeXml(format)} visual asset.</desc>
  <rect width="${width}" height="${height}" fill="${escapeXml(colors.background)}"/>
  <circle cx="${Math.round(width * 0.88)}" cy="${Math.round(height * 0.12)}" r="${Math.round(Math.min(width, height) * 0.24)}" fill="${escapeXml(colors.accent)}" opacity="0.18"/>
  <rect x="${pad}" y="${pad}" width="${accentWidth}" height="${Math.max(10, Math.round(height * 0.012))}" rx="${Math.max(5, Math.round(height * 0.006))}" fill="${escapeXml(colors.accent)}"/>
  ${eyebrow ? `<text x="${pad}" y="${Math.round(height * 0.22)}" fill="${escapeXml(colors.accent)}" font-family="system-ui,sans-serif" font-size="${Math.round(bodySize * 0.85)}" font-weight="800" letter-spacing="2">${escapeXml(eyebrow.toUpperCase())}</text>` : ''}
  <text x="${pad}" y="${titleStart}" fill="${escapeXml(colors.text)}" font-family="system-ui,sans-serif" font-size="${titleSize}" font-weight="800" letter-spacing="-2">${titleTspans}</text>
  ${subtitleLines.length ? `<text x="${pad}" y="${subtitleStart}" fill="${escapeXml(colors.muted)}" font-family="system-ui,sans-serif" font-size="${bodySize}" font-weight="500">${subtitleTspans}</text>` : ''}
  ${footer ? `<text x="${pad}" y="${height - pad}" fill="${escapeXml(colors.text)}" font-family="system-ui,sans-serif" font-size="${Math.round(bodySize * 0.82)}" font-weight="700">${escapeXml(footer)}</text>` : ''}
</svg>`;
}

export function normalizeVisualPackSpec(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw codedError('Visual pack spec must be an object', 'STUDIO_VISUAL_INVALID');
  const requested = boundedArray(raw.formats, 'formats', MAX_FORMATS);
  const formats = requested.length ? [...new Set(requested.map((item) => text(item, '', 40)))] : ['square', 'story', 'og', 'banner'];
  for (const format of formats) {
    if (!VISUAL_FORMATS[format]) throw codedError(`Unsupported visual format: ${format}`, 'STUDIO_VISUAL_FORMAT_UNSUPPORTED', { format });
  }
  return {
    contract: NATIVE_STUDIO_VISUAL_PACK_CONTRACT,
    name: safeSlug(raw.name || raw.brand || 'studio-visual', 1),
    formats,
    content: {
      brand: text(raw.brand, raw.name || '', 180),
      eyebrow: text(raw.eyebrow, '', 160),
      title: text(raw.title, 'Veteran Native Studio', 400),
      subtitle: text(raw.subtitle ?? raw.description, '', 600),
      footer: text(raw.footer, raw.brand || '', 180),
      colors: normalizeColors(raw.colors || raw.tokens?.colors || {})
    }
  };
}

export async function buildVisualPack(raw, outputDir) {
  const spec = normalizeVisualPackSpec(raw);
  const root = path.resolve(outputDir);
  await fs.mkdir(root, { recursive: true });
  const files = [];
  for (const format of spec.formats) {
    const filename = `${spec.name}-${format}.svg`;
    files.push(await writeWithHash(path.join(root, filename), visualSvg(spec.content, format), root));
  }
  const manifest = { contract: NATIVE_STUDIO_VISUAL_PACK_CONTRACT, name: spec.name, formats: spec.formats, files: files.map((file) => file.path) };
  files.push(await writeWithHash(path.join(root, 'visual-pack.json'), `${JSON.stringify(manifest, null, 2)}\n`, root));
  return { contract: NATIVE_STUDIO_VISUAL_PACK_CONTRACT, outputDir: root, files, formats: spec.formats };
}

export { VISUAL_FORMATS };
