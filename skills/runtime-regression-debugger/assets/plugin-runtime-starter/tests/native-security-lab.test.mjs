import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanSecurityLab, writeSecurityReport } from '../src/native-security-lab.mjs';

async function tempRoot() { return fs.mkdtemp(path.join(os.tmpdir(), 'veteran-security-lab-')); }

test('Security Lab detects specific and generic secrets without returning raw values', async () => {
  const root = await tempRoot();
  try {
    const aws = 'AKIA1234567890ABCDEF';
    const github = 'ghp_abcdefghijklmnopqrstuvwxyz1234567890ABCD';
    const generic = 'Y7x!2Qv9Lp4Zm8Nc5Rt1';
    await fs.writeFile(path.join(root, '.env'), `AWS_ACCESS_KEY_ID=${aws}\nGITHUB_TOKEN=${github}\npassword="${generic}"\n`, 'utf8');
    const report = await scanSecurityLab({ rootDir: root, failOn: 'high' });
    assert.equal(report.passed, false);
    assert.ok(report.findings.some((finding) => finding.kind === 'aws-access-key'));
    assert.ok(report.findings.some((finding) => finding.kind === 'github-token'));
    assert.ok(report.findings.some((finding) => finding.kind === 'generic-secret-assignment'));
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes(aws), false);
    assert.equal(serialized.includes(github), false);
    assert.equal(serialized.includes(generic), false);
    assert.ok(report.findings.every((finding) => finding.context.includes('[REDACTED]')));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Security Lab ignores common placeholders and environment references', async () => {
  const root = await tempRoot();
  try {
    await fs.writeFile(path.join(root, 'config.js'), `const api_key = "YOUR_API_KEY_HERE";\nconst password = "changeme-please";\nconst secret = "${'${process.env.SECRET}'}";\n`, 'utf8');
    const report = await scanSecurityLab({ rootDir: root });
    assert.equal(report.findings.length, 0);
    assert.equal(report.passed, true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Security Lab flags private key headers without exposing key material', async () => {
  const root = await tempRoot();
  try {
    await fs.writeFile(path.join(root, 'key.pem'), '-----BEGIN PRIVATE KEY-----\nSUPERSECRETKEYDATA\n-----END PRIVATE KEY-----\n', 'utf8');
    const report = await scanSecurityLab({ rootDir: root, failOn: 'critical' });
    assert.equal(report.passed, false);
    assert.equal(report.findings[0].kind, 'private-key');
    assert.equal(JSON.stringify(report).includes('SUPERSECRETKEYDATA'), false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Security Lab ignores vendor trees and symlinked files', async (t) => {
  const root = await tempRoot();
  const outside = await tempRoot();
  try {
    await fs.mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    await fs.writeFile(path.join(root, 'node_modules', 'pkg', 'config.js'), 'const password="N0tVendorSecret123456!";\n', 'utf8');
    await fs.writeFile(path.join(outside, 'secret.env'), 'password="OutsideSecret987654!"\n', 'utf8');
    try { await fs.symlink(path.join(outside, 'secret.env'), path.join(root, 'linked.env')); }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('symlink creation unavailable'); return; }
      throw error;
    }
    await fs.writeFile(path.join(root, 'safe.js'), 'console.log("safe");\n', 'utf8');
    const report = await scanSecurityLab({ rootDir: root });
    assert.equal(report.source.files, 1);
    assert.equal(report.findings.length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('Security Lab baseline marks existing fingerprints and fails only on new findings', async () => {
  const root = await tempRoot();
  try {
    await fs.mkdir(path.join(root, 'artifacts'));
    await fs.writeFile(path.join(root, 'app.env'), 'password="ExistingSecret123456789!"\n', 'utf8');
    const first = await scanSecurityLab({ rootDir: root });
    await writeSecurityReport(first, 'artifacts/baseline.json', { rootDir: root });
    const baselineOnly = await scanSecurityLab({ rootDir: root, baselinePath: 'artifacts/baseline.json' });
    assert.equal(baselineOnly.passed, true);
    assert.equal(baselineOnly.baselineCount, 1);
    assert.equal(baselineOnly.newCounts.high, 0);
    await fs.writeFile(path.join(root, 'second.env'), 'api_key="BrandNewSecret987654321!"\n', 'utf8');
    const withNew = await scanSecurityLab({ rootDir: root, baselinePath: 'artifacts/baseline.json' });
    assert.equal(withNew.passed, false);
    assert.equal(withNew.newCounts.high, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Security Lab report output containment rejects parent and symlink escapes', async (t) => {
  const root = await tempRoot();
  const outside = await tempRoot();
  try {
    await fs.writeFile(path.join(root, 'safe.js'), 'const value = 1;\n', 'utf8');
    const report = await scanSecurityLab({ rootDir: root, failOn: 'none' });
    await assert.rejects(() => writeSecurityReport(report, '../escape.json', { rootDir: root }), (error) => error.code === 'SECURITY_LAB_ROOT_ESCAPE');
    try { await fs.symlink(outside, path.join(root, 'link')); }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('symlink creation unavailable'); return; }
      throw error;
    }
    await assert.rejects(() => writeSecurityReport(report, 'link/report.json', { rootDir: root }), (error) => error.code === 'SECURITY_LAB_ROOT_ESCAPE');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});
