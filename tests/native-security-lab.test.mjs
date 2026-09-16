import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createSecurityBaseline,
  scanSecurityLab,
  SECURITY_BASELINE_CONTRACT,
  writeSecurityBaseline,
  writeSecurityReport
} from '../src/native-security-lab.mjs';

async function tempRoot() { return fs.mkdtemp(path.join(os.tmpdir(), 'veteran-security-lab-')); }
async function write(root, relative, content) {
  const target = path.join(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
  return target;
}

test('detects specific and generic credentials without returning raw values', async () => {
  const root = await tempRoot();
  const github = `ghp_${'A'.repeat(36)}`;
  const stripe = `sk_live_${'b'.repeat(24)}`;
  const generic = 'Y7x!2Qv9Lp4Zm8Nc5Rt1';
  try {
    await write(root, '.env', `GITHUB_TOKEN=${github}\nSTRIPE=${stripe}\npassword="${generic}"\n`);
    const report = await scanSecurityLab({ rootDir: root, failOn: 'high' });
    assert.equal(report.passed, false);
    assert.deepEqual(new Set(report.findings.map((item) => item.kind)), new Set(['github-token', 'stripe-live-secret', 'generic-secret-assignment']));
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes(github), false);
    assert.equal(serialized.includes(stripe), false);
    assert.equal(serialized.includes(generic), false);
    assert.equal(report.findings.every((item) => item.context.includes('[REDACTED')), true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('ignores common placeholders and environment references', async () => {
  const root = await tempRoot();
  try {
    await write(root, 'config.js', `const api_key = "YOUR_API_KEY_HERE";\nconst password = "changeme-please";\nconst secret = "${'${process.env.SECRET}'}";\n`);
    const report = await scanSecurityLab({ rootDir: root });
    assert.equal(report.findings.length, 0);
    assert.equal(report.passed, true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('scans pem and key files and never echoes private key material', async () => {
  const root = await tempRoot();
  const fakePrivate = '-----BEGIN PRIVATE KEY-----\nSUPER-SECRET-PRIVATE-MATERIAL\n-----END PRIVATE KEY-----\n';
  try {
    await write(root, 'certs/dev.pem', fakePrivate);
    await write(root, 'certs/legacy.key', fakePrivate);
    const report = await scanSecurityLab({ rootDir: root, failOn: 'critical' });
    assert.equal(report.passed, false);
    assert.equal(report.findings.filter((item) => item.kind === 'private-key').length, 2);
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes('SUPER-SECRET-PRIVATE-MATERIAL'), false);
    assert.equal(serialized.includes('BEGIN PRIVATE KEY'), false);
    assert.equal(report.findings.every((item) => item.context === '[REDACTED PRIVATE KEY MATERIAL]'), true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('rotated private key at the same path gets a new fingerprint instead of being masked by baseline', async () => {
  const root = await tempRoot();
  const first = '-----BEGIN PRIVATE KEY-----\nAAAA-FIRST-KEY-MATERIAL-BBBB\n-----END PRIVATE KEY-----\n';
  const second = '-----BEGIN PRIVATE KEY-----\nCCCC-SECOND-KEY-MATERIAL-DDDD\n-----END PRIVATE KEY-----\n';
  try {
    await write(root, 'service.key', first);
    const initial = await scanSecurityLab({ rootDir: root, failOn: 'critical' });
    await writeSecurityBaseline(initial, '.security-baseline.json', { rootDir: root });
    await write(root, 'service.key', second);
    const changed = await scanSecurityLab({ rootDir: root, baselinePath: '.security-baseline.json', failOn: 'critical' });
    assert.equal(changed.passed, false);
    assert.equal(changed.baselineCount, 0);
    assert.equal(changed.newCounts.critical, 1);
    assert.notEqual(changed.findings[0].fingerprint, initial.findings[0].fingerprint);
    assert.equal(JSON.stringify(changed).includes('SECOND-KEY-MATERIAL'), false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('baseline stores fingerprints only and suppresses known findings while failing on new ones', async () => {
  const root = await tempRoot();
  const first = `ghp_${'C'.repeat(36)}`;
  const second = `sk_live_${'d'.repeat(24)}`;
  try {
    await write(root, 'app.env', `TOKEN=${first}\n`);
    const initial = await scanSecurityLab({ rootDir: root, failOn: 'high' });
    const baseline = await createSecurityBaseline(initial);
    assert.equal(baseline.contract, SECURITY_BASELINE_CONTRACT);
    assert.deepEqual(Object.keys(baseline).sort(), ['contract', 'fingerprints']);
    await writeSecurityBaseline(initial, '.security-baseline.json', { rootDir: root });
    const known = await scanSecurityLab({ rootDir: root, baselinePath: '.security-baseline.json', failOn: 'high' });
    assert.equal(known.passed, true);
    assert.equal(known.baselineCount, 1);
    await write(root, 'next.env', `TOKEN=${second}\n`);
    const changed = await scanSecurityLab({ rootDir: root, baselinePath: '.security-baseline.json', failOn: 'high' });
    assert.equal(changed.passed, false);
    assert.equal(changed.newCounts.critical, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('legacy report baseline remains readable for branch compatibility', async () => {
  const root = await tempRoot();
  try {
    await write(root, 'app.env', `TOKEN=ghp_${'E'.repeat(36)}\n`);
    const initial = await scanSecurityLab({ rootDir: root });
    await fs.mkdir(path.join(root, 'artifacts'));
    await writeSecurityReport(initial, 'artifacts/legacy-report.json', { rootDir: root });
    const known = await scanSecurityLab({ rootDir: root, baselinePath: 'artifacts/legacy-report.json' });
    assert.equal(known.passed, true);
    assert.equal(known.baselineCount, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('ignores build vendor git directories and symlinked files', async (t) => {
  const root = await tempRoot();
  const outside = await tempRoot();
  const token = `ghp_${'F'.repeat(36)}`;
  try {
    await write(root, 'node_modules/pkg/config.js', `const token='${token}';\n`);
    await write(root, 'dist/config.js', `const token='${token}';\n`);
    await write(root, '.git/config-secret.txt', token);
    await write(outside, 'secret.env', `TOKEN=${token}\n`);
    try { await fs.symlink(path.join(outside, 'secret.env'), path.join(root, 'linked.env')); }
    catch (error) {
      if (!['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) throw error;
      t.diagnostic('symlink creation unavailable; ignored-directory coverage still applies');
    }
    await write(root, 'safe.js', 'console.log("safe");\n');
    const report = await scanSecurityLab({ rootDir: root, failOn: 'any' });
    assert.equal(report.findings.length, 0);
    assert.equal(report.source.files, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('skips binary-looking input and honors severity thresholds', async () => {
  const root = await tempRoot();
  try {
    const jwt = `eyJ${'A'.repeat(12)}.${'B'.repeat(12)}.${'C'.repeat(12)}`;
    await write(root, 'auth.txt', jwt);
    await write(root, 'binary.key', Buffer.from([0, 1, 2, 3, 45, 45, 45, 45]));
    const highOnly = await scanSecurityLab({ rootDir: root, failOn: 'high' });
    assert.equal(highOnly.passed, true);
    assert.equal(highOnly.counts.medium, 1);
    const medium = await scanSecurityLab({ rootDir: root, failOn: 'medium' });
    assert.equal(medium.passed, false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('baseline and output paths cannot escape root, including symlinked parents', async (t) => {
  const root = await tempRoot();
  const outside = await tempRoot();
  try {
    await write(root, 'safe.js', 'const value = 1;\n');
    await assert.rejects(() => scanSecurityLab({ rootDir: root, baselinePath: '../outside.json' }), (error) => error.code === 'SECURITY_PATH_INVALID');
    const report = await scanSecurityLab({ rootDir: root, failOn: 'none' });
    await assert.rejects(() => writeSecurityReport(report, '../escape.json', { rootDir: root }), (error) => error.code === 'SECURITY_PATH_INVALID');
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
