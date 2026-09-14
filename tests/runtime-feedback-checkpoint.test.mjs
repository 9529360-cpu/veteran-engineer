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
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

test('partial integrated wave checkpoints feed the next capacity slice without triggering repair', async () => {
  const port = await freePort();
  const serverSource = `const http=require('http');const port=Number(process.argv[2]);http.createServer((req,res)=>{res.statusCode=req.url==='/health'?200:404;res.end(req.url==='/health'?'ok':'missing');}).listen(port,'127.0.0.1');`;
  const { root, repo, stateRoot } = await createGitRepo({
    files: {
      'src/a.txt': 'a\n',
      'src/b.txt': 'b\n',
      'src/c.txt': 'c\n',
      'server.cjs': serverSource
    }
  });
  let app = null;
  try {
    const worker = path.join(root, 'worker.cjs');
    await fs.writeFile(worker, `const fs=require('fs'),p=require('path');const packet=JSON.parse(fs.readFileSync(process.env.VETERAN_TASK_PACKET,'utf8'));const id=process.env.VETERAN_TASK_ID;if(id==='T1'){if(packet.runtimeFeedback!==null)process.exit(31);fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','a.txt'),'a1\\n');}else if(id==='T2'){const f=packet.runtimeFeedback,s=f?.capabilities?.[0]?.observation?.service?.session;if(!f?.sourceBound||f.observedWaveIndex!==0||!f.advisory||f.scope!=='checkpoint'||f.completeWave!==false||f.triggerTaskId!=='T1'||s?.mode!=='persistent-live'||s?.generation!==1||s?.reused!==false||s?.sourceCheck?.ok!==true)process.exit(32);fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','b.txt'),'b1\\n');}else if(id==='T3'){const f=packet.runtimeFeedback,s=f?.capabilities?.[0]?.observation?.service?.session;if(!f?.sourceBound||f.scope!=='checkpoint'||f.completeWave!==false||f.triggerTaskId!=='T2'||s?.mode!=='persistent-live'||s?.generation!==2||s?.reused!==true||s?.sourceChanged!==true||s?.sourceCheck?.ok!==true)process.exit(33);fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','c.txt'),'c1\\n');}`);
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({
      defaults: {
        validationCapabilities: [{
          name: 'live-product',
          service: {
            command: [process.execPath, 'server.cjs', String(port)],
            readiness: { url: `http://127.0.0.1:${port}/health`, timeoutMs: 5_000, intervalMs: 50 }
          },
          command: [process.execPath, '-e', 'process.exit(0)']
        }],
        runtimeFeedbackCapabilities: ['live-product'],
        runtimeFeedbackPolicy: {
          liveSession: true,
          liveSessionIdleMs: 60_000,
          autoRepair: true,
          maxRepairAttempts: 1
        },
        workerPolicy: {
          enabled: true,
          maxWorkers: 1,
          workers: { default: { type: 'custom', command: process.execPath, args: [worker] } }
        }
      }
    }, null, 2)}\n`);

    app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'observe stable integrated product checkpoints before a wide wave finishes',
      doneDefinition: 'each later capacity slice receives feedback for the exact already-integrated source while only full-wave feedback can gate repair',
      tasks: [
        { id: 'T1', contract: 'change a', owner: 'a', dependencies: [], writeSet: ['src/a.txt'], risk: 'low' },
        { id: 'T2', contract: 'change b', owner: 'b', dependencies: [], writeSet: ['src/b.txt'], risk: 'low' },
        { id: 'T3', contract: 'change c', owner: 'c', dependencies: [], writeSet: ['src/c.txt'], risk: 'low' }
      ]
    });
    assert.deepEqual(planned.mission.waves[0], ['T1', 'T2', 'T3']);

    const first = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(first.results[0].taskId, 'T1');
    assert.equal(first.results[0].ok, true);
    assert.equal(first.runtimeFeedbackCheckpoint.recorded, true);
    assert.equal(first.runtimeFeedbackCheckpoint.scope, 'checkpoint');
    assert.equal(first.runtimeFeedbackCheckpoint.completeWave, false);
    assert.equal(first.runtimeFeedbackCheckpoint.advisory, true);
    assert.equal(first.runtimeFeedbackCheckpoint.triggerTaskId, 'T1');
    assert.equal(first.runtimeFeedbackCheckpoint.capabilities[0].observation.service.session.generation, 1);
    let status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.mission.nextWaveIndex, 0);
    assert.equal(status.mission.runtimeFeedback.status, 'pending', 'checkpoint must not impersonate complete-wave status');
    assert.equal(status.mission.runtimeFeedback.latestRound.scope, 'checkpoint');

    const repair = await app.services.runtimeFeedbackService.scheduleRepairWave({
      missionId: planned.mission.id,
      feedbackRound: first.runtimeFeedbackCheckpoint
    });
    assert.equal(repair.scheduled, false);
    assert.equal(repair.reason, 'checkpoint-feedback-is-advisory');

    const second = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(second.results[0].taskId, 'T2');
    assert.equal(second.results[0].ok, true, 'second capacity slice must consume the first exact-source checkpoint with explicit partial-wave semantics');
    assert.equal(second.runtimeFeedbackCheckpoint.scope, 'checkpoint');
    assert.equal(second.runtimeFeedbackCheckpoint.triggerTaskId, 'T2');
    assert.equal(second.runtimeFeedbackCheckpoint.capabilities[0].observation.service.session.reused, true);
    assert.equal(second.runtimeFeedbackCheckpoint.capabilities[0].observation.service.session.generation, 2);
    status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.mission.nextWaveIndex, 0);
    assert.equal(status.mission.runtimeFeedback.status, 'pending');

    const third = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(third.results[0].taskId, 'T3');
    assert.equal(third.results[0].ok, true, 'third capacity slice must consume the second exact-source checkpoint with explicit partial-wave semantics');
    assert.equal(third.runtimeFeedback.recorded, true);
    assert.equal(third.runtimeFeedback.scope, undefined, 'full-wave feedback retains the existing stored contract shape');
    assert.equal(third.runtimeFeedback.capabilities[0].observation.service.session.reused, true);
    assert.equal(third.runtimeFeedback.capabilities[0].observation.service.session.generation, 3);

    status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.mission.nextWaveIndex, 1);
    assert.equal(status.mission.runtimeFeedback.status, 'passed');
    assert.equal(status.mission.runtimeFeedback.latestRound.scope, undefined);
    assert.equal(status.mission.runtimeFeedback.rounds.length, 3);
    assert.equal(status.mission.runtimeFeedback.rounds.filter((round) => round.scope === 'checkpoint').length, 2);

    const completed = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(completed.phase, 'validation');
    assert.equal(app.services.liveSessionManager.snapshot().length, 0);
  } finally {
    await app?.services.liveSessionManager.releaseAll({ reason: 'test-cleanup' }).catch(() => {});
    await cleanup(root);
  }
});
