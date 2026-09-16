import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { main, normalizeMockSpec, startMockLab } from '../src/native-mock-lab.mjs';

function request(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = http.request({ hostname: target.hostname, port: target.port, path: `${target.pathname}${target.search}`, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.once('error', reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

async function tempRoot(prefix = 'veteran-mock-lab-') { return fs.mkdtemp(path.join(os.tmpdir(), prefix)); }

test('serves exact local mock routes and reports counts without request body/header values', async () => {
  const secretHeader = 'local-fixture-secret';
  const secretBody = JSON.stringify({ event: 'created', token: 'body-secret-value' });
  const lab = await startMockLab({ maxRequests: 2, routes: [{
    id: 'webhook', method: 'POST', path: '/hook', minCalls: 1, maxCalls: 2,
    requiredHeaders: ['x-event-type'], requiredQueryKeys: ['source'], expectJson: { event: 'created' },
    response: { status: 202, json: { accepted: true } }
  }] });
  try {
    const res = await request(`${lab.url}/hook?source=test`, { method: 'POST', headers: { 'x-event-type': secretHeader, 'content-type': 'application/json' }, body: secretBody });
    assert.equal(res.status, 202);
    assert.equal(res.body, JSON.stringify({ accepted: true }));
    const report = await lab.close();
    assert.equal(report.passed, true);
    assert.equal(report.requests.matched, 1);
    assert.equal(report.routes[0].calls, 1);
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes(secretHeader), false);
    assert.equal(serialized.includes('body-secret-value'), false);
  } finally { await lab.close(); }
});

test('records declarative expectation failures without echoing mismatched bodies', async () => {
  const lab = await startMockLab({ routes: [{ id: 'event', method: 'POST', path: '/event', minCalls: 1, requiredHeaders: ['x-required'], expectJson: { type: 'expected' }, response: { status: 200 } }] });
  try {
    const body = JSON.stringify({ type: 'wrong', secret: 'never-report-this' });
    const res = await request(`${lab.url}/event`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(res.status, 200);
    const report = await lab.close();
    assert.equal(report.passed, false);
    assert.equal(report.routes[0].expectationFailures, 1);
    assert.equal(JSON.stringify(report).includes('never-report-this'), false);
  } finally { await lab.close(); }
});

test('unmatched requests are counted and server binds only to loopback', async () => {
  const lab = await startMockLab({ routes: [{ id: 'known', method: 'GET', path: '/known', response: { status: 204 } }] });
  try {
    assert.equal(lab.host, '127.0.0.1');
    const res = await request(`${lab.url}/unknown?token=secret-query-value`);
    assert.equal(res.status, 404);
    const report = await lab.close();
    assert.equal(report.passed, false);
    assert.equal(report.requests.unmatched, 1);
    assert.equal(JSON.stringify(report).includes('secret-query-value'), false);
  } finally { await lab.close(); }
});

test('rejects duplicate or dynamic route matchers and unsafe response headers', () => {
  assert.throws(() => normalizeMockSpec({ routes: [
    { id: 'one', method: 'GET', path: '/same' },
    { id: 'two', method: 'GET', path: '/same' }
  ] }), (error) => error.code === 'MOCK_LAB_ROUTE_DUPLICATE');
  assert.throws(() => normalizeMockSpec({ routes: [{ path: '/users/*' }] }), (error) => error.code === 'MOCK_LAB_ROUTE_INVALID');
  assert.throws(() => normalizeMockSpec({ routes: [{ path: '/x', response: { headers: { 'content-length': '999' } } }] }), (error) => error.code === 'MOCK_LAB_RESPONSE_INVALID');
});

test('enforces request/body/duration bounds', () => {
  assert.throws(() => normalizeMockSpec({ maxRequests: 1001, routes: [{ path: '/' }] }), (error) => error.code === 'MOCK_LAB_REQUEST_LIMIT_INVALID');
  assert.throws(() => normalizeMockSpec({ durationMs: 60001, routes: [{ path: '/' }] }), (error) => error.code === 'MOCK_LAB_DURATION_INVALID');
  assert.throws(() => normalizeMockSpec({ maxRequestBodyBytes: 1024 * 1024 + 1, routes: [{ path: '/' }] }), (error) => error.code === 'MOCK_LAB_BODY_LIMIT_INVALID');
});

test('oversized request bodies fail closed without retaining body content', async () => {
  const lab = await startMockLab({ maxRequestBodyBytes: 8, routes: [{ id: 'tiny', method: 'POST', path: '/tiny', response: { status: 200 } }] });
  try {
    const res = await request(`${lab.url}/tiny`, { method: 'POST', body: 'this-body-is-way-too-large-and-secret' });
    assert.equal(res.status, 413);
    const report = await lab.close();
    assert.equal(report.passed, false);
    assert.equal(report.requests.bodyTooLarge, 1);
    assert.equal(JSON.stringify(report).includes('way-too-large'), false);
  } finally { await lab.close(); }
});

test('scenario and report paths cannot escape root through traversal or symlinks', async (t) => {
  const root = await tempRoot();
  const outside = await tempRoot('veteran-mock-outside-');
  try {
    await fs.writeFile(path.join(outside, 'spec.json'), JSON.stringify({ durationMs: 100, routes: [{ path: '/' }] }));
    await assert.rejects(() => main(['serve', '../outside/spec.json', '--root', root]), (error) => error.code === 'MOCK_LAB_PATH_INVALID');
    try { await fs.symlink(outside, path.join(root, 'link')); }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('symlink creation unavailable'); return; }
      throw error;
    }
    await assert.rejects(() => main(['serve', 'link/spec.json', '--root', root]), (error) => error.code === 'MOCK_LAB_PATH_ESCAPE');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});
