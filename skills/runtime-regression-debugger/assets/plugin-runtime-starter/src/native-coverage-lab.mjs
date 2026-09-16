import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const COVERAGE_SPEC_CONTRACT = 'veteran-coverage-check-v1';
export const COVERAGE_REPORT_CONTRACT = 'veteran-coverage-report-v1';

const FORMATS = new Set(['lcov', 'istanbul-summary']);
const METRICS = ['lines', 'branches', 'functions', 'statements'];
const MAX_REPORTS = 64;
const MAX_REPORT_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 20_000;
const MAX_LCOV_RECORDS = 50_000;
const MAX_FINDINGS = 2_000;
const MAX_SPEC_BYTES = 256 * 1024;

function fail(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function stableStringify(value) {
  return JSON.stringify(stable(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value, label, max = 4096) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) {
    throw fail(`${label} is invalid`, 'COVERAGE_SPEC_INVALID');
  }
  return value.trim();
}

function percentage(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw fail(`${label} must be between 0 and 100`, 'COVERAGE_SPEC_INVALID');
  }
  return Number(number.toFixed(4));
}

function nonNegativeInteger(value, label, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > max) {
    throw fail(`${label} must be a non-negative integer`, 'COVERAGE_SPEC_INVALID');
  }
  return number;
}

function normalizeThresholds(raw, label, { allowMinFiles = true } = {}) {
  if (raw === undefined) return Object.freeze({});
  if (!isPlainObject(raw)) throw fail(`${label} must be an object`, 'COVERAGE_SPEC_INVALID');
  const allowed = new Set([...METRICS, 'maxUncoveredLines', ...(allowMinFiles ? ['minFiles'] : [])]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw fail(`${label} has unknown field ${key}`, 'COVERAGE_SPEC_INVALID');
  }
  const out = {};
  for (const metric of METRICS) {
    if (raw[metric] !== undefined) out[metric] = percentage(raw[metric], `${label}.${metric}`);
  }
  if (raw.maxUncoveredLines !== undefined) out.maxUncoveredLines = nonNegativeInteger(raw.maxUncoveredLines, `${label}.maxUncoveredLines`, 10_000_000);
  if (raw.minFiles !== undefined) out.minFiles = nonNegativeInteger(raw.minFiles, `${label}.minFiles`, MAX_FILES);
  return Object.freeze(out);
}

export function normalizeCoverageSpec(raw) {
  if (!isPlainObject(raw) || raw.contract !== COVERAGE_SPEC_CONTRACT) {
    throw fail(`Coverage spec must use contract ${COVERAGE_SPEC_CONTRACT}`, 'COVERAGE_SPEC_INVALID');
  }
  const allowed = new Set(['contract', 'reports', 'thresholds', 'perFileThresholds']);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw fail(`Coverage spec has unknown field ${key}`, 'COVERAGE_SPEC_INVALID');
  }
  if (!Array.isArray(raw.reports) || raw.reports.length < 1 || raw.reports.length > MAX_REPORTS) {
    throw fail(`Coverage spec must contain 1-${MAX_REPORTS} reports`, 'COVERAGE_SPEC_INVALID');
  }
  const reports = raw.reports.map((entry, index) => {
    if (!isPlainObject(entry)) throw fail(`Coverage report ${index + 1} is invalid`, 'COVERAGE_SPEC_INVALID');
    for (const key of Object.keys(entry)) {
      if (!['path', 'format'].includes(key)) throw fail(`Coverage report ${index + 1} has unknown field ${key}`, 'COVERAGE_SPEC_INVALID');
    }
    const format = boundedString(entry.format, `Coverage report ${index + 1} format`, 40);
    if (!FORMATS.has(format)) throw fail(`Coverage report ${index + 1} format ${format} is unsupported`, 'COVERAGE_SPEC_INVALID');
    return Object.freeze({ path: boundedString(entry.path, `Coverage report ${index + 1} path`, 2048), format });
  });
  return Object.freeze({
    contract: COVERAGE_SPEC_CONTRACT,
    reports: Object.freeze(reports),
    thresholds: normalizeThresholds(raw.thresholds, 'thresholds'),
    perFileThresholds: normalizeThresholds(raw.perFileThresholds, 'perFileThresholds', { allowMinFiles: false })
  });
}

function within(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function normalizeRelative(value, label) {
  const portable = String(value || '').replaceAll('\\', '/');
  const normalized = path.posix.normalize(portable);
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized) || normalized.includes('\0')) {
    throw fail(`${label} escaped the project root`, 'COVERAGE_PATH_ESCAPE');
  }
  return normalized;
}

async function projectRoot(root) {
  return fs.realpath(path.resolve(root));
}

async function readContainedFile(root, relativePath, maxBytes, label) {
  const normalized = normalizeRelative(relativePath, label);
  const lexical = path.resolve(root, ...normalized.split('/'));
  if (!within(root, lexical)) throw fail(`${label} escaped the project root`, 'COVERAGE_PATH_ESCAPE');
  const stat = await fs.lstat(lexical).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.size > maxBytes) {
    throw fail(`${label} is missing, unsafe, or too large`, 'COVERAGE_INPUT_INVALID');
  }
  const real = await fs.realpath(lexical);
  if (!within(root, real)) throw fail(`${label} escaped the project root through a symlink`, 'COVERAGE_PATH_ESCAPE');
  return { normalized, real, size: stat.size, content: await fs.readFile(real, 'utf8') };
}

async function ensureSafeOutputParent(root, target) {
  const relative = path.relative(root, path.dirname(target));
  if (relative === '' || relative === '.') return root;
  const parts = relative.split(path.sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch(() => null);
    if (stat) {
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw fail('Coverage output parent is unsafe', 'COVERAGE_PATH_ESCAPE');
    } else {
      await fs.mkdir(current, { mode: 0o700 });
    }
    const real = await fs.realpath(current);
    if (!within(root, real)) throw fail('Coverage output parent escaped the project root', 'COVERAGE_PATH_ESCAPE');
  }
  return current;
}

async function safeWriteJson(root, relativePath, value) {
  const normalized = normalizeRelative(relativePath, 'Coverage output path');
  const target = path.resolve(root, ...normalized.split('/'));
  if (!within(root, target)) throw fail('Coverage output path escaped the project root', 'COVERAGE_PATH_ESCAPE');
  const existing = await fs.lstat(target).catch(() => null);
  if (existing?.isSymbolicLink() || (existing && !existing.isFile())) throw fail('Coverage output path is unsafe', 'COVERAGE_PATH_ESCAPE');
  await ensureSafeOutputParent(root, target);
  const body = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(target, body, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(target, 0o600).catch(() => {});
  return { path: normalized, bytes: Buffer.byteLength(body), sha256: sha256(body) };
}

function sourceIdentity(root, raw, label) {
  const value = boundedString(raw, label, 8192).replaceAll('\\', '/');
  let absolute;
  if (/^[A-Za-z]:\//.test(value) || value.startsWith('/')) absolute = path.resolve(value);
  else absolute = path.resolve(root, ...path.posix.normalize(value).split('/'));
  if (!within(root, absolute)) throw fail(`${label} points outside the project root`, 'COVERAGE_SOURCE_PATH_ESCAPE');
  const relative = path.relative(root, absolute).split(path.sep).join('/');
  if (!relative || relative === '.' || relative.startsWith('../')) throw fail(`${label} is invalid`, 'COVERAGE_SOURCE_PATH_ESCAPE');
  return relative;
}

function emptyMetric() {
  return { total: 0, covered: 0 };
}

function metric(total, covered, label) {
  const normalizedTotal = nonNegativeInteger(total, `${label}.total`, 100_000_000);
  const normalizedCovered = nonNegativeInteger(covered, `${label}.covered`, normalizedTotal);
  return { total: normalizedTotal, covered: normalizedCovered };
}

function percent(metricValue) {
  if (!metricValue) return null;
  if (metricValue.total === 0) return 100;
  return Number(((metricValue.covered / metricValue.total) * 100).toFixed(2));
}

function reportMetric(metricValue) {
  return metricValue ? { total: metricValue.total, covered: metricValue.covered, uncovered: metricValue.total - metricValue.covered, pct: percent(metricValue) } : null;
}

function createLcovFile(source) {
  return { source, format: 'lcov', lines: new Map(), branches: new Map(), functions: new Map() };
}

function parseLcov(root, content, reportName) {
  const files = new Map();
  let current = null;
  let records = 0;
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('SF:')) {
      if (current) throw fail(`${reportName} contains nested LCOV source records`, 'COVERAGE_REPORT_INVALID');
      const source = sourceIdentity(root, line.slice(3), `${reportName} LCOV source`);
      current = files.get(source) || createLcovFile(source);
      files.set(source, current);
      records += 1;
      if (records > MAX_LCOV_RECORDS) throw fail(`${reportName} contains too many LCOV records`, 'COVERAGE_REPORT_TOO_LARGE');
      continue;
    }
    if (line === 'end_of_record') {
      current = null;
      continue;
    }
    if (!current) continue;
    if (line.startsWith('DA:')) {
      const [lineNoRaw, countRaw] = line.slice(3).split(',', 2);
      const lineNo = nonNegativeInteger(lineNoRaw, `${reportName} LCOV line`, 100_000_000);
      const count = nonNegativeInteger(countRaw, `${reportName} LCOV line count`, 100_000_000_000);
      current.lines.set(lineNo, Math.max(current.lines.get(lineNo) || 0, count));
      continue;
    }
    if (line.startsWith('FN:')) {
      const comma = line.indexOf(',', 3);
      if (comma < 0) continue;
      nonNegativeInteger(line.slice(3, comma), `${reportName} LCOV function line`, 100_000_000);
      const name = line.slice(comma + 1).trim();
      if (name && name.length <= 4096 && !current.functions.has(name)) current.functions.set(name, 0);
      continue;
    }
    if (line.startsWith('FNDA:')) {
      const comma = line.indexOf(',', 5);
      if (comma < 0) continue;
      const count = nonNegativeInteger(line.slice(5, comma), `${reportName} LCOV function count`, 100_000_000_000);
      const name = line.slice(comma + 1).trim();
      if (!name || name.length > 4096) continue;
      current.functions.set(name, Math.max(current.functions.get(name) || 0, count));
      continue;
    }
    if (line.startsWith('BRDA:')) {
      const parts = line.slice(5).split(',');
      if (parts.length < 4) continue;
      const lineNo = nonNegativeInteger(parts[0], `${reportName} LCOV branch line`, 100_000_000);
      const block = boundedString(parts[1] || '0', `${reportName} LCOV branch block`, 200);
      const branch = boundedString(parts[2] || '0', `${reportName} LCOV branch id`, 200);
      const takenRaw = parts[3].trim();
      const covered = takenRaw !== '-' && nonNegativeInteger(takenRaw, `${reportName} LCOV branch count`, 100_000_000_000) > 0;
      const key = `${lineNo}:${block}:${branch}`;
      current.branches.set(key, Boolean(current.branches.get(key)) || covered);
    }
  }
  return [...files.values()].map((file) => lcovEntry(file, reportName));
}

function lcovEntry(file, reportName = 'lcov') {
  return {
    source: file.source,
    format: file.format,
    lcov: { lines: file.lines, branches: file.branches, functions: file.functions },
    metrics: {
      lines: metric(file.lines.size, [...file.lines.values()].filter((count) => count > 0).length, `${reportName}:${file.source}:lines`),
      branches: metric(file.branches.size, [...file.branches.values()].filter(Boolean).length, `${reportName}:${file.source}:branches`),
      functions: metric(file.functions.size, [...file.functions.values()].filter((count) => count > 0).length, `${reportName}:${file.source}:functions`),
      statements: null
    }
  };
}

function parseIstanbulMetric(raw, label) {
  if (!isPlainObject(raw)) throw fail(`${label} is invalid`, 'COVERAGE_REPORT_INVALID');
  return metric(raw.total, raw.covered, label);
}

function parseIstanbulSummary(root, content, reportName) {
  let raw;
  try { raw = JSON.parse(content); } catch { throw fail(`${reportName} is not valid JSON`, 'COVERAGE_REPORT_INVALID'); }
  if (!isPlainObject(raw)) throw fail(`${reportName} must contain an object`, 'COVERAGE_REPORT_INVALID');
  const out = [];
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'total') continue;
    if (!isPlainObject(value)) throw fail(`${reportName} entry ${key} is invalid`, 'COVERAGE_REPORT_INVALID');
    const source = sourceIdentity(root, key, `${reportName} source`);
    const metrics = {};
    for (const metricName of METRICS) metrics[metricName] = parseIstanbulMetric(value[metricName], `${reportName}:${source}:${metricName}`);
    out.push({ source, format: 'istanbul-summary', metrics });
    if (out.length > MAX_FILES) throw fail(`${reportName} contains too many files`, 'COVERAGE_REPORT_TOO_LARGE');
  }
  if (!out.length) throw fail(`${reportName} does not contain per-file coverage entries`, 'COVERAGE_REPORT_INVALID');
  return out;
}

function sameMetrics(a, b) {
  return METRICS.every((name) => {
    const left = a[name], right = b[name];
    if (left === null || right === null) return left === right;
    return left.total === right.total && left.covered === right.covered;
  });
}

function mergeFiles(fileEntries) {
  const files = new Map();
  for (const entry of fileEntries) {
    const existing = files.get(entry.source);
    if (!existing) {
      files.set(entry.source, entry);
      if (files.size > MAX_FILES) throw fail('Coverage input contains too many unique source files', 'COVERAGE_REPORT_TOO_LARGE');
      continue;
    }
    if (existing.format === 'lcov' && entry.format === 'lcov') {
      for (const [line, count] of entry.lcov.lines) existing.lcov.lines.set(line, Math.max(existing.lcov.lines.get(line) || 0, count));
      for (const [branch, covered] of entry.lcov.branches) existing.lcov.branches.set(branch, Boolean(existing.lcov.branches.get(branch)) || covered);
      for (const [name, count] of entry.lcov.functions) existing.lcov.functions.set(name, Math.max(existing.lcov.functions.get(name) || 0, count));
      existing.metrics = lcovEntry({ source: existing.source, format: 'lcov', ...existing.lcov }).metrics;
      continue;
    }
    if (existing.format === entry.format && sameMetrics(existing.metrics, entry.metrics)) continue;
    throw fail(`Coverage source ${entry.source} is duplicated with incompatible metrics`, 'COVERAGE_SOURCE_CONFLICT');
  }
  return files;
}

function aggregate(files) {
  const totals = Object.fromEntries(METRICS.map((name) => [name, emptyMetric()]));
  const available = Object.fromEntries(METRICS.map((name) => [name, false]));
  for (const entry of files.values()) {
    for (const name of METRICS) {
      const current = entry.metrics[name];
      if (!current) continue;
      available[name] = true;
      totals[name].total += current.total;
      totals[name].covered += current.covered;
    }
  }
  return Object.fromEntries(METRICS.map((name) => [name, available[name] ? totals[name] : null]));
}

function thresholdChecks(metrics, fileCount, thresholds, scope, file = null) {
  const checks = [];
  for (const name of METRICS) {
    if (thresholds[name] === undefined) continue;
    const actual = metrics[name];
    if (!actual) {
      checks.push({ scope, ...(file ? { file } : {}), metric: name, passed: false, reason: 'metric-unavailable', required: thresholds[name], actual: null });
      continue;
    }
    const pct = percent(actual);
    checks.push({ scope, ...(file ? { file } : {}), metric: name, passed: pct >= thresholds[name], required: thresholds[name], actual: pct });
  }
  if (thresholds.maxUncoveredLines !== undefined) {
    const actual = metrics.lines;
    const uncovered = actual ? actual.total - actual.covered : null;
    checks.push({ scope, ...(file ? { file } : {}), metric: 'maxUncoveredLines', passed: uncovered !== null && uncovered <= thresholds.maxUncoveredLines, required: thresholds.maxUncoveredLines, actual: uncovered });
  }
  if (!file && thresholds.minFiles !== undefined) checks.push({ scope, metric: 'minFiles', passed: fileCount >= thresholds.minFiles, required: thresholds.minFiles, actual: fileCount });
  return checks;
}

function evaluate(files, aggregateMetrics, spec) {
  const checks = [...thresholdChecks(aggregateMetrics, files.size, spec.thresholds, 'global')];
  const hasPerFile = Object.keys(spec.perFileThresholds).length > 0;
  if (hasPerFile) {
    for (const [source, entry] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      checks.push(...thresholdChecks(entry.metrics, 1, spec.perFileThresholds, 'file', source));
      if (checks.length > MAX_FINDINGS) throw fail('Coverage threshold evaluation produced too many checks', 'COVERAGE_REPORT_TOO_LARGE');
    }
  }
  return checks;
}

function publicFile(entry) {
  return {
    path: entry.source,
    format: entry.format,
    metrics: Object.fromEntries(METRICS.map((name) => [name, reportMetric(entry.metrics[name])]))
  };
}

export async function runCoverageCheck({ root = process.cwd(), spec, specPath = null, reportPath = null } = {}) {
  const resolvedRoot = await projectRoot(root);
  let normalizedSpec;
  if (specPath) {
    const input = await readContainedFile(resolvedRoot, specPath, MAX_SPEC_BYTES, 'Coverage spec');
    let raw;
    try { raw = JSON.parse(input.content); } catch { throw fail('Coverage spec is not valid JSON', 'COVERAGE_SPEC_INVALID'); }
    normalizedSpec = normalizeCoverageSpec(raw);
  } else normalizedSpec = normalizeCoverageSpec(spec);

  const parsed = [];
  const inputEvidence = [];
  let totalBytes = 0;
  for (const entry of normalizedSpec.reports) {
    const input = await readContainedFile(resolvedRoot, entry.path, MAX_REPORT_BYTES, `Coverage report ${entry.path}`);
    totalBytes += input.size;
    if (totalBytes > MAX_TOTAL_BYTES) throw fail('Coverage reports exceed the total input byte limit', 'COVERAGE_REPORT_TOO_LARGE');
    inputEvidence.push({ path: input.normalized, format: entry.format, bytes: input.size, sha256: sha256(input.content) });
    const rows = entry.format === 'lcov'
      ? parseLcov(resolvedRoot, input.content, entry.path)
      : parseIstanbulSummary(resolvedRoot, input.content, entry.path);
    parsed.push(...rows);
  }

  const files = mergeFiles(parsed);
  const aggregateMetrics = aggregate(files);
  const checks = evaluate(files, aggregateMetrics, normalizedSpec);
  const passed = checks.every((check) => check.passed);
  const fileReports = [...files.values()].sort((a, b) => a.source.localeCompare(b.source)).map(publicFile);
  const limitations = ['This lab validates existing local coverage artifacts; it does not execute test suites or upload coverage.'];
  if (normalizedSpec.reports.some((entry) => entry.format === 'lcov')) limitations.push('LCOV does not provide statement coverage; statement thresholds require Istanbul coverage-summary input.');
  const report = {
    contract: COVERAGE_REPORT_CONTRACT,
    passed,
    summary: passed
      ? `Coverage checks passed for ${files.size} file(s).`
      : `Coverage checks failed: ${checks.filter((check) => !check.passed).length} threshold check(s) failed.`,
    inputReports: inputEvidence,
    fileCount: files.size,
    metrics: Object.fromEntries(METRICS.map((name) => [name, reportMetric(aggregateMetrics[name])])),
    checks,
    files: fileReports,
    specIdentity: sha256(stableStringify(normalizedSpec)),
    coverageIdentity: sha256(stableStringify({ inputs: inputEvidence.map(({ path, format, sha256: digest }) => ({ path, format, sha256: digest })), files: fileReports })),
    limitations
  };
  const artifact = reportPath ? await safeWriteJson(resolvedRoot, reportPath, report) : null;
  return artifact ? { ...report, artifact } : report;
}

function parseArgs(argv) {
  if (argv[0] !== 'check' || !argv[1]) {
    throw fail('Usage: node src/native-coverage-lab.mjs check <spec.json> [--report <report.json>]', 'COVERAGE_CLI_USAGE');
  }
  let reportPath = null;
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === '--report') {
      reportPath = argv[++index] || null;
      if (!reportPath) throw fail('--report requires a project-relative JSON path', 'COVERAGE_CLI_USAGE');
      continue;
    }
    throw fail(`Unknown coverage CLI argument ${argv[index]}`, 'COVERAGE_CLI_USAGE');
  }
  return { specPath: argv[1], reportPath };
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write('Usage: node src/native-coverage-lab.mjs check <spec.json> [--report <report.json>]\n');
    return;
  }
  const parsed = parseArgs(argv);
  const result = await runCoverageCheck({ root: process.cwd(), ...parsed });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.passed) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ error: error?.code || 'COVERAGE_ERROR', message: String(error?.message || error) })}\n`);
    process.exitCode = 1;
  });
}
