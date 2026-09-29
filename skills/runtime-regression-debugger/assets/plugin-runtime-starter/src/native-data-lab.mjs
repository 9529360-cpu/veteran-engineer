#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const NATIVE_DATA_LAB_CONTRACT = 'veteran-native-data-lab-v1';
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_ROWS = 100_000;
const MAX_COLUMNS = 256;
const MAX_FILTERS = 32;
const MAX_SORTS = 8;
const MAX_METRICS = 32;
const MAX_RESULT_ROWS = 10_000;
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const FORMATS = new Set(['auto', 'json', 'ndjson', 'csv', 'tsv']);
const FILTER_OPS = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'exists']);
const METRIC_OPS = new Set(['count', 'sum', 'avg', 'min', 'max']);

function codedError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function text(value, fallback = '', max = 4000) {
  const out = value === undefined || value === null ? fallback : String(value).trim();
  if (out.length > max) throw codedError(`Data Lab text exceeds ${max} characters`, 'DATA_LAB_TEXT_TOO_LONG');
  return out;
}

function boundedArray(value, label, max) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw codedError(`${label} must be an array`, 'DATA_LAB_SPEC_INVALID', { label });
  if (value.length > max) throw codedError(`${label} exceeds ${max} items`, 'DATA_LAB_SPEC_INVALID', { label, max });
  return value;
}

function safePath(raw, label = 'path') {
  const value = text(raw, '', 500);
  if (!value) throw codedError(`${label} is required`, 'DATA_LAB_PATH_REQUIRED', { label });
  const segments = value.split('.').filter(Boolean);
  if (!segments.length || segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) {
    throw codedError(`${label} contains a forbidden path segment`, 'DATA_LAB_PATH_INVALID', { label, path: value });
  }
  return value;
}

function normalizeRow(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return { value };
}

function inferFormat(filePath, requested = 'auto') {
  const format = text(requested, 'auto', 20).toLowerCase();
  if (!FORMATS.has(format)) throw codedError(`Unsupported data format ${format}`, 'DATA_LAB_FORMAT_UNSUPPORTED', { format });
  if (format !== 'auto') return format;
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') return 'json';
  if (['.ndjson', '.jsonl'].includes(ext)) return 'ndjson';
  if (ext === '.csv') return 'csv';
  if (ext === '.tsv') return 'tsv';
  throw codedError('Cannot infer data format from file extension', 'DATA_LAB_FORMAT_UNKNOWN', { extension: ext });
}

async function resolveContainedFile(rootDir, inputPath) {
  const root = await fs.realpath(path.resolve(rootDir));
  const requested = path.resolve(root, inputPath);
  let real;
  try { real = await fs.realpath(requested); }
  catch (error) { throw codedError(`Data file is unavailable: ${inputPath}`, 'DATA_LAB_FILE_UNAVAILABLE', { inputPath, cause: error?.code || null }); }
  if (real !== root && !real.startsWith(`${root}${path.sep}`)) throw codedError('Data file escapes the allowed root', 'DATA_LAB_ROOT_ESCAPE', { inputPath });
  const stat = await fs.stat(real);
  if (!stat.isFile()) throw codedError('Data input must be a regular file', 'DATA_LAB_FILE_INVALID', { inputPath });
  if (stat.size > MAX_FILE_BYTES) throw codedError(`Data file exceeds ${MAX_FILE_BYTES} bytes`, 'DATA_LAB_FILE_TOO_LARGE', { bytes: stat.size, max: MAX_FILE_BYTES });
  return { root, file: real, bytes: stat.size };
}

function parseDelimited(source, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') { cell += '"'; i += 1; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell.length === 0) { quoted = true; continue; }
    if (ch === delimiter) { row.push(cell); cell = ''; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    if (ch === '\r' && source[i + 1] === '\n') continue;
    cell += ch;
  }
  if (quoted) throw codedError('Delimited file ends inside a quoted field', 'DATA_LAB_DELIMITED_INVALID');
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map((name, index) => text(name, `column_${index + 1}`, 240));
  if (headers.length > MAX_COLUMNS) throw codedError(`Dataset exceeds ${MAX_COLUMNS} columns`, 'DATA_LAB_COLUMN_LIMIT', { columns: headers.length });
  const seen = new Set();
  for (const header of headers) {
    if (!header || seen.has(header)) throw codedError(`Delimited header is empty or duplicated: ${header || '<empty>'}`, 'DATA_LAB_HEADER_INVALID', { header });
    seen.add(header);
  }
  return rows.filter((values) => values.some((value) => value !== '')).map((values, rowIndex) => {
    if (values.length > headers.length) throw codedError(`Delimited row ${rowIndex + 2} has more fields than the header`, 'DATA_LAB_DELIMITED_INVALID', { row: rowIndex + 2, fields: values.length, columns: headers.length });
    const out = Object.create(null);
    for (let i = 0; i < headers.length; i += 1) out[headers[i]] = coerceScalar(values[i] ?? '');
    return out;
  });
}

function coerceScalar(value) {
  const raw = String(value);
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  if (trimmed === 'null') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    const number = Number(trimmed);
    if (Number.isFinite(number)) return number;
  }
  return raw;
}

function parseJsonRows(source) {
  let parsed;
  try { parsed = JSON.parse(source); }
  catch { throw codedError('JSON input is invalid', 'DATA_LAB_JSON_INVALID'); }
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.rows) ? parsed.rows : [parsed];
  return rows.map(normalizeRow);
}

function parseNdjsonRows(source) {
  const rows = [];
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try { rows.push(normalizeRow(JSON.parse(line))); }
    catch { throw codedError(`NDJSON line ${index + 1} is invalid`, 'DATA_LAB_NDJSON_INVALID', { line: index + 1 }); }
  }
  return rows;
}

export async function loadDataset({ file, format = 'auto', rootDir = process.cwd() }) {
  const resolved = await resolveContainedFile(rootDir, file);
  const detected = inferFormat(resolved.file, format);
  const source = await fs.readFile(resolved.file, 'utf8');
  let rows;
  if (detected === 'json') rows = parseJsonRows(source);
  else if (detected === 'ndjson') rows = parseNdjsonRows(source);
  else rows = parseDelimited(source, detected === 'tsv' ? '\t' : ',');
  if (rows.length > MAX_ROWS) throw codedError(`Dataset exceeds ${MAX_ROWS} rows`, 'DATA_LAB_ROW_LIMIT', { rows: rows.length });
  return { contract: NATIVE_DATA_LAB_CONTRACT, file: path.relative(resolved.root, resolved.file).split(path.sep).join('/'), format: detected, bytes: resolved.bytes, rows };
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function collectColumns(rows) {
  const columns = new Set();
  for (const row of rows) for (const key of Object.keys(row)) columns.add(key);
  if (columns.size > MAX_COLUMNS) throw codedError(`Dataset exceeds ${MAX_COLUMNS} columns`, 'DATA_LAB_COLUMN_LIMIT', { columns: columns.size });
  return [...columns].sort();
}

export function profileDataset(rows) {
  const columns = collectColumns(rows);
  return {
    rows: rows.length,
    columns: columns.map((name) => {
      const types = new Set();
      let missing = 0;
      let empty = 0;
      const distinct = new Set();
      let distinctOverflow = false;
      for (const row of rows) {
        if (!Object.hasOwn(row, name) || row[name] === null || row[name] === undefined) { missing += 1; types.add('null'); continue; }
        const value = row[name];
        types.add(valueType(value));
        if (value === '') empty += 1;
        if (!distinctOverflow) {
          distinct.add(typeof value === 'object' ? JSON.stringify(value) : `${typeof value}:${String(value)}`);
          if (distinct.size > 2048) distinctOverflow = true;
        }
      }
      return { name, types: [...types].sort(), missing, empty, distinct: distinctOverflow ? '>=2048' : distinct.size };
    })
  };
}

function getPath(row, rawPath) {
  const target = safePath(rawPath, 'field path');
  let value = row;
  for (const segment of target.split('.')) {
    if (value === null || value === undefined || typeof value !== 'object' || !Object.hasOwn(value, segment)) return { exists: false, value: undefined };
    value = value[segment];
  }
  return { exists: true, value };
}

function compare(left, right) {
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
}

function matches(row, filter) {
  const resolved = getPath(row, filter.path);
  const actual = resolved.value;
  if (filter.op === 'exists') return filter.value === false ? !resolved.exists : resolved.exists;
  if (!resolved.exists) return false;
  if (filter.op === 'eq') return Object.is(actual, filter.value);
  if (filter.op === 'ne') return !Object.is(actual, filter.value);
  if (filter.op === 'gt') return compare(actual, filter.value) > 0;
  if (filter.op === 'gte') return compare(actual, filter.value) >= 0;
  if (filter.op === 'lt') return compare(actual, filter.value) < 0;
  if (filter.op === 'lte') return compare(actual, filter.value) <= 0;
  if (filter.op === 'contains') return String(actual ?? '').includes(String(filter.value ?? ''));
  if (filter.op === 'in') return filter.value.some((item) => Object.is(actual, item));
  return false;
}

function normalizeQuery(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw codedError('query must be an object', 'DATA_LAB_SPEC_INVALID');
  const where = boundedArray(raw.where, 'query.where', MAX_FILTERS).map((filter, index) => {
    if (!filter || typeof filter !== 'object' || Array.isArray(filter)) throw codedError(`query.where[${index}] must be an object`, 'DATA_LAB_FILTER_INVALID');
    const op = text(filter.op, 'eq', 20).toLowerCase();
    if (!FILTER_OPS.has(op)) throw codedError(`Unsupported filter op ${op}`, 'DATA_LAB_FILTER_INVALID', { op });
    if (op === 'in') {
      if (!Array.isArray(filter.value) || filter.value.length > 1024 || filter.value.some((value) => value !== null && typeof value === 'object')) throw codedError('in filter requires at most 1024 scalar values', 'DATA_LAB_FILTER_INVALID');
    } else if (op !== 'exists' && filter.value !== null && typeof filter.value === 'object') {
      throw codedError(`${op} filter requires a scalar value`, 'DATA_LAB_FILTER_INVALID');
    }
    return { path: safePath(filter.path, `query.where[${index}].path`), op, value: filter.value };
  });
  const select = boundedArray(raw.select, 'query.select', MAX_COLUMNS).map((item, index) => safePath(item, `query.select[${index}]`));
  const sort = boundedArray(raw.sort, 'query.sort', MAX_SORTS).map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw codedError(`query.sort[${index}] must be an object`, 'DATA_LAB_SORT_INVALID');
    const direction = text(item.direction, 'asc', 8).toLowerCase();
    if (!['asc', 'desc'].includes(direction)) throw codedError(`query.sort[${index}] direction is invalid`, 'DATA_LAB_SORT_INVALID');
    return { path: safePath(item.path, `query.sort[${index}].path`), direction };
  });
  const limit = raw.limit === undefined ? 100 : Number(raw.limit);
  if (!Number.isInteger(limit) || limit < 0 || limit > MAX_RESULT_ROWS) throw codedError(`query.limit must be within 0..${MAX_RESULT_ROWS}`, 'DATA_LAB_LIMIT_INVALID');
  return { where, select, sort, limit };
}

function normalizeAggregate(raw) {
  if (raw === undefined || raw === null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw codedError('aggregate must be an object', 'DATA_LAB_SPEC_INVALID');
  const groupBy = boundedArray(raw.groupBy, 'aggregate.groupBy', 16).map((item, index) => safePath(item, `aggregate.groupBy[${index}]`));
  const metrics = boundedArray(raw.metrics, 'aggregate.metrics', MAX_METRICS).map((metric, index) => {
    if (!metric || typeof metric !== 'object' || Array.isArray(metric)) throw codedError(`aggregate.metrics[${index}] must be an object`, 'DATA_LAB_METRIC_INVALID');
    const op = text(metric.op, '', 20).toLowerCase();
    if (!METRIC_OPS.has(op)) throw codedError(`Unsupported metric op ${op}`, 'DATA_LAB_METRIC_INVALID', { op });
    const name = text(metric.name, `${op}_${index + 1}`, 120);
    const pathValue = op === 'count' && !metric.path ? null : safePath(metric.path, `aggregate.metrics[${index}].path`);
    return { name, op, path: pathValue };
  });
  if (!metrics.length) metrics.push({ name: 'count', op: 'count', path: null });
  return { groupBy, metrics };
}

function sortRows(rows, sort) {
  if (!sort.length) return rows;
  return [...rows].sort((left, right) => {
    for (const rule of sort) {
      const a = getPath(left, rule.path).value;
      const b = getPath(right, rule.path).value;
      const order = compare(a, b);
      if (order) return rule.direction === 'desc' ? -order : order;
    }
    return 0;
  });
}

function selectRow(row, fields) {
  if (!fields.length) return row;
  const out = Object.create(null);
  for (const field of fields) out[field] = getPath(row, field).value;
  return out;
}

function aggregateRows(rows, aggregate) {
  const groups = new Map();
  for (const row of rows) {
    const keys = aggregate.groupBy.map((field) => getPath(row, field).value);
    const identity = JSON.stringify(keys);
    if (!groups.has(identity)) groups.set(identity, { keys, rows: [] });
    groups.get(identity).rows.push(row);
  }
  return [...groups.values()].map((group) => {
    const out = Object.create(null);
    aggregate.groupBy.forEach((field, index) => { out[field] = group.keys[index]; });
    for (const metric of aggregate.metrics) {
      const values = metric.path ? group.rows.map((row) => getPath(row, metric.path)).filter((item) => item.exists).map((item) => item.value) : [];
      if (metric.op === 'count') out[metric.name] = metric.path ? values.length : group.rows.length;
      else {
        const numbers = values.map(Number).filter(Number.isFinite);
        if (metric.op === 'sum') out[metric.name] = numbers.reduce((sum, value) => sum + value, 0);
        else if (metric.op === 'avg') out[metric.name] = numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
        else if (metric.op === 'min') out[metric.name] = values.length ? values.reduce((best, value) => compare(value, best) < 0 ? value : best) : null;
        else if (metric.op === 'max') out[metric.name] = values.length ? values.reduce((best, value) => compare(value, best) > 0 ? value : best) : null;
      }
    }
    return out;
  });
}

export function queryDataset(rows, rawQuery = {}, rawAggregate = null) {
  const query = normalizeQuery(rawQuery);
  const aggregate = normalizeAggregate(rawAggregate);
  let current = rows.filter((row) => query.where.every((filter) => matches(row, filter)));
  const filteredRows = current.length;
  if (aggregate) current = aggregateRows(current, aggregate);
  else current = current.map((row) => selectRow(row, query.select));
  current = sortRows(current, query.sort);
  const totalResultRows = current.length;
  current = current.slice(0, query.limit);
  return { filteredRows, totalResultRows, resultRows: current.length, truncated: current.length < totalResultRows, rows: current };
}

export async function runDataLab(rawSpec, { rootDir = process.cwd() } = {}) {
  if (!rawSpec || typeof rawSpec !== 'object' || Array.isArray(rawSpec)) throw codedError('Data Lab spec must be an object', 'DATA_LAB_SPEC_INVALID');
  const dataset = await loadDataset({ file: rawSpec.file, format: rawSpec.format || 'auto', rootDir });
  const profile = profileDataset(dataset.rows);
  const query = queryDataset(dataset.rows, rawSpec.query || {}, rawSpec.aggregate);
  return {
    contract: NATIVE_DATA_LAB_CONTRACT,
    source: { file: dataset.file, format: dataset.format, bytes: dataset.bytes },
    profile,
    query
  };
}

function usage() {
  return `Veteran Native Data Lab\n\nUsage:\n  node src/native-data-lab.mjs profile <data-file> [--format auto|json|ndjson|csv|tsv] [--root <dir>] [--out <report.json>]\n  node src/native-data-lab.mjs run <spec.json> [--root <dir>] [--out <report.json>]\n\nReads local JSON, NDJSON, CSV, and TSV under the allowed root. No paid service or third-party package is required.\n`;
}

async function resolveOutputTarget(rootDir, outPath) {
  const root = await fs.realpath(path.resolve(rootDir));
  const target = path.resolve(root, outPath);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) throw codedError('Output path escapes the allowed root', 'DATA_LAB_ROOT_ESCAPE', { outPath });
  const parent = await fs.realpath(path.dirname(target));
  if (parent !== root && !parent.startsWith(`${root}${path.sep}`)) throw codedError('Output parent escapes the allowed root', 'DATA_LAB_ROOT_ESCAPE', { outPath });
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw codedError('Output target must be a regular file', 'DATA_LAB_OUTPUT_INVALID', { outPath });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return target;
}

async function writeReport(report, outPath, rootDir) {
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (!outPath) { process.stdout.write(serialized); return; }
  const target = await resolveOutputTarget(rootDir, outPath);
  await fs.writeFile(target, serialized, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(serialized);
}

async function cli(argv) {
  const command = argv[0] || 'help';
  if (['help', '-h', '--help'].includes(command)) { process.stdout.write(usage()); return 0; }
  if (!['profile', 'run'].includes(command)) throw codedError(`Unknown Data Lab command: ${command}`, 'DATA_LAB_COMMAND_UNKNOWN');
  const input = argv[1];
  if (!input || input.startsWith('-')) throw codedError(`${command} requires an input path`, 'DATA_LAB_INPUT_REQUIRED');
  let rootDir = process.cwd();
  let format = 'auto';
  let outPath = null;
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') rootDir = argv[++index];
    else if (arg === '--format') format = argv[++index];
    else if (arg === '--out') outPath = argv[++index];
    else throw codedError(`Unknown Data Lab argument: ${arg}`, 'DATA_LAB_ARGUMENT_UNKNOWN');
    if (!argv[index] || argv[index].startsWith('-')) throw codedError(`${arg} requires a value`, 'DATA_LAB_ARGUMENT_VALUE_REQUIRED');
  }
  if (command === 'profile') {
    const dataset = await loadDataset({ file: input, format, rootDir });
    const report = { contract: NATIVE_DATA_LAB_CONTRACT, source: { file: dataset.file, format: dataset.format, bytes: dataset.bytes }, profile: profileDataset(dataset.rows) };
    await writeReport(report, outPath, rootDir);
    return 0;
  }
  const resolvedSpec = await resolveContainedFile(rootDir, input);
  const spec = JSON.parse(await fs.readFile(resolvedSpec.file, 'utf8'));
  const report = await runDataLab(spec, { rootDir: resolvedSpec.root });
  await writeReport(report, outPath, resolvedSpec.root);
  return 0;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  cli(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error.code ? `[${error.code}] ` : ''}${error.message || String(error)}\n`);
    process.exitCode = 1;
  });
}
