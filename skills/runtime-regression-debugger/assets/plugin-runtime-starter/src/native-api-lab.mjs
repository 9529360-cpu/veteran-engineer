#!/usr/bin/env node
import dns from 'node:dns';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const NATIVE_API_LAB_CONTRACT = 'veteran-native-api-lab-v1';

const MAX_STEPS = 64;
const MAX_ASSERTIONS = 32;
const MAX_CAPTURES = 32;
const MAX_VARIABLES = 64;
const MAX_HEADERS = 64;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_RESPONSE_BYTES = 1024 * 1024;
const MAX_TIMEOUT_MS = 120_000;
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const SENSITIVE_RESPONSE_HEADERS = new Set(['set-cookie', 'proxy-authenticate', 'authorization']);

function codedError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function text(value, fallback = '', max = 4000) {
  const result = value === undefined || value === null ? fallback : String(value).trim();
  if (result.length > max) throw codedError(`API Lab text exceeds ${max} characters`, 'API_LAB_TEXT_TOO_LONG');
  return result;
}

function boundedArray(value, label, max) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw codedError(`${label} must be an array`, 'API_LAB_SPEC_INVALID', { label });
  if (value.length > max) throw codedError(`${label} exceeds ${max} items`, 'API_LAB_SPEC_INVALID', { label, max });
  return value;
}

function boundedObject(value, label, max = MAX_VARIABLES) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw codedError(`${label} must be an object`, 'API_LAB_SPEC_INVALID', { label });
  const entries = Object.entries(value);
  if (entries.length > max) throw codedError(`${label} exceeds ${max} entries`, 'API_LAB_SPEC_INVALID', { label, max });
  return Object.fromEntries(entries);
}

function variableName(value, label) {
  const name = text(value, '', 80);
  if (!VARIABLE_NAME.test(name)) throw codedError(`${label} must be a safe variable name`, 'API_LAB_VARIABLE_INVALID', { label, name });
  return name;
}

function normalizeVariables(raw = {}) {
  const source = boundedObject(raw, 'variables');
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    variableName(key, `variables.${key}`);
    if (value !== null && typeof value === 'object') throw codedError(`variables.${key} must be scalar`, 'API_LAB_VARIABLE_INVALID', { key });
    out[key] = value === null ? '' : String(value);
  }
  return out;
}

function normalizeSecrets(raw = {}) {
  const source = boundedObject(raw, 'secrets');
  const out = {};
  for (const [variable, envNameRaw] of Object.entries(source)) {
    variableName(variable, `secrets.${variable}`);
    const envName = variableName(envNameRaw, `secrets.${variable}`);
    out[variable] = envName;
  }
  return out;
}

function templateNames(value) {
  const names = [];
  for (const match of String(value).matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)) names.push(match[1]);
  return [...new Set(names)];
}

function renderTemplate(value, variables, secretNames, { allowSecrets = true, label = 'template' } = {}) {
  const source = String(value);
  const refs = templateNames(source);
  for (const name of refs) {
    if (!Object.hasOwn(variables, name)) throw codedError(`Unknown API Lab variable ${name}`, 'API_LAB_VARIABLE_MISSING', { label, name });
    if (!allowSecrets && secretNames.has(name)) throw codedError(`Secret variable ${name} cannot be used in ${label}`, 'API_LAB_SECRET_IN_URL', { label, name });
  }
  return source.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_, name) => String(variables[name]));
}

function normalizeHeaders(raw = {}) {
  const source = boundedObject(raw, 'headers', MAX_HEADERS);
  const out = {};
  for (const [nameRaw, value] of Object.entries(source)) {
    const name = text(nameRaw, '', 120);
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw codedError(`Invalid HTTP header name: ${name}`, 'API_LAB_HEADER_INVALID', { name });
    if (Array.isArray(value) || (value !== null && typeof value === 'object')) throw codedError(`HTTP header ${name} must be scalar`, 'API_LAB_HEADER_INVALID', { name });
    out[name] = value === null ? '' : String(value);
  }
  return out;
}

function normalizeAssertion(raw, stepId, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw codedError(`${stepId}.assertions[${index}] must be an object`, 'API_LAB_ASSERTION_INVALID');
  const type = text(raw.type, '', 80);
  const base = { type };
  if (type === 'status') {
    const expected = raw.equals ?? raw.oneOf;
    if (Number.isInteger(expected)) return { ...base, equals: expected };
    if (Array.isArray(expected) && expected.length && expected.length <= 32 && expected.every(Number.isInteger)) return { ...base, oneOf: [...new Set(expected)] };
  } else if (type === 'header') {
    const name = text(raw.name, '', 120).toLowerCase();
    if (!name) throw codedError(`${stepId}.assertions[${index}] header requires name`, 'API_LAB_ASSERTION_INVALID');
    if (raw.exists === true) return { ...base, name, exists: true };
    if (raw.equals !== undefined) return { ...base, name, equals: String(raw.equals) };
    if (raw.contains !== undefined) return { ...base, name, contains: String(raw.contains) };
  } else if (type === 'body-contains') {
    return { ...base, value: text(raw.value, '', 4000) };
  } else if (type === 'json-equals') {
    return { ...base, path: text(raw.path, '', 500), value: raw.value };
  } else if (type === 'json-exists') {
    return { ...base, path: text(raw.path, '', 500) };
  } else if (type === 'duration-under') {
    if (Number.isFinite(raw.ms) && raw.ms >= 0 && raw.ms <= MAX_TIMEOUT_MS) return { ...base, ms: Number(raw.ms) };
  }
  throw codedError(`${stepId}.assertions[${index}] is invalid or unsupported`, 'API_LAB_ASSERTION_INVALID', { type });
}

function normalizeCapture(raw, stepId, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw codedError(`${stepId}.capture[${index}] must be an object`, 'API_LAB_CAPTURE_INVALID');
  return {
    name: variableName(raw.name, `${stepId}.capture[${index}].name`),
    path: text(raw.path, '', 500),
    secret: raw.secret === true
  };
}

function normalizeStep(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw codedError(`steps[${index}] must be an object`, 'API_LAB_STEP_INVALID');
  const id = text(raw.id, `step-${index + 1}`, 120).replace(/[^A-Za-z0-9_.-]+/g, '-');
  const method = text(raw.method, 'GET', 16).toUpperCase();
  if (!METHODS.has(method)) throw codedError(`Unsupported HTTP method ${method}`, 'API_LAB_METHOD_UNSUPPORTED', { id, method });
  if (raw.json !== undefined && raw.body !== undefined) throw codedError(`${id} cannot define both json and body`, 'API_LAB_BODY_AMBIGUOUS', { id });
  const assertions = boundedArray(raw.assertions, `${id}.assertions`, MAX_ASSERTIONS).map((item, assertionIndex) => normalizeAssertion(item, id, assertionIndex));
  const capture = boundedArray(raw.capture, `${id}.capture`, MAX_CAPTURES).map((item, captureIndex) => normalizeCapture(item, id, captureIndex));
  const timeoutMs = raw.timeoutMs === undefined ? 20_000 : Number(raw.timeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) throw codedError(`${id}.timeoutMs must be within 1..${MAX_TIMEOUT_MS}`, 'API_LAB_TIMEOUT_INVALID');
  return {
    id,
    method,
    path: text(raw.path, '/', 2048),
    query: boundedObject(raw.query, `${id}.query`, 64),
    headers: normalizeHeaders(raw.headers),
    json: raw.json,
    body: raw.body === undefined ? undefined : String(raw.body),
    timeoutMs,
    assertions,
    capture
  };
}

export function normalizeApiLabSpec(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw codedError('API Lab spec must be an object', 'API_LAB_SPEC_INVALID');
  const baseUrl = text(raw.baseUrl, '', 2048);
  if (!baseUrl) throw codedError('API Lab spec requires baseUrl', 'API_LAB_BASE_URL_REQUIRED');
  const parsed = new URL(baseUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw codedError('API Lab supports only http/https baseUrl', 'API_LAB_PROTOCOL_UNSUPPORTED', { protocol: parsed.protocol });
  if (parsed.username || parsed.password) throw codedError('Credentials in baseUrl are not allowed', 'API_LAB_URL_CREDENTIALS_FORBIDDEN');
  if (parsed.search || parsed.hash) throw codedError('API Lab baseUrl cannot contain query or fragment data', 'API_LAB_BASE_URL_INVALID');
  const steps = boundedArray(raw.steps, 'steps', MAX_STEPS).map(normalizeStep);
  if (!steps.length) throw codedError('API Lab spec requires at least one step', 'API_LAB_STEPS_REQUIRED');
  const ids = new Set();
  for (const step of steps) {
    if (ids.has(step.id)) throw codedError(`Duplicate API Lab step id ${step.id}`, 'API_LAB_STEP_DUPLICATE', { id: step.id });
    ids.add(step.id);
  }
  const maxResponseBytes = raw.maxResponseBytes === undefined ? DEFAULT_RESPONSE_BYTES : Number(raw.maxResponseBytes);
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > MAX_RESPONSE_BYTES) throw codedError(`maxResponseBytes must be within 1..${MAX_RESPONSE_BYTES}`, 'API_LAB_RESPONSE_LIMIT_INVALID');
  return {
    contract: NATIVE_API_LAB_CONTRACT,
    name: text(raw.name, 'api-scenario', 160),
    baseUrl: parsed.toString(),
    variables: normalizeVariables(raw.variables),
    secrets: normalizeSecrets(raw.secrets),
    stopOnFailure: raw.stopOnFailure !== false,
    maxResponseBytes,
    steps
  };
}

function ipv4Scope(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return 'forbidden';
  const [a, b, c] = parts;
  if (a === 0 || a >= 224) return 'forbidden';
  if (a === 169 && b === 254) return 'forbidden';
  if (a === 100 && b >= 64 && b <= 127) return 'forbidden';
  if (a === 198 && (b === 18 || b === 19)) return 'forbidden';
  if (a === 192 && b === 0 && c === 0) return 'forbidden';
  if (a === 127) return 'private';
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private';
  return 'public';
}

function mappedIpv4(normalized) {
  if (!normalized.startsWith('::ffff:')) return null;
  const tail = normalized.slice('::ffff:'.length);
  if (net.isIP(tail) === 4) return tail;
  const parts = tail.split(':');
  if (parts.length !== 2 || parts.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
  const high = Number.parseInt(parts[0], 16);
  const low = Number.parseInt(parts[1], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function ipv6Scope(address) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  const mapped = mappedIpv4(normalized);
  if (mapped) return ipv4Scope(mapped);
  if (normalized === '::') return 'forbidden';
  if (normalized === '::1') return 'private';
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return 'forbidden';
  if (normalized.startsWith('ff')) return 'forbidden';
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return 'private';
  return 'public';
}

function addressScope(address) {
  const normalized = String(address).replace(/^\[|\]$/g, '');
  const family = net.isIP(normalized);
  return family === 4 ? ipv4Scope(normalized) : family === 6 ? ipv6Scope(normalized) : 'forbidden';
}

function assertAddressAllowed(address, allowPrivateNetwork, hostname) {
  const scope = addressScope(address);
  if (scope === 'forbidden' || (scope === 'private' && !allowPrivateNetwork)) {
    throw codedError(`API Lab blocked non-public address for ${hostname}`, 'API_LAB_PRIVATE_NETWORK_BLOCKED', { hostname, address, scope });
  }
}

function guardedLookup(allowPrivateNetwork) {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error);
      if (!Array.isArray(addresses) || addresses.length === 0) return callback(codedError(`No addresses resolved for ${hostname}`, 'API_LAB_DNS_EMPTY', { hostname }));
      try {
        for (const item of addresses) assertAddressAllowed(item.address, allowPrivateNetwork, hostname);
      } catch (policyError) {
        return callback(policyError);
      }
      if (options?.all) return callback(null, addresses);
      return callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

async function assertUrlAllowed(url, { allowPrivateNetwork }) {
  if (!['http:', 'https:'].includes(url.protocol)) throw codedError('API Lab supports only http/https requests', 'API_LAB_PROTOCOL_UNSUPPORTED', { protocol: url.protocol });
  if (url.username || url.password) throw codedError('Credentials in request URLs are not allowed', 'API_LAB_URL_CREDENTIALS_FORBIDDEN');
  const literalHost = url.hostname.replace(/^\[|\]$/g, '');
  const literalFamily = net.isIP(literalHost);
  if (literalFamily) assertAddressAllowed(literalHost, allowPrivateNetwork, url.hostname);
  if (!literalFamily && !allowPrivateNetwork && url.hostname.toLowerCase() === 'localhost') throw codedError('API Lab blocked localhost', 'API_LAB_PRIVATE_NETWORK_BLOCKED', { hostname: url.hostname });
}

function scalarQuery(value, label) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') throw codedError(`${label} query value must be scalar`, 'API_LAB_QUERY_INVALID', { label });
  return String(value);
}

function buildStepUrl(baseUrl, step, variables, secretNames) {
  const renderedPath = renderTemplate(step.path, variables, secretNames, { allowSecrets: false, label: `${step.id}.path` });
  const candidate = new URL(renderedPath, baseUrl);
  const origin = new URL(baseUrl).origin;
  if (candidate.origin !== origin) throw codedError(`${step.id} cannot leave baseUrl origin`, 'API_LAB_CROSS_ORIGIN_BLOCKED', { id: step.id, origin: candidate.origin, expectedOrigin: origin });
  for (const [name, rawValue] of Object.entries(step.query)) {
    const raw = scalarQuery(rawValue, `${step.id}.query.${name}`);
    const value = renderTemplate(raw, variables, secretNames, { allowSecrets: false, label: `${step.id}.query.${name}` });
    candidate.searchParams.set(name, value);
  }
  return candidate;
}

function renderJson(value, variables, secretNames, label) {
  if (typeof value === 'string') return renderTemplate(value, variables, secretNames, { allowSecrets: true, label });
  if (Array.isArray(value)) return value.map((item, index) => renderJson(item, variables, secretNames, `${label}[${index}]`));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, renderJson(child, variables, secretNames, `${label}.${key}`)]));
  return value;
}

function renderedHeaders(step, variables, secretNames) {
  const headers = { 'accept-encoding': 'identity' };
  for (const [name, rawValue] of Object.entries(step.headers)) headers[name] = renderTemplate(rawValue, variables, secretNames, { allowSecrets: true, label: `${step.id}.headers.${name}` });
  return headers;
}

function requestBody(step, variables, secretNames, headers) {
  if (step.json !== undefined) {
    const body = JSON.stringify(renderJson(step.json, variables, secretNames, `${step.id}.json`));
    if (!Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(body));
    return body;
  }
  if (step.body !== undefined) {
    const body = renderTemplate(step.body, variables, secretNames, { allowSecrets: true, label: `${step.id}.body` });
    headers['content-length'] = String(Buffer.byteLength(body));
    return body;
  }
  return null;
}

function safeResponseHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers || {})) out[name] = SENSITIVE_RESPONSE_HEADERS.has(name.toLowerCase()) ? '[redacted]' : value;
  return out;
}

function performRequest(url, { method, headers, body, timeoutMs, maxResponseBytes, allowPrivateNetwork }) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    let settled = false;
    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const request = transport.request(url, {
      method,
      headers,
      lookup: guardedLookup(allowPrivateNetwork)
    }, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxResponseBytes) {
          request.destroy(codedError(`API Lab response exceeded ${maxResponseBytes} bytes`, 'API_LAB_RESPONSE_TOO_LARGE', { maxResponseBytes }));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (settled) return;
        settled = true;
        resolve({ status: response.statusCode || 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8'), bytes });
      });
      response.on('error', finishReject);
    });
    request.setTimeout(timeoutMs, () => request.destroy(codedError(`API Lab request timed out after ${timeoutMs}ms`, 'API_LAB_TIMEOUT', { timeoutMs })));
    request.on('error', finishReject);
    if (body !== null) request.write(body);
    request.end();
  });
}

function parseJsonBody(body, stepId) {
  try { return JSON.parse(body); } catch { throw codedError(`${stepId} response is not valid JSON`, 'API_LAB_RESPONSE_JSON_INVALID', { stepId }); }
}

function getDotPath(root, rawPath) {
  const pathText = text(rawPath, '', 500);
  if (!pathText) return { exists: true, value: root };
  const segments = pathText.split('.').filter(Boolean);
  let current = root;
  for (const segment of segments) {
    if (current === null || current === undefined || (typeof current !== 'object' && !Array.isArray(current)) || !Object.hasOwn(current, segment)) return { exists: false, value: undefined };
    current = current[segment];
  }
  return { exists: true, value: current };
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function evaluateAssertion(assertion, response, durationMs, jsonCache, stepId) {
  let ok = false;
  let actual;
  let expected;
  if (assertion.type === 'status') {
    actual = response.status;
    expected = assertion.equals ?? assertion.oneOf;
    ok = assertion.equals !== undefined ? actual === assertion.equals : assertion.oneOf.includes(actual);
  } else if (assertion.type === 'header') {
    actual = response.headers[assertion.name];
    if (Array.isArray(actual)) actual = actual.join(', ');
    if (assertion.exists) { expected = 'present'; ok = actual !== undefined; }
    else if (assertion.equals !== undefined) { expected = assertion.equals; ok = String(actual ?? '') === assertion.equals; }
    else { expected = `contains ${assertion.contains}`; ok = String(actual ?? '').includes(assertion.contains); }
  } else if (assertion.type === 'body-contains') {
    actual = response.body.includes(assertion.value);
    expected = true;
    ok = actual;
  } else if (assertion.type === 'duration-under') {
    actual = durationMs;
    expected = `< ${assertion.ms}ms`;
    ok = durationMs < assertion.ms;
  } else {
    if (!jsonCache.parsed) { jsonCache.value = parseJsonBody(response.body, stepId); jsonCache.parsed = true; }
    const resolved = getDotPath(jsonCache.value, assertion.path);
    actual = resolved.value;
    if (assertion.type === 'json-exists') { expected = 'present'; ok = resolved.exists; }
    else { expected = assertion.value; ok = resolved.exists && deepEqual(actual, expected); }
  }
  const safeActual = assertion.type === 'header' && SENSITIVE_RESPONSE_HEADERS.has(assertion.name) ? '[redacted]' : actual;
  const includeActual = !['json-equals', 'json-exists'].includes(assertion.type);
  return { type: assertion.type, ok, ...(assertion.path ? { path: assertion.path } : {}), ...(assertion.name ? { name: assertion.name } : {}), expected, ...(includeActual ? { actual: safeActual } : {}) };
}

function publicVariables(variables, secretNames) {
  return Object.fromEntries(Object.entries(variables).map(([name, value]) => [name, secretNames.has(name) ? '[redacted]' : value]));
}

function previewBody(body, includeBodyPreview) {
  if (!includeBodyPreview) return undefined;
  return body.length <= 4096 ? body : `${body.slice(0, 4095)}…`;
}

export async function runApiLab(rawSpec, { allowPrivateNetwork = false, includeBodyPreview = false, environment = process.env, now = () => new Date().toISOString() } = {}) {
  const spec = normalizeApiLabSpec(rawSpec);
  const variables = { ...spec.variables };
  const secretNames = new Set();
  for (const [name, envName] of Object.entries(spec.secrets)) {
    const value = environment?.[envName];
    if (typeof value !== 'string' || value.length === 0) throw codedError(`Required API Lab secret environment variable is unavailable: ${envName}`, 'API_LAB_SECRET_UNAVAILABLE', { variable: name, envName });
    variables[name] = value;
    secretNames.add(name);
  }
  if (Object.keys(variables).length > MAX_VARIABLES) throw codedError(`API Lab variables exceed ${MAX_VARIABLES}`, 'API_LAB_VARIABLE_LIMIT');
  const startedAt = now();
  const results = [];
  let stoppedEarly = false;
  for (const step of spec.steps) {
    const url = buildStepUrl(spec.baseUrl, step, variables, secretNames);
    await assertUrlAllowed(url, { allowPrivateNetwork });
    const headers = renderedHeaders(step, variables, secretNames);
    const body = requestBody(step, variables, secretNames, headers);
    const started = process.hrtime.bigint();
    let response;
    let requestError = null;
    try {
      response = await performRequest(url, { method: step.method, headers, body, timeoutMs: step.timeoutMs, maxResponseBytes: spec.maxResponseBytes, allowPrivateNetwork });
    } catch (error) {
      requestError = { code: error?.code || 'API_LAB_REQUEST_FAILED', message: String(error?.message || error).slice(0, 1000) };
    }
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    if (requestError) {
      results.push({ id: step.id, ok: false, request: { method: step.method, url: url.toString(), headerNames: Object.keys(headers).filter((name) => name.toLowerCase() !== 'authorization') }, error: requestError, durationMs });
      if (spec.stopOnFailure) { stoppedEarly = true; break; }
      continue;
    }
    const jsonCache = { parsed: false, value: null };
    const assertionResults = step.assertions.map((assertion) => {
      try { return evaluateAssertion(assertion, response, durationMs, jsonCache, step.id); }
      catch (error) { return { type: assertion.type, ok: false, code: error?.code || 'API_LAB_ASSERTION_ERROR', message: String(error?.message || error).slice(0, 1000) }; }
    });
    const captures = [];
    if (step.capture.length) {
      if (!jsonCache.parsed) { jsonCache.value = parseJsonBody(response.body, step.id); jsonCache.parsed = true; }
      for (const capture of step.capture) {
        const resolved = getDotPath(jsonCache.value, capture.path);
        if (!resolved.exists) throw codedError(`${step.id} capture path not found: ${capture.path}`, 'API_LAB_CAPTURE_MISSING', { stepId: step.id, name: capture.name, path: capture.path });
        if (resolved.value !== null && typeof resolved.value === 'object') throw codedError(`${step.id} capture ${capture.name} must resolve to a scalar`, 'API_LAB_CAPTURE_NON_SCALAR', { stepId: step.id, name: capture.name });
        variables[capture.name] = resolved.value === null ? '' : String(resolved.value);
        if (capture.secret) secretNames.add(capture.name); else secretNames.delete(capture.name);
        captures.push({ name: capture.name, path: capture.path, secret: capture.secret, value: capture.secret ? '[redacted]' : variables[capture.name] });
      }
    }
    const ok = assertionResults.every((item) => item.ok);
    results.push({
      id: step.id,
      ok,
      request: { method: step.method, url: url.toString(), headerNames: Object.keys(headers).filter((name) => name.toLowerCase() !== 'authorization') },
      response: { status: response.status, headers: safeResponseHeaders(response.headers), bytes: response.bytes, ...(includeBodyPreview ? { bodyPreview: previewBody(response.body, true) } : {}) },
      durationMs,
      assertions: assertionResults,
      captures
    });
    if (!ok && spec.stopOnFailure) { stoppedEarly = true; break; }
  }
  return {
    contract: NATIVE_API_LAB_CONTRACT,
    name: spec.name,
    baseUrl: spec.baseUrl,
    startedAt,
    finishedAt: now(),
    ok: results.length === spec.steps.length && results.every((item) => item.ok),
    stoppedEarly,
    completedSteps: results.length,
    totalSteps: spec.steps.length,
    variables: publicVariables(variables, secretNames),
    steps: results
  };
}

function usage() {
  return `Veteran Native API Lab\n\nUsage:\n  node src/native-api-lab.mjs run <scenario.json> [--allow-private-network] [--show-body] [--out <report.json>]\n\nRuns declarative HTTP scenarios with assertions and captures using Node.js built-ins only.\nPrivate/loopback targets are blocked unless --allow-private-network is explicitly supplied.\nSecrets may be referenced through the scenario's secrets map and are read from environment variables.\n`;
}

async function cli(argv) {
  const command = argv[0] || 'help';
  if (['help', '-h', '--help'].includes(command)) { process.stdout.write(usage()); return 0; }
  if (command !== 'run') throw codedError(`Unknown API Lab command: ${command}`, 'API_LAB_COMMAND_UNKNOWN');
  const specPath = argv[1];
  if (!specPath || specPath.startsWith('-')) throw codedError('API Lab run requires a scenario JSON file', 'API_LAB_SPEC_REQUIRED');
  let allowPrivateNetwork = false;
  let includeBodyPreview = false;
  let outPath = null;
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--allow-private-network') allowPrivateNetwork = true;
    else if (arg === '--show-body') includeBodyPreview = true;
    else if (arg === '--out') {
      outPath = argv[++index];
      if (!outPath || outPath.startsWith('-')) throw codedError('--out requires a path', 'API_LAB_ARGUMENT_VALUE_REQUIRED');
    } else throw codedError(`Unknown API Lab argument: ${arg}`, 'API_LAB_ARGUMENT_UNKNOWN');
  }
  const raw = JSON.parse(await fs.readFile(path.resolve(specPath), 'utf8'));
  const report = await runApiLab(raw, { allowPrivateNetwork, includeBodyPreview });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outPath) await fs.writeFile(path.resolve(outPath), serialized, 'utf8');
  process.stdout.write(serialized);
  return report.ok ? 0 : 1;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  cli(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error.code ? `[${error.code}] ` : ''}${error.message || String(error)}\n`);
    process.exitCode = 1;
  });
}
