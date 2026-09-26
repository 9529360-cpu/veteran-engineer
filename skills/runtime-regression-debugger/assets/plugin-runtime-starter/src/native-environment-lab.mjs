#!/usr/bin/env node
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const NATIVE_ENVIRONMENT_LAB_CONTRACT = 'veteran-native-environment-lab-v1';

const MAX_CHECKS = 256;
const MAX_SPEC_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const VERSION_TIMEOUT_MS = 5_000;
const PORT_TIMEOUT_MS = 1_500;
const COMMANDS = Object.freeze({
  node: ['--version'], npm: ['--version'], npx: ['--version'], pnpm: ['--version'], yarn: ['--version'], bun: ['--version'], deno: ['--version'],
  git: ['--version'], python: ['--version'], python3: ['--version'], docker: ['--version'], go: ['version'], rustc: ['--version'], cargo: ['--version'], java: ['-version']
});

function codedError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details !== null) error.details = details;
  return error;
}

function portable(value) { return String(value).split(path.sep).join('/'); }

function safeName(value, label, regex, max = 160) {
  const text = String(value || '').trim();
  if (!text || text.length > max || !regex.test(text)) throw codedError(`${label} is invalid`, 'ENV_LAB_CONFIG_INVALID');
  return text;
}

function normalizeVersion(value) {
  if (value === undefined || value === null || value === '') return null;
  const match = String(value).trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) throw codedError(`Invalid minimum version: ${value}`, 'ENV_LAB_CONFIG_INVALID');
  return [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)];
}

function parseObservedVersion(text) {
  const match = String(text || '').match(/(?:^|[^0-9])(\d+)\.(\d+)(?:\.(\d+))?/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] || 0)] : null;
}

function compareVersions(left, right) {
  for (let i = 0; i < 3; i += 1) {
    if (left[i] > right[i]) return 1;
    if (left[i] < right[i]) return -1;
  }
  return 0;
}

function versionText(parts) { return parts ? parts.join('.') : null; }

export function normalizeEnvironmentSpec(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw codedError('Environment spec must be an object', 'ENV_LAB_CONFIG_INVALID');
  const commands = Array.isArray(raw.commands) ? raw.commands : [];
  const env = Array.isArray(raw.env) ? raw.env : [];
  const paths = Array.isArray(raw.paths) ? raw.paths : [];
  const ports = Array.isArray(raw.ports) ? raw.ports : [];
  if (commands.length + env.length + paths.length + ports.length === 0) throw codedError('Environment spec must contain at least one check', 'ENV_LAB_CONFIG_INVALID');
  if (commands.length + env.length + paths.length + ports.length > MAX_CHECKS) throw codedError('Environment spec contains too many checks', 'ENV_LAB_CONFIG_INVALID');
  return {
    contract: NATIVE_ENVIRONMENT_LAB_CONTRACT,
    commands: commands.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw codedError('Command check must be an object', 'ENV_LAB_CONFIG_INVALID');
      const name = safeName(item.name, 'Command name', /^[A-Za-z0-9._+-]+$/);
      if (!Object.hasOwn(COMMANDS, name)) throw codedError(`Command ${name} is not in the bounded doctor allowlist`, 'ENV_LAB_COMMAND_UNSUPPORTED');
      return { name, required: item.required !== false, minVersion: normalizeVersion(item.minVersion) };
    }),
    env: env.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw codedError('Environment check must be an object', 'ENV_LAB_CONFIG_INVALID');
      return { name: safeName(item.name, 'Environment variable name', /^[A-Za-z_][A-Za-z0-9_]*$/), required: item.required !== false, nonEmpty: item.nonEmpty !== false };
    }),
    paths: paths.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw codedError('Path check must be an object', 'ENV_LAB_CONFIG_INVALID');
      const relative = String(item.path || '');
      if (!relative || relative.length > 4096 || relative.includes('\0') || path.isAbsolute(relative)) throw codedError('Path check must use a bounded relative path', 'ENV_LAB_CONFIG_INVALID');
      const normalized = path.normalize(relative);
      if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw codedError('Path check escapes root', 'ENV_LAB_CONFIG_INVALID');
      const type = item.type === undefined ? 'any' : String(item.type);
      if (!['any', 'file', 'directory'].includes(type)) throw codedError('Path check type is invalid', 'ENV_LAB_CONFIG_INVALID');
      return { path: normalized, type, required: item.required !== false };
    }),
    ports: ports.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw codedError('Port check must be an object', 'ENV_LAB_CONFIG_INVALID');
      const port = Number(item.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw codedError('Port must be between 1 and 65535', 'ENV_LAB_CONFIG_INVALID');
      const expected = String(item.expected || 'free');
      if (!['free', 'listening'].includes(expected)) throw codedError('Port expected state must be free or listening', 'ENV_LAB_CONFIG_INVALID');
      return { port, expected, required: item.required !== false };
    })
  };
}

async function commandCandidates(name) {
  const pathValue = process.env.PATH || '';
  const directories = pathValue.split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  const candidates = [];
  for (const directory of directories) {
    for (const extension of extensions) candidates.push(path.join(directory, process.platform === 'win32' ? `${name}${extension}` : name));
  }
  return candidates;
}

async function resolveCommand(name) {
  for (const candidate of await commandCandidates(name)) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {}
  }
  return null;
}

function runVersion(executable, args, cwd) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(executable, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, VERSION_TIMEOUT_MS);
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };
    child.stdout.on('data', (chunk) => { if (stdout.length < 8192) stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { if (stderr.length < 8192) stderr += chunk.toString('utf8'); });
    child.once('error', (error) => finish({ ok: false, code: null, errorCode: error?.code || 'ENV_LAB_VERSION_FAILED', text: '' }));
    child.once('close', (code) => finish({ ok: code === 0, code, errorCode: code === 0 ? null : 'ENV_LAB_VERSION_FAILED', text: `${stdout}\n${stderr}`.slice(0, 16384) }));
  });
}

async function checkCommand(check, cwd) {
  const executable = await resolveCommand(check.name);
  if (!executable) return { kind: 'command', name: check.name, required: check.required, passed: !check.required, available: false, version: null, minVersion: versionText(check.minVersion), reason: 'not-found' };
  const versionRun = await runVersion(executable, COMMANDS[check.name], cwd);
  const observed = parseObservedVersion(versionRun.text);
  let passed = versionRun.ok;
  let reason = versionRun.ok ? null : 'version-command-failed';
  if (passed && check.minVersion) {
    if (!observed) { passed = false; reason = 'version-unparseable'; }
    else if (compareVersions(observed, check.minVersion) < 0) { passed = false; reason = 'version-too-old'; }
  }
  if (!check.required && !passed) passed = true;
  return { kind: 'command', name: check.name, required: check.required, passed, available: true, version: versionText(observed), minVersion: versionText(check.minVersion), reason };
}

function checkEnv(check, environment) {
  const present = Object.hasOwn(environment, check.name);
  const nonEmpty = present && String(environment[check.name] ?? '').length > 0;
  const satisfies = present && (!check.nonEmpty || nonEmpty);
  return { kind: 'env', name: check.name, required: check.required, passed: satisfies || !check.required, present, nonEmpty: present ? nonEmpty : false, reason: satisfies ? null : (present ? 'empty' : 'missing') };
}

async function checkPath(check, root) {
  const target = path.resolve(root, check.path);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw codedError('Path check escapes root', 'ENV_LAB_PATH_ESCAPE');
  let stat;
  let real;
  try {
    real = await fs.realpath(target);
    if (real !== root && !real.startsWith(`${root}${path.sep}`)) throw codedError('Path check resolves outside root', 'ENV_LAB_PATH_ESCAPE');
    stat = await fs.stat(real);
  } catch (error) {
    if (error?.code === 'ENOENT') return { kind: 'path', path: portable(check.path), expectedType: check.type, required: check.required, passed: !check.required, exists: false, actualType: null, reason: 'missing' };
    throw error;
  }
  const actualType = stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other';
  const typeOk = check.type === 'any' || actualType === check.type;
  return { kind: 'path', path: portable(check.path), expectedType: check.type, required: check.required, passed: typeOk || !check.required, exists: true, actualType, reason: typeOk ? null : 'type-mismatch' };
}

function portListening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(PORT_TIMEOUT_MS, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function checkPort(check) {
  const listening = await portListening(check.port);
  const matches = check.expected === 'listening' ? listening : !listening;
  return { kind: 'port', port: check.port, expected: check.expected, required: check.required, passed: matches || !check.required, observed: listening ? 'listening' : 'free', reason: matches ? null : 'state-mismatch' };
}

export async function runEnvironmentLab(rawSpec, { rootDir = process.cwd(), environment = process.env } = {}) {
  const spec = rawSpec?.contract === NATIVE_ENVIRONMENT_LAB_CONTRACT ? rawSpec : normalizeEnvironmentSpec(rawSpec);
  const root = await fs.realpath(path.resolve(rootDir));
  const checks = [];
  for (const item of spec.commands) checks.push(await checkCommand(item, root));
  for (const item of spec.env) checks.push(checkEnv(item, environment));
  for (const item of spec.paths) checks.push(await checkPath(item, root));
  for (const item of spec.ports) checks.push(await checkPort(item));
  return {
    contract: NATIVE_ENVIRONMENT_LAB_CONTRACT,
    platform: { os: process.platform, arch: process.arch },
    passed: checks.every((item) => item.passed),
    summary: { total: checks.length, passed: checks.filter((item) => item.passed).length, failed: checks.filter((item) => !item.passed).length },
    checks
  };
}

function normalizeRelative(value, label) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0') || path.isAbsolute(value)) throw codedError(`${label} must be a relative path`, 'ENV_LAB_PATH_INVALID');
  const normalized = path.normalize(value);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw codedError(`${label} escapes root`, 'ENV_LAB_PATH_INVALID');
  return normalized;
}

async function readSpec(rootDir, relativePath) {
  const root = await fs.realpath(path.resolve(rootDir));
  const safe = normalizeRelative(relativePath, 'Spec path');
  const target = await fs.realpath(path.resolve(root, safe));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw codedError('Spec path escapes root', 'ENV_LAB_PATH_ESCAPE');
  const stat = await fs.stat(target);
  if (!stat.isFile() || stat.size > MAX_SPEC_BYTES) throw codedError('Environment spec is invalid or too large', 'ENV_LAB_SPEC_INVALID');
  let parsed;
  try { parsed = JSON.parse(await fs.readFile(target, 'utf8')); }
  catch { throw codedError('Environment spec JSON is invalid', 'ENV_LAB_SPEC_INVALID'); }
  return normalizeEnvironmentSpec(parsed);
}

async function writeReport(rootDir, relativePath, report) {
  const root = await fs.realpath(path.resolve(rootDir));
  const safe = normalizeRelative(relativePath, 'Output path');
  const target = path.resolve(root, safe);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const parent = await fs.realpath(path.dirname(target));
  if (parent !== root && !parent.startsWith(`${root}${path.sep}`)) throw codedError('Output path escapes root', 'ENV_LAB_PATH_ESCAPE');
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw codedError('Output must be a regular file', 'ENV_LAB_OUTPUT_INVALID');
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const content = `${JSON.stringify(report, null, 2)}\n`;
  if (Buffer.byteLength(content) > MAX_OUTPUT_BYTES) throw codedError('Environment report is too large', 'ENV_LAB_OUTPUT_TOO_LARGE');
  await fs.writeFile(target, content, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(target, 0o600).catch(() => {});
  return { path: portable(safe), bytes: Buffer.byteLength(content) };
}

function usage() {
  return `Veteran Native Environment Lab\n\nUsage:\n  node src/native-environment-lab.mjs run <doctor.json> [--root .] [--out report.json]\n\nChecks bounded tool versions, env presence, root-contained paths, and loopback port state. It never runs user-supplied shell commands or returns environment variable values.\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || 'help';
  if (['help', '-h', '--help'].includes(command)) { process.stdout.write(usage()); return 0; }
  if (command !== 'run') throw codedError(`Unknown Environment Lab command: ${command}`, 'ENV_LAB_COMMAND_UNKNOWN');
  const specPath = argv[1];
  if (!specPath || specPath.startsWith('-')) throw codedError('run requires a doctor JSON path', 'ENV_LAB_ARGUMENT_REQUIRED');
  let rootDir = process.cwd();
  let out = null;
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') { rootDir = argv[++index]; if (!rootDir) throw codedError('--root requires a value', 'ENV_LAB_ARGUMENT_REQUIRED'); }
    else if (arg === '--out') { out = argv[++index]; if (!out) throw codedError('--out requires a value', 'ENV_LAB_ARGUMENT_REQUIRED'); }
    else throw codedError(`Unknown Environment Lab argument: ${arg}`, 'ENV_LAB_ARGUMENT_UNKNOWN');
  }
  const spec = await readSpec(rootDir, specPath);
  const report = await runEnvironmentLab(spec, { rootDir });
  const artifact = out ? await writeReport(rootDir, out, report) : null;
  process.stdout.write(`${JSON.stringify({ ...report, artifact }, null, 2)}\n`);
  return report.passed ? 0 : 2;
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error?.code || 'ENV_LAB_ERROR'}: ${String(error?.message || error)}\n`);
    process.exitCode = 1;
  });
}
