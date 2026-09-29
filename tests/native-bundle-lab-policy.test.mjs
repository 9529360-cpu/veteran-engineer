import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BUNDLE_SPEC_CONTRACT, auditBundle, normalizeBundleSpec } from '../src/native-bundle-lab.mjs';

async function tempRoot() { return fs.mkdtemp(path.join(os.tmpdir(), 'veteran-bundle-policy-')); }
async function write(root, rel, body) { const file = path.join(root, rel); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, body); return file; }
function spec(extra = {}) { return { contract: BUNDLE_SPEC_CONTRACT, roots: ['dist'], policy: {}, ...extra }; }

test('category byte budgets expose deterministic category totals and gate named categories only', async () => {
  const root = await tempRoot();
  await write(root, 'dist/app.js', 'j'.repeat(80));
  await write(root, 'dist/styles.css', 'c'.repeat(40));
  await write(root, 'dist/image.png', Buffer.alloc(20));
  const report = await auditBundle(root, spec({ policy: { maxCategoryBytes: { javascript: 50, css: 100 } } }));
  assert.equal(report.source.categories.javascript.files, 1);
  assert.equal(report.source.categories.javascript.bytes, 80);
  assert.equal(report.source.categories.css.bytes, 40);
  assert.equal(report.source.categories.image.bytes, 20);
  const finding = report.findings.find((item) => item.rule === 'category-bytes-exceeded');
  assert.deepEqual({ category: finding.category, actual: finding.actual, limit: finding.limit }, { category: 'javascript', actual: 80, limit: 50 });
  assert.throws(() => normalizeBundleSpec({ contract: BUNDLE_SPEC_CONTRACT, roots: ['dist'], policy: { maxCategoryBytes: { video: 10 } } }), (e) => e.code === 'BUNDLE_SPEC_INVALID');
  assert.throws(() => normalizeBundleSpec({ contract: BUNDLE_SPEC_CONTRACT, roots: ['dist'], policy: { maxCategoryBytes: [] } }), (e) => e.code === 'BUNDLE_SPEC_INVALID');
});

test('baseline can forbid new and removed artifacts with deterministic file lists', async () => {
  const root = await tempRoot();
  await write(root, 'dist/keep.js', 'keep');
  await write(root, 'dist/remove.js', 'remove');
  const baseline = await auditBundle(root, spec());
  await write(root, 'baseline.json', JSON.stringify(baseline));
  await fs.rm(path.join(root, 'dist/remove.js'));
  await write(root, 'dist/new.js', 'new');
  const report = await auditBundle(root, spec({ baseline: { path: 'baseline.json', forbidNewFiles: true, forbidRemovedFiles: true } }));
  assert.deepEqual(report.comparison.newFiles, ['dist/new.js']);
  assert.deepEqual(report.comparison.removedFiles, ['dist/remove.js']);
  assert.ok(report.findings.some((item) => item.rule === 'new-file-forbidden' && item.path === 'dist/new.js'));
  assert.ok(report.findings.some((item) => item.rule === 'removed-file-forbidden' && item.path === 'dist/remove.js'));
  assert.throws(() => normalizeBundleSpec({ contract: BUNDLE_SPEC_CONTRACT, roots: ['dist'], baseline: { path: 'baseline.json', forbidNewFiles: 'yes' } }), (e) => e.code === 'BUNDLE_SPEC_INVALID');
});

test('baseline source identity is recomputed from file evidence and rejects a syntactically valid tampered digest', async () => {
  const root = await tempRoot();
  await write(root, 'dist/app.js', 'ok');
  const baseline = await auditBundle(root, spec());
  baseline.source.identity = '0'.repeat(64);
  await write(root, 'baseline.json', JSON.stringify(baseline));
  await assert.rejects(() => auditBundle(root, spec({ baseline: { path: 'baseline.json' } })), (e) => e.code === 'BUNDLE_BASELINE_INVALID');
});
