import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { BUNDLE_SPEC_CONTRACT, auditBundle, evaluateBundleReport, normalizeBundleSpec } from '../src/native-bundle-lab.mjs';

async function tempRoot() { return fs.mkdtemp(path.join(os.tmpdir(), 'veteran-bundle-')); }
async function write(root, rel, body) { const file = path.join(root, rel); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, body); return file; }
function spec(extra = {}) { return { contract: BUNDLE_SPEC_CONTRACT, roots: ['dist'], policy: {}, ...extra }; }
const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(MODULE_ROOT, 'src', 'native-bundle-lab.mjs');
function runCli(args, cwd) { return new Promise((resolve, reject) => { const child = spawn(process.execPath, [CLI, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = ''; child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8'); child.stdout.on('data', (c) => { stdout += c; }); child.stderr.on('data', (c) => { stderr += c; }); child.on('error', reject); child.on('close', (code) => resolve({ code, stdout, stderr })); }); }

test('audits bytes, deterministic identities, and compressed estimates without returning content', async () => {
  const root = await tempRoot(); await write(root, 'dist/app.js', 'const answer = 42;\n'.repeat(100)); await write(root, 'dist/logo.bin', Buffer.alloc(128, 7));
  const report = await auditBundle(root, spec());
  assert.equal(report.files.length, 2); assert.ok(report.source.totalBytes > 128); assert.ok(report.files.find((f) => f.path.endsWith('app.js')).gzipBytes > 0); assert.equal(report.files.find((f) => f.path.endsWith('logo.bin')).gzipBytes, 128); assert.equal(JSON.stringify(report).includes('const answer'), false); assert.equal(evaluateBundleReport(report).passed, true);
  assert.equal(report.source.identity, (await auditBundle(root, spec())).source.identity);
});

test('enforces total, per-file, gzip, brotli, and source-map budgets', async () => {
  const root = await tempRoot(); await write(root, 'dist/app.js', 'x'.repeat(5000)); await write(root, 'dist/app.js.map', '{}');
  const report = await auditBundle(root, spec({ policy: { maxTotalBytes: 100, maxFileBytes: 100, maxFileGzipBytes: 10, maxFileBrotliBytes: 10, maxTotalGzipBytes: 10, maxTotalBrotliBytes: 10, forbidSourceMaps: true } }));
  const rules = report.findings.map((f) => f.rule); for (const rule of ['total-bytes-exceeded', 'total-gzip-bytes-exceeded', 'total-brotli-bytes-exceeded', 'file-bytes-exceeded', 'file-gzip-bytes-exceeded', 'file-brotli-bytes-exceeded', 'source-map-forbidden']) assert.ok(rules.includes(rule), rule);
  assert.equal(evaluateBundleReport(report, 'high').passed, false);
});

test('duplicate bytes budget counts only redundant copies', async () => {
  const root = await tempRoot(); const body = Buffer.from('same artifact'); await write(root, 'dist/a.bin', body); await write(root, 'dist/b.bin', body); await write(root, 'dist/c.bin', Buffer.from('other'));
  const report = await auditBundle(root, spec({ policy: { maxDuplicateBytes: 0 } }));
  assert.equal(report.source.duplicateBytes, body.length); assert.ok(report.findings.some((f) => f.rule === 'duplicate-bytes-exceeded'));
});

test('baseline comparison gates total and matched-file growth without requiring upload', async () => {
  const root = await tempRoot(); await write(root, 'dist/app.js', 'a'.repeat(100));
  const baseline = await auditBundle(root, spec()); await write(root, 'baseline.json', JSON.stringify(baseline)); await write(root, 'dist/app.js', 'a'.repeat(150));
  const report = await auditBundle(root, spec({ baseline: { path: 'baseline.json', maxTotalGrowthBytes: 10, maxTotalGrowthPercent: 10, maxFileGrowthBytes: 10, maxFileGrowthPercent: 10 } }));
  assert.equal(report.comparison.totalGrowthBytes, 50); assert.equal(report.comparison.comparedFiles, 1); const rules = report.findings.map((f) => f.rule); for (const rule of ['total-growth-bytes-exceeded', 'total-growth-percent-exceeded', 'file-growth-bytes-exceeded', 'file-growth-percent-exceeded']) assert.ok(rules.includes(rule), rule);
});

test('zero-byte baseline growth percent fails closed when growth exists', async () => {
  const root = await tempRoot(); await write(root, 'dist/empty.js', ''); const baseline = await auditBundle(root, spec()); await write(root, 'baseline.json', JSON.stringify(baseline)); await write(root, 'dist/empty.js', 'x');
  const report = await auditBundle(root, spec({ baseline: { path: 'baseline.json', maxTotalGrowthPercent: 5, maxFileGrowthPercent: 5 } }));
  assert.equal(report.comparison.totalGrowthPercent, null); assert.ok(report.findings.some((f) => f.rule === 'total-growth-percent-exceeded')); assert.ok(report.findings.some((f) => f.rule === 'file-growth-percent-exceeded'));
});

test('missing roots and invalid/overlapping specs fail with stable errors', async () => {
  const root = await tempRoot(); await assert.rejects(() => auditBundle(root, spec()), (e) => e.code === 'BUNDLE_ROOT_INVALID');
  assert.throws(() => normalizeBundleSpec({ contract: BUNDLE_SPEC_CONTRACT, roots: ['dist', 'dist/assets'] }), (e) => e.code === 'BUNDLE_SPEC_INVALID'); assert.throws(() => normalizeBundleSpec({ contract: BUNDLE_SPEC_CONTRACT, roots: ['../outside'] }), (e) => e.code === 'BUNDLE_PATH_INVALID');
});

test('symlink roots and output-parent symlinks fail closed', async (t) => {
  if (process.platform === 'win32') t.skip('symlink permissions are environment dependent on Windows');
  const root = await tempRoot(), outside = await tempRoot(); await write(outside, 'app.js', 'secret'); await fs.symlink(outside, path.join(root, 'dist')); await assert.rejects(() => auditBundle(root, spec()), (e) => ['BUNDLE_ROOT_INVALID', 'BUNDLE_PATH_ESCAPE'].includes(e.code));
  await fs.rm(path.join(root, 'dist'), { force: true }); await fs.mkdir(path.join(root, 'dist')); await write(root, 'dist/app.js', 'ok'); await write(root, 'spec.json', JSON.stringify(spec())); await fs.symlink(outside, path.join(root, 'reports'));
  const result = await runCli(['audit', 'spec.json', '--root', root, '--out', 'reports/result.json'], path.resolve('.')); assert.equal(result.code, 1); assert.match(result.stderr, /BUNDLE_PATH_ESCAPE/); await assert.rejects(() => fs.stat(path.join(outside, 'result.json')), (e) => e.code === 'ENOENT');
});

test('baseline path traversal and malformed baseline fail closed', async () => {
  const root = await tempRoot(); await write(root, 'dist/app.js', 'ok'); await assert.rejects(() => auditBundle(root, spec({ baseline: { path: '../baseline.json' } })), (e) => e.code === 'BUNDLE_PATH_INVALID');
  await write(root, 'baseline.json', '{}'); await assert.rejects(() => auditBundle(root, spec({ baseline: { path: 'baseline.json' } })), (e) => e.code === 'BUNDLE_BASELINE_INVALID');
});


test('baseline and report paths cannot contaminate audited roots', async () => {
  assert.throws(() => normalizeBundleSpec({ contract: BUNDLE_SPEC_CONTRACT, roots: ['dist'], baseline: { path: 'dist/baseline.json' } }), (e) => e.code === 'BUNDLE_SPEC_INVALID');
  const root = await tempRoot(); await write(root, 'dist/app.js', 'ok'); await write(root, 'spec.json', JSON.stringify(spec()));
  const result = await runCli(['audit', 'spec.json', '--root', root, '--out', 'dist/report.json'], path.resolve('.')); assert.equal(result.code, 1); assert.match(result.stderr, /BUNDLE_OUTPUT_INVALID/); await assert.rejects(() => fs.stat(path.join(root, 'dist/report.json')), (e) => e.code === 'ENOENT');
});

test('symlink entries inside an audited bundle fail closed instead of being silently undercounted', async (t) => {
  if (process.platform === 'win32') t.skip('symlink permissions are environment dependent on Windows');
  const root = await tempRoot(), outside = await tempRoot(); await fs.mkdir(path.join(root, 'dist')); await write(outside, 'large.js', 'x'.repeat(1000)); await fs.symlink(path.join(outside, 'large.js'), path.join(root, 'dist/external.js'));
  await assert.rejects(() => auditBundle(root, spec()), (e) => e.code === 'BUNDLE_SYMLINK_UNSUPPORTED');
});

test('baseline rejects duplicate paths and malformed file metadata', async () => {
  const root = await tempRoot(); await write(root, 'dist/app.js', 'ok');
  const bad = { contract: 'veteran-native-bundle-report-v1', source: { totalBytes: 1 }, files: [{ path: 'dist/app.js', bytes: 1 }, { path: 'dist/app.js', bytes: 1 }] }; await write(root, 'baseline.json', JSON.stringify(bad));
  await assert.rejects(() => auditBundle(root, spec({ baseline: { path: 'baseline.json' } })), (e) => e.code === 'BUNDLE_BASELINE_INVALID');
});


test('compressed aggregate budgets include identity-transfer bytes for non-compressible artifacts and cjs/maps are compressible', async () => {
  const root = await tempRoot(); await write(root, 'dist/image.bin', Buffer.alloc(500, 3)); await write(root, 'dist/server.cjs', 'module.exports = 1;\n'.repeat(100)); await write(root, 'dist/app.js.map', JSON.stringify({ mappings: 'A'.repeat(1000) }));
  const report = await auditBundle(root, spec({ policy: { maxTotalGzipBytes: 100, maxTotalBrotliBytes: 100 } }));
  const binary = report.files.find((f) => f.path.endsWith('image.bin')); const cjs = report.files.find((f) => f.path.endsWith('server.cjs')); const map = report.files.find((f) => f.path.endsWith('app.js.map'));
  assert.equal(binary.gzipBytes, 500); assert.equal(binary.brotliBytes, 500); assert.ok(cjs.gzipBytes < cjs.bytes); assert.ok(map.gzipBytes < map.bytes); assert.ok(report.findings.some((f) => f.rule === 'total-gzip-bytes-exceeded')); assert.ok(report.findings.some((f) => f.rule === 'total-brotli-bytes-exceeded'));
});

test('baseline requires a valid identity and internally consistent total bytes', async () => {
  const root = await tempRoot(); await write(root, 'dist/app.js', 'ok');
  const current = await auditBundle(root, spec()); current.source.identity = 'not-a-digest'; await write(root, 'baseline.json', JSON.stringify(current));
  await assert.rejects(() => auditBundle(root, spec({ baseline: { path: 'baseline.json' } })), (e) => e.code === 'BUNDLE_BASELINE_INVALID');
  const good = await auditBundle(root, spec()); good.source.totalBytes += 1; await write(root, 'baseline.json', JSON.stringify(good));
  await assert.rejects(() => auditBundle(root, spec({ baseline: { path: 'baseline.json' } })), (e) => e.code === 'BUNDLE_BASELINE_INVALID');
});

test('CLI spec file cannot live inside the audited bundle root', async () => {
  const root = await tempRoot(); await write(root, 'dist/app.js', 'ok'); await write(root, 'dist/spec.json', JSON.stringify(spec()));
  const result = await runCli(['audit', 'dist/spec.json', '--root', root], path.resolve('.')); assert.equal(result.code, 1); assert.match(result.stderr, /BUNDLE_SPEC_INVALID/);
});

test('CLI writes mode-0600 report and returns exit 2 on a failed gate', async () => {
  const root = await tempRoot(); await write(root, 'dist/app.js', 'x'.repeat(100)); await write(root, 'spec.json', JSON.stringify(spec({ policy: { maxTotalBytes: 10 } })));
  const result = await runCli(['audit', 'spec.json', '--root', root, '--out', 'reports/result.json'], path.resolve('.')); assert.equal(result.code, 2, result.stderr); const parsed = JSON.parse(result.stdout); assert.equal(parsed.evaluation.passed, false); const info = await fs.stat(path.join(root, 'reports/result.json')); if (process.platform !== 'win32') assert.equal(info.mode & 0o777, 0o600);
});
