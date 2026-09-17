import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { NATIVE_BROWSER_SCENARIO_CONTRACT } from '../src/browser-native-provider.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

const browserPath = process.env.VETERAN_TEST_BROWSER_PATH || null;

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>Veteran Full Stack Fixture</title></head>
<body>
  <div id="ready">ready</div>
  <input id="name" />
  <button id="save">Save</button>
  <div id="result">idle</div>
  <script>
    document.getElementById('save').addEventListener('click', async () => {
      const name = document.getElementById('name').value;
      const response = await fetch('/api/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name })
      });
      document.getElementById('result').textContent = await response.text();
    });
  </script>
</body></html>`;

const serverSource = `
const http = require('node:http');
const port = Number(process.argv[2]);
const page = ${JSON.stringify(pageHtml)};
http.createServer((req, res) => {
  if (req.url === '/health') { res.statusCode = 200; res.end('ok'); return; }
  if (req.url === '/' && req.method === 'GET') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(page); return; }
  if (req.url === '/api/save' && req.method === 'POST') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('saved:' + String(parsed.name || ''));
    });
    return;
  }
  res.statusCode = 404; res.end('missing');
}).listen(port, '127.0.0.1');
`;

function evidenceSummary(evidence) { return JSON.parse(evidence.summary); }

test('validation_run owns a real Chromium UI-to-API full-stack proof with screenshot evidence', { skip: !browserPath, timeout: 120_000 }, async () => {
  assert.doesNotThrow(() => new Function(serverSource));
  assert.equal(path.isAbsolute(browserPath), true);
  const port = await freePort();
  const scenario = {
    contract: NATIVE_BROWSER_SCENARIO_CONTRACT,
    steps: [
      { action: 'assertText', selector: '#ready', text: 'ready', match: 'equals' },
      { action: 'fill', selector: '#name', value: 'Ada' },
      { action: 'click', selector: '#save' },
      { action: 'assertText', selector: '#result', text: 'saved:Ada', match: 'equals', timeoutMs: 10_000 },
      { action: 'screenshot', filename: 'fullstack.png' }
    ]
  };
  const { root, repo, stateRoot } = await createGitRepo({ files: {
    'server.cjs': serverSource,
    'tests/browser/smoke.json': `${JSON.stringify(scenario, null, 2)}\n`
  } });
  try {
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({
      defaults: {
        validationCapabilities: [{
          name: 'native-browser-fullstack',
          service: {
            command: [process.execPath, 'server.cjs', String(port)],
            readiness: { url: `http://127.0.0.1:${port}/health`, timeoutMs: 10_000, intervalMs: 50 }
          },
          browser: {
            native: { executablePath: browserPath },
            scenarioFile: 'tests/browser/smoke.json',
            timeoutMs: 45_000
          },
          artifacts: [{ path: '.veteran-browser-artifacts', required: true, kind: 'browser-screenshot' }]
        }]
      }
    }, null, 2)}\n`);

    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const result = await app.services.validationService.run({ projectId: project.id, capability: 'native-browser-fullstack' });
    assert.equal(result.passed, true, JSON.stringify(result, null, 2));
    assert.equal(result.failureStage, null);
    assert.equal(result.browser.contract, 'veteran-browser-validation-v1');
    assert.equal(result.browser.assertions.length, 2);
    assert.equal(result.browser.assertions.every((item) => item.passed), true);
    assert.equal(result.browser.providerDiagnostics?.pageErrors, 0);
    assert.equal(result.browser.providerDiagnostics?.blockedExternalRequests, 0);

    const [evidence] = await app.services.evidenceService.query({ ids: [result.evidenceId] });
    const summary = evidenceSummary(evidence);
    assert.equal(summary.browser.passed, true);
    assert.equal(summary.failureStage, null);
    const screenshot = evidence.attachments.find((item) => item.name === '.veteran-browser-artifacts/fullstack.png' && item.kind === 'browser-screenshot');
    assert.ok(screenshot);
    const png = await fs.readFile(path.join(stateRoot, screenshot.artifactPointer));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.toString('ascii', 12, 16), 'IHDR');
    assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0);
    assert.equal(png.length, screenshot.bytes);
    assert.equal(createHash('sha256').update(png).digest('hex'), screenshot.artifactHash);
    assert.ok(evidence.attachments.every((item) => item.bytes > 0 && item.artifactHash));

    // Export only this synthetic fixture's verified PNG, never a user's state
    // directory or arbitrary provider output. Retain it for visual inspection.
    if (process.env.VETERAN_TEST_EVIDENCE_DIR) {
      const output = process.env.VETERAN_TEST_EVIDENCE_DIR;
      assert.equal(path.isAbsolute(output), true);
      await fs.mkdir(output, { recursive: true });
      await fs.writeFile(path.join(output, 'fullstack.png'), png, { mode: 0o600 });
      await fs.writeFile(path.join(output, 'proof.json'), JSON.stringify({
        platform: process.platform, node: process.version,
        runtimeCommit: process.env.GITHUB_SHA || null,
        fixtureCommit: result.commitSha, evidenceId: result.evidenceId,
        passed: result.passed, assertions: result.browser.assertions,
        screenshot: { name: 'fullstack.png', bytes: png.length, sha256: screenshot.artifactHash,
          width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
      }, null, 2) + '\n', { mode: 0o600 });
    }
  } finally {
    await cleanup(root);
  }
});
