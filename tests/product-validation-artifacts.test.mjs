import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { normalizeValidationArtifacts } from '../src/validation-artifact-collector.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

async function configure(stateRoot, capability) {
  await fs.mkdir(stateRoot, { recursive: true });
  await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({ defaults: { validationCapabilities: [capability] } }, null, 2)}\n`);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

test('validation retains declared browser-style evidence artifacts before worktree cleanup', async () => {
  const { root, repo, stateRoot } = await createGitRepo();
  try {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const script = [
      "const fs=require('node:fs')",
      "fs.mkdirSync('test-results',{recursive:true})",
      `fs.writeFileSync('test-results/login.png',Buffer.from('${png.toString('base64')}','base64'))`,
      "fs.writeFileSync('test-results/trace.zip',Buffer.from('trace-data'))",
      "fs.mkdirSync('playwright-report',{recursive:true})",
      "fs.writeFileSync('playwright-report/index.html','<html>ok</html>')"
    ].join(';');
    await configure(stateRoot, {
      name: 'browser-e2e',
      command: [process.execPath, '-e', script],
      artifacts: [
        { path: 'test-results', required: true, kind: 'browser-test-output' },
        { path: 'playwright-report', required: false, kind: 'browser-report' }
      ]
    });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const result = await app.services.validationService.run({ projectId: project.id, capability: 'browser-e2e' });
    assert.equal(result.passed, true);
    assert.equal(result.failureStage, null);
    assert.equal(result.artifacts.complete, true);
    assert.equal(result.artifacts.files, 3);

    const [evidence] = await app.services.evidenceService.query({ ids: [result.evidenceId] });
    assert.equal(evidence.attachments.length, 3);
    assert.deepEqual(evidence.attachments.map((item) => item.name), [
      'test-results/login.png',
      'test-results/trace.zip',
      'playwright-report/index.html'
    ]);
    const screenshot = evidence.attachments.find((item) => item.name === 'test-results/login.png');
    const retained = await fs.readFile(path.join(app.store.root, screenshot.artifactPointer));
    assert.deepEqual(retained, png);
    assert.equal(screenshot.artifactHash, sha256(png));
    assert.equal(screenshot.kind, 'browser-test-output');
  } finally {
    await cleanup(root);
  }
});

test('required validation artifacts fail an otherwise green validation when missing', async () => {
  const { root, repo, stateRoot } = await createGitRepo();
  try {
    await configure(stateRoot, {
      name: 'missing-required-artifact',
      command: [process.execPath, '-e', 'process.exit(0)'],
      artifacts: [{ path: 'test-results', required: true, kind: 'browser-test-output' }]
    });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const result = await app.services.validationService.run({ projectId: project.id, capability: 'missing-required-artifact' });
    assert.equal(result.passed, false);
    assert.equal(result.failureStage, 'artifact-collection');
    assert.equal(result.artifacts.requiredMissing, true);
    assert.equal(result.artifacts.complete, false);
    const [evidence] = await app.services.evidenceService.query({ ids: [result.evidenceId] });
    assert.deepEqual(evidence.attachments, []);
  } finally {
    await cleanup(root);
  }
});

test('optional validation artifacts may be absent without changing a green result', async () => {
  const { root, repo, stateRoot } = await createGitRepo();
  try {
    await configure(stateRoot, {
      name: 'optional-artifact',
      command: [process.execPath, '-e', 'process.exit(0)'],
      artifacts: [{ path: 'playwright-report', required: false, kind: 'browser-report' }]
    });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const result = await app.services.validationService.run({ projectId: project.id, capability: 'optional-artifact' });
    assert.equal(result.passed, true);
    assert.equal(result.failureStage, null);
    assert.equal(result.artifacts.complete, true);
    assert.equal(result.artifacts.items[0].missing, true);
  } finally {
    await cleanup(root);
  }
});

test('validation artifact collection refuses symlinks instead of copying external files', async () => {
  const { root, repo, stateRoot } = await createGitRepo();
  try {
    const outside = path.join(root, 'outside-secret.txt');
    await fs.writeFile(outside, 'do-not-copy');
    await fs.mkdir(path.join(repo, 'test-results'));
    await fs.symlink(outside, path.join(repo, 'test-results', 'external.txt'));
    const { git } = await import('../src/git.mjs');
    await git(repo, ['add', 'test-results/external.txt']);
    await git(repo, ['commit', '-q', '-m', 'add external artifact symlink']);
    await configure(stateRoot, {
      name: 'unsafe-artifact',
      command: [process.execPath, '-e', 'process.exit(0)'],
      artifacts: [{ path: 'test-results', required: false }]
    });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const result = await app.services.validationService.run({ projectId: project.id, capability: 'unsafe-artifact' });
    assert.equal(result.passed, false);
    assert.equal(result.failureStage, 'artifact-collection');
    assert.equal(result.artifacts.error.code, 'VALIDATION_ARTIFACT_SYMLINK');
    const [evidence] = await app.services.evidenceService.query({ ids: [result.evidenceId] });
    assert.deepEqual(evidence.attachments, []);
  } finally {
    await cleanup(root);
  }
});

test('validation artifact declarations reject repository-external paths before execution', async () => {
  const { root, repo, stateRoot } = await createGitRepo();
  try {
    await configure(stateRoot, {
      name: 'escaped-artifact',
      command: [process.execPath, '-e', 'process.exit(0)'],
      artifacts: [{ path: '../outside.png', required: false }]
    });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    await assert.rejects(
      app.services.validationService.capabilities({ projectId: project.id }),
      (error) => error.code === 'VALIDATION_ARTIFACT_PATH_ESCAPE'
    );
  } finally {
    await cleanup(root);
  }
});


test('artifact path normalization rejects POSIX, drive-qualified, and UNC absolute paths', () => {
  for (const value of ['/tmp/screenshot.png', 'C:/temp/screenshot.png', 'C:\\temp\\screenshot.png', '\\\\server\\share\\screenshot.png']) {
    assert.throws(
      () => normalizeValidationArtifacts([{ path: value }]),
      (error) => error.code === 'VALIDATION_ARTIFACT_PATH_ESCAPE'
    );
  }
});
