import fs from 'node:fs/promises';
import path from 'node:path';

export const LOCAL_LOG_OBSERVABILITY_CONTRACT = 'veteran-local-log-observability-v1';

const MAX_FILES = 16;
const MAX_MATCHERS = 32;
const MAX_MATCHER_LENGTH = 240;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const DEFAULT_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_ENTRIES = 100_000;
const FORMATS = new Set(['auto', 'text', 'jsonl']);
const ERROR_LEVELS = new Set(['error', 'fatal', 'critical', 'panic']);
const WARNING_LEVELS = new Set(['warn', 'warning']);

function codedError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function text(value, fallback = '', max = 4000) {
  const out = value === undefined || value === null ? fallback : String(value).trim();
  if (out.length > max) throw codedError(`Local log value exceeds ${max} characters`, 'OBSERVABILITY_LOCAL_LOG_VALUE_TOO_LONG');
  return out;
}

function boundedStrings(raw, label, maxItems = MAX_MATCHERS) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > maxItems) throw codedError(`${label} must be a bounded array`, 'OBSERVABILITY_LOCAL_LOG_CONFIG_INVALID', { label });
  return raw.map((item, index) => {
    const value = text(item, '', MAX_MATCHER_LENGTH);
    if (!value || value.includes('\0')) throw codedError(`${label}[${index}] is invalid`, 'OBSERVABILITY_LOCAL_LOG_CONFIG_INVALID', { label, index });
    return value;
  });
}

function optionalInteger(value, label, { min = 0, max = MAX_ENTRIES } = {}) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw codedError(`${label} is outside the supported range`, 'OBSERVABILITY_LOCAL_LOG_CONFIG_INVALID', { label });
  return number;
}

function normalizeField(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const field = text(value, '', 120);
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(field) || ['__proto__', 'prototype', 'constructor'].some((part) => field.split('.').includes(part))) {
    throw codedError('Local log field path is invalid', 'OBSERVABILITY_LOCAL_LOG_CONFIG_INVALID', { field });
  }
  return field;
}

export function normalizeLocalLogObservability(raw) {
  if (raw === undefined || raw === null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw codedError('localLog must be an object', 'OBSERVABILITY_LOCAL_LOG_CONFIG_INVALID');
  const files = [...new Set(boundedStrings(raw.files, 'localLog.files', MAX_FILES))];
  if (!files.length) throw codedError('localLog.files requires at least one file', 'OBSERVABILITY_LOCAL_LOG_CONFIG_INVALID');
  for (const file of files) {
    if (path.isAbsolute(file) || file.split(/[\\/]+/).includes('..')) throw codedError('localLog files must be relative and cannot traverse parents', 'OBSERVABILITY_LOCAL_LOG_PATH_INVALID', { file });
  }
  const format = text(raw.format, 'auto', 16).toLowerCase();
  if (!FORMATS.has(format)) throw codedError(`Unsupported localLog format ${format}`, 'OBSERVABILITY_LOCAL_LOG_CONFIG_INVALID', { format });
  const maxBytes = raw.maxBytes === undefined ? DEFAULT_TOTAL_BYTES : Number(raw.maxBytes);
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_TOTAL_BYTES) throw codedError(`localLog.maxBytes must be within 1..${MAX_TOTAL_BYTES}`, 'OBSERVABILITY_LOCAL_LOG_CONFIG_INVALID');
  const maxErrors = optionalInteger(raw.maxErrors, 'localLog.maxErrors') ?? 0;
  const maxWarnings = optionalInteger(raw.maxWarnings, 'localLog.maxWarnings');
  const minEntries = optionalInteger(raw.minEntries, 'localLog.minEntries') ?? 0;
  const timestampField = normalizeField(raw.timestampField, null);
  if (timestampField && format === 'text') throw codedError('localLog.timestampField requires JSONL or auto format', 'OBSERVABILITY_LOCAL_LOG_CONFIG_INVALID');
  return {
    contract: LOCAL_LOG_OBSERVABILITY_CONTRACT,
    files,
    format,
    maxBytes,
    maxErrors,
    maxWarnings,
    minEntries,
    forbidContains: boundedStrings(raw.forbidContains, 'localLog.forbidContains'),
    requireContains: boundedStrings(raw.requireContains, 'localLog.requireContains'),
    caseSensitive: raw.caseSensitive === true,
    levelField: normalizeField(raw.levelField, 'level'),
    timestampField
  };
}

function getField(record, field) {
  if (!field) return undefined;
  let current = record;
  for (const segment of field.split('.')) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function inferFormat(file, requested) {
  if (requested !== 'auto') return requested;
  const ext = path.extname(file).toLowerCase();
  return ['.jsonl', '.ndjson'].includes(ext) ? 'jsonl' : 'text';
}

async function containedLogFile(root, relative) {
  const requested = path.resolve(root, relative);
  const real = await fs.realpath(requested).catch((error) => {
    throw codedError(`Local log file is unavailable: ${relative}`, 'OBSERVABILITY_LOCAL_LOG_FILE_UNAVAILABLE', { file: relative, cause: error?.code || null });
  });
  if (real !== root && !real.startsWith(`${root}${path.sep}`)) throw codedError('Local log file escapes the validation cwd', 'OBSERVABILITY_LOCAL_LOG_PATH_ESCAPE', { file: relative });
  const stat = await fs.stat(real);
  if (!stat.isFile()) throw codedError('Local log input must be a regular file', 'OBSERVABILITY_LOCAL_LOG_FILE_INVALID', { file: relative });
  return { real, bytes: stat.size };
}

function severityFromText(line) {
  const value = line.toLowerCase();
  if (/(^|\W)(error|fatal|critical|panic)(\W|$)/.test(value)) return 'error';
  if (/(^|\W)(warn|warning)(\W|$)/.test(value)) return 'warning';
  return 'other';
}

function severityFromJson(record, levelField, rawLine) {
  const raw = getField(record, levelField);
  const level = raw === undefined || raw === null ? '' : String(raw).toLowerCase();
  if (ERROR_LEVELS.has(level)) return 'error';
  if (WARNING_LEVELS.has(level)) return 'warning';
  return severityFromText(rawLine);
}

function normalizeTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value < 1e12 ? value * 1000 : value;
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

function makeCheck(name, passed, observed, threshold, detail = null) {
  return { name, passed, signal: null, observed, threshold, detail };
}

function matcherCount(entries, needle, caseSensitive) {
  const target = caseSensitive ? needle : needle.toLowerCase();
  let count = 0;
  for (const entry of entries) {
    const haystack = caseSensitive ? entry.raw : entry.raw.toLowerCase();
    if (haystack.includes(target)) count += 1;
  }
  return count;
}

export async function runLocalLogObservability(localLog, { cwd, expectedSourceHead, windowSeconds = 300, nowMs = Date.now() } = {}) {
  if (!localLog || localLog.contract !== LOCAL_LOG_OBSERVABILITY_CONTRACT) throw codedError('Normalized localLog configuration is required', 'OBSERVABILITY_LOCAL_LOG_CONFIG_INVALID');
  const root = await fs.realpath(path.resolve(cwd));
  let totalBytes = 0;
  const entries = [];
  const observedFiles = [];
  const seenRealFiles = new Set();
  let invalidTimestamps = 0;
  let timestampedEntries = 0;
  for (const relative of localLog.files) {
    const resolved = await containedLogFile(root, relative);
    if (seenRealFiles.has(resolved.real)) continue;
    seenRealFiles.add(resolved.real);
    observedFiles.push(relative);
    totalBytes += resolved.bytes;
    if (totalBytes > localLog.maxBytes) throw codedError(`Local log inputs exceed ${localLog.maxBytes} bytes`, 'OBSERVABILITY_LOCAL_LOG_SIZE_LIMIT', { maxBytes: localLog.maxBytes });
    const content = await fs.readFile(resolved.real, 'utf8');
    const format = inferFormat(relative, localLog.format);
    const lines = content.split(/\r?\n/).filter((line) => line.trim());
    for (let index = 0; index < lines.length; index += 1) {
      const raw = lines[index];
      let record = null;
      if (format === 'jsonl') {
        try { record = JSON.parse(raw); }
        catch { throw codedError(`Local JSONL log ${relative}:${index + 1} is invalid`, 'OBSERVABILITY_LOCAL_LOG_JSON_INVALID', { file: relative, line: index + 1 }); }
        if (!record || typeof record !== 'object' || Array.isArray(record)) throw codedError(`Local JSONL log ${relative}:${index + 1} must be an object`, 'OBSERVABILITY_LOCAL_LOG_JSON_INVALID', { file: relative, line: index + 1 });
      }
      let timestampMs = null;
      if (localLog.timestampField) {
        if (format !== 'jsonl') throw codedError('timestampField cannot be applied to text logs', 'OBSERVABILITY_LOCAL_LOG_CONFIG_INVALID', { file: relative });
        timestampMs = normalizeTimestamp(getField(record, localLog.timestampField));
        if (timestampMs === null) invalidTimestamps += 1;
        else timestampedEntries += 1;
      }
      entries.push({ raw, timestampMs, severity: format === 'jsonl' ? severityFromJson(record, localLog.levelField, raw) : severityFromText(raw) });
      if (entries.length > MAX_ENTRIES) throw codedError(`Local log inputs exceed ${MAX_ENTRIES} entries`, 'OBSERVABILITY_LOCAL_LOG_ENTRY_LIMIT');
    }
  }

  let observed = entries;
  let windowApplied = false;
  if (localLog.timestampField) {
    windowApplied = true;
    const start = nowMs - Number(windowSeconds) * 1000;
    observed = entries.filter((entry) => entry.timestampMs !== null && entry.timestampMs >= start && entry.timestampMs <= nowMs);
  }
  const errors = observed.filter((entry) => entry.severity === 'error').length;
  const warnings = observed.filter((entry) => entry.severity === 'warning').length;
  const checks = [];
  if (localLog.timestampField) checks.push(makeCheck('local-log-valid-timestamps', invalidTimestamps === 0, invalidTimestamps, 0, `${timestampedEntries} timestamped entries`));
  checks.push(makeCheck('local-log-min-entries', observed.length >= localLog.minEntries, observed.length, `>= ${localLog.minEntries}`));
  checks.push(makeCheck('local-log-max-errors', errors <= localLog.maxErrors, errors, `<= ${localLog.maxErrors}`));
  if (localLog.maxWarnings !== null) checks.push(makeCheck('local-log-max-warnings', warnings <= localLog.maxWarnings, warnings, `<= ${localLog.maxWarnings}`));
  for (let index = 0; index < localLog.forbidContains.length; index += 1) {
    const count = matcherCount(observed, localLog.forbidContains[index], localLog.caseSensitive);
    checks.push(makeCheck(`local-log-forbid-${index + 1}`, count === 0, count, 0));
  }
  for (let index = 0; index < localLog.requireContains.length; index += 1) {
    const count = matcherCount(observed, localLog.requireContains[index], localLog.caseSensitive);
    checks.push(makeCheck(`local-log-require-${index + 1}`, count > 0, count, '>= 1'));
  }
  const passed = checks.every((check) => check.passed);
  return {
    passed,
    failureCode: passed ? null : 'OBSERVABILITY_CHECK_FAILED',
    summary: passed ? `Local log observability passed (${observed.length} entries).` : `Local log observability failed (${checks.filter((check) => !check.passed).length} checks).`,
    observedSourceHead: expectedSourceHead || null,
    checks,
    diagnostics: {
      provider: 'local-log',
      files: observedFiles,
      totalBytes,
      totalEntries: entries.length,
      observedEntries: observed.length,
      errors,
      warnings,
      windowApplied,
      windowSeconds: windowApplied ? Number(windowSeconds) : null,
      invalidTimestamps
    }
  };
}
