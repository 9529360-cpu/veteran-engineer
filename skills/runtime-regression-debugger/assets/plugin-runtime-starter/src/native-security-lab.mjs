#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const NATIVE_SECURITY_LAB_CONTRACT = 'veteran-native-security-lab-v1';

const MAX_FILES = 5_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_FINDINGS = 2_000;
const MAX_REPORT_BYTES = 16 * 1024 * 1024;
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.cache', 'vendor']);
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env', '.properties', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.py', '.rb', '.php', '.go', '.rs', '.java', '.kt', '.kts', '.cs', '.swift', '.sql', '.md', '.mdx', '.txt', '.xml', '.html', '.css', '.scss', '.less', '.pem', '.key']);
const TEXT_NAMES = new Set(['dockerfile', 'makefile', 'procfile', '.npmrc', '.yarnrc', '.pypirc', '.netrc', '.env', '.env.local', '.env.production', '.env.development']);
const SEVERITY_RANK = Object.freeze({ none: 0, low: 1, medium: 2, high: 3, critical: 4 });
const PLACEHOLDER_WORDS = ['example', 'sample', 'dummy', 'fake', 'changeme', 'replace-me', 'replace_me', 'your_', 'test-only', 'not-a-secret', 'placeholder'];

const PATTERNS = Object.freeze([
  { kind: 'private-key', severity: 'critical', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { kind: 'aws-access-key', severity: 'high', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'github-token', severity: 'high', regex: /\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/g },
  { kind: 'slack-token', severity: 'high', regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { kind: 'stripe-live-key', severity: 'high', regex: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g },
  { kind: 'google-api-key', severity: 'high', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'jwt-token', severity: 'medium', regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g }
]);

const GENERIC_ASSIGNMENT = /\b(api[_-]?key|access[_-]?token|auth[_-]?token|secret(?:[_-]?key)?|client[_-]?secret|password|passwd|private[_-]?token)\b\s*[:=]\s*["'`]([^"'`\r\n]{12,})["'`]/gi;

function codedError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function portablePath(value) {
  return String(value).split(path.sep).join('/');
}

function isTextCandidate(name) {
  const lower = name.toLowerCase();
  return TEXT_NAMES.has(lower) || lower.startsWith('.env.') || TEXT_EXTENSIONS.has(path.extname(lower));
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

function genericSecretMatches(line) {
  const matches = [];
  GENERIC_ASSIGNMENT.lastIndex = 0;
  for (const match of line.matchAll(GENERIC_ASSIGNMENT)) {
    const secret = match[2];
    if (looksPlaceholder(secret)) continue;
    const compact = secret.replace(/\s+/g, '');
    if (compact.length < 16 || entropy(compact) < 3.2) continue;
    const full = match[0];
    const secretOffset = full.lastIndexOf(secret);
    matches.push({ kind: 'generic-secret-assignment', severity: 'high', value: secret, start: (match.index || 0) + Math.max(0, secretOffset), end: (match.index || 0) + Math.max(0, secretOffset) + secret.length });
  }
  return matches;
}

function specificMatches(line) {
  const matches = [];
  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    for (const match of line.matchAll(pattern.regex)) {
      matches.push({ kind: pattern.kind, severity: pattern.severity, value: match[0], start: match.index || 0, end: (match.index || 0) + match[0].length });
    }
  }
  matches.sort((a, b) => a.start - b.start || b.value.length - a.value.length);
  return matches;
}

function overlaps(left, right) {
  return left.start < right.end && right.start < left.end;
}

function maskedContext(line, matches) {
  let out = '';
  let cursor = 0;
  const ordered = [...matches].sort((a, b) => a.start - b.start || a.end - b.end);
  for (const match of ordered) {
    if (match.start < cursor) continue;
    out += line.slice(cursor, match.start);
    out += '[REDACTED]';
    cursor = match.end;
  }
  out += line.slice(cursor);
  const trimmed = out.trim();
  return trimmed.length <= 300 ? trimmed : `${trimmed.slice(0, 299)}…`;
}

function findingFingerprint(kind, relativePath, secret) {
  return stableHash(`${kind}\0${portablePath(relativePath)}\0${secret}`);
}

function scanLine(line, relativePath, lineNumber) {
  const specific = specificMatches(line);
  const generic = genericSecretMatches(line).filter((candidate) => !specific.some((item) => overlaps(candidate, item)));
  const all = [...specific, ...generic];
  return all.map((match) => ({
    kind: match.kind,
    severity: match.severity,
    path: portablePath(relativePath),
    line: lineNumber,
    fingerprint: findingFingerprint(match.kind, relativePath, match.value),
    context: maskedContext(line, [match])
  }));
}

async function listFiles(root) {
  const files = [];
  let totalBytes = 0;
  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { await walk(full); continue; }
      if (!entry.isFile() || !isTextCandidate(entry.name)) continue;
      const stat = await fs.stat(full);
      if (stat.size > MAX_FILE_BYTES) continue;
      totalBytes += stat.size;
      if (totalBytes > MAX_TOTAL_BYTES) throw codedError(`Security scan corpus exceeds ${MAX_TOTAL_BYTES} bytes`, 'SECURITY_LAB_CORPUS_TOO_LARGE', { bytes: totalBytes });
      files.push({ full, relative: path.relative(root, full), bytes: stat.size });
      if (files.length > MAX_FILES) throw codedError(`Security scan corpus exceeds ${MAX_FILES} files`, 'SECURITY_LAB_FILE_LIMIT');
    }
  }
  await walk(root);
  return { files, totalBytes };
}

function severityCounts(findings) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) if (Object.hasOwn(counts, finding.severity)) counts[finding.severity] += 1;
  return counts;
}

function normalizeFailOn(value) {
  const level = String(value ?? 'high').trim().toLowerCase();
  if (!Object.hasOwn(SEVERITY_RANK, level)) throw codedError('Security failOn level is invalid', 'SECURITY_LAB_FAIL_LEVEL_INVALID', { level });
  return level;
}

function failingFindings(findings, failOn) {
  const threshold = SEVERITY_RANK[failOn];
  if (threshold === 0) return [];
  return findings.filter((finding) => SEVERITY_RANK[finding.severity] >= threshold);
}

async function readBaselineFingerprints(baselinePath, root) {
  if (!baselinePath) return new Set();
  const target = path.resolve(root, baselinePath);
  const real = await fs.realpath(target).catch((error) => { throw codedError('Security baseline is unavailable', 'SECURITY_LAB_BASELINE_UNAVAILABLE', { cause: error?.code || null }); });
  if (real !== root && !real.startsWith(`${root}${path.sep}`)) throw codedError('Security baseline escapes the allowed root', 'SECURITY_LAB_ROOT_ESCAPE');
  const stat = await fs.stat(real);
  if (!stat.isFile() || stat.size > MAX_REPORT_BYTES) throw codedError('Security baseline is invalid or too large', 'SECURITY_LAB_BASELINE_INVALID', { bytes: stat.size });
  let parsed;
  try { parsed = JSON.parse(await fs.readFile(real, 'utf8')); }
  catch { throw codedError('Security baseline JSON is invalid', 'SECURITY_LAB_BASELINE_INVALID'); }
  if (!parsed || parsed.contract !== NATIVE_SECURITY_LAB_CONTRACT || !Array.isArray(parsed.findings) || parsed.findings.length > MAX_FINDINGS) throw codedError('Security baseline contract is invalid', 'SECURITY_LAB_BASELINE_INVALID');
  return new Set(parsed.findings.map((finding) => String(finding?.fingerprint || '')).filter((value) => /^[a-f0-9]{64}$/.test(value)));
}

export async function scanSecurityLab({ rootDir = process.cwd(), baselinePath = null, failOn = 'high' } = {}) {
  const root = await fs.realpath(path.resolve(rootDir));
  const baseline = await readBaselineFingerprints(baselinePath, root);
  const { files, totalBytes } = await listFiles(root);
  const findings = [];
  for (const file of files) {
    const content = await fs.readFile(file.full, 'utf8');
    if (content.includes('\0')) continue;
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      for (const finding of scanLine(lines[index], file.relative, index + 1)) {
        findings.push({ ...finding, baseline: baseline.has(finding.fingerprint) });
        if (findings.length > MAX_FINDINGS) throw codedError(`Security findings exceed ${MAX_FINDINGS}`, 'SECURITY_LAB_FINDING_LIMIT');
      }
    }
  }
  findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.path.localeCompare(b.path) || a.line - b.line || a.kind.localeCompare(b.kind));
  const newFindings = findings.filter((finding) => !finding.baseline);
  const threshold = normalizeFailOn(failOn);
  const failing = failingFindings(newFindings, threshold);
  return {
    contract: NATIVE_SECURITY_LAB_CONTRACT,
    source: { root: '.', files: files.length, bytes: totalBytes },
    failOn: threshold,
    passed: failing.length === 0,
    counts: severityCounts(findings),
    newCounts: severityCounts(newFindings),
    baselineCount: findings.length - newFindings.length,
    findings
  };
}

async function containedOutput(rootDir, outputPath) {
  const root = await fs.realpath(path.resolve(rootDir));
  const target = path.resolve(root, outputPath);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) throw codedError('Security report output escapes the allowed root', 'SECURITY_LAB_ROOT_ESCAPE');
  const parent = await fs.realpath(path.dirname(target));
  if (parent !== root && !parent.startsWith(`${root}${path.sep}`)) throw codedError('Security report output parent escapes the allowed root', 'SECURITY_LAB_ROOT_ESCAPE');
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw codedError('Security report output must be a regular file', 'SECURITY_LAB_OUTPUT_INVALID');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return target;
}

export async function writeSecurityReport(report, outputPath, { rootDir = process.cwd() } = {}) {
  if (!report || report.contract !== NATIVE_SECURITY_LAB_CONTRACT) throw codedError('Security report contract is invalid', 'SECURITY_LAB_REPORT_INVALID');
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_REPORT_BYTES) throw codedError('Security report exceeds the supported size', 'SECURITY_LAB_REPORT_TOO_LARGE');
  const target = await containedOutput(rootDir, outputPath);
  await fs.writeFile(target, serialized, { encoding: 'utf8', mode: 0o600 });
  return { path: portablePath(path.relative(await fs.realpath(path.resolve(rootDir)), target)), bytes: Buffer.byteLength(serialized), sha256: stableHash(serialized) };
}

function usage() {
  return `Veteran Native Security Lab\n\nUsage:\n  node src/native-security-lab.mjs scan --root <directory> [--baseline <report.json>] [--fail-on none|low|medium|high|critical] [--out <report.json>]\n\nScans local text/config/code files for credential-like material without returning raw secret values. No Snyk, Gitleaks cloud service, or paid API is required.\n`;
}

function requiredValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) throw codedError(`${option} requires a value`, 'SECURITY_LAB_ARGUMENT_VALUE_REQUIRED');
  return value;
}

async function cli(argv) {
  const command = argv[0] || 'help';
  if (['help', '-h', '--help'].includes(command)) { process.stdout.write(usage()); return 0; }
  if (command !== 'scan') throw codedError(`Unknown Security Lab command: ${command}`, 'SECURITY_LAB_COMMAND_UNKNOWN');
  let rootDir = process.cwd();
  let baselinePath = null;
  let failOn = 'high';
  let outPath = null;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') rootDir = requiredValue(argv, index++, arg);
    else if (arg === '--baseline') baselinePath = requiredValue(argv, index++, arg);
    else if (arg === '--fail-on') failOn = requiredValue(argv, index++, arg);
    else if (arg === '--out') outPath = requiredValue(argv, index++, arg);
    else throw codedError(`Unknown Security Lab argument: ${arg}`, 'SECURITY_LAB_ARGUMENT_UNKNOWN');
  }
  const report = await scanSecurityLab({ rootDir, baselinePath, failOn });
  let artifact = null;
  if (outPath) artifact = await writeSecurityReport(report, outPath, { rootDir });
  process.stdout.write(`${JSON.stringify({ ...report, ...(artifact ? { artifact } : {}) }, null, 2)}\n`);
  return report.passed ? 0 : 2;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  cli(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error.code ? `[${error.code}] ` : ''}${error.message || String(error)}\n`);
    process.exitCode = 1;
  });
}
