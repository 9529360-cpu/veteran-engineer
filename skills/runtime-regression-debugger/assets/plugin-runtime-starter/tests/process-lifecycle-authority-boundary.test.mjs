import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(testDir, '../src');
const AUTHORITY_FILE = 'process-lifecycle-authority.mjs';
const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);

async function sourceFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...await sourceFiles(absolute));
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) output.push(absolute);
  }
  return output;
}

function signallingViolations(relativePath, source) {
  if (relativePath === AUTHORITY_FILE) return [];
  const violations = [];
  if (/\bprocess\.kill\s*\(/.test(source)) violations.push('process.kill');
  if (/\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(\s*['"]taskkill['"]/.test(source)) violations.push('taskkill');
  return violations.map((kind) => `${relativePath}:${kind}`);
}

test('production process signalling has one authority', async () => {
  const violations = [];
  for (const file of await sourceFiles(srcDir)) {
    const relativePath = path.relative(srcDir, file).replaceAll('\\', '/');
    const source = await fs.readFile(file, 'utf8');
    violations.push(...signallingViolations(relativePath, source));
  }
  assert.deepEqual(violations.sort(), []);
});
