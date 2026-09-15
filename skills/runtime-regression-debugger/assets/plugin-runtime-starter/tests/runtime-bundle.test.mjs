import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { buildRuntimeBundle, materializeRuntimeBundle, serializeRuntimeBundle, writeRuntimeBundle, RUNTIME_DISTRIBUTION_ROOTS } from '../src/installer/runtime-bundle.mjs';
import { tempDir, cleanup } from './helpers.mjs';

async function fixture(root, version = '1.2.3') {
  for (const rel of RUNTIME_DISTRIBUTION_ROOTS) {
    const target = path.join(root, rel);
    if (['.mcp.json', 'NEXT_CHAT_HANDOFF.md', 'README.md', 'package-lock.json', 'package.json'].includes(rel)) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, rel === 'package.json' ? `${JSON.stringify({ name: 'veteran-engineer', version })}\n` : `${rel}\n`);
    } else await fs.mkdir(target, { recursive: true });
  }
  await fs.writeFile(path.join(root, '.codex-plugin', 'plugin.json'), `${JSON.stringify({ name: 'veteran-engineer', version })}\n`);
  await fs.writeFile(path.join(root, 'src', 'constants.mjs'), `export const RUNTIME_VERSION = '${version}';\n`);
  const executable = path.join(root, 'bin', 'veteran-engineer.mjs');
  await fs.writeFile(executable, '#!/usr/bin/env node\n');
  await fs.chmod(executable, 0o755);
  await fs.writeFile(path.join(root, 'tests', 'smoke.test.mjs'), 'export {};\n');
  await fs.mkdir(path.join(root, 'skills', 'runtime-regression-debugger', 'assets', 'plugin-runtime-starter'), { recursive: true });
  await fs.writeFile(path.join(root, 'skills', 'runtime-regression-debugger', 'SKILL.md'), '---\nname: runtime-regression-debugger\n---\n');
  await fs.writeFile(path.join(root, 'skills', 'runtime-regression-debugger', 'assets', 'plugin-runtime-starter', 'should-not-ship.txt'), 'recursive-copy');
}

test('runtime bundle is deterministic, path-safe, and excludes the nested runtime starter', async () => {
  const root = await tempDir('veteran-runtime-bundle-source-');
  const output = await tempDir('veteran-runtime-bundle-output-');
  const target = await tempDir('veteran-runtime-bundle-target-');
  try {
    await fixture(root);
    const first = path.join(output, 'first.json');
    const second = path.join(output, 'second.json');
    const a = await writeRuntimeBundle({ root, output: first, version: '1.2.3' });
    const b = await writeRuntimeBundle({ root, output: second, version: '1.2.3' });
    assert.equal(a.sha256, b.sha256);
    assert.deepEqual(await fs.readFile(first), await fs.readFile(second));
    assert.equal(a.bundle.files.some((file) => file.path.includes('assets/plugin-runtime-starter')), false);

    await materializeRuntimeBundle(await fs.readFile(first), target);
    assert.equal(JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8')).version, '1.2.3');
    assert.match(await fs.readFile(path.join(target, 'skills', 'runtime-regression-debugger', 'SKILL.md'), 'utf8'), /runtime-regression-debugger/);
    assert.equal((await fs.stat(path.join(target, 'bin', 'veteran-engineer.mjs'))).mode & 0o777, 0o755);

    const tampered = structuredClone(await buildRuntimeBundle({ root, version: '1.2.3' }));
    tampered.files[0].contentBase64 = Buffer.from('tampered').toString('base64');
    await assert.rejects(materializeRuntimeBundle(serializeRuntimeBundle(tampered), path.join(target, 'tampered')), (error) => error.code === 'RUNTIME_BUNDLE_DIGEST_MISMATCH');

    const traversal = structuredClone(await buildRuntimeBundle({ root, version: '1.2.3' }));
    traversal.files[0].path = '../escape';
    await assert.rejects(materializeRuntimeBundle(serializeRuntimeBundle(traversal), path.join(target, 'traversal')), (error) => error.code === 'RUNTIME_BUNDLE_PATH_INVALID');
  } finally {
    await Promise.all([cleanup(root), cleanup(output), cleanup(target)]);
  }
});

test('runtime bundle identity binds package, plugin, and runtime constant to bundle version', async () => {
  const root = await tempDir('veteran-runtime-bundle-identity-');
  const target = await tempDir('veteran-runtime-bundle-identity-target-');
  try {
    await fixture(root);
    const bundle = await buildRuntimeBundle({ root, version: '1.2.3' });
    const pkg = bundle.files.find((file) => file.path === 'package.json');
    const content = Buffer.from(`${JSON.stringify({ name: 'veteran-engineer', version: '9.9.9' })}\n`);
    pkg.contentBase64 = content.toString('base64');
    pkg.bytes = content.length;
    const crypto = await import('node:crypto');
    pkg.sha256 = crypto.createHash('sha256').update(content).digest('hex');
    bundle.contentBytes = bundle.files.reduce((sum, file) => sum + file.bytes, 0);
    await assert.rejects(materializeRuntimeBundle(bundle, target), (error) => error.code === 'RUNTIME_BUNDLE_IDENTITY_MISMATCH');
  } finally {
    await Promise.all([cleanup(root), cleanup(target)]);
  }
});
