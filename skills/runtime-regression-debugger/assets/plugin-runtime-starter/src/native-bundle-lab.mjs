#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

export const BUNDLE_SPEC_CONTRACT = 'veteran-native-bundle-spec-v1';
export const BUNDLE_REPORT_CONTRACT = 'veteran-native-bundle-report-v1';
const LIMIT = { spec: 256 * 1024, baseline: 16 * 1024 * 1024, files: 5000, file: 32 * 1024 * 1024, total: 256 * 1024 * 1024, roots: 32, findings: 5000 };
const TOP_KEYS = new Set(['contract', 'roots', 'policy', 'baseline']);
const POLICY_KEYS = new Set(['minFiles', 'maxTotalBytes', 'maxFileBytes', 'maxFileGzipBytes', 'maxFileBrotliBytes', 'maxTotalGzipBytes', 'maxTotalBrotliBytes', 'forbidSourceMaps', 'maxDuplicateBytes']);
const BASELINE_KEYS = new Set(['path', 'maxTotalGrowthBytes', 'maxTotalGrowthPercent', 'maxFileGrowthBytes', 'maxFileGrowthPercent']);
const COMPRESSIBLE = new Set(['.cjs', '.css', '.csv', '.html', '.htm', '.js', '.json', '.map', '.mjs', '.svg', '.txt', '.xml']);
const SEVERITY = { low: 1, medium: 2, high: 3, critical: 4 };

function errorWith(message, code, details) { const e = new Error(message); e.code = code; if (details !== undefined) e.details = details; return e; }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function portable(value) { return String(value).split(path.sep).join('/'); }
function inside(root, target) { const rel = path.relative(root, target); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); }
async function statOrNull(target) { try { return await fs.lstat(target); } catch (e) { if (e?.code === 'ENOENT') return null; throw e; } }
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])])); return value; }
function relative(value, label) { if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0') || path.isAbsolute(value)) throw errorWith(`${label} must be a relative path`, 'BUNDLE_PATH_INVALID'); const normalized = path.normalize(value); if (normalized === '.' || normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw errorWith(`${label} escapes root`, 'BUNDLE_PATH_INVALID'); return portable(normalized); }
function keys(object, allowed, label) { for (const key of Object.keys(object)) if (!allowed.has(key)) throw errorWith(`${label} contains unknown field ${key}`, 'BUNDLE_SPEC_INVALID'); }
function boundedInt(value, label, max = Number.MAX_SAFE_INTEGER) { if (value === null || value === undefined) return null; if (!Number.isInteger(value) || value < 0 || value > max) throw errorWith(`${label} is invalid`, 'BUNDLE_SPEC_INVALID'); return value; }
function boundedPercent(value, label) { if (value === null || value === undefined) return null; if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10000) throw errorWith(`${label} is invalid`, 'BUNDLE_SPEC_INVALID'); return value; }

export function normalizeBundleSpec(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.contract !== BUNDLE_SPEC_CONTRACT) throw errorWith(`Bundle spec must use contract ${BUNDLE_SPEC_CONTRACT}`, 'BUNDLE_SPEC_INVALID');
  keys(raw, TOP_KEYS, 'Bundle spec');
  if (!Array.isArray(raw.roots) || raw.roots.length < 1 || raw.roots.length > LIMIT.roots) throw errorWith(`Bundle roots must contain 1-${LIMIT.roots} directories`, 'BUNDLE_SPEC_INVALID');
  const roots = [...new Set(raw.roots.map((v) => relative(v, 'Bundle root')))];
  for (let i = 0; i < roots.length; i += 1) for (let j = i + 1; j < roots.length; j += 1) { const a = `${roots[i].replace(/\/$/, '')}/`, b = `${roots[j].replace(/\/$/, '')}/`; if (a.startsWith(b) || b.startsWith(a)) throw errorWith('Bundle roots must not overlap', 'BUNDLE_SPEC_INVALID'); }
  const p = raw.policy ?? {}; if (!p || typeof p !== 'object' || Array.isArray(p)) throw errorWith('Bundle policy must be an object', 'BUNDLE_SPEC_INVALID'); keys(p, POLICY_KEYS, 'Bundle policy');
  const policy = Object.freeze({
    minFiles: boundedInt(p.minFiles ?? 1, 'minFiles', LIMIT.files),
    maxTotalBytes: boundedInt(p.maxTotalBytes, 'maxTotalBytes'), maxFileBytes: boundedInt(p.maxFileBytes, 'maxFileBytes'),
    maxFileGzipBytes: boundedInt(p.maxFileGzipBytes, 'maxFileGzipBytes'), maxFileBrotliBytes: boundedInt(p.maxFileBrotliBytes, 'maxFileBrotliBytes'),
    maxTotalGzipBytes: boundedInt(p.maxTotalGzipBytes, 'maxTotalGzipBytes'), maxTotalBrotliBytes: boundedInt(p.maxTotalBrotliBytes, 'maxTotalBrotliBytes'),
    forbidSourceMaps: p.forbidSourceMaps ?? false, maxDuplicateBytes: boundedInt(p.maxDuplicateBytes, 'maxDuplicateBytes')
  });
  if (typeof policy.forbidSourceMaps !== 'boolean') throw errorWith('forbidSourceMaps must be boolean', 'BUNDLE_SPEC_INVALID');
  let baseline = null;
  if (raw.baseline !== undefined && raw.baseline !== null) {
    const b = raw.baseline; if (!b || typeof b !== 'object' || Array.isArray(b)) throw errorWith('Bundle baseline must be an object', 'BUNDLE_SPEC_INVALID'); keys(b, BASELINE_KEYS, 'Bundle baseline');
    baseline = Object.freeze({ path: relative(b.path, 'Baseline path'), maxTotalGrowthBytes: boundedInt(b.maxTotalGrowthBytes, 'maxTotalGrowthBytes'), maxTotalGrowthPercent: boundedPercent(b.maxTotalGrowthPercent, 'maxTotalGrowthPercent'), maxFileGrowthBytes: boundedInt(b.maxFileGrowthBytes, 'maxFileGrowthBytes'), maxFileGrowthPercent: boundedPercent(b.maxFileGrowthPercent, 'maxFileGrowthPercent') });
  }
  if (baseline) for (const bundleRoot of roots) { const prefix = `${bundleRoot.replace(/\/$/, '')}/`; if (baseline.path === bundleRoot || baseline.path.startsWith(prefix)) throw errorWith('Bundle baseline must live outside audited roots', 'BUNDLE_SPEC_INVALID'); }
  return Object.freeze({ contract: BUNDLE_SPEC_CONTRACT, roots: Object.freeze(roots), policy, baseline });
}

async function containedFile(root, rel, maxBytes, code) {
  const safe = relative(rel, 'Input path'), target = path.resolve(root, safe); if (!inside(root, target)) throw errorWith('Input path escapes root', 'BUNDLE_PATH_ESCAPE');
  const info = await statOrNull(target); if (!info || info.isSymbolicLink() || !info.isFile() || info.size > maxBytes) throw errorWith('Input file is invalid or too large', code, { path: safe, bytes: info?.size ?? null });
  const real = await fs.realpath(target); if (!inside(root, real)) throw errorWith('Input real path escapes root', 'BUNDLE_PATH_ESCAPE'); return { real, text: await fs.readFile(real, 'utf8') };
}
async function rootDir(root, rel) { const safe = relative(rel, 'Bundle root'), target = path.resolve(root, safe); const info = await statOrNull(target); if (!info || info.isSymbolicLink() || !info.isDirectory()) throw errorWith('Bundle root must be a real directory', 'BUNDLE_ROOT_INVALID', { path: safe }); const real = await fs.realpath(target); if (!inside(root, real)) throw errorWith('Bundle root escapes project root', 'BUNDLE_PATH_ESCAPE'); return real; }
async function discover(root, roots) {
  const files = new Map(); let total = 0;
  for (const owner of roots) { const start = await rootDir(root, owner), stack = [start]; while (stack.length) { const dir = stack.pop(), entries = await fs.readdir(dir, { withFileTypes: true }); entries.sort((a, b) => a.name.localeCompare(b.name)); for (let i = entries.length - 1; i >= 0; i -= 1) { const entry = entries[i], full = path.join(dir, entry.name); if (entry.isSymbolicLink()) throw errorWith('Bundle roots may not contain symlink entries', 'BUNDLE_SYMLINK_UNSUPPORTED', { path: portable(path.relative(root, full)) }); if (entry.isDirectory()) { stack.push(full); continue; } if (!entry.isFile()) continue; const info = await fs.stat(full); if (info.size > LIMIT.file) throw errorWith('Bundle file exceeds hard byte limit', 'BUNDLE_FILE_LIMIT', { path: portable(path.relative(root, full)), bytes: info.size }); const real = await fs.realpath(full); if (!inside(root, real)) throw errorWith('Bundle file real path escapes root', 'BUNDLE_PATH_ESCAPE'); if (files.has(real)) continue; total += info.size; if (total > LIMIT.total) throw errorWith('Bundle input exceeds hard total byte limit', 'BUNDLE_TOTAL_LIMIT'); files.set(real, { full: real, path: portable(path.relative(root, real)), root: owner, bytes: info.size }); if (files.size > LIMIT.files) throw errorWith('Bundle file count exceeded limit', 'BUNDLE_FILE_LIMIT'); } } }
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}
function add(findings, finding) { findings.push(finding); if (findings.length > LIMIT.findings) throw errorWith('Bundle findings exceeded limit', 'BUNDLE_FINDING_LIMIT'); }
function pctGrowth(current, baseline) { if (baseline === 0) return current === 0 ? 0 : null; return ((current - baseline) / baseline) * 100; }
function category(file) { const ext = path.extname(file).toLowerCase(); if (['.js', '.mjs', '.cjs'].includes(ext)) return 'javascript'; if (ext === '.css') return 'css'; if (['.html', '.htm'].includes(ext)) return 'html'; if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico'].includes(ext)) return 'image'; if (['.woff', '.woff2', '.ttf', '.otf'].includes(ext)) return 'font'; if (ext === '.map') return 'source-map'; return 'other'; }

async function loadBaseline(root, config) {
  if (!config) return null; const file = await containedFile(root, config.path, LIMIT.baseline, 'BUNDLE_BASELINE_INVALID'); let parsed; try { parsed = JSON.parse(file.text); } catch { throw errorWith('Bundle baseline must be valid JSON', 'BUNDLE_BASELINE_INVALID'); }
  if (!parsed || parsed.contract !== BUNDLE_REPORT_CONTRACT || !Array.isArray(parsed.files) || parsed.files.length > LIMIT.files || !Number.isInteger(parsed.source?.totalBytes) || parsed.source.totalBytes < 0) throw errorWith('Bundle baseline report contract is invalid', 'BUNDLE_BASELINE_INVALID');
  if (typeof parsed.source.identity !== 'string' || !/^[0-9a-f]{64}$/i.test(parsed.source.identity)) throw errorWith('Bundle baseline source identity is invalid', 'BUNDLE_BASELINE_INVALID');
  const byPath = new Map(); let summedBytes = 0; for (const item of parsed.files) { if (!item || typeof item.path !== 'string' || !Number.isInteger(item.bytes) || item.bytes < 0) throw errorWith('Bundle baseline file metadata is invalid', 'BUNDLE_BASELINE_INVALID'); const itemPath = relative(item.path, 'Baseline file path'); if (byPath.has(itemPath)) throw errorWith('Bundle baseline contains duplicate file paths', 'BUNDLE_BASELINE_INVALID'); byPath.set(itemPath, item.bytes); summedBytes += item.bytes; }
  if (summedBytes !== parsed.source.totalBytes) throw errorWith('Bundle baseline byte totals are inconsistent', 'BUNDLE_BASELINE_INVALID');
  return { totalBytes: parsed.source.totalBytes, byPath, identity: parsed.source.identity.toLowerCase() };
}

export async function auditBundle(rootDir, rawSpec) {
  const root = await fs.realpath(path.resolve(rootDir)), spec = normalizeBundleSpec(rawSpec), discovered = await discover(root, spec.roots), findings = [], files = [], hashes = new Map();
  let totalBytes = 0, totalGzipBytes = 0, totalBrotliBytes = 0;
  for (const file of discovered) {
    const body = await fs.readFile(file.full); if (body.length !== file.bytes) throw errorWith('Bundle file changed during audit', 'BUNDLE_INPUT_CHANGED', { path: file.path }); const digest = sha256(body), ext = path.extname(file.path).toLowerCase(), compressible = COMPRESSIBLE.has(ext) && file.bytes > 0;
    const gzipBytes = compressible ? zlib.gzipSync(body, { level: 6 }).length : file.bytes, brotliBytes = compressible ? zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }).length : file.bytes;
    totalBytes += file.bytes; totalGzipBytes += gzipBytes; totalBrotliBytes += brotliBytes;
    const item = { path: file.path, root: file.root, category: category(file.path), bytes: file.bytes, gzipBytes, brotliBytes, sha256: digest }; files.push(item);
    const list = hashes.get(digest) || []; list.push(item); hashes.set(digest, list);
    if (spec.policy.maxFileBytes !== null && file.bytes > spec.policy.maxFileBytes) add(findings, { rule: 'file-bytes-exceeded', severity: 'high', path: file.path, actual: file.bytes, limit: spec.policy.maxFileBytes });
    if (spec.policy.maxFileGzipBytes !== null && gzipBytes > spec.policy.maxFileGzipBytes) add(findings, { rule: 'file-gzip-bytes-exceeded', severity: 'high', path: file.path, actual: gzipBytes, limit: spec.policy.maxFileGzipBytes });
    if (spec.policy.maxFileBrotliBytes !== null && brotliBytes > spec.policy.maxFileBrotliBytes) add(findings, { rule: 'file-brotli-bytes-exceeded', severity: 'high', path: file.path, actual: brotliBytes, limit: spec.policy.maxFileBrotliBytes });
    if (spec.policy.forbidSourceMaps && item.category === 'source-map') add(findings, { rule: 'source-map-forbidden', severity: 'high', path: file.path, actual: file.bytes });
  }
  if (files.length < spec.policy.minFiles) add(findings, { rule: 'minimum-bundle-files-not-met', severity: 'high', actual: files.length, expected: spec.policy.minFiles });
  if (spec.policy.maxTotalBytes !== null && totalBytes > spec.policy.maxTotalBytes) add(findings, { rule: 'total-bytes-exceeded', severity: 'high', actual: totalBytes, limit: spec.policy.maxTotalBytes });
  if (spec.policy.maxTotalGzipBytes !== null && totalGzipBytes > spec.policy.maxTotalGzipBytes) add(findings, { rule: 'total-gzip-bytes-exceeded', severity: 'high', actual: totalGzipBytes, limit: spec.policy.maxTotalGzipBytes });
  if (spec.policy.maxTotalBrotliBytes !== null && totalBrotliBytes > spec.policy.maxTotalBrotliBytes) add(findings, { rule: 'total-brotli-bytes-exceeded', severity: 'high', actual: totalBrotliBytes, limit: spec.policy.maxTotalBrotliBytes });
  let duplicateBytes = 0; for (const group of hashes.values()) if (group.length > 1) duplicateBytes += group[0].bytes * (group.length - 1);
  if (spec.policy.maxDuplicateBytes !== null && duplicateBytes > spec.policy.maxDuplicateBytes) add(findings, { rule: 'duplicate-bytes-exceeded', severity: 'medium', actual: duplicateBytes, limit: spec.policy.maxDuplicateBytes });
  const baseline = await loadBaseline(root, spec.baseline), comparison = baseline ? { baselineIdentity: baseline.identity, totalGrowthBytes: totalBytes - baseline.totalBytes, totalGrowthPercent: pctGrowth(totalBytes, baseline.totalBytes), comparedFiles: 0 } : null;
  if (baseline) {
    const b = spec.baseline; if (b.maxTotalGrowthBytes !== null && comparison.totalGrowthBytes > b.maxTotalGrowthBytes) add(findings, { rule: 'total-growth-bytes-exceeded', severity: 'high', actual: comparison.totalGrowthBytes, limit: b.maxTotalGrowthBytes }); if (b.maxTotalGrowthPercent !== null && (comparison.totalGrowthPercent === null || comparison.totalGrowthPercent > b.maxTotalGrowthPercent)) add(findings, { rule: 'total-growth-percent-exceeded', severity: 'high', actual: comparison.totalGrowthPercent, limit: b.maxTotalGrowthPercent });
    for (const file of files) { const old = baseline.byPath.get(file.path); if (old === undefined) continue; comparison.comparedFiles += 1; const growthBytes = file.bytes - old, growthPercent = pctGrowth(file.bytes, old); if (b.maxFileGrowthBytes !== null && growthBytes > b.maxFileGrowthBytes) add(findings, { rule: 'file-growth-bytes-exceeded', severity: 'medium', path: file.path, actual: growthBytes, limit: b.maxFileGrowthBytes }); if (b.maxFileGrowthPercent !== null && (growthPercent === null || growthPercent > b.maxFileGrowthPercent)) add(findings, { rule: 'file-growth-percent-exceeded', severity: 'medium', path: file.path, actual: growthPercent, limit: b.maxFileGrowthPercent }); }
  }
  findings.sort((a, b) => (SEVERITY[b.severity] - SEVERITY[a.severity]) || String(a.path || '').localeCompare(String(b.path || '')) || a.rule.localeCompare(b.rule));
  const counts = { critical: 0, high: 0, medium: 0, low: 0 }; for (const finding of findings) counts[finding.severity] += 1;
  const sourceIdentity = sha256(files.map((f) => `${f.path}\0${f.sha256}`).join('\n'));
  return { contract: BUNDLE_REPORT_CONTRACT, root: '.', spec: { contract: spec.contract, identity: sha256(JSON.stringify(stable(spec))), roots: [...spec.roots], policy: { ...spec.policy }, baseline: spec.baseline ? { ...spec.baseline } : null }, source: { files: files.length, totalBytes, totalGzipBytes, totalBrotliBytes, duplicateBytes, identity: sourceIdentity }, files, comparison, findings, counts, limitations: ['Offline artifact-size audit only; the lab does not execute a bundler or infer runtime code coverage.', 'Gzip/brotli sizes are deterministic local transfer estimates: known text artifacts are compressed locally and other artifact types use raw bytes.', 'Transfer estimates are not CDN-specific wire-size proofs.'] };
}

function rank(value) { return SEVERITY[value] || 0; }
export function evaluateBundleReport(report, failOn = 'high') { if (!report || report.contract !== BUNDLE_REPORT_CONTRACT || !Array.isArray(report.findings)) throw errorWith('Invalid bundle report', 'BUNDLE_REPORT_INVALID'); const level = String(failOn).toLowerCase(); if (!['none', 'low', 'medium', 'high', 'critical'].includes(level)) throw errorWith('Invalid failOn severity', 'BUNDLE_FAIL_LEVEL_INVALID'); const threshold = level === 'none' ? Infinity : rank(level), failing = report.findings.filter((f) => rank(f.severity) >= threshold); return { passed: failing.length === 0, failOn: level, failing: failing.length }; }
async function safeParent(root, target) { const rel = path.relative(root, path.dirname(target)); if (!rel || rel === '.') return; let current = root; for (const part of rel.split(path.sep)) { current = path.join(current, part); const info = await statOrNull(current); if (info) { if (info.isSymbolicLink() || !info.isDirectory()) throw errorWith('Output parent contains a symlink or non-directory', 'BUNDLE_PATH_ESCAPE'); } else await fs.mkdir(current, { mode: 0o700 }); } }
async function writeReport(rootDir, rel, payload, auditedRoots) { const root = await fs.realpath(path.resolve(rootDir)), safe = relative(rel, 'Output path'); for (const bundleRoot of auditedRoots) { const prefix = `${bundleRoot.replace(/\/$/, '')}/`; if (safe === bundleRoot || safe.startsWith(prefix)) throw errorWith('Bundle report must live outside audited roots', 'BUNDLE_OUTPUT_INVALID'); } const target = path.resolve(root, safe); if (!inside(root, target)) throw errorWith('Output path escapes root', 'BUNDLE_PATH_ESCAPE'); await safeParent(root, target); const info = await statOrNull(target); if (info && (info.isSymbolicLink() || !info.isFile())) throw errorWith('Output target must be a regular file', 'BUNDLE_OUTPUT_INVALID'); const text = `${JSON.stringify(payload, null, 2)}\n`; await fs.writeFile(target, text, { mode: 0o600 }); await fs.chmod(target, 0o600).catch(() => {}); return { path: portable(path.relative(root, target)), bytes: Buffer.byteLength(text), sha256: sha256(text) }; }
async function loadSpec(rootDir, rel) { const root = await fs.realpath(path.resolve(rootDir)), file = await containedFile(root, rel, LIMIT.spec, 'BUNDLE_SPEC_INVALID'); try { return normalizeBundleSpec(JSON.parse(file.text)); } catch (e) { if (e?.code) throw e; throw errorWith('Bundle spec must be valid JSON', 'BUNDLE_SPEC_INVALID'); } }
function pathInRoots(rel, roots) { const safe = relative(rel, 'Path'); return roots.some((bundleRoot) => safe === bundleRoot || safe.startsWith(`${bundleRoot.replace(/\/$/, '')}/`)); }
function usage() { return `Veteran Native Bundle Lab\n\nUsage:\n  node src/native-bundle-lab.mjs audit <spec.json> [--root .] [--fail-on high] [--out report.json]\n\nAudits local build artifacts and optional size baselines without network upload.\n`; }
export async function main(argv = process.argv.slice(2)) { const command = argv[0] || 'help'; if (['help', '-h', '--help'].includes(command)) { process.stdout.write(usage()); return 0; } if (command !== 'audit') throw errorWith(`Unknown command: ${command}`, 'BUNDLE_COMMAND_UNKNOWN'); const specPath = argv[1]; if (!specPath || specPath.startsWith('--')) throw errorWith('audit requires a spec path', 'BUNDLE_ARGUMENT_REQUIRED'); let rootDir = process.cwd(), failOn = 'high', out = null; for (let i = 2; i < argv.length; i += 1) { const arg = argv[i]; if (arg === '--root') rootDir = argv[++i]; else if (arg === '--fail-on') failOn = argv[++i]; else if (arg === '--out') out = argv[++i]; else throw errorWith(`Unknown argument: ${arg}`, 'BUNDLE_ARGUMENT_UNKNOWN'); if (!argv[i] && ['--root', '--fail-on', '--out'].includes(arg)) throw errorWith(`${arg} requires a value`, 'BUNDLE_ARGUMENT_REQUIRED'); } const spec = await loadSpec(rootDir, specPath); if (pathInRoots(specPath, spec.roots)) throw errorWith('Bundle spec must live outside audited roots', 'BUNDLE_SPEC_INVALID'); const report = await auditBundle(rootDir, spec), evaluation = evaluateBundleReport(report, failOn), result = { ...report, evaluation }, artifact = out ? await writeReport(rootDir, out, result, spec.roots) : null; process.stdout.write(`${JSON.stringify({ ...result, artifact }, null, 2)}\n`); return evaluation.passed ? 0 : 2; }
const invoked = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invoked) main().then((code) => { process.exitCode = code; }).catch((e) => { process.stderr.write(`${e?.code || 'BUNDLE_ERROR'}: ${String(e?.message || e)}\n`); process.exitCode = 1; });
