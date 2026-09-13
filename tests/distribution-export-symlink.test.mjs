import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { cleanup, tempDir } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const exporter = path.join(root, 'skills', 'runtime-regression-debugger', 'scripts', 'export_plugin_bundle.py');

async function exporterAvailable() {
  try {
    await fs.access(exporter);
    return true;
  } catch {
    return false;
  }
}

function runExporter(skillRoot, output, profile = 'web') {
  return spawnSync('python3', [exporter, skillRoot, '--profile', profile, '--output', output], { encoding: 'utf8' });
}

async function createMinimalWebSkill(skillRoot) {
  const manifestDir = path.join(skillRoot, 'assets', 'plugin-runtime-starter', '.codex-plugin');
  await fs.mkdir(manifestDir, { recursive: true });
  await fs.writeFile(path.join(skillRoot, 'SKILL.md'), '# Test Skill\n');
  await fs.writeFile(path.join(manifestDir, 'plugin.json'), `${JSON.stringify({ name: 'veteran-engineer' })}\n`);
}

test('plugin exporter rejects source symlinks instead of copying repository-external content', { skip: process.platform === 'win32' }, async (t) => {
  if (!(await exporterAvailable())) return t.skip('source Skill exporter is absent in the standalone runtime starter');
  if (spawnSync('python3', ['--version'], { encoding: 'utf8' }).status !== 0) return t.skip('python3 unavailable');
  const temp = await tempDir('veteran-export-symlink-');
  try {
    const skillRoot = path.join(temp, 'skill');
    await createMinimalWebSkill(skillRoot);
    const references = path.join(skillRoot, 'references');
    await fs.mkdir(references, { recursive: true });
    const secret = path.join(temp, 'outside-secret.txt');
    await fs.writeFile(secret, 'TOP-SECRET-EXPORT-BOUNDARY\n');
    await fs.symlink(secret, path.join(references, 'leak.txt'));
    const output = path.join(temp, 'web.zip');

    const result = runExporter(skillRoot, output, 'web');
    assert.notEqual(result.status, 0, 'export must fail closed on a source symlink');
    assert.match(`${result.stderr}${result.stdout}`, /refuses symbolic link/i);
    await assert.rejects(fs.access(output));
  } finally {
    await cleanup(temp);
  }
});

test('plugin exporter rejects a symlinked runtime seed before reading its web manifest', { skip: process.platform === 'win32' }, async (t) => {
  if (!(await exporterAvailable())) return t.skip('source Skill exporter is absent in the standalone runtime starter');
  if (spawnSync('python3', ['--version'], { encoding: 'utf8' }).status !== 0) return t.skip('python3 unavailable');
  const temp = await tempDir('veteran-export-runtime-symlink-');
  try {
    const skillRoot = path.join(temp, 'skill');
    const assets = path.join(skillRoot, 'assets');
    const outsideRuntime = path.join(temp, 'outside-runtime');
    await fs.mkdir(path.join(outsideRuntime, '.codex-plugin'), { recursive: true });
    await fs.mkdir(assets, { recursive: true });
    await fs.writeFile(path.join(skillRoot, 'SKILL.md'), '# Test Skill\n');
    await fs.writeFile(path.join(outsideRuntime, '.codex-plugin', 'plugin.json'), `${JSON.stringify({ name: 'veteran-engineer', leaked: 'outside-runtime' })}\n`);
    await fs.symlink(outsideRuntime, path.join(assets, 'plugin-runtime-starter'), 'dir');
    const output = path.join(temp, 'web.zip');

    const result = runExporter(skillRoot, output, 'web');
    assert.notEqual(result.status, 0, 'export must reject a symlinked runtime seed before reading it');
    assert.match(`${result.stderr}${result.stdout}`, /refuses symbolic link/i);
    await assert.rejects(fs.access(output));
  } finally {
    await cleanup(temp);
  }
});
