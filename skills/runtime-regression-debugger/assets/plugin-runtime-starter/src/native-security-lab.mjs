#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const NATIVE_SECURITY_LAB_CONTRACT = 'veteran-native-security-lab-v1';
export const SECURITY_REPORT_CONTRACT = NATIVE_SECURITY_LAB_CONTRACT;
export const SECURITY_BASELINE_CONTRACT = 'veteran-native-security-baseline-v1';

const DEFAULT_MAX_FILES = 20_000;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_FINDINGS = 10_000;
const MAX_REPORT_BYTES = 16 * 1024 * 1024;
const IGNORED_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'vendor', 'dist', 'build', 'coverage', '.next', '.nuxt', '.cache', '.turbo', '.venv', 'venv', '__pycache__'
]);
const TEXT_EXTENSIONS = new Set([
  '', '.txt', '.md', '.mdx', '.rst', '.json', '.jsonc', '.jsonl', '.ndjson', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.config', '.env', '.properties',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.php', '.java', '.kt', '.kts', '.go', '.rs', '.c', '.h', '.cc', '.cpp', '.cs', '.swift',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.sql', '.graphql', '.gql', '.xml', '.html', '.css', '.scss', '.less', '.dockerfile',
  '.pem', '.key', '.crt', '.cer', '.tf', '.tfvars', '.hcl'
]);
const SPECIAL_TEXT_NAMES = new Set(['dockerfile', 'makefile', 'procfile', 'gemfile', 'rakefile', '.npmrc', '.yarnrc', '.pypirc', '.netrc', '.git-credentials']);
const PLACEHOLDER_WORDS = ['example', 'sample', 'dummy', 'fake', 'changeme', 'replace-me', 'replace_me', 'your_', 'test-only', 'not-a-secret', 'placeholder'];
const SEVERITY_RANK = Object.freeze({ none: 0, low: 1, medium: 2, high: 3, critical: 4, any: 0 });

const TOKEN_RULES = [
  { id: 'github-token', severity: 'critical', description: 'GitHub access token', regex: /\b(?:gh[pousr]_[A-Za-z0-9_]{30,255}|github_pat_[A-Za-z0-9_]{20,255})\b/g },
  { id: 'slack-token', severity: 'high', description: 'Slack token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,255}\b/g },
  { id: 'aws-access-key', severity: 'high', description: 'AWS access key id', regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { id: 'stripe-live-secret', severity: 'critical', description: 'Stripe live secret key', regex: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,255}\b/g },
  { id: 'google-api-key', severity: 'high', description: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'jwt-token', severity: 'medium', description: 'JWT-like bearer token', regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { id: 'credential-url', severity: 'high', description: 'Credential embedded in URL', regex: /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s/@:]{1,128}:[^\s/@]{8,256}@[^\s]+/gi }
];

const PRIVATE_KEY_RULES = [
  /-----BEGIN ((?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY)-----[\s\S]{1,65536}?-----END \1-----/g,
  /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]{1,65536}?-----END PGP PRIVATE KEY BLOCK-----/g
];

const GENERIC_ASSIGNMENT = /\b(api[_-]?key|access[_-]?token|auth[_-]?token|secret(?:[_-]?key)?|client[_-]?secret|password|passwd|private[_-]?token)\b\s*[:=]\s*["'`]([^"'`\r\n]{12,})["'`]/gi;

function codedError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details !== null) error.details = details;
  return error;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function portablePath(value) {
  return String(value).split(path.sep).join('/');
}

function normalizeRelativePath(value, label = 'path') {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value.includes('\0')) {
    throw codedError(`${label} must be a bounded relative path`, 'SECURITY_PATH_INVALID');
  }
  if (path.isAbsolute(value)) throw codedError(`${label} must stay inside the root`, 'SECURITY_PATH_INVALID');
  const normalized = path.normalize(value);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw codedError(`${label} must stay inside the root`, 'SECURITY_PATH_INVALID');
  return normalized;
}

async function rootInfo(root) {
  const absolute = path.resolve(root || '.');
  const real = await fs.realpath(absolute);
  return { absolute, real };
}

function isWithin(rootReal, candidateReal) {
  return candidateReal === rootReal || candidateReal.startsWith(`${rootReal}${path.sep}`);
}

async function resolveContainedExisting(root, relative, label) {
  const safe = normalizeRelativePath(relative, label);
  const absolute = path.resolve(root.absolute, safe);
  const real = await fs.realpath(absolute);
  if (!isWithin(root.real, real)) throw codedError(`${label} escapes root`, 'SECURITY_LAB_ROOT_ESCAPE');
  return { safe, absolute, real };
}

async function resolveContainedOutput(root, relative, label) {
  const safe = normalizeRelativePath(relative, label);
  const absolute = path.resolve(root.absolute, safe);
  const parent = path.dirname(absolute);
  await fs.mkdir(parent, { recursive: true });
  const parentReal = await fs.realpath(parent);
  if (!isWithin(root.real, parentReal)) throw codedError(`${label} escapes root`, 'SECURITY_LAB_ROOT_ESCAPE');
  try {
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink() || !stat.isFile()) throw codedError(`${label} must be a regular file`, 'SECURITY_LAB_OUTPUT_INVALID');
    const existingReal = await fs.realpath(absolute);
    if (!isWithin(root.real, existingReal)) throw codedError(`${label} escapes root`, 'SECURITY_LAB_ROOT_ESCAPE');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return { safe, absolute };
}

function extensionFor(name) {
  const lower = name.toLowerCase();
  if (SPECIAL_TEXT_NAMES.has(lower)) return '';
  if (lower.endsWith('.env') || lower.includes('.env.')) return '.env';
  return path.extname(lower);
}

function shouldScanFile(name) {
  return TEXT_EXTENSIONS.has(extensionFor(name));
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return sample.length > 0 && suspicious / sample.length > 0.15;
}

function looksPlaceholder(value) {
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.startsWith('${') || normalized.startsWith('$env:') || normalized.includes('process.env') || normalized.includes('os.environ')) return true;
  if (/^<[^>]+>$/.test(normalized)) return true;
  return PLACEHOLDER_WORDS.some((word) => normalized.includes(word));
}

function entropy(value) {
  if (!value) return 0;
  const counts = new Map();
  for (const char of value) counts.set(char, (counts.get(char) || 0) + 1);
  let out = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    out -= p * Math.log2(p);
  }
  return out;
}

async function walkFiles(root, limits) {
  const files = [];
  let totalBytes = 0;
  const stack = [{ absolute: root.absolute, relative: '' }];
  while (stack.length) {
    const current = stack.pop();
    const entries = await fs.readdir(current.absolute, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry.isSymbolicLink()) continue;
      const relative = current.relative ? path.join(current.relative, entry.name) : entry.name;
      const absolute = path.join(current.absolute, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name.toLowerCase())) stack.push({ absolute, relative });
        continue;
      }
      if (!entry.isFile() || !shouldScanFile(entry.name)) continue;
      if (files.length >= limits.maxFiles) throw codedError('Security scan exceeded file count limit', 'SECURITY_LAB_SCAN_LIMIT');
      const stat = await fs.stat(absolute);
      if (stat.size > limits.maxFileBytes) continue;
      if (totalBytes + stat.size > limits.maxTotalBytes) throw codedError('Security scan exceeded total byte limit', 'SECURITY_LAB_SCAN_LIMIT');
      totalBytes += stat.size;
      files.push({ absolute, relative: portablePath(relative), size: stat.size });
    }
  }
  files.sort((a, b) => a.relative.localeCompare(b.relative));
  return { files, totalBytes };
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

function lineBounds(text, index) {
  const start = text.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  let end = text.indexOf('\n', index);
  if (end < 0) end = text.length;
  return { start, end };
}

function safeContext(text, matchIndex, matchLength) {
  const { start, end } = lineBounds(text, matchIndex);
  let line = text.slice(start, end).replace(/\r$/, '');
  const localStart = matchIndex - start;
  const localEnd = localStart + matchLength;
  line = `${line.slice(0, localStart)}[REDACTED:${matchLength}]${line.slice(localEnd)}`;
  if (line.length > 240) line = `${line.slice(0, 237)}...`;
  return line;
}

function findingFingerprint(kind, relativePath, secret) {
  return sha256(`${kind}\0${relativePath}\0${secret}`);
}

function genericSecretFindings(text, relativePath) {
  const findings = [];
  GENERIC_ASSIGNMENT.lastIndex = 0;
  let match;
  while ((match = GENERIC_ASSIGNMENT.exec(text)) !== null) {
    const secret = match[2];
    if (looksPlaceholder(secret)) continue;
    const compact = secret.replace(/\s+/g, '');
    if (compact.length < 16 || entropy(compact) < 3.2) continue;
    const full = match[0];
    const localOffset = full.lastIndexOf(secret);
    const secretIndex = match.index + Math.max(0, localOffset);
    findings.push({
      kind: 'generic-secret-assignment',
      severity: 'high',
      description: 'High-entropy credential assignment',
      path: relativePath,
      line: lineNumberAt(text, secretIndex),
      fingerprint: findingFingerprint('generic-secret-assignment', relativePath, secret),
      context: safeContext(text, secretIndex, secret.length)
    });
  }
  return findings;
}

function scanPrivateKeyBlocks(text, relativePath) {
  const findings = [];
  for (const regex of PRIVATE_KEY_RULES) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const block = match[0];
      findings.push({
        kind: 'private-key',
        severity: 'critical',
        description: 'Private key material',
        path: relativePath,
        line: lineNumberAt(text, match.index),
        fingerprint: findingFingerprint('private-key', relativePath, block),
        context: '[REDACTED PRIVATE KEY MATERIAL]'
      });
      if (match.index === regex.lastIndex) regex.lastIndex += 1;
    }
  }
  return findings;
}

function scanTokenRules(text, relativePath) {
  const findings = [];
  for (const rule of TOKEN_RULES) {
    rule.regex.lastIndex = 0;
    let match;
    while ((match = rule.regex.exec(text)) !== null) {
      const secret = match[0];
      findings.push({
        kind: rule.id,
        severity: rule.severity,
        description: rule.description,
        path: relativePath,
        line: lineNumberAt(text, match.index),
        fingerprint: findingFingerprint(rule.id, relativePath, secret),
        context: safeContext(text, match.index, secret.length)
      });
      if (match.index === rule.regex.lastIndex) rule.regex.lastIndex += 1;
    }
  }
  return findings;
}

function uniqueFindings(findings) {
  const seen = new Set();
  const out = [];
  for (const finding of findings) {
    const key = `${finding.kind}\0${finding.path}\0${finding.line}\0${finding.fingerprint}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }
  return out;
}

function severityRank(value) {
  return ({ low: 1, medium: 2, high: 3, critical: 4 })[value] || 0;
}

function normalizeFailOn(value) {
  const level = String(value ?? 'high').trim().toLowerCase();
  if (!['none', 'low', 'medium', 'high', 'critical', 'any'].includes(level)) throw codedError('Security failOn level is invalid', 'SECURITY_LAB_FAIL_LEVEL_INVALID');
  return level;
}

function baselineFingerprints(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw codedError('Invalid security baseline', 'SECURITY_LAB_BASELINE_INVALID');
  let values;
  if (raw.contract === SECURITY_BASELINE_CONTRACT && Array.isArray(raw.fingerprints)) values = raw.fingerprints;
  else if (raw.contract === NATIVE_SECURITY_LAB_CONTRACT && Array.isArray(raw.findings)) values = raw.findings.map((finding) => finding?.fingerprint);
  else throw codedError('Invalid security baseline contract', 'SECURITY_LAB_BASELINE_INVALID');
  const set = new Set();
  for (const value of values) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw codedError('Invalid security baseline fingerprint', 'SECURITY_LAB_BASELINE_INVALID');
    set.add(value);
  }
  return set;
}

async function loadBaseline(root, relative) {
  if (!relative) return new Set();
  const resolved = await resolveContainedExisting(root, relative, 'baseline path');
  const stat = await fs.stat(resolved.absolute);
  if (!stat.isFile() || stat.size > MAX_REPORT_BYTES) throw codedError('Security baseline is invalid or too large', 'SECURITY_LAB_BASELINE_INVALID');
  let parsed;
  try { parsed = JSON.parse(await fs.readFile(resolved.absolute, 'utf8')); }
  catch { throw codedError('Security baseline JSON is invalid', 'SECURITY_LAB_BASELINE_INVALID'); }
  return baselineFingerprints(parsed);
}

function severityCounts(findings) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) if (Object.hasOwn(counts, finding.severity)) counts[finding.severity] += 1;
  return counts;
}

export async function scanSecurityLab({ rootDir = process.cwd(), baselinePath = null, failOn = 'high', maxFiles, maxFileBytes, maxTotalBytes } = {}) {
  const root = await rootInfo(rootDir);
  const limits = {
    maxFiles: Math.max(1, Math.min(DEFAULT_MAX_FILES, Number(maxFiles || DEFAULT_MAX_FILES))),
    maxFileBytes: Math.max(1024, Math.min(DEFAULT_MAX_FILE_BYTES, Number(maxFileBytes || DEFAULT_MAX_FILE_BYTES))),
    maxTotalBytes: Math.max(1024, Math.min(DEFAULT_MAX_TOTAL_BYTES, Number(maxTotalBytes || DEFAULT_MAX_TOTAL_BYTES)))
  };
  const baseline = await loadBaseline(root, baselinePath);
  const walked = await walkFiles(root, limits);
  const findings = [];
  let scannedFiles = 0;
  let scannedBytes = 0;
  for (const file of walked.files) {
    const buffer = await fs.readFile(file.absolute);
    if (looksBinary(buffer)) continue;
    scannedFiles += 1;
    scannedBytes += buffer.length;
    const text = buffer.toString('utf8');
    findings.push(...scanPrivateKeyBlocks(text, file.relative), ...scanTokenRules(text, file.relative), ...genericSecretFindings(text, file.relative));
    if (findings.length > MAX_FINDINGS) throw codedError('Security scan exceeded finding limit', 'SECURITY_LAB_FINDING_LIMIT');
  }
  const ordered = uniqueFindings(findings).sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.path.localeCompare(b.path) || a.line - b.line || a.kind.localeCompare(b.kind));
  const decorated = ordered.map((finding) => ({ ...finding, baseline: baseline.has(finding.fingerprint) }));
  const newFindings = decorated.filter((finding) => !finding.baseline);
  const threshold = normalizeFailOn(failOn);
  const thresholdRank = threshold === 'none' ? 999 : threshold === 'any' ? 0 : severityRank(threshold);
  const failed = newFindings.some((finding) => severityRank(finding.severity) >= thresholdRank);
  return {
    contract: NATIVE_SECURITY_LAB_CONTRACT,
    source: { root: '.', files: scannedFiles, bytes: scannedBytes },
    failOn: threshold,
    passed: !failed,
    counts: severityCounts(decorated),
    newCounts: severityCounts(newFindings),
    baselineCount: decorated.length - newFindings.length,
    findings: decorated
  };
}

export async function scanSecurity(rootPath = '.', options = {}) {
  const report = await scanSecurityLab({ rootDir: rootPath, baselinePath: options.baseline || null, failOn: options.failOn || 'high', ...options });
  return {
    ...report,
    scannedFiles: report.source.files,
    scannedBytes: report.source.bytes,
    summary: {
      findings: report.findings.length,
      newFindings: report.findings.filter((finding) => !finding.baseline).length,
      baselineFindings: report.baselineCount,
      counts: report.counts,
      newCounts: report.newCounts
    }
  };
}

export async function createSecurityBaseline(report) {
  if (!report || report.contract !== NATIVE_SECURITY_LAB_CONTRACT || !Array.isArray(report.findings)) throw codedError('Invalid security report', 'SECURITY_LAB_REPORT_INVALID');
  return { contract: SECURITY_BASELINE_CONTRACT, fingerprints: [...new Set(report.findings.map((finding) => finding.fingerprint))].sort() };
}

export const createBaseline = createSecurityBaseline;

async function writePrivateJson(root, relative, payload, label) {
  const resolved = await resolveContainedOutput(root, relative, label);
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  if (Buffer.byteLength(content) > MAX_REPORT_BYTES) throw codedError(`${label} exceeds the supported size`, 'SECURITY_LAB_REPORT_TOO_LARGE');
  await fs.writeFile(resolved.absolute, content, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(resolved.absolute, 0o600).catch(() => {});
  return { path: portablePath(resolved.safe), bytes: Buffer.byteLength(content), sha256: sha256(content) };
}

export async function writeSecurityReport(report, outputPath, { rootDir = process.cwd() } = {}) {
  if (!report || report.contract !== NATIVE_SECURITY_LAB_CONTRACT) throw codedError('Security report contract is invalid', 'SECURITY_LAB_REPORT_INVALID');
  return writePrivateJson(await rootInfo(rootDir), outputPath, report, 'report output');
}

export async function writeSecurityBaseline(report, outputPath, { rootDir = process.cwd() } = {}) {
  return writePrivateJson(await rootInfo(rootDir), outputPath, await createSecurityBaseline(report), 'baseline output');
}

function requiredValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) throw codedError(`${option} requires a value`, 'SECURITY_LAB_ARGUMENT_VALUE_REQUIRED');
  return value;
}

function usage() {
  return `Veteran Native Security Lab\n\nUsage:\n  node src/native-security-lab.mjs scan --root <directory> [--baseline <baseline.json>] [--write-baseline <baseline.json>] [--fail-on none|low|medium|high|critical|any] [--out <report.json>]\n\nScans local text/config/code/key files for credential-like material without returning raw secret values. Baselines contain fingerprints only. No Snyk, Gitleaks cloud service, or paid API is required.\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || 'help';
  if (['help', '-h', '--help'].includes(command)) { process.stdout.write(usage()); return 0; }
  if (command !== 'scan') throw codedError(`Unknown Security Lab command: ${command}`, 'SECURITY_LAB_COMMAND_UNKNOWN');
  let rootDir = process.cwd();
  let baselinePath = null;
  let writeBaselinePath = null;
  let failOn = 'high';
  let outPath = null;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') rootDir = requiredValue(argv, index++, arg);
    else if (arg === '--baseline') baselinePath = requiredValue(argv, index++, arg);
    else if (arg === '--write-baseline') writeBaselinePath = requiredValue(argv, index++, arg);
    else if (arg === '--fail-on') failOn = requiredValue(argv, index++, arg);
    else if (arg === '--out') outPath = requiredValue(argv, index++, arg);
    else throw codedError(`Unknown Security Lab argument: ${arg}`, 'SECURITY_LAB_ARGUMENT_UNKNOWN');
  }
  const report = await scanSecurityLab({ rootDir, baselinePath, failOn });
  const artifacts = {};
  if (outPath) artifacts.report = await writeSecurityReport(report, outPath, { rootDir });
  if (writeBaselinePath) artifacts.baseline = await writeSecurityBaseline(report, writeBaselinePath, { rootDir });
  process.stdout.write(`${JSON.stringify({ ...report, artifacts }, null, 2)}\n`);
  return report.passed ? 0 : 2;
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error?.code || 'SECURITY_LAB_ERROR'}: ${String(error?.message || error)}\n`);
    process.exitCode = 1;
  });
}
