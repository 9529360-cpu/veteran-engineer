#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { MODERN_PROTOCOL_VERSION, RUNTIME_VERSION } from '../src/constants.mjs';
import { inspectMcpSdkIntegrity, assertMcpSdkIntegrity } from '../src/mcp-sdk-integrity.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const PINNED_SDK_VERSION = '2.0.0';

function parseArgs(argv) {
  const out = {
    server: path.join(root, 'mcp', 'server.mjs'),
    mode: 'legacy',
    requireSdk: false,
    requireServerSdk: false,
    forceFallback: false,
    stateful: false,
    expectTools: 36,
    stateRoot: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--server') out.server = path.resolve(argv[++i]);
    else if (arg === '--mode') out.mode = argv[++i];
    else if (arg === '--require-sdk') out.requireSdk = true;
    else if (arg === '--require-server-sdk') out.requireServerSdk = true;
    else if (arg === '--force-fallback') out.forceFallback = true;
    else if (arg === '--stateful') out.stateful = true;
    else if (arg === '--expect-tools') out.expectTools = Number(argv[++i]);
    else if (arg === '--state-root') out.stateRoot = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!['legacy', 'auto', 'modern-pinned'].includes(out.mode)) throw new Error(`Unsupported mode: ${out.mode}`);
  if (!Number.isInteger(out.expectTools) || out.expectTools < 0) throw new Error('--expect-tools must be a non-negative integer');
  return out;
}

function findPackageVersion(specifier) {
  try {
    const require = createRequire(import.meta.url);
    const resolved = require.resolve(specifier);
    let dir = path.dirname(resolved);
    for (;;) {
      const pkg = path.join(dir, 'package.json');
      if (fs.existsSync(pkg)) {
        const parsed = JSON.parse(fs.readFileSync(pkg, 'utf8'));
        if (parsed?.name === specifier) return parsed.version;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* unavailable */ }
  return null;
}

function parseToolText(result) {
  const item = result?.content?.find?.((entry) => entry?.type === 'text');
  return item?.text ? JSON.parse(item.text) : null;
}

async function legacyProbe(args, stateRoot) {
  const env = {
    ...process.env,
    VETERAN_ENGINEER_STATE_DIR: stateRoot,
    ...(args.forceFallback ? { VETERAN_MCP_FORCE_FALLBACK: '1' } : {}),
    ...(args.requireServerSdk ? { VETERAN_MCP_REQUIRE_SDK: '1' } : {})
  };
  const child = spawn(process.execPath, [args.server], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  let buffer = '';
  let nextId = 1;
  const pending = new Map();
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    while (true) {
      const index = buffer.indexOf('\n');
      if (index < 0) break;
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject, timer } = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.error) reject(Object.assign(new Error(msg.error.message || 'MCP error'), { mcpError: msg.error }));
        else resolve(msg.result);
      }
    }
  });
  const request = (method, params = undefined) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}. stderr: ${stderr.slice(-2000)}`));
    }, 10_000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`);
  });
  try {
    const init = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'veteran-handshake', version: RUNTIME_VERSION } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const tools = await request('tools/list', {});
    assert.equal(tools.tools.length, args.expectTools, `expected ${args.expectTools} tools, got ${tools.tools.length}`);
    assert.equal(tools.tools.every((tool) => tool.outputSchema?.type === 'object'), true, 'legacy fallback must publish object-root output schemas');
    const timeline = tools.tools.find((tool) => tool.name === 'mission_timeline');
    assert.equal(timeline?.outputSchema?.properties?.result?.type, 'array', 'legacy fallback must wrap natural array outputs under result');
    const healthResult = await request('tools/call', { name: 'runtime_health', arguments: {} });
    const health = parseToolText(healthResult);
    assert.ok(health?.mcp, 'runtime_health did not return MCP capability');
    assert.deepEqual(healthResult.structuredContent, health, 'legacy fallback structuredContent must match object text JSON');
    return { ok: true, client: 'manual-legacy', era: 'legacy', protocolVersion: init.protocolVersion, toolCount: tools.tools.length, outputContracts: true, runtime: health };
  } finally {
    for (const item of pending.values()) clearTimeout(item.timer);
    pending.clear();
    child.stdin.end();
    child.kill('SIGTERM');
  }
}

async function sdkProbe(args, stateRoot) {
  const integrity = await inspectMcpSdkIntegrity(root);
  assertMcpSdkIntegrity(integrity);
  const version = findPackageVersion('@modelcontextprotocol/client');
  if (!version) {
    const error = new Error('Official MCP client SDK is unavailable');
    error.code = 'MCP_SDK_UNAVAILABLE';
    throw error;
  }
  assert.equal(version, PINNED_SDK_VERSION, `official client SDK must be pinned to ${PINNED_SDK_VERSION}; found ${version}`);
  const serverVersion = findPackageVersion('@modelcontextprotocol/server');
  if (args.requireServerSdk) {
    assert.ok(serverVersion, 'Official MCP server SDK is unavailable');
    assert.equal(serverVersion, PINNED_SDK_VERSION, `official server SDK must be pinned to ${PINNED_SDK_VERSION}; found ${serverVersion}`);
  }
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/client'),
    import('@modelcontextprotocol/client/stdio')
  ]);
  const options = args.mode === 'legacy' ? {} : {
    versionNegotiation: args.mode === 'auto'
      ? { mode: 'auto', probe: { timeoutMs: 2_500, maxRetries: 0 } }
      : { mode: { pin: MODERN_PROTOCOL_VERSION }, probe: { timeoutMs: 2_500, maxRetries: 0 } }
  };
  const client = new Client({ name: 'veteran-handshake', version: RUNTIME_VERSION }, options);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [args.server],
    env: {
      ...process.env,
      VETERAN_ENGINEER_STATE_DIR: stateRoot,
      ...(args.forceFallback ? { VETERAN_MCP_FORCE_FALLBACK: '1' } : {}),
      ...(args.requireServerSdk ? { VETERAN_MCP_REQUIRE_SDK: '1' } : {})
    },
    stderr: 'pipe'
  });
  let stderr = '';
  let statefulRepo = null;
  transport.stderr?.on?.('data', (chunk) => { stderr += String(chunk); });
  try {
    await client.connect(transport);
    const era = client.getProtocolEra();
    if (args.mode === 'modern-pinned') assert.equal(era, 'modern');
    if (args.mode === 'legacy') assert.equal(era, 'legacy');
    const tools = await client.listTools();
    assert.equal(tools.tools.length, args.expectTools, `expected ${args.expectTools} tools, got ${tools.tools.length}`);
    assert.equal(tools.tools.every((tool) => Boolean(tool.outputSchema)), true, 'official SDK must publish outputSchema for every Veteran tool');
    const timeline = tools.tools.find((tool) => tool.name === 'mission_timeline');
    if (era === 'modern') assert.equal(timeline?.outputSchema?.type, 'array', 'modern MCP should expose the natural timeline array schema');
    else assert.equal(timeline?.outputSchema?.properties?.result?.type, 'array', 'legacy SDK codec should wrap the timeline array schema');
    const healthResult = await client.callTool({ name: 'runtime_health', arguments: {} });
    const health = parseToolText(healthResult);
    assert.ok(health?.mcp, 'runtime_health did not return MCP capability');
    assert.deepEqual(healthResult.structuredContent, health, 'official SDK structuredContent must match object text JSON');
    let stateful = null;
    if (args.stateful) {
      statefulRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'veteran-handshake-repo-'));
      fs.writeFileSync(path.join(statefulRepo, 'README.md'), '# handshake fixture\n');
      for (const gitArgs of [
        ['init', '--quiet'],
        ['add', 'README.md'],
        ['-c', 'user.name=Veteran Test', '-c', 'user.email=veteran@example.invalid', 'commit', '--quiet', '-m', 'fixture']
      ]) {
        const git = spawnSync('git', gitArgs, { cwd: statefulRepo, encoding: 'utf8', windowsHide: true });
        assert.equal(git.status, 0, `git ${gitArgs.join(' ')} failed: ${git.stderr || git.stdout}`);
      }
      const openResult = await client.callTool({ name: 'project_open', arguments: { requestId: `official-modern-project-open-${randomUUID()}`, repoPath: statefulRepo } });
      const opened = parseToolText(openResult);
      if (openResult?.isError) {
        const error = new Error(`official modern stateful project_open failed: ${opened?.message || 'unknown MCP tool error'}`);
        error.code = opened?.code || 'MCP_TOOL_ERROR';
        throw error;
      }
      assert.ok(opened?.id, 'official modern stateful project_open did not persist a project');
      assert.equal(openResult.structuredContent?.id, opened.id, 'project_open structuredContent must expose the chainable project id');
      const capabilitiesResult = await client.callTool({ name: 'validation_capabilities', arguments: { projectId: opened.id } });
      const capabilitiesText = parseToolText(capabilitiesResult);
      assert.ok(Array.isArray(capabilitiesText), 'validation_capabilities text result must remain a natural array');
      assert.ok(Array.isArray(capabilitiesResult.structuredContent), 'modern structuredContent must preserve natural array outputs');
      stateful = { tool: 'project_open', projectId: opened.id, structuredOutput: true };
    }
    return { ok: true, client: `official-sdk-${version}`, sdk: { client: version, server: serverVersion, integrity }, era, toolCount: tools.tools.length, outputContracts: true, stateful, runtime: health };
  } catch (error) {
    if (stderr.trim()) error.message += `\nserver stderr:\n${stderr.slice(-4000)}`;
    throw error;
  } finally {
    await client.close().catch(() => {});
    if (statefulRepo) fs.rmSync(statefulRepo, { recursive: true, force: true });
  }
}

const args = parseArgs(process.argv.slice(2));
const temporaryState = !args.stateRoot;
const stateRoot = args.stateRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'veteran-handshake-'));
try {
  let report;
  if (args.mode === 'legacy' && !args.requireSdk) report = await legacyProbe(args, stateRoot);
  else report = await sdkProbe(args, stateRoot);
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch (error) {
  process.stderr.write(`${error.stack || error.message || String(error)}\n`);
  process.exitCode = 1;
} finally {
  if (temporaryState) fs.rmSync(stateRoot, { recursive: true, force: true });
}
