import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { git } from '../src/git.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

test('browser source freshness mismatch stays runtime evidence and never becomes an auto-repair code task', async () => {
  const provider = `
let input='';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  const payload = JSON.parse(input);
  process.stdout.write(JSON.stringify({
    contract: payload.contract,
    passed: true,
    summary: 'rendered stale preview',
    assertions: [{ name: 'page rendered', passed: true }],
    currentUrl: payload.baseUrl,
    observedSourceHead: 'stale-source-head'
  }));
});
`;
  const { root, repo, head, stateRoot } = await createGitRepo({ files: {
    'src/a.txt': 'before\n',
    'browser-provider.cjs': provider,
    'tests/browser/source.json': '{}\n'
  } });
  try {
    const worker = path.join(root, 'worker.cjs');
    await fs.writeFile(worker, `const fs=require('fs'),p=require('path');fs.writeFileSync(p.join(process.env.VETERAN_WORKTREE,'src','a.txt'),'changed\\n');\n`);
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({
      defaults: {
        validationCapabilities: [{
          name: 'browser-live',
          browser: {
            command: [process.execPath, 'browser-provider.cjs'],
            scenarioFile: 'tests/browser/source.json',
            baseUrl: 'http://127.0.0.1:3000/',
            requireSourceMatch: true
          }
        }],
        runtimeFeedbackPolicy: { autoRepair: true, maxRepairAttempts: 1 },
        workerPolicy: {
          enabled: true,
          maxWorkers: 1,
          workers: { default: { type: 'custom', command: process.execPath, args: [worker] } }
        }
      }
    }, null, 2)}\n`);

    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const planned = await app.services.missionService.plan({
      projectId: project.id,
      goal: 'keep runtime freshness failures out of product-code repair',
      doneDefinition: 'stale preview evidence is explicit and no repair task is fabricated',
      tasks: [{
        id: 'T1',
        contract: 'change product source',
        owner: 'src/a.txt',
        dependencies: [],
        writeSet: ['src/a.txt'],
        risk: 'low',
        validationCapability: 'browser-live'
      }]
    });

    const result = await app.services.workerOrchestrator.execute({ missionId: planned.mission.id, runWorkers: true });
    assert.equal(result.runtimeFeedback.passed, false);
    const capability = result.runtimeFeedback.capabilities[0];
    assert.equal(capability.observation.kind, 'browser');
    assert.equal(capability.observation.failureCode, 'BROWSER_SOURCE_IDENTITY_MISMATCH');
    assert.equal(capability.observation.observedSourceHead, 'stale-source-head');
    assert.equal(capability.observation.sourceMatch, false);
    assert.equal(result.runtimeFeedback.repair.scheduled, false);
    assert.equal(result.runtimeFeedback.repair.reason, 'failed-capabilities-not-code-repairable');
    assert.deepEqual(result.runtimeFeedback.repair.suppressedFailures, [{
      capability: 'browser-live',
      failureCode: 'BROWSER_SOURCE_IDENTITY_MISMATCH'
    }]);

    const status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.mission.waves.length, 1);
    assert.equal(status.tasks.length, 1);
    assert.equal(status.tasks.some((task) => task.feedbackRemediation), false);
    assert.equal((await git(repo, ['rev-parse', 'HEAD'])).stdout.trim(), head);
    assert.equal(await fs.readFile(path.join(repo, 'src/a.txt'), 'utf8'), 'before\n');
  } finally {
    await cleanup(root);
  }
});
