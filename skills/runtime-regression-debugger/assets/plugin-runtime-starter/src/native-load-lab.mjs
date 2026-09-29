#!/usr/bin/env node
import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const NATIVE_LOAD_LAB_CONTRACT = 'veteran-native-load-lab-v1';

const MAX_REQUESTS = 5_000;
const MAX_CONCURRENCY = 64;
const MAX_TIMEOUT_MS = 30_000;
const MAX_TOTAL_DURATION_MS = 60_000;
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_HEADER_COUNT = 64;
const MAX_HEADER_VALUE_LENGTH = 4096;
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const BLOCKED_HEADERS = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'upgrade']);

function codedError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details !== null) error.details = details;
  return error;
}

function clampInteger(value, fallback, min, max, code, label) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw codedError(`${label} must be an integer between ${min} and ${max}`, code);
  return number;
}

function normalizeHeaders(raw) {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw codedError('headers must be an object', 'LOAD_LAB_HEADERS_INVALID');
  const entries = Object.entries(raw);
  if (entries.length > MAX_HEADER_COUNT) throw codedError('Too many request headers', 'LOAD_LAB_HEADERS_INVALID');
  const headers = {};
  for (const [key, value] of entries) {
    const name = String(key).trim().toLowerCase();
    if (!name || !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || BLOCKED_HEADERS.has(name)) throw codedError(`Header ${key} is not allowed`, 'LOAD_LAB_HEADERS_INVALID');
    const text = String(value);
    if (text.length > MAX_HEADER_VALUE_LENGTH || /[\r\n]/.test(text)) throw codedError(`Header ${key} is invalid`, 'LOAD_LAB_HEADERS_INVALID');
    headers[name] = text;
  }
  return headers;
}

function normalizeThresholds(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw codedError('thresholds must be an object', 'LOAD_LAB_THRESHOLDS_INVALID');
  const maxErrorRate = raw.maxErrorRate === undefined ? 0 : Number(raw.maxErrorRate);
  if (!Number.isFinite(maxErrorRate) || maxErrorRate < 0 || maxErrorRate > 1) throw codedError('maxErrorRate must be between 0 and 1', 'LOAD_LAB_THRESHOLDS_INVALID');
  function optionalPositive(name, max = 60_000) {
    if (raw[name] === undefined || raw[name] === null) return null;
    const value = Number(raw[name]);
    if (!Number.isFinite(value) || value < 0 || value > max) throw codedError(`${name} is outside the supported range`, 'LOAD_LAB_THRESHOLDS_INVALID');
    return value;
  }
  return {
    maxErrorRate,
    maxP95Ms: optionalPositive('maxP95Ms'),
    maxP99Ms: optionalPositive('maxP99Ms'),
    minRps: optionalPositive('minRps', 1_000_000)
  };
}

export function normalizeLoadScenario(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw codedError('Load scenario must be an object', 'LOAD_LAB_CONFIG_INVALID');
  let url;
  try { url = new URL(String(raw.url || '')); }
  catch { throw codedError('Load scenario url is invalid', 'LOAD_LAB_URL_INVALID'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw codedError('Only http/https load targets are supported', 'LOAD_LAB_URL_INVALID');
  if (url.username || url.password) throw codedError('Credentials in load target URLs are forbidden', 'LOAD_LAB_URL_CREDENTIALS_FORBIDDEN');
  const method = String(raw.method || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw codedError(`Method ${method} is not supported`, 'LOAD_LAB_METHOD_INVALID');
  const requests = clampInteger(raw.requests, 100, 1, MAX_REQUESTS, 'LOAD_LAB_REQUESTS_INVALID', 'requests');
  const concurrency = clampInteger(raw.concurrency, Math.min(10, requests), 1, Math.min(MAX_CONCURRENCY, requests), 'LOAD_LAB_CONCURRENCY_INVALID', 'concurrency');
  const timeoutMs = clampInteger(raw.timeoutMs, 5_000, 100, MAX_TIMEOUT_MS, 'LOAD_LAB_TIMEOUT_INVALID', 'timeoutMs');
  const maxDurationMs = clampInteger(raw.maxDurationMs, MAX_TOTAL_DURATION_MS, 100, MAX_TOTAL_DURATION_MS, 'LOAD_LAB_DURATION_INVALID', 'maxDurationMs');
  const successStatusMin = clampInteger(raw.successStatusMin, 200, 100, 599, 'LOAD_LAB_STATUS_RANGE_INVALID', 'successStatusMin');
  const successStatusMax = clampInteger(raw.successStatusMax, 399, 100, 599, 'LOAD_LAB_STATUS_RANGE_INVALID', 'successStatusMax');
  if (successStatusMax < successStatusMin) throw codedError('success status range is invalid', 'LOAD_LAB_STATUS_RANGE_INVALID');
  const body = raw.body === undefined || raw.body === null ? null : String(raw.body);
  if (body !== null && Buffer.byteLength(body) > MAX_REQUEST_BODY_BYTES) throw codedError('Request body exceeds size limit', 'LOAD_LAB_BODY_TOO_LARGE');
  return {
    contract: NATIVE_LOAD_LAB_CONTRACT,
    url: url.toString(),
    method,
    headers: normalizeHeaders(raw.headers),
    body,
    requests,
    concurrency,
    timeoutMs,
    maxDurationMs,
    successStatusMin,
    successStatusMax,
    thresholds: normalizeThresholds(raw.thresholds)
  };
}

function parseIpv4(value) {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => Number(part));
  if (bytes.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return bytes;
}

function allowedIpv4(value) {
  const bytes = parseIpv4(value);
  if (!bytes) return false;
  const [a, b] = bytes;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isMappedIpv4(value) {
  const lower = value.toLowerCase();
  if (!lower.startsWith('::ffff:')) return null;
  return lower.slice('::ffff:'.length);
}

function allowedAddress(address) {
  const mapped = isMappedIpv4(address);
  if (mapped) return allowedIpv4(mapped);
  const family = net.isIP(address);
  if (family === 4) return allowedIpv4(address);
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === '::1') return true;
    return lower.startsWith('fc') || lower.startsWith('fd');
  }
  return false;
}

async function resolvePrivateTarget(url) {
  const hostname = url.hostname;
  if (hostname.toLowerCase() === 'localhost') return { address: '127.0.0.1', family: 4 };
  if (net.isIP(hostname)) {
    if (!allowedAddress(hostname)) throw codedError('Load Lab only permits localhost/RFC1918/ULA targets', 'LOAD_LAB_TARGET_FORBIDDEN', { hostname });
    return { address: hostname, family: net.isIP(hostname) };
  }
  const resolved = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!resolved.length || resolved.some((item) => !allowedAddress(item.address))) {
    throw codedError('Load Lab hostname resolved outside localhost/RFC1918/ULA ranges', 'LOAD_LAB_TARGET_FORBIDDEN', { hostname });
  }
  return resolved[0];
}

function percentile(sorted, fraction) {
  if (!sorted.length) return 0;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function requestOnce(scenario, target) {
  const url = new URL(scenario.url);
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    let settled = false;
    let responseBytes = 0;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
      resolve({ ...payload, elapsedMs });
    };
    const request = transport.request({
      protocol: url.protocol,
      hostname: target.address,
      family: target.family,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: scenario.method,
      headers: { ...scenario.headers, host: url.host },
      servername: url.hostname
    }, (response) => {
      response.on('data', (chunk) => {
        responseBytes += chunk.length;
        if (responseBytes > MAX_RESPONSE_BYTES) request.destroy(codedError('Response body exceeded load-lab limit', 'LOAD_LAB_RESPONSE_TOO_LARGE'));
      });
      response.on('end', () => {
        const statusCode = Number(response.statusCode || 0);
        finish({ ok: statusCode >= scenario.successStatusMin && statusCode <= scenario.successStatusMax, statusCode, errorCode: null, responseBytes });
      });
    });
    request.setTimeout(scenario.timeoutMs, () => request.destroy(codedError('Request timed out', 'LOAD_LAB_REQUEST_TIMEOUT')));
    request.on('error', (error) => finish({ ok: false, statusCode: null, errorCode: error?.code || 'LOAD_LAB_REQUEST_FAILED', responseBytes }));
    if (scenario.body !== null) request.write(scenario.body);
    request.end();
  });
}

function evaluateThresholds(metrics, thresholds) {
  const checks = [
    { name: 'error-rate', passed: metrics.errorRate <= thresholds.maxErrorRate, observed: metrics.errorRate, threshold: thresholds.maxErrorRate, operator: '<=' }
  ];
  if (thresholds.maxP95Ms !== null) checks.push({ name: 'p95-ms', passed: metrics.latencyMs.p95 <= thresholds.maxP95Ms, observed: metrics.latencyMs.p95, threshold: thresholds.maxP95Ms, operator: '<=' });
  if (thresholds.maxP99Ms !== null) checks.push({ name: 'p99-ms', passed: metrics.latencyMs.p99 <= thresholds.maxP99Ms, observed: metrics.latencyMs.p99, threshold: thresholds.maxP99Ms, operator: '<=' });
  if (thresholds.minRps !== null) checks.push({ name: 'rps', passed: metrics.rps >= thresholds.minRps, observed: metrics.rps, threshold: thresholds.minRps, operator: '>=' });
  return checks;
}

export async function runLoadLab(rawScenario) {
  const scenario = rawScenario?.contract === NATIVE_LOAD_LAB_CONTRACT ? rawScenario : normalizeLoadScenario(rawScenario);
  const target = await resolvePrivateTarget(new URL(scenario.url));
  const started = process.hrtime.bigint();
  const deadline = Date.now() + scenario.maxDurationMs;
  const results = new Array(scenario.requests);
  let cursor = 0;
  let deadlineExceeded = false;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= scenario.requests) return;
      if (Date.now() >= deadline) {
        deadlineExceeded = true;
        results[index] = { ok: false, statusCode: null, errorCode: 'LOAD_LAB_DURATION_EXCEEDED', responseBytes: 0, elapsedMs: 0 };
        continue;
      }
      results[index] = await requestOnce(scenario, target);
    }
  }

  await Promise.all(Array.from({ length: scenario.concurrency }, () => worker()));
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  const completed = results.filter(Boolean);
  const latencies = completed.map((item) => item.elapsedMs).sort((a, b) => a - b);
  const errors = completed.filter((item) => !item.ok);
  const statusCounts = {};
  const errorCounts = {};
  let responseBytes = 0;
  for (const item of completed) {
    responseBytes += item.responseBytes || 0;
    if (item.statusCode !== null) statusCounts[item.statusCode] = (statusCounts[item.statusCode] || 0) + 1;
    if (item.errorCode) errorCounts[item.errorCode] = (errorCounts[item.errorCode] || 0) + 1;
  }
  const metrics = {
    requested: scenario.requests,
    completed: completed.length,
    concurrency: scenario.concurrency,
    durationMs: round(durationMs),
    rps: durationMs > 0 ? round(completed.length / (durationMs / 1000)) : 0,
    errors: errors.length,
    errorRate: completed.length ? round(errors.length / completed.length, 6) : 1,
    responseBytes,
    latencyMs: {
      min: round(latencies[0] || 0),
      p50: round(percentile(latencies, 0.50)),
      p95: round(percentile(latencies, 0.95)),
      p99: round(percentile(latencies, 0.99)),
      max: round(latencies[latencies.length - 1] || 0)
    },
    statusCounts,
    errorCounts
  };
  const checks = evaluateThresholds(metrics, scenario.thresholds);
  if (deadlineExceeded) checks.push({ name: 'max-duration', passed: false, observed: metrics.durationMs, threshold: scenario.maxDurationMs, operator: '<=' });
  return {
    contract: NATIVE_LOAD_LAB_CONTRACT,
    passed: checks.every((check) => check.passed),
    target: { protocol: new URL(scenario.url).protocol, host: new URL(scenario.url).hostname, port: new URL(scenario.url).port || null, path: `${new URL(scenario.url).pathname}${new URL(scenario.url).search}` },
    metrics,
    checks
  };
}

function normalizeRelativePath(value, label) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0') || path.isAbsolute(value)) throw codedError(`${label} must be a bounded relative path`, 'LOAD_LAB_PATH_INVALID');
  const normalized = path.normalize(value);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw codedError(`${label} escapes root`, 'LOAD_LAB_PATH_INVALID');
  return normalized;
}

async function loadScenarioFile(rootDir, relativePath) {
  const root = await fs.realpath(path.resolve(rootDir));
  const safe = normalizeRelativePath(relativePath, 'Scenario path');
  const target = await fs.realpath(path.resolve(root, safe));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw codedError('Scenario path escapes root', 'LOAD_LAB_PATH_ESCAPE');
  const stat = await fs.stat(target);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw codedError('Scenario file is invalid or too large', 'LOAD_LAB_SCENARIO_INVALID');
  let parsed;
  try { parsed = JSON.parse(await fs.readFile(target, 'utf8')); }
  catch { throw codedError('Scenario JSON is invalid', 'LOAD_LAB_SCENARIO_INVALID'); }
  return normalizeLoadScenario(parsed);
}

function usage() {
  return `Veteran Native Load Lab\n\nUsage:\n  node src/native-load-lab.mjs run <scenario.json> [--root <directory>]\n\nLocal/private development targets only. Public, link-local, metadata, multicast, and carrier-grade targets are not permitted.\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || 'help';
  if (['help', '--help', '-h'].includes(command)) { process.stdout.write(usage()); return 0; }
  if (command !== 'run') throw codedError(`Unknown Load Lab command: ${command}`, 'LOAD_LAB_COMMAND_UNKNOWN');
  const scenarioPath = argv[1];
  if (!scenarioPath || scenarioPath.startsWith('-')) throw codedError('run requires a scenario JSON path', 'LOAD_LAB_ARGUMENT_REQUIRED');
  let rootDir = process.cwd();
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) throw codedError('--root requires a value', 'LOAD_LAB_ARGUMENT_REQUIRED');
      rootDir = value;
      index += 1;
    } else throw codedError(`Unknown Load Lab argument: ${arg}`, 'LOAD_LAB_ARGUMENT_UNKNOWN');
  }
  const scenario = await loadScenarioFile(rootDir, scenarioPath);
  const result = await runLoadLab(scenario);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.passed ? 0 : 2;
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error?.code || 'LOAD_LAB_ERROR'}: ${String(error?.message || error)}\n`);
    process.exitCode = 1;
  });
}
