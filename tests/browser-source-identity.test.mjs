import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

async function configure(stateRoot, validationCapabilities) {
  await fs.mkdir(stateRoot, { recursive: true });
  await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({ defaults: { validationCapabilities } }, null, 2)}\n`);
}

const providerSource = `
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const payload = JSON.parse(input);
  const mode = process.argv[2];
  const result = {
    contract: payload.contract,
    passed: true,
    summary: 'browser assertion passed',
    assertions: [{ name: 'rendered', passed: true }],
    currentUrl: payload.baseUrl
  };
  if (mode === 'match') result.observedSourceHead = payload.expectedSourceHead;
  if (mode === 'stale') result.observedSourceHead = 'stale-source-head';
  process.stdout.write(JSON.stringify(result));
});
`;

function capability(name, mode, requireSourceMatch) {
  return {
    name,
    browser: {
      command: [process.execPath, 'browser-source-provider.cjs', mode],
      scenarioFile: 'tests/browser/source.json',
      baseUrl: 'http://127.0.0.1:3000/',
      requireSourceMatch
    }
  };
}

test('browser validation can prove the exact detached source identity without breaking legacy providers', async () => {
  const { root, repo, head, stateRoot } = await createGitRepo({ files: {
    'browser-source-provider.cjs': providerSource,
    'tests/browser/source.json': '{}\n'
  } });
  try {
    await configure(stateRoot, [
      capability('browser-source-match', 'match', true),
      capability('browser-source-stale', 'stale', true),
      capability('browser-source-missing', 'missing', true),
      capability('browser-legacy', 'missing', false)
    ]);
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    assert.equal(project.sourceIdentity.head, head);

    const matched = await app.services.validationService.run({ projectId: project.id, capability: 'browser-source-match' });
    assert.equal(matched.passed, true);
    assert.equal(matched.browser.failureCode, null);
    assert.equal(matched.browser.observedSourceHead, matched.commitSha);
    assert.equal(matched.browser.sourceMatch, true);

    const stale = await app.services.validationService.run({ projectId: project.id, capability: 'browser-source-stale' });
    assert.equal(stale.passed, false);
    assert.equal(stale.failureStage, 'browser-validation');
    assert.equal(stale.browser.failureCode, 'BROWSER_SOURCE_IDENTITY_MISMATCH');
    assert.equal(stale.browser.observedSourceHead, 'stale-source-head');
    assert.equal(stale.browser.sourceMatch, false);

    const missing = await app.services.validationService.run({ projectId: project.id, capability: 'browser-source-missing' });
    assert.equal(missing.passed, false);
    assert.equal(missing.browser.failureCode, 'BROWSER_SOURCE_IDENTITY_MISMATCH');
    assert.equal(missing.browser.observedSourceHead, null);
    assert.equal(missing.browser.sourceMatch, false);

    const legacy = await app.services.validationService.run({ projectId: project.id, capability: 'browser-legacy' });
    assert.equal(legacy.passed, true, 'source proof remains opt-in so existing browser providers keep working');
    assert.equal(legacy.browser.observedSourceHead, null);
    assert.equal(legacy.browser.sourceMatch, null);
  } finally {
    await cleanup(root);
  }
});

test('browser source matching configuration fails closed on non-boolean values', async () => {
  const { root, repo, stateRoot } = await createGitRepo({ files: {
    'browser-source-provider.cjs': providerSource,
    'tests/browser/source.json': '{}\n'
  } });
  try {
    await configure(stateRoot, [{
      name: 'browser-invalid-source-policy',
      browser: {
        command: [process.execPath, 'browser-source-provider.cjs', 'match'],
        scenarioFile: 'tests/browser/source.json',
        baseUrl: 'http://127.0.0.1:3000/',
        requireSourceMatch: 'yes'
      }
    }]);
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    await assert.rejects(
      app.services.validationService.capabilities({ projectId: project.id }),
      (error) => error.code === 'BROWSER_VALIDATION_CONFIG_INVALID'
    );
  } finally {
    await cleanup(root);
  }
});
