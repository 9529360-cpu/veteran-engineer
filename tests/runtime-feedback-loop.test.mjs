import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { git } from '../src/git.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

async function configureCapability(stateRoot, workerScript, capability, runtimeFeedbackPolicy = null) {
  await fs.mkdir(stateRoot, { recursive: true });
  await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({
    defaults: {
      validationCapabilities: [capability],
      runtimeFeedbackCapabilities: [capability.name],
      ...(runtimeFeedbackPolicy ? { runtimeFeedbackPolicy } : {}),
      workerPolicy: {
        enabled: true,
        maxWorkers: 1,
        workers: { default: { type: 'custom', command: process.execPath, args: [workerScript] } }
      }
    }
  }, null, 2)}\n`);
}

async function configure(stateRoot, workerScript, feedbackCommand) {
  return configureCapability(stateRoot, workerScript, { name: 'live-product', command: feedbackCommand });
}

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

test('completed engineering wave materializes exact integrated source and records non-gating runtime feedback', async () => {
  const { root, repo, head, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  try {
    const worker = path.join(root, 'worker.cjs');
    await fs.writeFile(worker, `const fs=require('fs'),p=require('path');fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','a.txt'),'after\\n');\n`);
    await configure(stateRoot, worker, [process.execPath, '-e', "const fs=require('fs');process.exit(fs.readFileSync('src/a.txt','utf8')==='after\\n'?0:9)"]);
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    assert.deepEqual(project.runtimeFeedbackCapabilities, ['live-product']);
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'close the engineering feedback loop',
      doneDefinition: 'integrated change is observed in a materialized runtime',
      tasks: [{ id: 'T1', contract: 'change runtime-visible product state', owner: 'src', dependencies: [], writeSet: ['src'], risk: 'low' }]
    });
    const result = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(result.results[0].ok, true);
    assert.equal(result.runtimeFeedback.recorded, true);
    assert.equal(result.runtimeFeedback.passed, true);
    assert.equal(result.runtimeFeedback.capabilities[0].capability, 'live-product');
    assert.equal(result.runtimeFeedback.capabilities[0].observation.kind, 'command');
    const status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.mission.runtimeFeedback.status, 'passed');
    assert.equal(status.mission.runtimeFeedback.latestRound.commitSha, status.tasks[0].integrationSha);
    assert.equal(status.mission.validation.status, 'pending', 'development feedback must not impersonate final validation');
    assert.equal((await git(repo, ['rev-parse', 'HEAD'])).stdout.trim(), head, 'user checkout remains untouched');
    assert.equal(await fs.readFile(path.join(repo, 'src/a.txt'), 'utf8'), 'before\n');
  } finally {
    await cleanup(root);
  }
});

test('persistent live session telemetry survives feedback compaction and reaches the next wave', async () => {
  const port = await freePort();
  const serverSource = `const http=require('http');const port=Number(process.argv[2]);http.createServer((req,res)=>{res.statusCode=req.url==='/health'?200:404;res.end(req.url==='/health'?'ok':'missing');}).listen(port,'127.0.0.1');`;
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'a\n', 'src/b.txt': 'b\n', 'server.cjs': serverSource } });
  let app = null;
  try {
    const worker = path.join(root, 'worker.cjs');
    await fs.writeFile(worker, `const fs=require('fs'),p=require('path');const packet=JSON.parse(fs.readFileSync(process.env.VETERAN_TASK_PACKET,'utf8'));if(process.env.VETERAN_TASK_ID==='T1'){fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','a.txt'),'changed-a\\n');}else{const session=packet.runtimeFeedback?.capabilities?.[0]?.observation?.service?.session;if(!session||session.mode!=='persistent-live'||session.active!==true||session.reused!==false||session.generation!==1||session.sourceCheck?.ok!==true)process.exit(41);fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','b.txt'),'changed-b\\n');}\n`);
    await configureCapability(stateRoot, worker, {
      name: 'live-product',
      service: {
        command: [process.execPath, 'server.cjs', String(port)],
        readiness: { url: `http://127.0.0.1:${port}/health`, timeoutMs: 5_000, intervalMs: 50 }
      },
      command: [process.execPath, '-e', 'process.exit(0)']
    }, { liveSession: true, liveSessionIdleMs: 60_000 });
    app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'make live feedback lifecycle visible to the engineer',
      doneDefinition: 'feedback distinguishes a fresh live session from a reused source generation',
      tasks: [
        { id: 'T1', contract: 'change a', owner: 'a', dependencies: [], writeSet: ['src/a.txt'], risk: 'low' },
        { id: 'T2', contract: 'change b after inspecting live session feedback', owner: 'b', dependencies: ['T1'], writeSet: ['src/b.txt'], risk: 'low' }
      ]
    });

    const first = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    const firstSession = first.runtimeFeedback.capabilities[0].observation.service.session;
    assert.equal(firstSession.mode, 'persistent-live');
    assert.equal(firstSession.active, true);
    assert.equal(firstSession.reused, false);
    assert.equal(firstSession.restarted, false);
    assert.equal(firstSession.generation, 1);
    assert.equal(firstSession.sourceChanged, false);
    assert.equal(firstSession.sourceCheck.ok, true);

    const second = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(second.results[0].ok, true, 'next worker must receive source-bound live session telemetry');
    const secondSession = second.runtimeFeedback.capabilities[0].observation.service.session;
    assert.equal(secondSession.mode, 'persistent-live');
    assert.equal(secondSession.active, true);
    assert.equal(secondSession.reused, true);
    assert.equal(secondSession.restarted, false);
    assert.equal(secondSession.generation, 2);
    assert.equal(secondSession.sourceChanged, true);
    assert.equal(secondSession.sourceCheck.ok, true);

    const status = await app.services.missionService.status({ missionId: planned.mission.id });
    const secondPacket = status.tasks.find((task) => task.id === 'T2').dispatches.at(-1).packet;
    assert.equal(secondPacket.runtimeFeedback.capabilities[0].observation.service.session.mode, 'persistent-live');
    assert.equal(secondPacket.runtimeFeedback.capabilities[0].observation.service.session.generation, 1);
  } finally {
    await app?.services.liveSessionManager.releaseAll({ reason: 'test-cleanup' }).catch(() => {});
    await cleanup(root);
  }
});

test('failed runtime feedback is source-bound into the next worker packet without widening task authority', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'a\n', 'src/b.txt': 'b\n' } });
  try {
    const worker = path.join(root, 'worker.cjs');
    await fs.writeFile(worker, `const fs=require('fs'),p=require('path');const packet=JSON.parse(fs.readFileSync(process.env.VETERAN_TASK_PACKET,'utf8'));if(process.env.VETERAN_TASK_ID==='T1'){if(packet.runtimeFeedback!==null)process.exit(21);fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','a.txt'),'changed-a\\n');}else{const feedback=packet.runtimeFeedback;if(!feedback||feedback.sourceBound!==true||feedback.sourceHead!==packet.waveBase||feedback.passed!==false)process.exit(22);if(feedback.capabilities?.[0]?.exitCode!==7||feedback.capabilities?.[0]?.observation?.kind!=='command')process.exit(23);if(packet.task.writeSet.length!==1||packet.task.writeSet[0]!=='src/b.txt')process.exit(24);fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','b.txt'),'changed-b\\n');}\n`);
    await configure(stateRoot, worker, [process.execPath, '-e', 'process.exit(7)']);
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'continue from runtime evidence',
      doneDefinition: 'later engineering work consumes source-bound feedback without broadening scope',
      tasks: [
        { id: 'T1', contract: 'change a', owner: 'a', dependencies: [], writeSet: ['src/a.txt'], risk: 'low' },
        { id: 'T2', contract: 'change b after a using current runtime evidence', owner: 'b', dependencies: ['T1'], writeSet: ['src/b.txt'], risk: 'low' }
      ]
    });
    const first = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(first.runtimeFeedback.passed, false);
    let status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.mission.nextWaveIndex, 1);
    assert.equal(status.mission.runtimeFeedback.status, 'failed');
    assert.equal(status.mission.validation.status, 'pending');

    const second = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(second.results[0].ok, true);
    assert.equal(second.runtimeFeedback.passed, false);
    status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.mission.nextWaveIndex, 2);
    assert.equal(status.mission.runtimeFeedback.rounds.length, 2);
    assert.equal(status.tasks.every((task) => task.status === 'done'), true);
    const secondPacket = status.tasks.find((task) => task.id === 'T2').dispatches.at(-1).packet;
    assert.equal(secondPacket.runtimeFeedback.sourceBound, true);
    assert.equal(secondPacket.runtimeFeedback.sourceHead, secondPacket.waveBase);
    assert.equal(secondPacket.runtimeFeedback.advisory, true);
    assert.match(secondPacket.runtimeFeedbackPrecedence, /never expands task authority/i);
  } finally {
    await cleanup(root);
  }
});

test('structured observability failures become bounded actionable feedback for the next wave', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'a\n', 'src/b.txt': 'b\n' } });
  try {
    const observer = path.join(root, 'observer.cjs');
    await fs.writeFile(observer, `let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const p=JSON.parse(input);process.stdout.write(JSON.stringify({contract:'veteran-observability-validation-v1',passed:false,summary:'5xx budget exceeded',observedSourceHead:p.expectedSourceHead,checks:[{name:'5xx-rate',passed:false,signal:'error-rate',observed:0.12,threshold:0.01,detail:'too many server errors'}]}));});\n`);
    const worker = path.join(root, 'worker.cjs');
    await fs.writeFile(worker, `const fs=require('fs'),p=require('path');const packet=JSON.parse(fs.readFileSync(process.env.VETERAN_TASK_PACKET,'utf8'));if(process.env.VETERAN_TASK_ID==='T1'){fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','a.txt'),'changed-a\\n');}else{const observation=packet.runtimeFeedback?.capabilities?.[0]?.observation;if(observation?.kind!=='observability'||observation?.summary!=='5xx budget exceeded'||observation?.failedChecks?.[0]?.name!=='5xx-rate')process.exit(31);fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','b.txt'),'changed-b\\n');}\n`);
    await configureCapability(stateRoot, worker, {
      name: 'live-observe',
      observability: {
        command: [process.execPath, observer],
        target: 'local-product',
        windowSeconds: 30
      }
    });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'adapt from structured runtime signals',
      doneDefinition: 'the next worker sees bounded failed checks tied to its wave base',
      tasks: [
        { id: 'T1', contract: 'change a', owner: 'a', dependencies: [], writeSet: ['src/a.txt'], risk: 'low' },
        { id: 'T2', contract: 'change b while accounting for observed runtime failure', owner: 'b', dependencies: ['T1'], writeSet: ['src/b.txt'], risk: 'low' }
      ]
    });
    const first = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(first.runtimeFeedback.passed, false);
    assert.equal(first.runtimeFeedback.capabilities[0].observation.kind, 'observability');
    assert.equal(first.runtimeFeedback.capabilities[0].observation.failedChecks[0].name, '5xx-rate');
    const second = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(second.results[0].ok, true);
  } finally {
    await cleanup(root);
  }
});

test('stale runtime feedback is visible as history but its capability details are not actionable', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'a\n', 'src/b.txt': 'b\n' } });
  try {
    const worker = path.join(root, 'worker.cjs');
    await fs.writeFile(worker, `const fs=require('fs'),p=require('path');if(process.env.VETERAN_TASK_ID==='T1')fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','a.txt'),'changed-a\\n');else fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','b.txt'),'changed-b\\n');\n`);
    await configure(stateRoot, worker, [process.execPath, '-e', 'process.exit(7)']);
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'reject stale feedback as current evidence',
      doneDefinition: 'source identity mismatch strips actionable details',
      tasks: [
        { id: 'T1', contract: 'change a', owner: 'a', dependencies: [], writeSet: ['src/a.txt'], risk: 'low' },
        { id: 'T2', contract: 'change b', owner: 'b', dependencies: ['T1'], writeSet: ['src/b.txt'], risk: 'low' }
      ]
    });
    await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    await app.store.transaction('test_stale_runtime_feedback', (state) => {
      state.missions[planned.mission.id].runtimeFeedback.latestRound = {
        ...state.missions[planned.mission.id].runtimeFeedback.latestRound,
        commitSha: 'stale-source-head'
      };
    });
    const dispatched = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: false });
    const feedback = dispatched.dispatched[0].packet.runtimeFeedback;
    assert.equal(feedback.sourceBound, false);
    assert.equal(feedback.passed, null);
    assert.deepEqual(feedback.capabilities, []);
    assert.equal(feedback.reason, 'feedback-source-does-not-match-wave-base');
  } finally {
    await cleanup(root);
  }
});

test('runtime feedback target override is confined to integrated mission identities', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'src/a.txt': 'a\n' } });
  try {
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({ defaults: { validationCapabilities: [{ name: 'smoke', command: [process.execPath, '-e', 'process.exit(0)'] }] } }, null, 2)}\n`);
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const planned = await app.services.missionService.plan({ projectId: project.id, goal: 'scope feedback target', doneDefinition: 'arbitrary revisions are rejected', tasks: [{ id: 'T1', contract: 'noop', owner: 'src', dependencies: [], writeSet: [], risk: 'low' }] });
    await assert.rejects(
      app.services.validationService.run({ projectId: project.id, missionId: planned.mission.id, capability: 'smoke', purpose: 'runtime-feedback', targetCommitSha: 'deadbeef' }),
      (error) => error.code === 'RUNTIME_FEEDBACK_TARGET_INVALID'
    );
  } finally {
    await cleanup(root);
  }
});
