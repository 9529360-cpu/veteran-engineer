#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const NATIVE_MOCK_LAB_CONTRACT = 'veteran-native-mock-lab-v1';

const MAX_ROUTES = 128;
const MAX_REQUESTS = 1_000;
const MAX_DURATION_MS = 60_000;
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const MAX_RESPONSE_BODY_BYTES = 1024 * 1024;
const MAX_HEADERS = 64;
const MAX_HEADER_VALUE_LENGTH = 4096;
const MAX_REPORT_BYTES = 4 * 1024 * 1024;
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const BLOCKED_RESPONSE_HEADERS = new Set(['connection', 'content-length', 'transfer-encoding', 'upgrade']);

function codedError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details !== null) error.details = details;
  return error;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function clampInteger(value, fallback, min, max, code, label) {
  const number = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw codedError(`${label} must be an integer between ${min} and ${max}`, code);
  return number;
}

function normalizeHeaderName(value, code) {
  const name = String(value).trim().toLowerCase();
  if (!name || !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name)) throw codedError(`Invalid header name: ${value}`, code);
  return name;
}

function normalizeRequiredHeaders(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_HEADERS) throw codedError('requiredHeaders must be a bounded array', 'MOCK_LAB_EXPECTATION_INVALID');
  return [...new Set(raw.map((value) => normalizeHeaderName(value, 'MOCK_LAB_EXPECTATION_INVALID')))];
}

function normalizeQueryKeys(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 64) throw codedError('requiredQueryKeys must be a bounded array', 'MOCK_LAB_EXPECTATION_INVALID');
  const values = raw.map((value) => String(value));
  if (values.some((value) => !value || value.length > 256 || value.includes('\0'))) throw codedError('requiredQueryKeys contains an invalid key', 'MOCK_LAB_EXPECTATION_INVALID');
  return [...new Set(values)];
}

function plainJsonValue(value, depth = 0) {
  if (depth > 16) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 256 && value.every((item) => plainJsonValue(item, depth + 1));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value);
    return entries.length <= 256 && entries.every(([key, item]) => key.length <= 256 && !['__proto__', 'prototype', 'constructor'].includes(key) && plainJsonValue(item, depth + 1));
  }
  return false;
}

function normalizeExpectedJson(raw) {
  if (raw === undefined) return null;
  if (!plainJsonValue(raw) || Array.isArray(raw) || raw === null || typeof raw !== 'object') throw codedError('expectJson must be a bounded JSON object', 'MOCK_LAB_EXPECTATION_INVALID');
  const serialized = JSON.stringify(raw);
  if (Buffer.byteLength(serialized) > 64 * 1024) throw codedError('expectJson is too large', 'MOCK_LAB_EXPECTATION_INVALID');
  return raw;
}

function normalizeResponseHeaders(raw) {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw codedError('response headers must be an object', 'MOCK_LAB_RESPONSE_INVALID');
  const entries = Object.entries(raw);
  if (entries.length > MAX_HEADERS) throw codedError('Too many response headers', 'MOCK_LAB_RESPONSE_INVALID');
  const out = {};
  for (const [key, value] of entries) {
    const name = normalizeHeaderName(key, 'MOCK_LAB_RESPONSE_INVALID');
    if (BLOCKED_RESPONSE_HEADERS.has(name)) throw codedError(`Response header ${name} is not allowed`, 'MOCK_LAB_RESPONSE_INVALID');
    const text = String(value);
    if (text.length > MAX_HEADER_VALUE_LENGTH || /[\r\n]/.test(text)) throw codedError(`Response header ${name} is invalid`, 'MOCK_LAB_RESPONSE_INVALID');
    out[name] = text;
  }
  return out;
}

function normalizeRoute(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw codedError(`Route ${index + 1} must be an object`, 'MOCK_LAB_ROUTE_INVALID');
  const id = String(raw.id || `route-${index + 1}`);
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) throw codedError(`Route ${index + 1} id is invalid`, 'MOCK_LAB_ROUTE_INVALID');
  const method = String(raw.method || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw codedError(`Route ${id} method is unsupported`, 'MOCK_LAB_ROUTE_INVALID');
  const routePath = String(raw.path || '');
  if (!routePath.startsWith('/') || routePath.length > 2048 || routePath.includes('\0') || routePath.includes('?') || routePath.includes('#') || routePath.includes('*')) {
    throw codedError(`Route ${id} path must be an exact pathname`, 'MOCK_LAB_ROUTE_INVALID');
  }
  const minCalls = clampInteger(raw.minCalls, 0, 0, MAX_REQUESTS, 'MOCK_LAB_CALLS_INVALID', `Route ${id} minCalls`);
  const maxCalls = clampInteger(raw.maxCalls, MAX_REQUESTS, 0, MAX_REQUESTS, 'MOCK_LAB_CALLS_INVALID', `Route ${id} maxCalls`);
  if (maxCalls < minCalls) throw codedError(`Route ${id} maxCalls cannot be lower than minCalls`, 'MOCK_LAB_CALLS_INVALID');
  const response = raw.response || {};
  if (!response || typeof response !== 'object' || Array.isArray(response)) throw codedError(`Route ${id} response must be an object`, 'MOCK_LAB_RESPONSE_INVALID');
  const status = clampInteger(response.status, 200, 100, 599, 'MOCK_LAB_RESPONSE_INVALID', `Route ${id} response status`);
  let body = '';
  const headers = normalizeResponseHeaders(response.headers);
  if (response.json !== undefined && response.body !== undefined) throw codedError(`Route ${id} response must choose body or json`, 'MOCK_LAB_RESPONSE_INVALID');
  if (response.json !== undefined) {
    if (!plainJsonValue(response.json)) throw codedError(`Route ${id} response json is invalid`, 'MOCK_LAB_RESPONSE_INVALID');
    body = JSON.stringify(response.json);
    if (!Object.hasOwn(headers, 'content-type')) headers['content-type'] = 'application/json; charset=utf-8';
  } else if (response.body !== undefined && response.body !== null) {
    body = String(response.body);
  }
  if (Buffer.byteLength(body) > MAX_RESPONSE_BODY_BYTES) throw codedError(`Route ${id} response body is too large`, 'MOCK_LAB_RESPONSE_INVALID');
  return {
    id,
    method,
    path: routePath,
    minCalls,
    maxCalls,
    requiredHeaders: normalizeRequiredHeaders(raw.requiredHeaders),
    requiredQueryKeys: normalizeQueryKeys(raw.requiredQueryKeys),
    expectJson: normalizeExpectedJson(raw.expectJson),
    response: { status, headers, body }
  };
}

export function normalizeMockSpec(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw codedError('Mock spec must be an object', 'MOCK_LAB_CONFIG_INVALID');
  if (!Array.isArray(raw.routes) || raw.routes.length === 0 || raw.routes.length > MAX_ROUTES) throw codedError('Mock spec routes must be a bounded non-empty array', 'MOCK_LAB_CONFIG_INVALID');
  const routes = raw.routes.map(normalizeRoute);
  const ids = new Set();
  const keys = new Set();
  for (const route of routes) {
    if (ids.has(route.id)) throw codedError(`Duplicate route id: ${route.id}`, 'MOCK_LAB_ROUTE_DUPLICATE');
    ids.add(route.id);
    const key = `${route.method}\0${route.path}`;
    if (keys.has(key)) throw codedError(`Duplicate route matcher: ${route.method} ${route.path}`, 'MOCK_LAB_ROUTE_DUPLICATE');
    keys.add(key);
  }
  return {
    contract: NATIVE_MOCK_LAB_CONTRACT,
    durationMs: clampInteger(raw.durationMs, 30_000, 100, MAX_DURATION_MS, 'MOCK_LAB_DURATION_INVALID', 'durationMs'),
    maxRequests: clampInteger(raw.maxRequests, 100, 1, MAX_REQUESTS, 'MOCK_LAB_REQUEST_LIMIT_INVALID', 'maxRequests'),
    maxRequestBodyBytes: clampInteger(raw.maxRequestBodyBytes, MAX_REQUEST_BODY_BYTES, 1, MAX_REQUEST_BODY_BYTES, 'MOCK_LAB_BODY_LIMIT_INVALID', 'maxRequestBodyBytes'),
    routes
  };
}

function jsonSubset(expected, actual) {
  if (expected === null || typeof expected !== 'object') return Object.is(expected, actual);
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length < expected.length) return false;
    return expected.every((item, index) => jsonSubset(item, actual[index]));
  }
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
  return Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && jsonSubset(value, actual[key]));
}

function evaluateRequest(route, request, bodyBuffer) {
  const failures = [];
  for (const header of route.requiredHeaders) if (request.headers[header] === undefined) failures.push(`missing-header:${header}`);
  for (const key of route.requiredQueryKeys) if (!request.url.searchParams.has(key)) failures.push(`missing-query-key:${key}`);
  if (route.expectJson !== null) {
    let parsed = null;
    try { parsed = JSON.parse(bodyBuffer.toString('utf8')); }
    catch { failures.push('json-body-invalid'); }
    if (parsed !== null && !jsonSubset(route.expectJson, parsed)) failures.push('json-body-mismatch');
  }
  return failures;
}

function buildReport(spec, state) {
  const routes = spec.routes.map((route) => {
    const stats = state.routes.get(route.id);
    const countPassed = stats.calls >= route.minCalls && stats.calls <= route.maxCalls;
    const expectationsPassed = stats.expectationFailures === 0;
    return {
      id: route.id,
      method: route.method,
      path: route.path,
      calls: stats.calls,
      expectationFailures: stats.expectationFailures,
      minCalls: route.minCalls,
      maxCalls: route.maxCalls,
      passed: countPassed && expectationsPassed
    };
  });
  const passed = state.unmatched === 0 && state.tooLarge === 0 && routes.every((route) => route.passed);
  return {
    contract: NATIVE_MOCK_LAB_CONTRACT,
    passed,
    binding: { host: '127.0.0.1', port: state.port },
    requests: { total: state.total, matched: state.matched, unmatched: state.unmatched, bodyTooLarge: state.tooLarge },
    routes
  };
}

function readRequestBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes <= limit) chunks.push(chunk);
      else tooLarge = true;
    });
    request.once('end', () => resolve({ body: Buffer.concat(chunks), bytes, tooLarge }));
    request.once('error', reject);
  });
}

function writeRouteResponse(response, route) {
  response.writeHead(route.response.status, route.response.headers);
  response.end(route.response.body);
}

export async function startMockLab(rawSpec, { port = 0 } = {}) {
  const spec = normalizeMockSpec(rawSpec);
  const listenPort = clampInteger(port, 0, 0, 65535, 'MOCK_LAB_PORT_INVALID', 'port');
  const state = {
    port: null,
    total: 0,
    matched: 0,
    unmatched: 0,
    tooLarge: 0,
    routes: new Map(spec.routes.map((route) => [route.id, { calls: 0, expectationFailures: 0 }]))
  };
  let closed = false;
  let closeResolve;
  const done = new Promise((resolve) => { closeResolve = resolve; });
  const server = http.createServer(async (request, response) => {
    state.total += 1;
    let parsedUrl;
    try { parsedUrl = new URL(request.url || '/', 'http://127.0.0.1'); }
    catch {
      state.unmatched += 1;
      response.statusCode = 400;
      response.end();
      return;
    }
    let read;
    try { read = await readRequestBody(request, spec.maxRequestBodyBytes); }
    catch {
      state.unmatched += 1;
      response.statusCode = 400;
      response.end();
      return;
    }
    if (read.tooLarge) {
      state.tooLarge += 1;
      response.statusCode = 413;
      response.end();
    } else {
      const method = String(request.method || 'GET').toUpperCase();
      const route = spec.routes.find((item) => item.method === method && item.path === parsedUrl.pathname);
      if (!route) {
        state.unmatched += 1;
        response.statusCode = 404;
        response.end();
      } else {
        state.matched += 1;
        const stats = state.routes.get(route.id);
        stats.calls += 1;
        const failures = evaluateRequest(route, { headers: request.headers, url: parsedUrl }, read.body);
        if (failures.length) stats.expectationFailures += 1;
        writeRouteResponse(response, route);
      }
    }
    if (state.total >= spec.maxRequests) setImmediate(() => close().catch(() => {}));
  });

  function closeServer() {
    return new Promise((resolve) => {
      if (!server.listening) { resolve(); return; }
      server.close(() => resolve());
    });
  }

  async function close() {
    if (closed) return buildReport(spec, state);
    closed = true;
    await closeServer();
    const report = buildReport(spec, state);
    closeResolve(report);
    return report;
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  state.port = typeof address === 'object' && address ? address.port : listenPort;
  return { url: `http://127.0.0.1:${state.port}`, port: state.port, host: '127.0.0.1', spec, close, done, report: () => buildReport(spec, state) };
}

export async function runMockLab(rawSpec, { port = 0 } = {}) {
  const lab = await startMockLab(rawSpec, { port });
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(resolve, lab.spec.durationMs); });
  await Promise.race([lab.done, timeout]);
  clearTimeout(timer);
  return lab.close();
}

function normalizeRelativePath(value, label) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0') || path.isAbsolute(value)) throw codedError(`${label} must be a bounded relative path`, 'MOCK_LAB_PATH_INVALID');
  const normalized = path.normalize(value);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw codedError(`${label} escapes root`, 'MOCK_LAB_PATH_INVALID');
  return normalized;
}

async function rootInfo(rootDir) {
  const absolute = path.resolve(rootDir || '.');
  const real = await fs.realpath(absolute);
  return { absolute, real };
}

function within(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function loadSpecFile(rootDir, relativePath) {
  const root = await rootInfo(rootDir);
  const safe = normalizeRelativePath(relativePath, 'Spec path');
  const target = await fs.realpath(path.resolve(root.absolute, safe));
  if (!within(root.real, target)) throw codedError('Spec path escapes root', 'MOCK_LAB_PATH_ESCAPE');
  const stat = await fs.stat(target);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw codedError('Spec file is invalid or too large', 'MOCK_LAB_SPEC_INVALID');
  let parsed;
  try { parsed = JSON.parse(await fs.readFile(target, 'utf8')); }
  catch { throw codedError('Spec JSON is invalid', 'MOCK_LAB_SPEC_INVALID'); }
  return normalizeMockSpec(parsed);
}

async function writeReport(rootDir, relativePath, report) {
  const root = await rootInfo(rootDir);
  const safe = normalizeRelativePath(relativePath, 'Report path');
  const target = path.resolve(root.absolute, safe);
  const parent = path.dirname(target);
  await fs.mkdir(parent, { recursive: true });
  const parentReal = await fs.realpath(parent);
  if (!within(root.real, parentReal)) throw codedError('Report path escapes root', 'MOCK_LAB_PATH_ESCAPE');
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw codedError('Report output must be a regular file', 'MOCK_LAB_OUTPUT_INVALID');
    const real = await fs.realpath(target);
    if (!within(root.real, real)) throw codedError('Report path escapes root', 'MOCK_LAB_PATH_ESCAPE');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const content = `${JSON.stringify(report, null, 2)}\n`;
  if (Buffer.byteLength(content) > MAX_REPORT_BYTES) throw codedError('Report is too large', 'MOCK_LAB_REPORT_TOO_LARGE');
  await fs.writeFile(target, content, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(target, 0o600).catch(() => {});
  return { path: safe.split(path.sep).join('/'), bytes: Buffer.byteLength(content), sha256: sha256(content) };
}

function requiredValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) throw codedError(`${option} requires a value`, 'MOCK_LAB_ARGUMENT_REQUIRED');
  return value;
}

function usage() {
  return `Veteran Native Mock Lab\n\nUsage:\n  node src/native-mock-lab.mjs serve <spec.json> [--root <directory>] [--port 0] [--out report.json]\n\nBinds only to 127.0.0.1. Exact declarative routes only; request bodies and header values are never written to reports. No Postman Mock, Webhook.site, Beeceptor, or paid API is required.\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || 'help';
  if (['help', '--help', '-h'].includes(command)) { process.stdout.write(usage()); return 0; }
  if (command !== 'serve') throw codedError(`Unknown Mock Lab command: ${command}`, 'MOCK_LAB_COMMAND_UNKNOWN');
  const specPath = argv[1];
  if (!specPath || specPath.startsWith('-')) throw codedError('serve requires a spec JSON path', 'MOCK_LAB_ARGUMENT_REQUIRED');
  let rootDir = process.cwd();
  let port = 0;
  let out = null;
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') rootDir = requiredValue(argv, index++, arg);
    else if (arg === '--port') port = Number(requiredValue(argv, index++, arg));
    else if (arg === '--out') out = requiredValue(argv, index++, arg);
    else throw codedError(`Unknown Mock Lab argument: ${arg}`, 'MOCK_LAB_ARGUMENT_UNKNOWN');
  }
  const spec = await loadSpecFile(rootDir, specPath);
  const report = await runMockLab(spec, { port });
  const artifact = out ? await writeReport(rootDir, out, report) : null;
  process.stdout.write(`${JSON.stringify({ ...report, artifact }, null, 2)}\n`);
  return report.passed ? 0 : 2;
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error?.code || 'MOCK_LAB_ERROR'}: ${String(error?.message || error)}\n`);
    process.exitCode = 1;
  });
}
