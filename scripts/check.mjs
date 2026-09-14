#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RUNTIME_VERSION, MODERN_PROTOCOL_VERSION, LEGACY_PROTOCOL_VERSION } from '../src/constants.mjs';
import { TOOL_NAMES } from '../src/tool-catalog.mjs';
import { inspectMcpSdkIntegrity } from '../src/mcp-sdk-integrity.mjs';
import { SURFACE_CAPABILITY_CONTRACT, surfaceProfileNames } from '../src/surface-capabilities.mjs';
import { verifyRuntimeStarterMirror } from './runtime-starter-mirror.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const codeRoots = ['src', 'mcp', 'bin', 'scripts', 'tests'];
const starterRoot = path.join(root, 'skills', 'runtime-regression-debugger', 'assets', 'plugin-runtime-starter');

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

const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const plugin = JSON.parse(await fs.readFile(path.join(root, '.codex-plugin', 'plugin.json'), 'utf8'));
const mcp = JSON.parse(await fs.readFile(path.join(root, '.mcp.json'), 'utf8'));
const skill = await fs.readFile(path.join(root, 'skills', 'runtime-regression-debugger', 'SKILL.md'), 'utf8');

assert.equal(packageJson.name, 'veteran-engineer');
assert.equal(packageJson.version, RUNTIME_VERSION, 'package.json and runtime version must match');
assert.equal(plugin.name, 'veteran-engineer');
assert.equal(plugin.version, RUNTIME_VERSION, 'plugin manifest and runtime version must match');
assert.equal(plugin.skills, './skills/');
assert.equal(plugin.mcpServers, './.mcp.json');
assert.ok(plugin.description && plugin.author?.name && plugin.interface?.displayName && plugin.interface?.shortDescription && plugin.interface?.longDescription && plugin.interface?.developerName && plugin.interface?.category, 'Codex plugin manifest is missing required metadata');
assert.equal(mcp.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
const server = mcp.mcpServers?.['veteran-engineer'];
assert.equal(server?.type, 'stdio');
assert.equal(server?.command, 'node');
assert.deepEqual(server?.args, ['${PLUGIN_ROOT}/mcp/server.mjs']);
assert.equal(server?.cwd, '${PLUGIN_ROOT}');
assert.equal(server?.env?.VETERAN_ENGINEER_SURFACE_PROFILE, 'local-stdio');
assert.equal(SURFACE_CAPABILITY_CONTRACT, 'veteran-surface-capabilities-v1');
assert.deepEqual(surfaceProfileNames(), ['local-stdio', 'remote-mcp', 'secure-tunnel']);
assert.equal(TOOL_NAMES.length, 34);
assert.equal(new Set(TOOL_NAMES).size, 34, 'MCP tool names must be unique');
assert.equal(MODERN_PROTOCOL_VERSION, '2026-07-28');
assert.equal(LEGACY_PROTOCOL_VERSION, '2025-11-25');
assert.match(skill, /^---\s*\nname:\s*runtime-regression-debugger\s*\ndescription:/, 'Skill frontmatter is invalid');
assert.ok(!/\[TODO:[^\]]*\]/.test(skill), 'Skill contains unresolved TODO placeholder');
const sdkIntegrity = await inspectMcpSdkIntegrity(root);
assert.notEqual(sdkIntegrity.status, 'invalid', `MCP SDK integrity failure: ${JSON.stringify(sdkIntegrity)}`);
assert.equal(sdkIntegrity.lockfile.status, 'verified', 'package-lock.json must verify exact MCP SDK pins and npm integrity');
const mirror = await verifyRuntimeStarterMirror({ root, starterRoot });

let checked = 0;
for (const relRoot of codeRoots) {
  const target = path.join(root, relRoot);
  for (const file of await walk(target)) {
    if (!file.endsWith('.mjs')) continue;
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      process.stderr.write(result.stderr || result.stdout || `node --check failed: ${file}\n`);
      process.exit(result.status || 1);
    }
    checked += 1;
  }
}

process.stdout.write(`${JSON.stringify({ ok: true, version: RUNTIME_VERSION, syntaxFiles: checked, toolCount: TOOL_NAMES.length, protocols: { modern: MODERN_PROTOCOL_VERSION, legacy: LEGACY_PROTOCOL_VERSION }, sdk: { graph: sdkIntegrity.graph.status, lockfile: sdkIntegrity.lockfile.status }, runtimeStarterMirror: mirror })}\n`);
