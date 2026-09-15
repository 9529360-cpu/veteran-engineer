import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { ELECTRON_SCENARIO_CONTRACT } from '../src/electron-validation-provider.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

function parseEvidenceSummary(evidence) {
  return JSON.parse(evidence.summary);
}

test('Electron validation is a first-class validation mode and fails closed into durable evidence when the executable is unavailable', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: {
    'main.cjs': 'process.exit(0);\n',
    'tests/electron/smoke.json': `${JSON.stringify({
      contract: ELECTRON_SCENARIO_CONTRACT,
      steps: [{ action: 'waitForSurface' }]
    })}\n`
  } });
  try {
    const missingExecutable = path.join(root, 'missing-electron-binary');
    await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({
      defaults: {
        validationCapabilities: [{
          name: 'electron-smoke',
          electron: {
            executablePath: missingExecutable,
            args: ['main.cjs'],
            scenarioFile: 'tests/electron/smoke.json',
            timeoutMs: 2000,
            stepTimeoutMs: 500
          }
        }]
      }
    }, null, 2)}\n`);
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const [capability] = await app.services.validationService.capabilities({ projectId: project.id });
    assert.equal(capability.electron.contract, 'veteran-electron-validation-v1');
    assert.equal(capability.browser, null);
    assert.equal(capability.observability, null);

    const result = await app.services.validationService.run({ projectId: project.id, capability: 'electron-smoke' });
    assert.equal(result.passed, false);
    assert.equal(result.failureStage, 'electron-validation');
    assert.equal(result.electron.failureCode, 'ELECTRON_EXECUTABLE_NOT_FOUND');

    const [evidence] = await app.services.evidenceService.query({ ids: [result.evidenceId] });
    const summary = parseEvidenceSummary(evidence);
    assert.equal(summary.failureStage, 'electron-validation');
    assert.equal(summary.electron.failureCode, 'ELECTRON_EXECUTABLE_NOT_FOUND');
  } finally {
    await cleanup(root);
  }
});

test('Electron execution cannot be combined with another validation execution mode', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: {
    'tests/electron/smoke.json': `${JSON.stringify({ contract: ELECTRON_SCENARIO_CONTRACT, steps: [{ action: 'waitForSurface' }] })}\n`
  } });
  try {
    await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({
      defaults: {
        validationCapabilities: [{
          name: 'ambiguous-electron',
          command: [process.execPath, '-e', 'process.exit(0)'],
          electron: { executablePath: process.execPath, scenarioFile: 'tests/electron/smoke.json' }
        }]
      }
    }, null, 2)}\n`);
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
