import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { git } from '../src/git.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

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

async function configure(stateRoot, capability) {
  await fs.mkdir(stateRoot, { recursive: true });
  await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({ defaults: { validationCapabilities: [capability] } }, null, 2)}\n`);
}

const serverSource = `
const http = require('node:http');
const port = Number(process.argv[2]);
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, {'content-type':'text/plain'}); res.end('ok'); return; }
  if (req.url === '/') { res.writeHead(200, {'content-type':'text/html'}); res.end('<h1>Veteran Browser Fixture</h1>'); return; }
  res.writeHead(404); res.end('no');
});
server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`;

const providerSource = `
const fs = require('node:fs');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', async () => {
  const payload = JSON.parse(input);
  if (payload.contract !== 'veteran-browser-validation-v1') process.exit(31);
  if (process.env.VETERAN_BROWSER_SECRET_TEST) process.exit(32);
  if (process.env.VETERAN_BROWSER_ALLOWED_TEST !== 'allowed-value') process.exit(33);
  const scenario = JSON.parse(fs.readFileSync(payload.scenario.path, 'utf8'));
  const response = await fetch(payload.baseUrl);
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/login.png', Buffer.from('fake-png-evidence'));
  fs.writeFileSync('test-results/trace.zip', Buffer.from('fake-trace-evidence'));
  process.stdout.write(JSON.stringify({
    contract: 'veteran-browser-validation-v1',
    passed: response.status === 200 && scenario.flow === 'login',
    summary: 'login flow rendered',
    assertions: [
      { name: 'home responds', passed: response.status === 200, detail: String(response.status) },
      { name: 'scenario loaded', passed: scenario.flow === 'login' }
    ],
    currentUrl: payload.baseUrl
  }));
});
`;

function parseEvidenceSummary(evidence) {
  return JSON.parse(evidence.summary);
}

test('browser product validation runs an isolated provider, records structured assertions, and preserves artifacts', async () => {
  const port = await freePort();
  const { root, repo, stateRoot } = await createGitRepo({ files: {
    'server.cjs': serverSource,
    'browser-provider.cjs': providerSource,
    'tests/browser/login.json': '{"flow":"login"}\n'
  } });
  const previousSecret = process.env.VETERAN_BROWSER_SECRET_TEST;
  const previousAllowed = process.env.VETERAN_BROWSER_ALLOWED_TEST;
  process.env.VETERAN_BROWSER_SECRET_TEST = 'must-not-leak';
  process.env.VETERAN_BROWSER_ALLOWED_TEST = 'allowed-value';
  try {
    await configure(stateRoot, {
      name: 'browser-login',
      service: {
        command: [process.execPath, 'server.cjs', String(port)],
        readiness: { url: `http://127.0.0.1:${port}/health`, statuses: [200], timeoutMs: 5000, intervalMs: 50 }
      },
      browser: {
        command: [process.execPath, 'browser-provider.cjs'],
        scenarioFile: 'tests/browser/login.json',
        envAllowlist: ['VETERAN_BROWSER_ALLOWED_TEST']
      },
      artifacts: [
        { path: 'test-results/login.png', required: true, kind: 'browser-screenshot' },
        { path: 'test-results/trace.zip', required: true, kind: 'browser-trace' }
      ]
    });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const result = await app.services.validationService.run({ projectId: project.id, capability: 'browser-login' });

    assert.equal(result.passed, true);
    assert.equal(result.failureStage, null);
    assert.equal(result.browser.contract, 'veteran-browser-validation-v1');
    assert.equal(result.browser.passed, true);
    assert.equal(result.browser.assertions.length, 2);
    assert.equal(result.browser.assertions.every((item) => item.passed), true);
    assert.equal(result.browser.diagnostics.exitCode, 0);
    assert.equal(result.browser.diagnostics.stderrBytes, 0);
    assert.equal(result.artifacts.files, 2);

    const [evidence] = await app.services.evidenceService.query({ ids: [result.evidenceId] });
    const summary = parseEvidenceSummary(evidence);
    assert.equal(summary.browser.passed, true);
    assert.equal(summary.browser.assertions[0].name, 'home responds');
    assert.deepEqual(evidence.attachments.map((item) => item.name), [
      'test-results/login.png',
      'test-results/trace.zip'
    ]);
    const artifactText = await fs.readFile(path.join(app.store.artifactsDir, path.basename(evidence.artifactPointer)), 'utf8');
    assert.doesNotMatch(artifactText, /must-not-leak/);
    assert.doesNotMatch(JSON.stringify(evidence), /must-not-leak/);
  } finally {
    if (previousSecret === undefined) delete process.env.VETERAN_BROWSER_SECRET_TEST;
    else process.env.VETERAN_BROWSER_SECRET_TEST = previousSecret;
    if (previousAllowed === undefined) delete process.env.VETERAN_BROWSER_ALLOWED_TEST;
    else process.env.VETERAN_BROWSER_ALLOWED_TEST = previousAllowed;
    await cleanup(root);
  }
});

test('browser provider assertion failure fails validation while preserving structured evidence', async () => {
  const provider = `
let input=''; process.stdin.on('data', c => input += c); process.stdin.on('end', () => {
  const payload = JSON.parse(input);
  process.stdout.write(JSON.stringify({ contract: payload.contract, passed: false, summary: 'login button missing', assertions: [{name:'login button visible', passed:false, detail:'not found'}], currentUrl: payload.baseUrl }));
});`;
  const { root, repo, stateRoot } = await createGitRepo({ files: {
    'browser-provider.cjs': provider,
    'tests/browser/login.json': '{}\n'
  } });
  try {
    await configure(stateRoot, {
      name: 'browser-fail',
      browser: { command: [process.execPath, 'browser-provider.cjs'], scenarioFile: 'tests/browser/login.json', baseUrl: 'http://127.0.0.1:3000/' }
    });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const result = await app.services.validationService.run({ projectId: project.id, capability: 'browser-fail' });
    assert.equal(result.passed, false);
    assert.equal(result.failureStage, 'browser-validation');
    assert.equal(result.browser.failureCode, 'BROWSER_ASSERTION_FAILED');
    assert.equal(result.browser.assertions[0].passed, false);
    const [evidence] = await app.services.evidenceService.query({ ids: [result.evidenceId] });
    const summary = parseEvidenceSummary(evidence);
    assert.equal(summary.failureStage, 'browser-validation');
    assert.equal(summary.browser.summary, 'login button missing');
  } finally {
    await cleanup(root);
  }
});

test('browser provider malformed stdout fails closed and still records validation evidence without raw provider output', async () => {
  const provider = `process.stdout.write('not-json secret-like-provider-output');`;
  const { root, repo, stateRoot } = await createGitRepo({ files: {
    'browser-provider.cjs': provider,
    'tests/browser/smoke.json': '{}\n'
  } });
  try {
    await configure(stateRoot, {
      name: 'browser-malformed',
      browser: { command: [process.execPath, 'browser-provider.cjs'], scenarioFile: 'tests/browser/smoke.json', baseUrl: 'http://localhost:3000/' }
    });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const result = await app.services.validationService.run({ projectId: project.id, capability: 'browser-malformed' });
    assert.equal(result.passed, false);
    assert.equal(result.failureStage, 'browser-validation');
    assert.equal(result.browser.failureCode, 'BROWSER_PROVIDER_RESULT_INVALID');
    const [evidence] = await app.services.evidenceService.query({ ids: [result.evidenceId] });
    const artifactText = await fs.readFile(path.join(app.store.artifactsDir, path.basename(evidence.artifactPointer)), 'utf8');
    assert.doesNotMatch(artifactText, /secret-like-provider-output/);
    assert.doesNotMatch(JSON.stringify(evidence), /secret-like-provider-output/);
  } finally {
    await cleanup(root);
  }
});

test('browser validation rejects non-loopback base URLs before execution', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'tests/browser/smoke.json': '{}\n' } });
  try {
    await configure(stateRoot, {
      name: 'browser-unsafe-url',
      browser: { command: [process.execPath, '-e', 'process.exit(0)'], scenarioFile: 'tests/browser/smoke.json', baseUrl: 'https://example.com/' }
    });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    await assert.rejects(
      app.services.validationService.capabilities({ projectId: project.id }),
      (error) => error.code === 'BROWSER_BASE_URL_NOT_LOCAL'
    );
  } finally {
    await cleanup(root);
  }
});

test('browser validation rejects repository-escaping scenario paths before execution', async () => {
  const { root, repo, stateRoot } = await createGitRepo();
  try {
    await configure(stateRoot, {
      name: 'browser-escape',
      browser: { command: [process.execPath, '-e', 'process.exit(0)'], scenarioFile: '../secret.json', baseUrl: 'http://127.0.0.1:3000/' }
    });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    await assert.rejects(
      app.services.validationService.capabilities({ projectId: project.id }),
      (error) => error.code === 'BROWSER_SCENARIO_PATH_ESCAPE'
    );
  } finally {
    await cleanup(root);
  }
});

test('browser validation rejects scenario symlinks inside the detached worktree and records the failure', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: {
    'browser-provider.cjs': `process.stdout.write(JSON.stringify({contract:'veteran-browser-validation-v1',passed:true,assertions:[]}));`,
    'tests/browser/real.json': '{}\n'
  } });
  try {
    await fs.symlink('real.json', path.join(repo, 'tests/browser/link.json'));
    await git(repo, ['add', 'tests/browser/link.json']);
    await git(repo, ['commit', '-q', '-m', 'add browser scenario symlink']);
    await configure(stateRoot, {
      name: 'browser-symlink',
      browser: { command: [process.execPath, 'browser-provider.cjs'], scenarioFile: 'tests/browser/link.json', baseUrl: 'http://127.0.0.1:3000/' }
    });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const result = await app.services.validationService.run({ projectId: project.id, capability: 'browser-symlink' });
    assert.equal(result.passed, false);
    assert.equal(result.failureStage, 'browser-validation');
    assert.equal(result.browser.failureCode, 'BROWSER_SCENARIO_SYMLINK');
    const [evidence] = await app.services.evidenceService.query({ ids: [result.evidenceId] });
    assert.equal(parseEvidenceSummary(evidence).browser.failureCode, 'BROWSER_SCENARIO_SYMLINK');
  } finally {
    await cleanup(root);
  }
});

test('browser validation capability rejects ambiguous browser plus command execution', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'tests/browser/smoke.json': '{}\n' } });
  try {
    await configure(stateRoot, {
      name: 'browser-ambiguous',
      command: [process.execPath, '-e', 'process.exit(0)'],
      browser: { command: [process.execPath, '-e', 'process.exit(0)'], scenarioFile: 'tests/browser/smoke.json', baseUrl: 'http://127.0.0.1:3000/' }
    });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    await assert.rejects(
      app.services.validationService.capabilities({ projectId: project.id }),
      (error) => error.code === 'VALIDATION_CAPABILITY_AMBIGUOUS'
    );
  } finally {
    await cleanup(root);
  }
});

test('browser provider timeout terminates the managed provider process tree', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: {
    'browser-provider.cjs': `
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
fs.writeFileSync(process.env.BROWSER_PROVIDER_PID_FILE, String(child.pid));
setInterval(()=>{},1000);
`,
    'tests/browser/smoke.json': '{}\n'
  } });
  const pidFile = path.join(root, 'provider-child.pid');
  const previousPidFile = process.env.BROWSER_PROVIDER_PID_FILE;
  process.env.BROWSER_PROVIDER_PID_FILE = pidFile;
  try {
    await configure(stateRoot, {
      name: 'browser-timeout',
      browser: {
        command: [process.execPath, 'browser-provider.cjs'],
        scenarioFile: 'tests/browser/smoke.json',
        baseUrl: 'http://127.0.0.1:3000/',
        timeoutMs: 1000,
        envAllowlist: ['BROWSER_PROVIDER_PID_FILE']
      }
    });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const result = await app.services.validationService.run({ projectId: project.id, capability: 'browser-timeout' });
    assert.equal(result.passed, false);
    assert.equal(result.failureStage, 'browser-validation');
    assert.equal(result.browser.failureCode, 'BROWSER_PROVIDER_TIMEOUT');
    const childPid = Number(await fs.readFile(pidFile, 'utf8'));
    let alive = true;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (process.platform === 'linux') {
        try {
          const stat = await fs.readFile(`/proc/${childPid}/stat`, 'utf8');
          const state = stat.split(' ')[2];
          alive = !['Z', 'X'].includes(state);
        } catch (error) {
          if (error?.code === 'ENOENT') alive = false;
          else throw error;
        }
      } else {
        try { process.kill(childPid, 0); alive = true; } catch { alive = false; }
      }
      if (!alive) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(alive, false);
  } finally {
    if (previousPidFile === undefined) delete process.env.BROWSER_PROVIDER_PID_FILE;
    else process.env.BROWSER_PROVIDER_PID_FILE = previousPidFile;
    await cleanup(root);
  }
});
