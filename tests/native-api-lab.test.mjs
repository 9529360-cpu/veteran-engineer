import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { runApiLab, normalizeApiLabSpec } from '../src/native-api-lab.mjs';

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function address(server) {
  const info = server.address();
  return `http://127.0.0.1:${info.port}`;
}

test('API Lab blocks loopback targets unless explicitly authorized', async () => {
  const server = await listen((req, res) => { res.end('ok'); });
  try {
    await assert.rejects(() => runApiLab({ baseUrl: address(server), steps: [{ id: 'one', path: '/' }] }), (error) => error.code === 'API_LAB_PRIVATE_NETWORK_BLOCKED');
  } finally { server.close(); }
});


test('API Lab never authorizes link-local metadata targets through the private-network flag', async () => {
  await assert.rejects(
    () => runApiLab({ baseUrl: 'http://169.254.169.254', steps: [{ id: 'metadata', path: '/latest/meta-data/' }] }, { allowPrivateNetwork: true }),
    (error) => error.code === 'API_LAB_PRIVATE_NETWORK_BLOCKED'
  );
});

test('API Lab keeps mapped metadata and carrier-grade ranges forbidden in private mode', async () => {
  await assert.rejects(
    () => runApiLab({ baseUrl: 'http://[::ffff:169.254.169.254]', steps: [{ id: 'mapped-metadata', path: '/' }] }, { allowPrivateNetwork: true }),
    (error) => error.code === 'API_LAB_PRIVATE_NETWORK_BLOCKED'
  );
  await assert.rejects(
    () => runApiLab({ baseUrl: 'http://100.100.100.200', steps: [{ id: 'carrier-grade', path: '/' }] }, { allowPrivateNetwork: true }),
    (error) => error.code === 'API_LAB_PRIVATE_NETWORK_BLOCKED'
  );
});

test('API Lab runs sequential assertions and captures without exposing secret variables', async () => {
  const server = await listen((req, res) => {
    if (req.url === '/login') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        assert.equal(parsed.token, 'secret-from-env');
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ session: 'session-123', userId: '42', ok: true }));
      });
      return;
    }
    if (req.url === '/users/42') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 42, name: 'Ada' }));
      return;
    }
    res.statusCode = 404;
    res.end('missing');
  });
  try {
    const report = await runApiLab({
      name: 'auth flow',
      baseUrl: address(server),
      secrets: { apiToken: 'API_TOKEN' },
      steps: [
        {
          id: 'login', method: 'POST', path: '/login', json: { token: '{{apiToken}}' },
          assertions: [{ type: 'status', equals: 200 }, { type: 'json-equals', path: 'ok', value: true }],
          capture: [{ name: 'session', path: 'session', secret: true }, { name: 'userId', path: 'userId' }]
        },
        {
          id: 'profile', path: '/users/{{userId}}',
          assertions: [{ type: 'status', oneOf: [200, 201] }, { type: 'header', name: 'content-type', contains: 'application/json' }, { type: 'json-equals', path: 'id', value: 42 }, { type: 'json-exists', path: 'name' }]
        }
      ]
    }, { allowPrivateNetwork: true, environment: { API_TOKEN: 'secret-from-env' } });
    assert.equal(report.ok, true);
    assert.equal(report.completedSteps, 2);
    assert.equal(report.variables.apiToken, '[redacted]');
    assert.equal(report.variables.session, '[redacted]');
    assert.equal(report.steps[0].captures[0].value, '[redacted]');
    assert.equal(Object.hasOwn(report.steps[0].response, 'bodyPreview'), false);
  } finally { server.close(); }
});

test('API Lab rejects base URLs with query or fragment data', () => {
  assert.throws(() => normalizeApiLabSpec({ baseUrl: 'https://example.com?token=leaky', steps: [{ id: 'one', path: '/' }] }), (error) => error.code === 'API_LAB_BASE_URL_INVALID');
});

test('API Lab refuses secret interpolation into URLs and cross-origin steps', async () => {
  const spec = normalizeApiLabSpec({ baseUrl: 'https://example.com', secrets: { token: 'TOKEN' }, steps: [{ id: 'one', path: '/v1/{{token}}' }] });
  await assert.rejects(() => runApiLab(spec, { environment: { TOKEN: 'secret' } }), (error) => error.code === 'API_LAB_SECRET_IN_URL');

  await assert.rejects(() => runApiLab({ baseUrl: 'https://example.com', steps: [{ id: 'one', path: 'https://example.org/' }] }), (error) => error.code === 'API_LAB_CROSS_ORIGIN_BLOCKED');
});

test('API Lab reports failed assertions and stops by default', async () => {
  const server = await listen((req, res) => { res.statusCode = 418; res.end('teapot'); });
  try {
    const report = await runApiLab({ baseUrl: address(server), steps: [
      { id: 'first', path: '/', assertions: [{ type: 'status', equals: 200 }, { type: 'body-contains', value: 'tea' }] },
      { id: 'second', path: '/' }
    ] }, { allowPrivateNetwork: true });
    assert.equal(report.ok, false);
    assert.equal(report.stoppedEarly, true);
    assert.equal(report.completedSteps, 1);
    assert.equal(report.steps[0].assertions[0].ok, false);
    assert.equal(report.steps[0].assertions[1].ok, true);
  } finally { server.close(); }
});
