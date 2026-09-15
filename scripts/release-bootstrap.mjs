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
const MAX_ASSET_BYTES = 96 * 1024 * 1024;
const MAX_FILES = 5000;
const MAX_CONTENT_BYTES = 64 * 1024 * 1024;
const REQUIRED_RUNTIME_PACKAGES = [
  '@modelcontextprotocol/client',
  '@modelcontextprotocol/core',
  '@modelcontextprotocol/server',
  'zod'
];
const BUILTIN_HOSTS = new Set(['codex', 'hermes', 'generic']);
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

async function pathExists(target) {
  try { await fs.lstat(target); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function normalizeSelector(selector) {
  const value = String(selector || 'latest').trim();
  if (value === 'latest' || /^v\d+\.\d+\.\d+$/.test(value)) return value;
  throw bootstrapError(`Unsupported release selector: ${selector}`, 'BOOTSTRAP_RELEASE_SELECTOR_INVALID');
}

async function fetchBytes(fetchImpl, url, { headers = {}, maxBytes = MAX_ASSET_BYTES } = {}) {
  const response = await fetchImpl(url, { headers, redirect: 'follow' });
  if (!response?.ok) throw bootstrapError(`Release download failed (${response?.status || 'unknown'}): ${url}`, 'BOOTSTRAP_DOWNLOAD_FAILED', { status: response?.status || null });
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (declared > maxBytes) throw bootstrapError(`Release asset exceeds size limit: ${declared}`, 'BOOTSTRAP_ASSET_TOO_LARGE');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw bootstrapError(`Release asset exceeds size limit: ${bytes.length}`, 'BOOTSTRAP_ASSET_TOO_LARGE');
  return bytes;
}

function requireAsset(release, name) {
  const asset = release.assets?.find((item) => item?.name === name);
  if (!asset) throw bootstrapError(`Release asset is missing: ${name}`, 'BOOTSTRAP_ASSET_MISSING');
  if (typeof asset.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(asset.digest)) {
    throw bootstrapError(`Release asset has no verified SHA-256 digest: ${name}`, 'BOOTSTRAP_ASSET_DIGEST_MISSING');
  }
  if (typeof asset.browser_download_url !== 'string' || !asset.browser_download_url) {
    throw bootstrapError(`Release asset has no download URL: ${name}`, 'BOOTSTRAP_ASSET_URL_INVALID');
  }
  return asset;
}

async function downloadVerifiedAsset(fetchImpl, asset, options = {}) {
  const bytes = await fetchBytes(fetchImpl, asset.browser_download_url, options);
  const expected = asset.digest.slice('sha256:'.length);
  const actual = sha256(bytes);
  if (expected !== actual) throw bootstrapError(`Release asset digest mismatch: ${asset.name}`, 'BOOTSTRAP_ASSET_DIGEST_MISMATCH', { expected, actual });
  if (Number.isInteger(asset.size) && asset.size !== bytes.length) throw bootstrapError(`Release asset size mismatch: ${asset.name}`, 'BOOTSTRAP_ASSET_SIZE_MISMATCH');
  return bytes;
}

async function fetchRelease({ fetchImpl, repository, apiBase, selector }) {
  const normalized = normalizeSelector(selector);
  const endpoint = normalized === 'latest'
    ? `${String(apiBase).replace(/\/$/, '')}/repos/${repository}/releases/latest`
    : `${String(apiBase).replace(/\/$/, '')}/repos/${repository}/releases/tags/${encodeURIComponent(normalized)}`;
  const response = await fetchImpl(endpoint, { headers: { accept: 'application/vnd.github+json' } });
  if (!response?.ok) throw bootstrapError(`Release lookup failed (${response?.status || 'unknown'})`, 'BOOTSTRAP_RELEASE_LOOKUP_FAILED');
  const release = await response.json();
  if (release?.draft || release?.prerelease) throw bootstrapError('Bootstrap accepts only stable public releases', 'BOOTSTRAP_RELEASE_NOT_STABLE');
  if (!/^v\d+\.\d+\.\d+$/.test(release?.tag_name || '')) throw bootstrapError(`Release tag is not stable semver: ${release?.tag_name || ''}`, 'BOOTSTRAP_RELEASE_TAG_INVALID');
  if (normalized !== 'latest' && release.tag_name !== normalized) throw bootstrapError('Release selector resolved to the wrong tag', 'BOOTSTRAP_RELEASE_IDENTITY_MISMATCH');
  if (!/^[0-9a-f]{40}$/.test(release?.target_commitish || '')) throw bootstrapError('Release target must be an exact commit SHA', 'BOOTSTRAP_RELEASE_SOURCE_IDENTITY_INVALID');
  return release;
}

function manifestAsset(manifest, profile) {
  const asset = manifest.assets?.find((item) => item?.profile === profile);
  if (!asset?.filename || !asset?.checksumFile || !/^[0-9a-f]{64}$/.test(asset?.sha256 || '') || !Number.isInteger(asset?.bytes)) {
    throw bootstrapError(`Release manifest is missing a valid ${profile} asset`, 'BOOTSTRAP_MANIFEST_ASSET_INVALID', { profile });
  }
  return asset;
}

function verifyManifestIdentity(manifest, release) {
  const version = release.tag_name.slice(1);
  if (manifest?.schemaVersion !== 1 || manifest?.product !== 'veteran-engineer' || manifest?.version !== version || manifest?.tag !== release.tag_name || manifest?.commit !== release.target_commitish) {
    throw bootstrapError('Release manifest identity does not match GitHub release', 'BOOTSTRAP_MANIFEST_IDENTITY_MISMATCH');
  }
  return version;
}

async function verifyManifestAsset({ fetchImpl, release, manifestEntry, selfBytes = null }) {
  const asset = requireAsset(release, manifestEntry.filename);
  const checksumAsset = requireAsset(release, manifestEntry.checksumFile);
  let bytes = selfBytes;
  if (bytes === null) bytes = await downloadVerifiedAsset(fetchImpl, asset);
  else {
    bytes = Buffer.from(bytes);
    const releaseDigest = asset.digest.slice('sha256:'.length);
    if (sha256(bytes) !== releaseDigest) throw bootstrapError(`Running bootstrap does not match selected release asset: ${manifestEntry.filename}`, 'BOOTSTRAP_SELF_DIGEST_MISMATCH');
    if (Number.isInteger(asset.size) && asset.size !== bytes.length) throw bootstrapError('Running bootstrap size does not match selected release asset', 'BOOTSTRAP_SELF_SIZE_MISMATCH');
  }
  if (bytes.length !== manifestEntry.bytes || sha256(bytes) !== manifestEntry.sha256) throw bootstrapError(`Asset does not match release manifest: ${manifestEntry.filename}`, 'BOOTSTRAP_MANIFEST_ASSET_MISMATCH');
  const checksumBytes = await downloadVerifiedAsset(fetchImpl, checksumAsset, { maxBytes: 4096 });
  if (checksumBytes.toString('utf8').trim() !== `${manifestEntry.sha256}  ${manifestEntry.filename}`) {
    throw bootstrapError(`Checksum asset does not match release manifest: ${manifestEntry.checksumFile}`, 'BOOTSTRAP_CHECKSUM_MISMATCH');
  }
  return bytes;
}

function safeRelativeParts(rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\\') || rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) {
    throw bootstrapError(`Unsafe runtime bundle path: ${rel}`, 'BOOTSTRAP_RUNTIME_PATH_INVALID');
  }
  const parts = rel.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) throw bootstrapError(`Unsafe runtime bundle path: ${rel}`, 'BOOTSTRAP_RUNTIME_PATH_INVALID');
  return parts;
}

async function materializeRuntime(runtimeBytes, targetRoot, version) {
  let bundle;
  try { bundle = JSON.parse(Buffer.from(runtimeBytes).toString('utf8')); }
  catch { throw bootstrapError('Runtime bundle is invalid JSON', 'BOOTSTRAP_RUNTIME_INVALID'); }
  if (bundle?.schemaVersion !== 1 || bundle?.product !== 'veteran-engineer' || bundle?.version !== version) throw bootstrapError('Runtime bundle identity is invalid', 'BOOTSTRAP_RUNTIME_IDENTITY_MISMATCH');
  if (!Array.isArray(bundle.files) || bundle.files.length === 0 || bundle.files.length > MAX_FILES) throw bootstrapError('Runtime bundle file list is invalid', 'BOOTSTRAP_RUNTIME_INVALID');
  const seen = new Set();
  const prepared = [];
  let totalBytes = 0;
  for (const file of bundle.files) {
    const parts = safeRelativeParts(file?.path);
    if (seen.has(file.path)) throw bootstrapError(`Duplicate runtime bundle path: ${file.path}`, 'BOOTSTRAP_RUNTIME_DUPLICATE_PATH');
    seen.add(file.path);
    if (![0o644, 0o755].includes(file.mode)) throw bootstrapError(`Invalid runtime bundle mode: ${file.path}`, 'BOOTSTRAP_RUNTIME_MODE_INVALID');
    if (!Number.isInteger(file.bytes) || file.bytes < 0 || typeof file.contentBase64 !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256 || '')) throw bootstrapError(`Invalid runtime bundle metadata: ${file.path}`, 'BOOTSTRAP_RUNTIME_INVALID');
    const content = Buffer.from(file.contentBase64, 'base64');
    if (content.length !== file.bytes || sha256(content) !== file.sha256) throw bootstrapError(`Runtime bundle digest mismatch: ${file.path}`, 'BOOTSTRAP_RUNTIME_DIGEST_MISMATCH');
    totalBytes += content.length;
    if (totalBytes > MAX_CONTENT_BYTES) throw bootstrapError('Runtime bundle content exceeds safety limit', 'BOOTSTRAP_RUNTIME_TOO_LARGE');
    prepared.push({ file, parts, content });
  }
  if (bundle.fileCount !== prepared.length || bundle.contentBytes !== totalBytes) throw bootstrapError('Runtime bundle aggregate metadata mismatch', 'BOOTSTRAP_RUNTIME_INVALID');
  const contentByPath = new Map(prepared.map((item) => [item.file.path, item.content]));
  try {
    const pkg = JSON.parse(contentByPath.get('package.json')?.toString('utf8') || 'null');
    const plugin = JSON.parse(contentByPath.get('.codex-plugin/plugin.json')?.toString('utf8') || 'null');
    const constants = contentByPath.get('src/constants.mjs')?.toString('utf8') || '';
    const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (pkg?.name !== 'veteran-engineer' || pkg?.version !== version || plugin?.name !== 'veteran-engineer' || plugin?.version !== version || !new RegExp(`RUNTIME_VERSION\\s*=\\s*['"]${escaped}['"]`).test(constants)) throw new Error('package/plugin/runtime version mismatch');
  } catch (cause) {
    throw bootstrapError(`Runtime bundle product/version identity is invalid: ${cause.message}`, 'BOOTSTRAP_RUNTIME_IDENTITY_MISMATCH');
  }
  await fs.mkdir(targetRoot, { recursive: false });
  for (const item of prepared) {
    const target = path.join(targetRoot, ...item.parts);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, item.content, { mode: item.file.mode });
    await fs.chmod(target, item.file.mode);
  }
  return { root: targetRoot, version, fileCount: prepared.length, contentBytes: totalBytes };
}

async function runCommand(command, args, { cwd, env, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: env ? { ...process.env, ...env } : process.env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1000).unref();
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

async function isExecutableFile(candidate) {
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile()) return false;
    if (process.platform !== 'win32') await fs.access(candidate, fsConstants.X_OK);
    return true;
  } catch { return false; }
}

async function findExecutable(command, env = process.env) {
  const paths = String(env.PATH || '').split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32' ? String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean) : [''];
  for (const dir of paths) {
    for (const ext of extensions) {
      const candidate = path.join(dir, process.platform === 'win32' ? `${command}${ext}` : command);
      if (await isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

async function verifyRuntimeDependencies(root) {
  let pkg;
  try { pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')); }
  catch (cause) { throw bootstrapError(`Installed runtime package metadata is invalid: ${cause.message}`, 'BOOTSTRAP_DEPENDENCY_CONTRACT_INVALID'); }
  for (const name of REQUIRED_RUNTIME_PACKAGES) {
    const expected = pkg.optionalDependencies?.[name];
    if (typeof expected !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(expected)) throw bootstrapError(`Runtime does not pin required bootstrap dependency ${name}`, 'BOOTSTRAP_DEPENDENCY_CONTRACT_INVALID');
    let installed;
    try { installed = JSON.parse(await fs.readFile(path.join(root, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')); }
    catch { throw bootstrapError(`Required runtime dependency was not installed: ${name}@${expected}`, 'BOOTSTRAP_DEPENDENCY_MISSING'); }
    if (installed?.version !== expected) throw bootstrapError(`Runtime dependency version mismatch: ${name} expected ${expected}, found ${installed?.version || 'unknown'}`, 'BOOTSTRAP_DEPENDENCY_VERSION_MISMATCH');
  }
}

async function defaultPrepareDependencies({ root, npmExecutable, env }) {
  const result = await runCommand(npmExecutable, ['ci', '--include=optional', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: root, env, timeoutMs: 180_000 });
  if (result.code !== 0) throw bootstrapError(`npm ci failed while preparing Veteran Engineer dependencies: ${result.stderr.trim() || result.stdout.trim()}`, 'BOOTSTRAP_DEPENDENCY_INSTALL_FAILED');
}

function installCliArgs({ runtimeRoot, runtimeStateRoot, installerRoot, home, host, descriptorPath, surfaceProfile, hermesHome }) {
  const cli = path.join(runtimeRoot, 'bin', 'veteran-engineer.mjs');
  const args = [cli, 'install', host, '--distribution-root', runtimeRoot, '--runtime-root', runtimeRoot, '--state-root', runtimeStateRoot, '--installer-root', installerRoot, '--home', home, '--json'];
  if (descriptorPath) args.push('--descriptor', descriptorPath);
  if (surfaceProfile) args.push('--surface-profile', surfaceProfile);
  if (hermesHome) args.push('--hermes-home', hermesHome);
  return args;
}

async function defaultBindHost(options) {
  const env = { ...options.env, HOME: options.home, USERPROFILE: options.home };
  const installArgs = installCliArgs(options);
  const install = await runCommand(process.execPath, installArgs, { env, timeoutMs: 120_000 });
  if (install.code !== 0) {
    const recovery = `${process.execPath} ${installArgs.slice(0, 3).map((item) => JSON.stringify(item)).join(' ')}`;
    throw bootstrapError(`Verified runtime was installed at ${options.runtimeRoot}, but host binding failed. The runtime was left in place for repair. ${install.stderr.trim() || install.stdout.trim()} Recovery: ${recovery}`, 'BOOTSTRAP_HOST_BIND_FAILED', { runtimeRoot: options.runtimeRoot, host: options.host });
  }
  let installReport;
  try { installReport = JSON.parse(install.stdout); }
  catch { throw bootstrapError('Installed Veteran CLI returned invalid install JSON', 'BOOTSTRAP_HOST_BIND_INVALID_RESPONSE'); }

  const doctorArgs = [path.join(options.runtimeRoot, 'bin', 'veteran-engineer.mjs'), 'doctor', options.host, '--distribution-root', options.runtimeRoot, '--runtime-root', options.runtimeRoot, '--state-root', options.runtimeStateRoot, '--installer-root', options.installerRoot, '--home', options.home, '--json'];
  if (options.descriptorPath) doctorArgs.push('--descriptor', options.descriptorPath);
  if (options.surfaceProfile) doctorArgs.push('--surface-profile', options.surfaceProfile);
  if (options.hermesHome) doctorArgs.push('--hermes-home', options.hermesHome);
  const doctor = await runCommand(process.execPath, doctorArgs, { env, timeoutMs: 120_000 });
  let doctorReport = null;
  try { doctorReport = JSON.parse(doctor.stdout); } catch { /* handled below */ }
  if (doctor.code !== 0 || doctorReport?.ok !== true) throw bootstrapError(`Veteran Engineer was installed, but post-install doctor failed. Runtime remains at ${options.runtimeRoot} for repair. ${doctor.stderr.trim() || doctor.stdout.trim()}`, 'BOOTSTRAP_POST_INSTALL_DOCTOR_FAILED', { runtimeRoot: options.runtimeRoot, host: options.host });
  return { install: installReport, doctor: doctorReport };
}

async function preflightHost({ host, home, runtimeRoot, env, bindHostImpl }) {
  if (!BUILTIN_HOSTS.has(host)) throw bootstrapError(`Unsupported bootstrap host: ${host}`, 'BOOTSTRAP_HOST_INVALID');
  if (host === 'codex' && path.resolve(runtimeRoot) !== path.resolve(path.join(home, 'plugins', 'veteran-engineer'))) throw bootstrapError(`Codex bootstrap requires the shared runtime at ${path.join(home, 'plugins', 'veteran-engineer')}`, 'BOOTSTRAP_CODEX_RUNTIME_ROOT_UNSUPPORTED');
  if (bindHostImpl !== defaultBindHost || host === 'generic') return;
  if (!(await findExecutable(host, env))) throw bootstrapError(`${host === 'codex' ? 'Codex' : 'Hermes'} CLI not found on PATH`, 'BOOTSTRAP_HOST_CLI_NOT_FOUND');
}

export async function bootstrapVeteran({
  host,
  release = 'latest',
  home = os.homedir(),
  runtimeRoot = null,
  runtimeStateRoot = null,
  installerRoot = null,
  descriptorPath = null,
  surfaceProfile = null,
  hermesHome = null,
  repository = DEFAULT_RELEASE_REPOSITORY,
  apiBase = DEFAULT_API_BASE,
  fetchImpl = globalThis.fetch,
  env = process.env,
  selfBytes = null,
  npmExecutable = null,
  prepareDependenciesImpl = defaultPrepareDependencies,
  bindHostImpl = defaultBindHost
} = {}) {
  if (typeof fetchImpl !== 'function') throw bootstrapError('fetch is unavailable in this Node runtime', 'BOOTSTRAP_FETCH_UNAVAILABLE');
  const resolvedHome = path.resolve(home);
  const resolvedInstallerRoot = path.resolve(installerRoot || path.join(resolvedHome, '.veteran-engineer'));
  const resolvedRuntimeStateRoot = path.resolve(runtimeStateRoot || path.join(resolvedInstallerRoot, 'state'));
  const resolvedRuntimeRoot = path.resolve(runtimeRoot || path.join(resolvedHome, 'plugins', 'veteran-engineer'));
  const effectiveEnv = { ...env, HOME: resolvedHome, USERPROFILE: resolvedHome };

  await preflightHost({ host, home: resolvedHome, runtimeRoot: resolvedRuntimeRoot, env: effectiveEnv, bindHostImpl });
  if (await pathExists(resolvedRuntimeRoot)) throw bootstrapError(`Veteran Engineer runtime already exists at ${resolvedRuntimeRoot}; use veteran-engineer upgrade --release instead`, 'BOOTSTRAP_RUNTIME_EXISTS');
  let npm = npmExecutable;
  if (prepareDependenciesImpl === defaultPrepareDependencies) {
    npm ||= await findExecutable('npm', effectiveEnv);
    if (!npm) throw bootstrapError('npm was not found on PATH; Node.js 20+ with npm is required for bootstrap', 'BOOTSTRAP_NPM_NOT_FOUND');
  }

  const releaseJson = await fetchRelease({ fetchImpl, repository, apiBase, selector: release });
  const manifestAssetMeta = requireAsset(releaseJson, 'veteran-engineer-release-manifest.json');
  const manifestBytes = await downloadVerifiedAsset(fetchImpl, manifestAssetMeta);
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); }
  catch { throw bootstrapError('Release manifest is invalid JSON', 'BOOTSTRAP_MANIFEST_INVALID'); }
  const version = verifyManifestIdentity(manifest, releaseJson);
  const bootstrapEntry = manifestAsset(manifest, 'bootstrap');
  const runtimeEntry = manifestAsset(manifest, 'runtime');
  const runningBytes = selfBytes === null ? await fs.readFile(self) : Buffer.from(selfBytes);
  await verifyManifestAsset({ fetchImpl, release: releaseJson, manifestEntry: bootstrapEntry, selfBytes: runningBytes });
  const runtimeBytes = await verifyManifestAsset({ fetchImpl, release: releaseJson, manifestEntry: runtimeEntry });

  await fs.mkdir(path.dirname(resolvedRuntimeRoot), { recursive: true });
  const stageRoot = `${resolvedRuntimeRoot}.bootstrap-stage-${crypto.randomUUID()}`;
  let promoted = false;
  try {
    await materializeRuntime(runtimeBytes, stageRoot, version);
    await prepareDependenciesImpl({ root: stageRoot, npmExecutable: npm, env: effectiveEnv });
    await verifyRuntimeDependencies(stageRoot);
    if (await pathExists(resolvedRuntimeRoot)) throw bootstrapError(`Veteran Engineer runtime appeared during bootstrap at ${resolvedRuntimeRoot}; refusing to overwrite it`, 'BOOTSTRAP_RUNTIME_RACE');
    await fs.rename(stageRoot, resolvedRuntimeRoot);
    promoted = true;
    const binding = await bindHostImpl({
      runtimeRoot: resolvedRuntimeRoot,
      runtimeStateRoot: resolvedRuntimeStateRoot,
      installerRoot: resolvedInstallerRoot,
      home: resolvedHome,
      host,
      descriptorPath,
      surfaceProfile,
      hermesHome,
      env: effectiveEnv
    });
    return {
      ok: true,
      product: 'veteran-engineer',
      version,
      release: { tag: releaseJson.tag_name, commit: releaseJson.target_commitish, releaseId: releaseJson.id || null },
      runtimeRoot: resolvedRuntimeRoot,
      runtimeStateRoot: resolvedRuntimeStateRoot,
      installerRoot: resolvedInstallerRoot,
      host,
      binding
    };
  } finally {
    if (!promoted) await fs.rm(stageRoot, { recursive: true, force: true }).catch(() => {});
  }
}

function optionValue(argv, index, option) {
  const value = argv[index + 1];
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('-')) throw bootstrapError(`${option} requires a value`, 'BOOTSTRAP_ARGUMENT_VALUE_REQUIRED');
  return value;
}

export function parseBootstrapArgs(argv) {
  const out = { command: argv[0] || 'help', host: null, release: 'latest', json: false };
  let index = 1;
  if (argv[index] && !argv[index].startsWith('-')) out.host = argv[index++];
  for (; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--release') out.release = optionValue(argv, index++, arg);
    else if (arg === '--home') out.home = optionValue(argv, index++, arg);
    else if (arg === '--runtime-root') out.runtimeRoot = optionValue(argv, index++, arg);
    else if (arg === '--state-root') out.runtimeStateRoot = optionValue(argv, index++, arg);
    else if (arg === '--installer-root') out.installerRoot = optionValue(argv, index++, arg);
    else if (arg === '--descriptor') out.descriptorPath = optionValue(argv, index++, arg);
    else if (arg === '--surface-profile') out.surfaceProfile = optionValue(argv, index++, arg);
    else if (arg === '--hermes-home') out.hermesHome = optionValue(argv, index++, arg);
    else if (arg === '--json') out.json = true;
    else throw bootstrapError(`Unknown argument: ${arg}`, 'BOOTSTRAP_ARGUMENT_INVALID');
  }
  return out;
}

function usage() {
  return `Veteran Engineer verified bootstrap\n\nUsage:\n  node veteran-engineer-bootstrap.mjs install <codex|hermes|generic> [options]\n\nOptions:\n  --release latest|vX.Y.Z\n  --home <path>\n  --runtime-root <path>\n  --state-root <path>\n  --installer-root <path>\n  --descriptor <path>\n  --surface-profile <local-stdio|remote-mcp|secure-tunnel>\n  --hermes-home <path>\n  --json\n\nBootstrap refuses to overwrite an existing runtime. Existing installations must use veteran-engineer upgrade --release.\n`;
}

async function main() {
  const args = parseBootstrapArgs(process.argv.slice(2));
  if (['help', '-h', '--help'].includes(args.command)) {
    process.stdout.write(usage());
    return;
  }
  if (args.command !== 'install' || !args.host) throw bootstrapError('bootstrap requires: install <codex|hermes|generic>', 'BOOTSTRAP_COMMAND_INVALID');
  const result = await bootstrapVeteran(args);
  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`Veteran Engineer ${result.version} installed for ${result.host}\nRuntime: ${result.runtimeRoot}\nRelease: ${result.release.tag} @ ${result.release.commit}\nDoctor: PASS\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  main().catch((error) => {
    process.stderr.write(`${error.code ? `[${error.code}] ` : ''}${error.stack || error.message || String(error)}\n`);
    process.exitCode = 1;
  });
}
