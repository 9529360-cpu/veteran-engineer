#!/usr/bin/env node
import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DEFAULT_RELEASE_REPOSITORY = '9529360-cpu/veteran-engineer';
const DEFAULT_API_BASE = 'https://api.github.com';
const SELF_ASSET = 'veteran-engineer-remote-host-bootstrap.mjs';
const CANONICAL_BOOTSTRAP_ASSET = 'veteran-engineer-bootstrap.mjs';
const MAX_BOOTSTRAP_BYTES = 2 * 1024 * 1024;
const self = fileURLToPath(import.meta.url);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function bootstrapError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function normalizeSelector(selector) {
  const value = String(selector || 'latest').trim();
  if (value === 'latest' || /^v\d+\.\d+\.\d+$/.test(value)) return value;
  throw bootstrapError(`Unsupported release selector: ${selector}`, 'REMOTE_BOOTSTRAP_RELEASE_SELECTOR_INVALID');
}

async function fetchBytes(fetchImpl, url, maxBytes = MAX_BOOTSTRAP_BYTES) {
  const response = await fetchImpl(url, { redirect: 'follow' });
  if (!response?.ok) {
    throw bootstrapError(`Release download failed (${response?.status || 'unknown'}): ${url}`, 'REMOTE_BOOTSTRAP_DOWNLOAD_FAILED', { status: response?.status || null });
  }
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (declared > maxBytes) throw bootstrapError(`Release asset exceeds size limit: ${declared}`, 'REMOTE_BOOTSTRAP_ASSET_TOO_LARGE');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw bootstrapError(`Release asset exceeds size limit: ${bytes.length}`, 'REMOTE_BOOTSTRAP_ASSET_TOO_LARGE');
  return bytes;
}

async function fetchRelease({ fetchImpl, repository, apiBase, selector }) {
  const normalized = normalizeSelector(selector);
  const endpoint = normalized === 'latest'
    ? `${String(apiBase).replace(/\/$/, '')}/repos/${repository}/releases/latest`
    : `${String(apiBase).replace(/\/$/, '')}/repos/${repository}/releases/tags/${encodeURIComponent(normalized)}`;
  const response = await fetchImpl(endpoint, { headers: { accept: 'application/vnd.github+json' } });
  if (!response?.ok) throw bootstrapError(`Release lookup failed (${response?.status || 'unknown'})`, 'REMOTE_BOOTSTRAP_RELEASE_LOOKUP_FAILED');
  const release = await response.json();
  if (release?.draft || release?.prerelease) throw bootstrapError('Remote Host bootstrap accepts only stable public releases', 'REMOTE_BOOTSTRAP_RELEASE_NOT_STABLE');
  if (!/^v\d+\.\d+\.\d+$/.test(release?.tag_name || '')) throw bootstrapError(`Release tag is not stable semver: ${release?.tag_name || ''}`, 'REMOTE_BOOTSTRAP_RELEASE_TAG_INVALID');
  if (normalized !== 'latest' && release.tag_name !== normalized) throw bootstrapError('Release selector resolved to the wrong tag', 'REMOTE_BOOTSTRAP_RELEASE_IDENTITY_MISMATCH');
  if (!/^[0-9a-f]{40}$/.test(release?.target_commitish || '')) throw bootstrapError('Release target must be an exact commit SHA', 'REMOTE_BOOTSTRAP_RELEASE_SOURCE_IDENTITY_INVALID');
  return release;
}

function requireAsset(release, name) {
  const asset = release.assets?.find((item) => item?.name === name);
  if (!asset) throw bootstrapError(`Release asset is missing: ${name}`, 'REMOTE_BOOTSTRAP_ASSET_MISSING');
  if (typeof asset.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(asset.digest)) {
    throw bootstrapError(`Release asset has no verified SHA-256 digest: ${name}`, 'REMOTE_BOOTSTRAP_ASSET_DIGEST_MISSING');
  }
  if (typeof asset.browser_download_url !== 'string' || !asset.browser_download_url) {
    throw bootstrapError(`Release asset has no download URL: ${name}`, 'REMOTE_BOOTSTRAP_ASSET_URL_INVALID');
  }
  return asset;
}

function verifyAssetBytes(asset, bytes, code = 'REMOTE_BOOTSTRAP_ASSET_DIGEST_MISMATCH') {
  const content = Buffer.from(bytes);
  const expected = asset.digest.slice('sha256:'.length);
  const actual = sha256(content);
  if (actual !== expected) throw bootstrapError(`Release asset digest mismatch: ${asset.name}`, code, { expected, actual });
  if (Number.isInteger(asset.size) && asset.size !== content.length) throw bootstrapError(`Release asset size mismatch: ${asset.name}`, 'REMOTE_BOOTSTRAP_ASSET_SIZE_MISMATCH');
  return content;
}

async function runCommand(command, args, { cwd = null, env = process.env, timeoutMs = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: cwd || undefined,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1_000).unref();
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; if (stdout.length > 2_000_000) stdout = stdout.slice(-2_000_000); });
    child.stderr.on('data', (chunk) => { stderr += chunk; if (stderr.length > 2_000_000) stderr = stderr.slice(-2_000_000); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, signal, stdout, stderr });
    });
  });
}

async function isExecutableFile(candidate, platform = process.platform) {
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile()) return false;
    if (platform !== 'win32') await fs.access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findExecutable(command, env = process.env, platform = process.platform) {
  const paths = String(env.PATH || '').split(path.delimiter).filter(Boolean);
  const extensions = platform === 'win32'
    ? String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  for (const dir of paths) {
    for (const ext of extensions) {
      const candidate = path.join(dir, platform === 'win32' ? `${command}${ext}` : command);
      if (await isExecutableFile(candidate, platform)) return candidate;
    }
  }
  return null;
}

function parseJsonResult(result, code, label) {
  if (result?.code !== 0) {
    throw bootstrapError(`${label} failed: ${String(result?.stderr || result?.stdout || `exit ${result?.code ?? 'unknown'}`).trim()}`, code);
  }
  try {
    const parsed = JSON.parse(result.stdout);
    if (parsed?.ok !== true) throw new Error('ok was not true');
    return parsed;
  } catch (cause) {
    throw bootstrapError(`${label} returned invalid JSON: ${cause.message}`, `${code}_INVALID_RESPONSE`);
  }
}

function normalizeWorkspaces(workspaces) {
  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    throw bootstrapError('Remote Host bootstrap requires at least one workspace', 'REMOTE_BOOTSTRAP_WORKSPACE_REQUIRED');
  }
  const values = workspaces.map((item) => path.resolve(String(item || '')));
  if (values.some((item) => !item)) throw bootstrapError('Remote Host workspace is invalid', 'REMOTE_BOOTSTRAP_WORKSPACE_INVALID');
  return [...new Set(values)];
}

export async function bootstrapRemoteHost({
  release = 'latest',
  workspaces = [],
  home = os.homedir(),
  runtimeRoot = null,
  stateRoot = null,
  installerRoot = null,
  configPath = null,
  serviceRoot = null,
  repository = DEFAULT_RELEASE_REPOSITORY,
  apiBase = DEFAULT_API_BASE,
  fetchImpl = globalThis.fetch,
  env = process.env,
  selfBytes = null,
  platform = process.platform,
  nodeVersion = process.versions.node,
  gitExecutable = null,
  startService = true,
  runCommandImpl = runCommand
} = {}) {
  if (platform !== 'win32') throw bootstrapError('Remote Host clean-machine bootstrap is currently supported on Windows only', 'REMOTE_BOOTSTRAP_PLATFORM_UNSUPPORTED');
  const nodeMajor = Number(String(nodeVersion || '').split('.')[0]);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 20) throw bootstrapError(`Node.js 20+ is required; found ${nodeVersion || 'unknown'}`, 'REMOTE_BOOTSTRAP_NODE_UNSUPPORTED');
  if (typeof fetchImpl !== 'function') throw bootstrapError('fetch is unavailable in this Node runtime', 'REMOTE_BOOTSTRAP_FETCH_UNAVAILABLE');

  const resolvedWorkspaces = normalizeWorkspaces(workspaces);
  const resolvedHome = path.resolve(home);
  const resolvedInstallerRoot = path.resolve(installerRoot || path.join(resolvedHome, '.veteran-engineer'));
  const resolvedRuntimeRoot = path.resolve(runtimeRoot || path.join(resolvedHome, 'plugins', 'veteran-engineer'));
  const resolvedStateRoot = path.resolve(stateRoot || path.join(resolvedInstallerRoot, 'state'));
  const resolvedConfigPath = path.resolve(configPath || path.join(resolvedInstallerRoot, 'remote-host.json'));
  const resolvedServiceRoot = path.resolve(serviceRoot || path.join(resolvedInstallerRoot, 'remote-host-service'));
  const descriptorPath = path.join(resolvedInstallerRoot, 'remote-host.mcp.json');
  const effectiveEnv = { ...env, HOME: resolvedHome, USERPROFILE: resolvedHome };

  const git = gitExecutable || await findExecutable('git', effectiveEnv, platform);
  if (!git) throw bootstrapError('Git was not found on PATH; Git is required for Remote Host repository work', 'REMOTE_BOOTSTRAP_GIT_NOT_FOUND');

  const releaseJson = await fetchRelease({ fetchImpl, repository, apiBase, selector: release });
  const selfAsset = requireAsset(releaseJson, SELF_ASSET);
  const canonicalAsset = requireAsset(releaseJson, CANONICAL_BOOTSTRAP_ASSET);
  const runningBytes = selfBytes === null ? await fs.readFile(self) : Buffer.from(selfBytes);
  verifyAssetBytes(selfAsset, runningBytes, 'REMOTE_BOOTSTRAP_SELF_DIGEST_MISMATCH');
  const canonicalBytes = verifyAssetBytes(canonicalAsset, await fetchBytes(fetchImpl, canonicalAsset.browser_download_url));

  await fs.mkdir(resolvedInstallerRoot, { recursive: true });
  const canonicalPath = path.join(resolvedInstallerRoot, `.bootstrap-${crypto.randomUUID()}.mjs`);
  await fs.writeFile(canonicalPath, canonicalBytes, { mode: 0o600 });
  try {
    const canonicalArgs = [
      canonicalPath,
      'install',
      'generic',
      '--release', releaseJson.tag_name,
      '--home', resolvedHome,
      '--runtime-root', resolvedRuntimeRoot,
      '--state-root', resolvedStateRoot,
      '--installer-root', resolvedInstallerRoot,
      '--descriptor', descriptorPath,
      '--surface-profile', 'secure-tunnel',
      '--json'
    ];
    const installed = parseJsonResult(
      await runCommandImpl(process.execPath, canonicalArgs, { env: effectiveEnv, timeoutMs: 240_000 }),
      'REMOTE_BOOTSTRAP_RUNTIME_INSTALL_FAILED',
      'Verified Veteran runtime bootstrap'
    );

    const remoteCli = path.join(resolvedRuntimeRoot, 'bin', 'veteran-remote-host.mjs');
    if (runCommandImpl === runCommand && !(await isExecutableFile(remoteCli, platform))) {
      throw bootstrapError(`Installed runtime is missing Remote Host CLI: ${remoteCli}`, 'REMOTE_BOOTSTRAP_REMOTE_CLI_MISSING');
    }
    const initArgs = [
      remoteCli,
      'init',
      '--config', resolvedConfigPath,
      '--state-root', resolvedStateRoot,
      '--bind', '127.0.0.1',
      ...resolvedWorkspaces.flatMap((workspace) => ['--workspace', workspace])
    ];
    let initialized;
    try {
      initialized = parseJsonResult(
        await runCommandImpl(process.execPath, initArgs, { env: effectiveEnv, timeoutMs: 120_000 }),
        'REMOTE_BOOTSTRAP_HOST_INIT_FAILED',
        'Remote Host initialization'
      );
    } catch (error) {
      error.details = { ...(error.details || {}), runtimeRoot: resolvedRuntimeRoot, configPath: resolvedConfigPath };
      throw error;
    }
    if (typeof initialized.pairingToken !== 'string' || !initialized.pairingToken.startsWith('veteran_') || typeof initialized.device?.deviceId !== 'string') {
      throw bootstrapError('Remote Host initialization did not return the expected one-time pairing credential', 'REMOTE_BOOTSTRAP_HOST_INIT_INVALID_RESPONSE');
    }

    const serviceArgs = [
      remoteCli,
      'install-service',
      '--config', resolvedConfigPath,
      '--service-root', resolvedServiceRoot,
      '--json'
    ];
    if (!startService) serviceArgs.push('--no-start');
    let service;
    try {
      service = parseJsonResult(
        await runCommandImpl(process.execPath, serviceArgs, { env: effectiveEnv, timeoutMs: 120_000 }),
        'REMOTE_BOOTSTRAP_SERVICE_INSTALL_FAILED',
        'Remote Host service installation'
      );
    } catch (error) {
      error.message += ` Runtime and Remote Host config were preserved. Repair the service, then rotate the pairing token before connecting.`;
      error.details = {
        ...(error.details || {}),
        runtimeRoot: resolvedRuntimeRoot,
        configPath: resolvedConfigPath,
        serviceRoot: resolvedServiceRoot,
        recovery: `${process.execPath} ${JSON.stringify(remoteCli)} repair-service --config ${JSON.stringify(resolvedConfigPath)} --service-root ${JSON.stringify(resolvedServiceRoot)}`
      };
      throw error;
    }

    return {
      ok: true,
      product: 'veteran-engineer-remote-host',
      version: installed.version,
      release: installed.release,
      runtimeRoot: resolvedRuntimeRoot,
      stateRoot: resolvedStateRoot,
      installerRoot: resolvedInstallerRoot,
      configPath: resolvedConfigPath,
      serviceRoot: resolvedServiceRoot,
      workspaces: resolvedWorkspaces,
      device: initialized.device,
      pairingToken: initialized.pairingToken,
      pairingHint: initialized.pairingHint || null,
      service,
      gitExecutable: git
    };
  } finally {
    await fs.rm(canonicalPath, { force: true }).catch(() => {});
  }
}

function optionValue(argv, index, option) {
  const value = argv[index + 1];
  if (typeof value !== 'string' || !value || value.startsWith('-')) throw bootstrapError(`${option} requires a value`, 'REMOTE_BOOTSTRAP_ARGUMENT_VALUE_REQUIRED');
  return value;
}

export function parseRemoteBootstrapArgs(argv) {
  const out = { command: argv[0] || 'help', release: 'latest', workspaces: [], json: false, startService: true };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--release') out.release = optionValue(argv, index++, arg);
    else if (arg === '--workspace') out.workspaces.push(optionValue(argv, index++, arg));
    else if (arg === '--home') out.home = optionValue(argv, index++, arg);
    else if (arg === '--runtime-root') out.runtimeRoot = optionValue(argv, index++, arg);
    else if (arg === '--state-root') out.stateRoot = optionValue(argv, index++, arg);
    else if (arg === '--installer-root') out.installerRoot = optionValue(argv, index++, arg);
    else if (arg === '--config') out.configPath = optionValue(argv, index++, arg);
    else if (arg === '--service-root') out.serviceRoot = optionValue(argv, index++, arg);
    else if (arg === '--no-start') out.startService = false;
    else if (arg === '--json') out.json = true;
    else throw bootstrapError(`Unknown argument: ${arg}`, 'REMOTE_BOOTSTRAP_ARGUMENT_INVALID');
  }
  return out;
}

function usage() {
  return `Veteran Remote Host verified bootstrap\n\nUsage:\n  node veteran-engineer-remote-host-bootstrap.mjs install --workspace <path> [--workspace <path> ...] [options]\n\nOptions:\n  --release latest|vX.Y.Z\n  --workspace <path>      Allowed development workspace; repeatable\n  --home <path>\n  --runtime-root <path>\n  --state-root <path>\n  --installer-root <path>\n  --config <path>\n  --service-root <path>\n  --no-start              Register startup but do not start the service immediately\n  --json\n\nRequirements: Windows, Node.js 20+, npm, and Git. The runtime and all release assets are verified before activation. The Remote Host binds to loopback by default; use TLS / an approved tunnel for Web connectivity.\n`;
}

async function main() {
  const args = parseRemoteBootstrapArgs(process.argv.slice(2));
  if (['help', '-h', '--help'].includes(args.command)) {
    process.stdout.write(usage());
    return;
  }
  if (args.command !== 'install') throw bootstrapError('Remote Host bootstrap requires the install command', 'REMOTE_BOOTSTRAP_COMMAND_INVALID');
  const result = await bootstrapRemoteHost(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`Veteran Remote Host ${result.version} installed\nRuntime: ${result.runtimeRoot}\nDevice: ${result.device.deviceName || result.device.deviceId} (${result.device.deviceId})\nService: ${result.service.service?.taskName || 'installed'}\nWorkspaces:\n${result.workspaces.map((workspace) => `  - ${workspace}`).join('\n')}\n\nPairing token (shown once):\n${result.pairingToken}\n\nSave this token now. Only its SHA-256 digest is stored on the host.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  main().catch((error) => {
    process.stderr.write(`${error.code ? `[${error.code}] ` : ''}${error.stack || error.message || String(error)}\n`);
    process.exitCode = 1;
  });
}
