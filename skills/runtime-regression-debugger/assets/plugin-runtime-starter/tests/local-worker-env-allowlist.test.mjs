import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { WorkerAdapter, enforceWorkerPolicy } from '../src/worker-adapter.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

const policyProject = {
  workerPolicy: {
    enabled: true,
    allowUnconfinedCustomWorkers: false
  }
};
const policyTask = { id: 'T1', key: 'M1:T1', risk: 'low', writeSet: ['src/a.txt'] };

function localConfig(envAllowlist) {
  return {
    type: 'custom',
    command: process.execPath,
    args: ['-e', 'process.exit(0)'],
    envAllowlist
  };
}

test('local worker env allowlist requires a bounded array of variable names', () => {
  for (const invalid of [null, 'WORKER_TOKEN', ['GOOD', 42], Array.from({ length: 65 }, (_, index) => `ENV_${index}`)]) {
    assert.throws(
      () => enforceWorkerPolicy(policyProject, policyTask, localConfig(invalid)),
      (error) => error?.code === 'WORKER_CONFIG_INVALID'
    );
  }
  assert.doesNotThrow(() => enforceWorkerPolicy(policyProject, policyTask, localConfig(['WORKER_TOKEN', 'lower_case_ok'])));
});

test('local worker spawn config is validated before claims while omitted type remains legacy custom', async () => {
  const validLegacy = {
    command: process.execPath,
    args: ['-e', 'process.exit(0)'],
    env: { WORKER_MODE: 'test' },
    timeoutMs: 1_000
  };
  assert.doesNotThrow(() => enforceWorkerPolicy(policyProject, policyTask, validLegacy));

  const invalidConfigs = [
    { type: 'mystery', command: process.execPath },
    { type: 'custom', command: '' },
    { type: 'custom', command: 42 },
    { type: 'custom', command: process.execPath, args: 'not-an-array' },
    { type: 'custom', command: process.execPath, args: ['ok', 42] },
    { type: 'custom', command: process.execPath, env: [] },
    { type: 'custom', command: process.execPath, env: { GOOD: 42 } },
    { type: 'custom', command: process.execPath, env: { 'BAD-KEY': 'value' } },
    { type: 'custom', command: process.execPath, timeoutMs: 0 },
    { type: 'custom', command: process.execPath, timeoutMs: 1.5 },
    { type: 'custom', command: process.execPath, timeoutMs: 2_147_483_648 },
    { type: 'custom', command: process.execPath, stdinMode: 'raw' }
  ];
  for (const config of invalidConfigs) {
    assert.throws(
      () => enforceWorkerPolicy(policyProject, policyTask, config),
      (error) => error?.code === 'WORKER_CONFIG_INVALID'
    );
  }

  const adapter = new WorkerAdapter();
  await assert.rejects(
    adapter.run({
      project: policyProject,
      mission: { id: 'M1' },
      task: policyTask,
      worktreePath: path.join(process.cwd(), 'must-not-be-touched'),
      packet: { protocol: 'veteran-worker-v1' },
      config: { type: 'custom', command: process.execPath, args: ['ok', 42] }
    }),
    (error) => error?.code === 'WORKER_CONFIG_INVALID'
  );
  assert.deepEqual(adapter.snapshot(), [], 'invalid worker config must fail before an execution claim exists');
});

test('mission execution rejects malformed local worker env allowlist before spawn', async () => {
  const fixture = await createGitRepo({ files: { 'src/a.txt': 'before\n' } });
  const marker = path.join(fixture.root, 'worker-ran.txt');
  const worker = path.join(fixture.root, 'worker.mjs');
  const configPath = path.join(fixture.root, 'operator.json');
  try {
    await fs.writeFile(worker, `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(marker)}, 'ran\\n');\n`);
    await fs.writeFile(configPath, `${JSON.stringify({
      defaults: {
        workerPolicy: {
          enabled: true,
          maxWorkers: 1,
          defaultWorker: 'bad-env',
          workers: {
            'bad-env': {
              type: 'custom',
              command: process.execPath,
              args: [worker],
              envAllowlist: 'WORKER_TOKEN'
            }
          }
        }
      }
    }, null, 2)}\n`);

    const app = await createVeteranApp({ stateRoot: fixture.stateRoot, configPath });
    const project = await app.callTool('project_open', {
      requestId: 'worker-env-shape-open',
      repoPath: fixture.repo
    });
    const planned = await app.callTool('mission_plan', {
      requestId: 'worker-env-shape-plan',
      projectId: project.id,
      goal: 'reject malformed local worker environment policy',
      doneDefinition: 'worker is never spawned',
      tasks: [{
        id: 'T1',
        contract: 'touch src/a.txt only if worker starts',
        owner: 'src/a.txt',
        dependencies: [],
        writeSet: ['src/a.txt'],
        risk: 'low',
        worker: 'bad-env'
      }]
    });

    const result = await app.callTool('mission_execute', {
      requestId: 'worker-env-shape-execute',
      missionId: planned.mission.id,
      runWorkers: true
    });
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].ok, false);
    assert.equal(result.results[0].error.code, 'WORKER_CONFIG_INVALID');
    await assert.rejects(fs.access(marker), (error) => error?.code === 'ENOENT');

    const status = await app.services.missionService.status({ missionId: planned.mission.id });
    assert.equal(status.tasks[0].status, 'failed');
  } finally {
    await cleanup(fixture.root);
  }
});
