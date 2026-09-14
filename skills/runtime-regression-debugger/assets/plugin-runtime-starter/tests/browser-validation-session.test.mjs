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
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function configure(stateRoot, workerScript, capability) {
  await fs.mkdir(stateRoot, { recursive: true });
  await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({
    defaults: {
      validationCapabilities: [capability],
      runtimeFeedbackCapabilities: [capability.name],
      runtimeFeedbackPolicy: { liveSession: true, liveSessionIdleMs: 60_000 },
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

const oneShotProvider = `
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',async()=>{const p=JSON.parse(input);const r=await fetch(new URL('value',p.baseUrl));const text=await r.text();process.stdout.write(JSON.stringify({contract:p.contract,passed:r.ok,summary:'oneshot:'+text,assertions:[{name:'one-shot-visible',passed:r.ok,detail:text}],currentUrl:p.baseUrl}));});
`;

const persistentProvider = `
let buffer='',observations=0,chain=Promise.resolve();
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\\n'))>=0){const line=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);if(!line)continue;chain=chain.then(()=>handle(line)).catch(error=>{process.stderr.write(String(error&&error.stack||error));process.exit(9);});}});
async function handle(line){const p=JSON.parse(line);if(p.sessionContract!=='veteran-browser-session-jsonl-v1'||p.operation!=='observe')process.exit(31);const r=await fetch(new URL('value',p.baseUrl));const text=await r.text();observations+=1;process.stdout.write(JSON.stringify({sessionContract:p.sessionContract,requestId:p.requestId,contract:p.contract,passed:r.ok,summary:text+'|pid:'+process.pid+'|obs:'+observations,assertions:[{name:'persistent-source-visible',passed:r.ok,detail:text}],currentUrl:p.baseUrl})+'\\n');}
`;

const malformedPersistentProvider = `process.stdin.once('data',()=>process.stdout.write('not-json\\n'));setInterval(()=>{},1000);`;

function serverSource() {
  return `const http=require('http'),fs=require('fs');const port=Number(process.argv[2]);http.createServer((req,res)=>{if(req.url==='/health'){res.statusCode=200;res.end('ok');return;}if(req.url==='/value'){const a=fs.readFileSync('src/a.txt','utf8').trim();const b=fs.readFileSync('src/b.txt','utf8').trim();res.statusCode=200;res.end(a+'|'+b);return;}res.statusCode=404;res.end('missing');}).listen(port,'127.0.0.1');`;
}

test('persistent browser feedback reuses one provider across live product waves and releases with execution', async () => {
  const port = await freePort();
  const { root, repo, stateRoot } = await createGitRepo({ files: {
    'src/a.txt': 'before-a\n',
    'src/b.txt': 'before-b\n',
    'server.cjs': serverSource(),
    'browser-once.cjs': oneShotProvider,
    'browser-session.cjs': persistentProvider,
    'scenario.json': '{}\n'
  } });
  let app = null;
  try {
    const worker = path.join(root, 'worker.cjs');
    await fs.writeFile(worker, `const fs=require('fs'),p=require('path');if(process.env.VETERAN_TASK_ID==='T1')fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','a.txt'),'after-a\\n');else fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','b.txt'),'after-b\\n');`);
    const capability = {
      name: 'browser-live-product',
      service: {
        command: [process.execPath, 'server.cjs', String(port)],
        readiness: { url: `http://127.0.0.1:${port}/health`, timeoutMs: 5_000, intervalMs: 50 }
      },
      browser: {
        command: [process.execPath, 'browser-once.cjs'],
        scenarioFile: 'scenario.json',
        timeoutMs: 5_000,
        session: { command: [process.execPath, 'browser-session.cjs'], timeoutMs: 5_000 }
      }
    };
    await configure(stateRoot, worker, capability);
    app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'keep browser context alive while the product changes across waves',
      doneDefinition: 'one browser provider observes both integrated product states and closes with execution',
      tasks: [
        { id: 'T1', contract: 'change a', owner: 'a', dependencies: [], writeSet: ['src/a.txt'], risk: 'low', validationCapability: capability.name },
        { id: 'T2', contract: 'change b', owner: 'b', dependencies: ['T1'], writeSet: ['src/b.txt'], risk: 'low', validationCapability: capability.name }
      ]
    });

    const first = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(first.runtimeFeedback.passed, true);
    const firstEvidence = await evidenceSummary(app, first.runtimeFeedback.capabilities[0].evidenceId);
    assert.equal(firstEvidence.browser.session.mode, 'persistent-browser');
    assert.equal(firstEvidence.browser.session.reused, false);
    assert.equal(firstEvidence.browser.session.observation, 1);
    assert.match(firstEvidence.browser.summary, /^after-a\|before-b\|pid:\d+\|obs:1$/);
    const browserSessionId = firstEvidence.browser.session.sessionId;
    const providerPid = firstEvidence.browser.session.providerPid;
    assert.equal(app.services.validationService.browserSessionManager.snapshot().length, 1);

    const preview = await app.handlers.runtime_cleanup({ apply: false });
    assert.equal(preview.browserSessions.active.length, 1);
    assert.equal(preview.liveSessions.active.length, 1);

    const second = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(second.runtimeFeedback.passed, true);
    const secondEvidence = await evidenceSummary(app, second.runtimeFeedback.capabilities[0].evidenceId);
    assert.equal(secondEvidence.browser.session.sessionId, browserSessionId);
    assert.equal(secondEvidence.browser.session.providerPid, providerPid);
    assert.equal(secondEvidence.browser.session.reused, true);
    assert.equal(secondEvidence.browser.session.observation, 2);
    assert.equal(secondEvidence.browser.session.sourceChanged, true);
    assert.match(secondEvidence.browser.summary, /^after-a\|after-b\|pid:\d+\|obs:2$/);

    const completed = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(completed.phase, 'validation');
    assert.equal(app.services.validationService.browserSessionManager.snapshot().length, 0, 'execution completion must release browser context');
    assert.equal(app.services.liveSessionManager.snapshot().length, 0, 'execution completion must release live product service');
  } finally {
    await app?.services.validationService.browserSessionManager.releaseAll({ reason: 'test-cleanup' }).catch(() => {});
    await app?.services.liveSessionManager.releaseAll({ reason: 'test-cleanup' }).catch(() => {});
    await cleanup(root);
  }
});

test('persistent browser protocol failure releases the session and falls back to the existing one-shot provider', async () => {
  const port = await freePort();
  const { root, repo, stateRoot } = await createGitRepo({ files: {
    'src/a.txt': 'before-a\n',
    'src/b.txt': 'before-b\n',
    'server.cjs': serverSource(),
    'browser-once.cjs': oneShotProvider,
    'browser-session.cjs': malformedPersistentProvider,
    'scenario.json': '{}\n'
  } });
  let app = null;
  try {
    const worker = path.join(root, 'worker.cjs');
    await fs.writeFile(worker, `const fs=require('fs'),p=require('path');fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','a.txt'),'after-a\\n');`);
    const capability = {
      name: 'browser-fallback-product',
      service: {
        command: [process.execPath, 'server.cjs', String(port)],
        readiness: { url: `http://127.0.0.1:${port}/health`, timeoutMs: 5_000, intervalMs: 50 }
      },
      browser: {
        command: [process.execPath, 'browser-once.cjs'],
        scenarioFile: 'scenario.json',
        timeoutMs: 5_000,
        session: { command: [process.execPath, 'browser-session.cjs'], timeoutMs: 5_000 }
      }
    };
    await configure(stateRoot, worker, capability);
    app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'preserve browser feedback when a persistent provider protocol fails',
      doneDefinition: 'the broken persistent session is released and the legacy one-shot provider supplies evidence',
      tasks: [{ id: 'T1', contract: 'change a', owner: 'a', dependencies: [], writeSet: ['src/a.txt'], risk: 'low', validationCapability: capability.name }]
    });

    const result = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(result.runtimeFeedback.passed, true);
    const evidence = await evidenceSummary(app, result.runtimeFeedback.capabilities[0].evidenceId);
    assert.equal(evidence.browser.session.mode, 'ephemeral-fallback');
    assert.equal(evidence.browser.session.fallbackReason, 'BROWSER_SESSION_RESULT_INVALID');
    assert.equal(evidence.browser.session.active, false);
    assert.equal(evidence.browser.summary, 'oneshot:after-a|before-b');
    assert.equal(app.services.validationService.browserSessionManager.snapshot().length, 0, 'failed persistent provider must not remain alive');
  } finally {
    await app?.services.validationService.browserSessionManager.releaseAll({ reason: 'test-cleanup' }).catch(() => {});
    await app?.services.liveSessionManager.releaseAll({ reason: 'test-cleanup' }).catch(() => {});
    await cleanup(root);
  }
});
