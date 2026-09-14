#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUNTIME_STARTER_MIRROR_ROOTS = [
  '.codex-plugin', '.mcp.json', 'NEXT_CHAT_HANDOFF.md', 'README.md', 'bin', 'mcp',
  'package-lock.json', 'package.json', 'scripts', 'src', 'tests'
];

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

async function mirroredFiles(base, rel) {
  const target = path.join(base, rel);
  const stat = await fs.stat(target);
  if (stat.isFile()) return [rel];
  return (await walk(target)).map((file) => path.relative(base, file)).sort();
}

async function assertSources(root, mirrorRoots) {
  for (const relRoot of mirrorRoots) {
    assert.equal(await exists(path.join(root, relRoot)), true, `Runtime mirror source is missing: ${relRoot}`);
  }
}

async function copyFileWithMode(source, target) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
  const stat = await fs.stat(source);
  await fs.chmod(target, stat.mode & 0o777);
}

export async function verifyRuntimeStarterMirror({ root, starterRoot, mirrorRoots = RUNTIME_STARTER_MIRROR_ROOTS }) {
  if (!(await exists(starterRoot))) return { enforced: false, files: 0 };
  await assertSources(root, mirrorRoots);
  let files = 0;
  for (const relRoot of mirrorRoots) {
    const starterPath = path.join(starterRoot, relRoot);
    assert.equal(await exists(starterPath), true, `Runtime starter mirror is missing: ${relRoot}`);
    const sourceFiles = await mirroredFiles(root, relRoot);
    const starterFiles = await mirroredFiles(starterRoot, relRoot);
    assert.deepEqual(starterFiles, sourceFiles, `Runtime starter file set drifted under ${relRoot}`);
    for (const rel of sourceFiles) {
      const [source, starter] = await Promise.all([
        fs.readFile(path.join(root, rel)),
        fs.readFile(path.join(starterRoot, rel))
      ]);
      assert.equal(Buffer.compare(source, starter), 0, `Runtime starter content drifted: ${rel}`);
      files += 1;
    }
  }
  return { enforced: true, files };
}

export async function syncRuntimeStarterMirror({ root, starterRoot, mirrorRoots = RUNTIME_STARTER_MIRROR_ROOTS }) {
  await assertSources(root, mirrorRoots);
  await fs.mkdir(starterRoot, { recursive: true });
  for (const relRoot of mirrorRoots) {
    const sourcePath = path.join(root, relRoot);
    const starterPath = path.join(starterRoot, relRoot);
    const sourceFiles = await mirroredFiles(root, relRoot);
    await fs.rm(starterPath, { recursive: true, force: true });
    const stat = await fs.stat(sourcePath);
    if (stat.isFile()) {
      await copyFileWithMode(sourcePath, starterPath);
      continue;
    }
    for (const rel of sourceFiles) {
      await copyFileWithMode(path.join(root, rel), path.join(starterRoot, rel));
    }
  }
  return verifyRuntimeStarterMirror({ root, starterRoot, mirrorRoots });
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const root = path.resolve(path.dirname(self), '..');
  const starterRoot = path.join(root, 'skills', 'runtime-regression-debugger', 'assets', 'plugin-runtime-starter');
  const synced = process.argv.includes('--sync');
  const result = synced
    ? await syncRuntimeStarterMirror({ root, starterRoot })
    : await verifyRuntimeStarterMirror({ root, starterRoot });
  process.stdout.write(`${JSON.stringify({ ok: true, synced, ...result })}\n`);
}
