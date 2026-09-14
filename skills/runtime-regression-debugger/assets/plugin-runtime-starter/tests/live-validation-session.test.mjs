import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { git } from '../src/git.mjs';
import { LiveValidationSessionManager } from '../src/live-validation-session-manager.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function configure(stateRoot, workerScript, capability, runtimeFeedbackPolicy = {}) {
  await fs.mkdir(stateRoot, { recursive: true });
  await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({
    defaults: {
      validationCapabilities: [capability],
      runtimeFeedbackCapabilities: [capability.name],
      runtimeFeedbackPolicy: {
        liveSession: true,
        liveSessionIdleMs: 60_000,
        ...runtimeFeedbackPolicy
      },
      workerPolicy: {
        enabled: true,
        maxWorkers: 1,
        workers: { default: { type: 'custom', command: process.execPath, args: [workerScript] } }
      }
    }
  }, null, 2)}\n`);
}

async function evidenceSummary(app, evidenceId) {
  const items = await app.services.evidenceService.query({ ids: [evidenceId] });
  assert.equal(items.length, 1);
  return JSON.parse(items[0].summary);
}

test('persistent live validation keeps one service across waves, advances source generation, and closes at execution end', async () => {
  const port = await freePort();
  const serverSource = `const http=require('http'),fs=require('fs');const port=Number(process.argv[2]);http.createServer((req,res)=>{if(req.url==='/health'){res.statusCode=200;res.end('ok');return;}if(req.url==='/value'){const a=fs.readFileSync('src/a.txt','utf8').trim();const b=fs.readFileSync('src/b.txt','utf8').trim();res.statusCode=200;res.end(a+'|'+b);return;}res.statusCode=404;res.end('missing');}).listen(port,'127.0.0.1');`;
  const providerSource = `let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',async()=>{const p=JSON.parse(input);try{const url=new URL('value',p.baseUrl);const r=await fetch(url);const text=await r.text();process.stdout.write(JSON.stringify({contract:p.contract,passed:r.ok,summary:text,assertions:[{name:'live-source-visible',passed:r.ok,detail:text}],currentUrl:p.baseUrl}));}catch(e){process.stderr.write(String(e&&e.stack||e));process.exit(3);}});`;
  const { root, repo, head, stateRoot } = await createGitRepo({
    files: {
      'src/a.txt': 'before-a\n',
      'src/b.txt': 'before-b\n',
      'server.cjs': serverSource,
      'provider.cjs': providerSource,
      'scenario.json': '{}\n'
    }
  });
  let app = null;
  try {
    const worker = path.join(root, 'worker.cjs');
    await fs.writeFile(worker, `const fs=require('fs'),p=require('path');if(process.env.VETERAN_TASK_ID==='T1')fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','a.txt'),'after-a\\n');else fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','b.txt'),'after-b\\n');`);
    const capability = {
      name: 'live-product',
      service: {
        command: [process.execPath, 'server.cjs', String(port)],
        readiness: { url: `http://127.0.0.1:${port}/health`, timeoutMs: 5_000, intervalMs: 50 }
      },
      browser: {
        command: [process.execPath, 'provider.cjs'],
        scenarioFile: 'scenario.json',
        timeoutMs: 5_000
      }
    };
    await configure(stateRoot, worker, capability);
    app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    assert.equal(project.runtimeFeedbackPolicy.liveSession, true);

    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'keep a real product preview alive while dependent code waves integrate',
      doneDefinition: 'the same live service observes each exact integrated wave and is released when execution ends',
      tasks: [
        { id: 'T1', contract: 'change a', owner: 'a', dependencies: [], writeSet: ['src/a.txt'], risk: 'low', validationCapability: 'live-product' },
        { id: 'T2', contract: 'change b after a', owner: 'b', dependencies: ['T1'], writeSet: ['src/b.txt'], risk: 'low', validationCapability: 'live-product' }
      ]
    });

    const first = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(first.runtimeFeedback.passed, true);
    const firstEvidence = await evidenceSummary(app, first.runtimeFeedback.capabilities[0].evidenceId);
    assert.equal(firstEvidence.browser.summary, 'after-a|before-b');
    assert.equal(firstEvidence.service.session.mode, 'persistent-live');
    assert.equal(firstEvidence.service.session.reused, false);
    assert.equal(firstEvidence.service.session.generation, 1);
    assert.equal(firstEvidence.service.session.active, true);
    assert.equal(firstEvidence.service.session.sourceCheck.ok, true);
    const firstSessionId = firstEvidence.service.session.sessionId;
    assert.equal(app.services.liveSessionManager.snapshot().length, 1);

    const second = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(second.runtimeFeedback.passed, true);
    const secondEvidence = await evidenceSummary(app, second.runtimeFeedback.capabilities[0].evidenceId);
    assert.equal(secondEvidence.browser.summary, 'after-a|after-b');
    assert.equal(secondEvidence.service.session.sessionId, firstSessionId);
    assert.equal(secondEvidence.service.session.reused, true);
    assert.equal(secondEvidence.service.session.generation, 2);
    assert.equal(secondEvidence.service.session.sourceChanged, true);
    assert.equal(secondEvidence.service.session.sourceCheck.ok, true);

    const status = await app.services.missionService.status({ missionId: planned.mission.id });
    const session = app.services.liveSessionManager.snapshot()[0];
    assert.equal(session.commitSha, status.tasks.find((task) => task.id === 'T2').integrationSha);
    const cleanupPreview = await app.handlers.runtime_cleanup({ apply: false });
    assert.equal(cleanupPreview.orphans.includes(session.worktreeName), false, 'active live worktree must not be reported as orphan');

    const completed = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(completed.phase, 'validation');
    assert.equal(app.services.liveSessionManager.snapshot().length, 0, 'execution completion must release the persistent service');
    assert.equal((await git(repo, ['rev-parse', 'HEAD'])).stdout.trim(), head);
    assert.equal(await fs.readFile(path.join(repo, 'src/a.txt'), 'utf8'), 'before-a\n');
    assert.equal(await fs.readFile(path.join(repo, 'src/b.txt'), 'utf8'), 'before-b\n');
  } finally {
    await app?.services.liveSessionManager.releaseAll({ reason: 'test-cleanup' }).catch(() => {});
    await cleanup(root);
  }
});

test('persistent live validation fails closed and releases the session when the service mutates tracked source', async () => {
  const port = await freePort();
  const mutatingServer = `const http=require('http'),fs=require('fs');fs.writeFileSync('src/a.txt','tampered\\n');const port=Number(process.argv[2]);http.createServer((req,res)=>{res.statusCode=200;res.end('ok');}).listen(port,'127.0.0.1');`;
  const { root, repo, head, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'before\n', 'server.cjs': mutatingServer } });
  let app = null;
  try {
    const worker = path.join(root, 'worker.cjs');
    await fs.writeFile(worker, `const fs=require('fs'),p=require('path');fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','a.txt'),'after\\n');`);
    const capability = {
      name: 'live-product',
      service: {
        command: [process.execPath, 'server.cjs', String(port)],
        readiness: { url: `http://127.0.0.1:${port}/health`, timeoutMs: 5_000, intervalMs: 50 }
      },
      command: [process.execPath, '-e', 'process.exit(0)']
    };
    await configure(stateRoot, worker, capability);
    app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'reject live preview processes that rewrite authoritative source',
      doneDefinition: 'tracked drift invalidates runtime feedback and closes the session',
      tasks: [{ id: 'T1', contract: 'change a', owner: 'a', dependencies: [], writeSet: ['src/a.txt'], risk: 'low', validationCapability: 'live-product' }]
    });
    const result = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(result.runtimeFeedback.passed, false);
    assert.equal(result.runtimeFeedback.capabilities[0].failureStage, 'live-session-source-drift');
    const evidence = await evidenceSummary(app, result.runtimeFeedback.capabilities[0].evidenceId);
    assert.equal(evidence.service.session.sourceCheck.ok, false);
    assert.equal(evidence.service.session.sourceCheck.reason, 'tracked-source-dirty');
    assert.equal(evidence.service.session.released, true);
    assert.equal(app.services.liveSessionManager.snapshot().length, 0);
    assert.equal((await git(repo, ['rev-parse', 'HEAD'])).stdout.trim(), head);
    assert.equal(await fs.readFile(path.join(repo, 'src/a.txt'), 'utf8'), 'before\n');
  } finally {
    await app?.services.liveSessionManager.releaseAll({ reason: 'test-cleanup' }).catch(() => {});
    await cleanup(root);
  }
});

test('persistent sessions fail closed on invalid policy and degrade to ephemeral on hosted multi-instance state', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'a\n' } });
  try {
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({
      defaults: { runtimeFeedbackPolicy: { liveSession: true, liveSessionIdleMs: 999 } }
    })}\n`);
    await assert.rejects(
      createVeteranApp({ stateRoot }),
      (error) => error.code === 'OPERATOR_CONFIG_INVALID' && error.details?.path === 'defaults.runtimeFeedbackPolicy.liveSessionIdleMs'
    );

    const manager = new LiveValidationSessionManager({ store: { backendKind: 'postgres' } });
    const support = manager.support({
      project: { runtimeFeedbackPolicy: { liveSession: true, liveSessionIdleMs: 60_000 } },
      service: { command: ['node'], cwd: '.', readiness: { url: 'http://127.0.0.1:1/' } }
    });
    assert.equal(support.enabled, false);
    assert.equal(support.reason, 'hosted-backend-requires-session-lease');
  } finally {
    await cleanup(root);
  }
});

test('different missions cannot own the same persistent loopback endpoint at the same time', async () => {
  const port = await freePort();
  const serverSource = `const http=require('http');const port=Number(process.argv[2]);http.createServer((req,res)=>{res.statusCode=200;res.end('ok');}).listen(port,'127.0.0.1');`;
  const { root, repo, head, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'a\n', 'server.cjs': serverSource } });
  let app = null;
  try {
    const worker = path.join(root, 'worker.cjs');
    await fs.writeFile(worker, 'process.exit(0);\n');
    const capability = {
      name: 'live-product',
      service: {
        command: [process.execPath, 'server.cjs', String(port)],
        readiness: { url: `http://127.0.0.1:${port}/health`, timeoutMs: 5_000, intervalMs: 50 }
      },
      command: [process.execPath, '-e', 'process.exit(0)']
    };
    await configure(stateRoot, worker, capability);
    app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const normalized = (await app.services.validationService.capabilities({ projectId: project.id }))[0];

    const first = await app.services.liveSessionManager.acquire({
      project,
      mission: { id: 'mission-a' },
      capability: 'live-product',
      commitSha: head,
      service: normalized.service
    });
    assert.equal(first.active, true);
    assert.equal(app.services.liveSessionManager.snapshot().length, 1);

    const samePortDifferentPath = {
      ...normalized.service,
      readiness: {
        ...normalized.service.readiness,
        url: `http://127.0.0.1:${port}/other-health`
      }
    };
    await assert.rejects(
      app.services.liveSessionManager.acquire({
        project,
        mission: { id: 'mission-b' },
        capability: 'live-product',
        commitSha: head,
        service: samePortDifferentPath
      }),
      (error) => error.code === 'LIVE_VALIDATION_ENDPOINT_IN_USE'
        && error.details?.ownerMissionId === 'mission-a'
        && String(error.details?.port) === String(port)
    );
    assert.equal(app.services.liveSessionManager.snapshot().length, 1, 'conflicting mission must not create a second session or worktree');

    const released = await app.services.liveSessionManager.releaseMission({ missionId: 'mission-a', reason: 'lease-handoff-test' });
    assert.equal(released.length, 1);
    assert.equal(app.services.liveSessionManager.snapshot().length, 0);

    const second = await app.services.liveSessionManager.acquire({
      project,
      mission: { id: 'mission-b' },
      capability: 'live-product',
      commitSha: head,
      service: samePortDifferentPath
    });
    assert.equal(second.active, true, 'endpoint lease must be reusable after the prior owner releases it');
    assert.equal(app.services.liveSessionManager.snapshot().length, 1);
    assert.equal((await git(repo, ['rev-parse', 'HEAD'])).stdout.trim(), head);
  } finally {
    await app?.services.liveSessionManager.releaseAll({ reason: 'test-cleanup' }).catch(() => {});
    await cleanup(root);
  }
});
