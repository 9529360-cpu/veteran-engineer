import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizeLoadScenario, runLoadLab } from '../src/native-load-lab.mjs';

function listen(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function close(server) { return new Promise((resolve) => server.close(resolve)); }

test('runs bounded concurrent load against localhost and reports latency/rps without bodies', async () => {
  const server = await listen((_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); });
  try {
    const port = server.address().port;
    const result = await runLoadLab({
      url: `http://127.0.0.1:${port}/health?x=1`, requests: 24, concurrency: 4,
      thresholds: { maxErrorRate: 0, maxP95Ms: 1000, minRps: 1 }
    });
    assert.equal(result.passed, true, JSON.stringify(result));
    assert.equal(result.metrics.completed, 24);
    assert.equal(result.metrics.errors, 0);
    assert.equal(result.metrics.statusCounts['200'], 24);
    assert.ok(result.metrics.rps > 0);
    assert.ok(result.metrics.latencyMs.p95 >= 0);
    assert.equal(JSON.stringify(result).includes('ok'), false);
  } finally { await close(server); }
});

test('fails declarative error-rate thresholds on HTTP errors', async () => {
  let calls = 0;
  const server = await listen((_req, res) => { calls += 1; res.statusCode = calls % 2 === 0 ? 500 : 200; res.end('x'); });
  try {
    const port = server.address().port;
    const result = await runLoadLab({ url: `http://localhost:${port}/`, requests: 10, concurrency: 2, thresholds: { maxErrorRate: 0 } });
    assert.equal(result.passed, false);
    assert.equal(result.metrics.errors, 5);
    assert.equal(result.checks.find((item) => item.name === 'error-rate').passed, false);
  } finally { await close(server); }
});

test('pins DNS/private policy and rejects public and metadata targets before requests', async () => {
  await assert.rejects(() => runLoadLab({ url: 'http://8.8.8.8/', requests: 1 }), (error) => error.code === 'LOAD_LAB_TARGET_FORBIDDEN');
  await assert.rejects(() => runLoadLab({ url: 'http://169.254.169.254/latest/meta-data', requests: 1 }), (error) => error.code === 'LOAD_LAB_TARGET_FORBIDDEN');
  await assert.rejects(() => runLoadLab({ url: 'http://100.64.0.1/', requests: 1 }), (error) => error.code === 'LOAD_LAB_TARGET_FORBIDDEN');
  await assert.rejects(() => runLoadLab({ url: 'http://224.0.0.1/', requests: 1 }), (error) => error.code === 'LOAD_LAB_TARGET_FORBIDDEN');
});

test('rejects excessive concurrency, request counts, URL credentials, and hop-by-hop headers', () => {
  assert.throws(() => normalizeLoadScenario({ url: 'http://127.0.0.1/', requests: 5001 }), (error) => error.code === 'LOAD_LAB_REQUESTS_INVALID');
  assert.throws(() => normalizeLoadScenario({ url: 'http://127.0.0.1/', requests: 100, concurrency: 65 }), (error) => error.code === 'LOAD_LAB_CONCURRENCY_INVALID');
  assert.throws(() => normalizeLoadScenario({ url: 'http://user:pass@127.0.0.1/' }), (error) => error.code === 'LOAD_LAB_URL_CREDENTIALS_FORBIDDEN');
  assert.throws(() => normalizeLoadScenario({ url: 'http://127.0.0.1/', headers: { Host: 'evil.example' } }), (error) => error.code === 'LOAD_LAB_HEADERS_INVALID');
});

test('supports bounded POST bodies without echoing request headers/body in results', async () => {
  let observed = '';
  const server = await listen((req, res) => { req.setEncoding('utf8'); req.on('data', (chunk) => { observed += chunk; }); req.on('end', () => { res.statusCode = 201; res.end('created'); }); });
  try {
    const port = server.address().port;
    const secretBody = 'payload-with-sensitive-local-fixture';
    const result = await runLoadLab({
      url: `http://127.0.0.1:${port}/items`, method: 'POST', requests: 2, concurrency: 1,
      body: secretBody, headers: { 'content-type': 'text/plain', authorization: 'Bearer local-fixture-secret' },
      successStatusMin: 200, successStatusMax: 299
    });
    assert.equal(result.passed, true);
    assert.equal(observed, secretBody.repeat(2));
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(secretBody), false);
    assert.equal(serialized.includes('local-fixture-secret'), false);
  } finally { await close(server); }
});

test('scenario files cannot escape the declared root through parent traversal or symlinks', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-load-root-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-load-outside-'));
  try {
    await fs.writeFile(path.join(outside, 'scenario.json'), JSON.stringify({ url: 'http://127.0.0.1/', requests: 1 }));
    const module = await import('../src/native-load-lab.mjs');
    await assert.rejects(() => module.main(['run', '../outside/scenario.json', '--root', root]), (error) => error.code === 'LOAD_LAB_PATH_INVALID');
    try { await fs.symlink(outside, path.join(root, 'link')); }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('symlink creation unavailable'); return; }
      throw error;
    }
    await assert.rejects(() => module.main(['run', 'link/scenario.json', '--root', root]), (error) => error.code === 'LOAD_LAB_PATH_ESCAPE');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});
