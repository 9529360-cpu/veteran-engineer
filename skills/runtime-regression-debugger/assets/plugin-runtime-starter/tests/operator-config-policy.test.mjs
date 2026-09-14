import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { loadOperatorConfig, projectPolicy } from '../src/operator-config.mjs';
import { cleanup, tempDir } from './helpers.mjs';

function rejectsConfig(config, expectedPath) {
  assert.throws(
    () => projectPolicy(config, '/repo'),
    (error) => error.code === 'OPERATOR_CONFIG_INVALID' && error.details?.path === expectedPath
  );
}

test('operator policy rejects ambiguous safety-sensitive scalar types', () => {
  rejectsConfig(
    { defaults: { workerPolicy: { enabled: 'false' } } },
    'defaults.workerPolicy.enabled'
  );
  rejectsConfig(
    { defaults: { workerPolicy: { allowUnconfinedCustomWorkers: 'false' } } },
    'defaults.workerPolicy.allowUnconfinedCustomWorkers'
  );
  rejectsConfig(
    { defaults: { workerPolicy: { allowRawValidation: 'false' } } },
    'defaults.workerPolicy.allowRawValidation'
  );
  rejectsConfig(
    { defaults: { workerPolicy: { maxWorkers: '2' } } },
    'defaults.workerPolicy.maxWorkers'
  );
  rejectsConfig(
    { defaults: { workerPolicy: { capabilities: 'container-worker' } } },
    'defaults.workerPolicy.capabilities'
  );
  rejectsConfig(
    { defaults: { validationCapabilities: 'browser' } },
    'defaults.validationCapabilities'
  );
  rejectsConfig(
    { defaults: { requiredValidationCapabilities: ['ok', 42] } },
    'defaults.requiredValidationCapabilities'
  );
  rejectsConfig(
    { defaults: { requireValidation: 'false' } },
    'defaults.requireValidation'
  );
  rejectsConfig(
    { projects: { '/repo': { validationCapabilities: [{ name: '' }] } } },
    'projects./repo.validationCapabilities[0].name'
  );
  rejectsConfig(
    { projects: { '/repo': { workerPolicy: { allowUnconfinedCustomWorkers: 'false' } } } },
    'projects./repo.workerPolicy.allowUnconfinedCustomWorkers'
  );
});

test('operator config file fails closed before malformed policy reaches project services', async () => {
  const root = await tempDir('veteran-operator-policy-');
  try {
    await fs.writeFile(path.join(root, 'operator.json'), `${JSON.stringify({
      defaults: { workerPolicy: { enabled: 'false' } }
    })}\n`);
    await assert.rejects(
      loadOperatorConfig({ stateRoot: root }),
      (error) => error.code === 'OPERATOR_CONFIG_INVALID' && error.details?.path === 'defaults.workerPolicy.enabled'
    );
  } finally {
    await cleanup(root);
  }
});

test('valid operator safety controls preserve extensible worker configuration and canonicalize capability identities', () => {
  const validationCapability = { name: ' lint ', command: ['node', '--version'] };
  const policy = projectPolicy({
    defaults: {
      requireValidation: true,
      validationCapabilities: [validationCapability],
      requiredValidationCapabilities: [' lint ', 'lint'],
      runtimeFeedbackCapabilities: [' lint ', 'lint'],
      workerPolicy: {
        enabled: true,
        maxWorkers: 4,
        capabilities: [' custom-tooling ', 'custom-tooling'],
        allowUnconfinedCustomWorkers: false,
        allowRawValidation: false,
        defaultWorker: 'codex',
        workers: {
          codex: { type: 'custom', command: 'codex-wrapper', args: ['--bounded'] }
        },
        codex: { model: 'example-model', extraArgs: ['--quiet'] }
      }
    },
    projects: {
      '/repo': {
        requireSemanticReview: true,
        workerPolicy: { maxWorkers: 1 }
      }
    }
  }, '/repo');

  assert.equal(policy.requireValidation, true);
  assert.equal(policy.requireSemanticReview, true);
  assert.deepEqual(policy.validationCapabilities, [{ name: 'lint', command: ['node', '--version'] }]);
  assert.deepEqual(policy.requiredValidationCapabilities, ['lint']);
  assert.deepEqual(policy.runtimeFeedbackCapabilities, ['lint']);
  assert.equal(policy.workerPolicy.enabled, true);
  assert.equal(policy.workerPolicy.maxWorkers, 1);
  assert.deepEqual(policy.workerPolicy.capabilities, ['custom-tooling']);
  assert.equal(policy.workerPolicy.allowUnconfinedCustomWorkers, false);
  assert.equal(policy.workerPolicy.allowRawValidation, false);
  assert.equal(policy.workerPolicy.defaultWorker, 'codex');
  assert.deepEqual(policy.workerPolicy.workers.codex, {
    type: 'custom', command: 'codex-wrapper', args: ['--bounded']
  });
  assert.deepEqual(policy.workerPolicy.codex, {
    model: 'example-model', extraArgs: ['--quiet']
  });
  assert.equal(validationCapability.name, ' lint ');
});
