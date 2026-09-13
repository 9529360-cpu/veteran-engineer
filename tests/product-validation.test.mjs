import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => error ? reject(error) : resolve(port));
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
  res.writeHead(404); res.end('no');
});
server.listen(port, '127.0.0.1', () => process.stdout.write('READY\\n'));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`;

test('product validation starts a service, waits for readiness, runs validation, records logs, and cleans up', async () => {
  const port = await freePort();
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'server.cjs': serverSource } });
  try {
    await configure(stateRoot, {
      name: 'product-smoke',
      command: [process.execPath, '-e', `fetch('http://127.0.0.1:${port}/health').then(r=>process.exit(r.status===200?0:2)).catch(()=>process.exit(3))`],
      service: {
        command: [process.execPath, 'server.cjs', String(port)],
        readiness: { url: `http://127.0.0.1:${port}/health`, statuses: [200], timeoutMs: 5000, intervalMs: 50 },
        shutdownGraceMs: 1000
      }
    });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const result = await app.services.validationService.run({ projectId: project.id, capability: 'product-smoke' });
    assert.equal(result.passed, true);
    assert.equal(result.failureStage, null);
    assert.equal(result.service.ready, true);
    assert.equal(result.service.cleanup.after.running, false);
    assert.ok(result.service.readiness.attempts >= 1);

    const [evidence] = await app.services.evidenceService.query({ ids: [result.evidenceId] });
    const artifact = await fs.readFile(path.join(app.store.artifactsDir, path.basename(evidence.artifactPointer)), 'utf8');
    assert.match(artifact, /--- service stdout ---/);
    assert.match(artifact, /READY/);

    await assert.rejects(fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) }));
  } finally {
    await cleanup(root);
  }
});

test('product validation fails closed when service readiness never succeeds and still cleans up', async () => {
  const port = await freePort();
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'server.cjs': serverSource } });
  try {
    await configure(stateRoot, {
      name: 'product-not-ready',
      command: [process.execPath, '-e', 'process.exit(0)'],
      service: {
        command: [process.execPath, 'server.cjs', String(port)],
        readiness: { url: `http://127.0.0.1:${port}/missing`, statuses: [200], timeoutMs: 1000, intervalMs: 50 },
        shutdownGraceMs: 500
      }
    });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const result = await app.services.validationService.run({ projectId: project.id, capability: 'product-not-ready' });
    assert.equal(result.passed, false);
    assert.equal(result.failureStage, 'readiness');
    assert.equal(result.service.ready, false);
    assert.equal(result.service.cleanup.after.running, false);
    assert.equal(result.service.readiness.lastStatus, 404);
  } finally {
    await cleanup(root);
  }
});

test('product validation reports service startup exit instead of running the validation command', async () => {
  const port = await freePort();
  const { root, repo, stateRoot } = await createGitRepo();
  try {
    await configure(stateRoot, {
      name: 'product-crash',
      command: [process.execPath, '-e', 'process.exit(77)'],
      service: {
        command: [process.execPath, '-e', "process.stderr.write('startup-boom\\n');process.exit(3)"],
        readiness: { url: `http://127.0.0.1:${port}/health`, statuses: [200], timeoutMs: 2000, intervalMs: 50 }
      }
    });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const result = await app.services.validationService.run({ projectId: project.id, capability: 'product-crash' });
    assert.equal(result.passed, false);
    assert.equal(result.failureStage, 'service-startup');
    assert.equal(result.exitCode, 1);
    const [evidence] = await app.services.evidenceService.query({ ids: [result.evidenceId] });
    const artifact = await fs.readFile(path.join(app.store.artifactsDir, path.basename(evidence.artifactPointer)), 'utf8');
    assert.match(artifact, /startup-boom/);
  } finally {
    await cleanup(root);
  }
});

test('product validation readiness is restricted to credential-free loopback HTTP', async () => {
  const { root, repo, stateRoot } = await createGitRepo();
  try {
    await configure(stateRoot, {
      name: 'unsafe-product-smoke',
      command: [process.execPath, '-e', 'process.exit(0)'],
      service: {
        command: [process.execPath, '-e', 'setInterval(()=>{},1000)'],
        readiness: { url: 'https://example.com/health' }
      }
    });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    await assert.rejects(
      app.services.validationService.capabilities({ projectId: project.id }),
      (error) => error.code === 'VALIDATION_READINESS_URL_NOT_LOCAL'
    );
  } finally {
    await cleanup(root);
  }
});

test('product validation service cwd cannot escape the detached worktree through a symlink', async () => {
  const port = await freePort();
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'server.cjs': serverSource } });
  try {
    const outside = path.join(root, 'outside');
    await fs.mkdir(outside, { recursive: true });
    await fs.symlink(outside, path.join(repo, 'escape'), 'dir');
    const { git } = await import('../src/git.mjs');
    await git(repo, ['add', 'escape']);
    await git(repo, ['commit', '-q', '-m', 'add escape symlink']);
    await configure(stateRoot, {
      name: 'escaped-service-cwd',
      command: [process.execPath, '-e', 'process.exit(0)'],
      service: {
        command: [process.execPath, 'server.cjs', String(port)],
        cwd: 'escape',
        readiness: { url: `http://127.0.0.1:${port}/health` }
      }
    });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    await assert.rejects(
      app.services.validationService.run({ projectId: project.id, capability: 'escaped-service-cwd' }),
      (error) => error.code === 'VALIDATION_CWD_ESCAPE'
    );
  } finally {
    await cleanup(root);
  }
});
