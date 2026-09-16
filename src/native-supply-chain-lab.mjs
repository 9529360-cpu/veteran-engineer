#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const SUPPLY_CHAIN_REPORT_CONTRACT = 'veteran-native-supply-chain-report-v1';
const MAX_FILES = 5_000;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_LOCK_BYTES = 32 * 1024 * 1024;
const MAX_FINDINGS = 5_000;
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', 'coverage', '.next', '.cache', '.turbo']);
const LOCK_NAMES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock'];
const DEP_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'];
const SEVERITY = { low: 1, medium: 2, high: 3, critical: 4 };

function codedError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details !== null) error.details = details;
  return error;
}

function portable(value) { return String(value).split(path.sep).join('/'); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

async function walk(root) {
  const manifests = [];
  const locks = [];
  const stack = [root];
  let files = 0;
  while (stack.length) {
    const dir = stack.pop();
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      files += 1;
      if (files > MAX_FILES) throw codedError('Supply-chain scan exceeded file limit', 'SUPPLY_CHAIN_FILE_LIMIT');
      if (entry.name === 'package.json') manifests.push(full);
      if (LOCK_NAMES.includes(entry.name)) locks.push(full);
    }
  }
  manifests.sort();
  locks.sort();
  return { manifests, locks };
}

async function readJson(file, limit, code) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > limit) throw codedError(`File is invalid or too large: ${path.basename(file)}`, code, { bytes: stat.size });
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { throw codedError(`Invalid JSON: ${path.basename(file)}`, code); }
}

function addFinding(findings, finding) {
  findings.push(finding);
  if (findings.length > MAX_FINDINGS) throw codedError('Supply-chain findings exceeded limit', 'SUPPLY_CHAIN_FINDING_LIMIT');
}

function classifySpec(spec) {
  const value = String(spec || '').trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower === '*' || lower === 'latest' || lower === 'next') return { rule: 'floating-dependency', severity: 'medium', sourceType: 'floating-tag' };
  if (lower.startsWith('http://')) return { rule: 'insecure-http-dependency', severity: 'high', sourceType: 'http' };
  if (lower.startsWith('https://')) return { rule: 'remote-url-dependency', severity: 'medium', sourceType: 'https' };
  if (/^(git\+|git:|ssh:|github:|gitlab:|bitbucket:)/i.test(value)) return { rule: 'git-dependency', severity: 'medium', sourceType: 'git' };
  if (/^(file:|link:)/i.test(value)) return { rule: 'local-path-dependency', severity: 'low', sourceType: 'local-path' };
  return null;
}

function findNearestLock(manifestDir, root, locksByDir) {
  let current = manifestDir;
  while (true) {
    if (locksByDir.has(current)) return locksByDir.get(current);
    if (current === root) return null;
    const parent = path.dirname(current);
    if (parent === current || !parent.startsWith(root)) return null;
    current = parent;
  }
}

function packageNameFromLockPath(lockPath, entry) {
  if (entry?.name) return String(entry.name);
  const marker = 'node_modules/';
  const index = lockPath.lastIndexOf(marker);
  if (index < 0) return null;
  return lockPath.slice(index + marker.length) || null;
}

function componentKey(name, version) { return `${name}\0${version}`; }

async function inspectNpmLock(lockFile, root, findings, components) {
  const parsed = await readJson(lockFile, MAX_LOCK_BYTES, 'SUPPLY_CHAIN_LOCK_INVALID');
  const relative = portable(path.relative(root, lockFile));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
  if (!parsed.packages || typeof parsed.packages !== 'object' || Array.isArray(parsed.packages)) return;
  for (const [lockPath, entry] of Object.entries(parsed.packages)) {
    if (!lockPath || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const name = packageNameFromLockPath(lockPath, entry);
    const version = typeof entry.version === 'string' ? entry.version : null;
    if (name && version) components.set(componentKey(name, version), { type: 'library', name, version });
    const resolved = typeof entry.resolved === 'string' ? entry.resolved.trim() : '';
    if (/^http:\/\//i.test(resolved)) addFinding(findings, { rule: 'insecure-lock-resolution', severity: 'high', path: relative, package: name, sourceType: 'http' });
    else if (/^(git\+|git:|ssh:)/i.test(resolved)) addFinding(findings, { rule: 'git-lock-resolution', severity: 'medium', path: relative, package: name, sourceType: 'git' });
  }
}

export async function auditSupplyChain(rootDir = '.') {
  const root = await fs.realpath(path.resolve(rootDir));
  const { manifests, locks } = await walk(root);
  const locksByDir = new Map();
  for (const file of locks) {
    const dir = path.dirname(file);
    const list = locksByDir.get(dir) || [];
    list.push(file);
    locksByDir.set(dir, list);
  }
  const findings = [];
  const packages = [];
  for (const manifestFile of manifests) {
    const manifest = await readJson(manifestFile, MAX_MANIFEST_BYTES, 'SUPPLY_CHAIN_MANIFEST_INVALID');
    const relative = portable(path.relative(root, manifestFile));
    const packageName = typeof manifest.name === 'string' ? manifest.name : null;
    const packageVersion = typeof manifest.version === 'string' ? manifest.version : null;
    const manifestDir = path.dirname(manifestFile);
    packages.push({ path: relative, name: packageName, version: packageVersion, lockfiles: (findNearestLock(manifestDir, root, locksByDir) || []).map((item) => portable(path.relative(root, item))) });
    const hasDependencies = DEP_SECTIONS.some((section) => manifest[section] && Object.keys(manifest[section]).length > 0);
    if (hasDependencies && !findNearestLock(manifestDir, root, locksByDir)) addFinding(findings, { rule: 'dependency-lock-missing', severity: 'medium', path: relative, package: packageName, sourceType: 'manifest' });
    for (const script of INSTALL_SCRIPTS) {
      if (typeof manifest.scripts?.[script] === 'string' && manifest.scripts[script].trim()) addFinding(findings, { rule: 'install-lifecycle-script', severity: 'medium', path: relative, package: packageName, script, sourceType: 'script' });
    }
    for (const section of DEP_SECTIONS) {
      const deps = manifest[section];
      if (!deps || typeof deps !== 'object' || Array.isArray(deps)) continue;
      for (const [dependency, spec] of Object.entries(deps)) {
        const classification = classifySpec(spec);
        if (classification) addFinding(findings, { ...classification, path: relative, package: packageName, dependency, section });
      }
    }
  }
  const components = new Map();
  for (const lock of locks) {
    if (['package-lock.json', 'npm-shrinkwrap.json'].includes(path.basename(lock))) await inspectNpmLock(lock, root, findings, components);
  }
  findings.sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity] || a.path.localeCompare(b.path) || a.rule.localeCompare(b.rule) || String(a.dependency || '').localeCompare(String(b.dependency || '')));
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const item of findings) counts[item.severity] += 1;
  return {
    contract: SUPPLY_CHAIN_REPORT_CONTRACT,
    root: '.',
    packages,
    lockfiles: locks.map((item) => portable(path.relative(root, item))),
    findings,
    counts,
    components: [...components.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
  };
}

export function createCycloneDx(report) {
  if (!report || report.contract !== SUPPLY_CHAIN_REPORT_CONTRACT || !Array.isArray(report.components)) throw codedError('Invalid supply-chain report', 'SUPPLY_CHAIN_REPORT_INVALID');
  const components = report.components.map((component) => ({ type: component.type, name: component.name, version: component.version }));
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata: { timestamp: new Date().toISOString(), tools: [{ vendor: 'Veteran Engineer', name: 'Native Supply Chain Lab' }] },
    components
  };
}

function severityRank(value) { return SEVERITY[value] || 0; }
export function evaluateSupplyChain(report, failOn = 'high') {
  const level = String(failOn).toLowerCase();
  if (!['none', 'low', 'medium', 'high', 'critical'].includes(level)) throw codedError('Invalid failOn severity', 'SUPPLY_CHAIN_FAIL_LEVEL_INVALID');
  const threshold = level === 'none' ? Number.POSITIVE_INFINITY : severityRank(level);
  const failing = report.findings.filter((item) => severityRank(item.severity) >= threshold);
  return { passed: failing.length === 0, failOn: level, failing: failing.length };
}

function normalizeRelative(value, label) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0') || path.isAbsolute(value)) throw codedError(`${label} must be a relative path`, 'SUPPLY_CHAIN_PATH_INVALID');
  const normalized = path.normalize(value);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw codedError(`${label} escapes root`, 'SUPPLY_CHAIN_PATH_INVALID');
  return normalized;
}

async function writeContainedJson(rootDir, relativePath, payload) {
  const root = await fs.realpath(path.resolve(rootDir));
  const safe = normalizeRelative(relativePath, 'Output path');
  const target = path.resolve(root, safe);
  const parent = path.dirname(target);
  await fs.mkdir(parent, { recursive: true });
  const parentReal = await fs.realpath(parent);
  if (parentReal !== root && !parentReal.startsWith(`${root}${path.sep}`)) throw codedError('Output path escapes root', 'SUPPLY_CHAIN_PATH_ESCAPE');
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw codedError('Output must be a regular file', 'SUPPLY_CHAIN_OUTPUT_INVALID');
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  await fs.writeFile(target, content, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(target, 0o600).catch(() => {});
  return { path: portable(path.relative(root, target)), bytes: Buffer.byteLength(content), sha256: sha256(content) };
}

function usage() {
  return `Veteran Native Supply Chain Lab\n\nUsage:\n  node src/native-supply-chain-lab.mjs audit [--root .] [--fail-on high] [--out report.json]\n  node src/native-supply-chain-lab.mjs sbom [--root .] [--out sbom.json]\n\nOffline repository audit only; this tool does not claim CVE/vulnerability intelligence.\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || 'help';
  if (['help', '-h', '--help'].includes(command)) { process.stdout.write(usage()); return 0; }
  if (!['audit', 'sbom'].includes(command)) throw codedError(`Unknown command: ${command}`, 'SUPPLY_CHAIN_COMMAND_UNKNOWN');
  let rootDir = process.cwd();
  let failOn = 'high';
  let out = null;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') { rootDir = argv[++index]; if (!rootDir) throw codedError('--root requires a value', 'SUPPLY_CHAIN_ARGUMENT_REQUIRED'); }
    else if (arg === '--fail-on') { failOn = argv[++index]; if (!failOn) throw codedError('--fail-on requires a value', 'SUPPLY_CHAIN_ARGUMENT_REQUIRED'); }
    else if (arg === '--out') { out = argv[++index]; if (!out) throw codedError('--out requires a value', 'SUPPLY_CHAIN_ARGUMENT_REQUIRED'); }
    else throw codedError(`Unknown argument: ${arg}`, 'SUPPLY_CHAIN_ARGUMENT_UNKNOWN');
  }
  const report = await auditSupplyChain(rootDir);
  if (command === 'sbom') {
    const sbom = createCycloneDx(report);
    const artifact = out ? await writeContainedJson(rootDir, out, sbom) : null;
    process.stdout.write(`${JSON.stringify({ sbom, artifact }, null, 2)}\n`);
    return 0;
  }
  const evaluation = evaluateSupplyChain(report, failOn);
  const result = { ...report, evaluation };
  const artifact = out ? await writeContainedJson(rootDir, out, result) : null;
  process.stdout.write(`${JSON.stringify({ ...result, artifact }, null, 2)}\n`);
  return evaluation.passed ? 0 : 2;
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error?.code || 'SUPPLY_CHAIN_ERROR'}: ${String(error?.message || error)}\n`);
    process.exitCode = 1;
  });
}
