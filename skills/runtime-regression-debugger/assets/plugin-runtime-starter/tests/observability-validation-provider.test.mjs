import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

async function configure(stateRoot, capability) {
  await fs.mkdir(stateRoot, { recursive: true });
  await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({ defaults: { validationCapabilities: [capability] } }, null, 2)}\n`);
}

function parseEvidenceSummary(evidence) {
  return JSON.parse(evidence.summary);
}

test('observability validation uses an ephemeral credential reference and records structured source-bound health evidence', async () => {
  const provider = `
let input='';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  const payload = JSON.parse(input);
  if (process.env.OBSERVABILITY_TOKEN !== 'telemetry-secret-value') process.exit(71);
  process.stdout.write(JSON.stringify({
    contract: payload.contract,
    passed: true,
    summary: 'production telemetry healthy',
    observedSourceHead: payload.expectedSourceHead,
    checks: [
      { name: '5xx rate', signal: 'error-rate', passed: true, observed: 0.002, threshold: 0.01 },
      { name: 'p95 latency', signal: 'latency', passed: true, observed: 180, threshold: 300, detail: 'milliseconds' }
    ]
  }));
});
`;
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'observability-provider.cjs': provider } });
  const previous = process.env.VETERAN_OBS_TOKEN;
  process.env.VETERAN_OBS_TOKEN = 'telemetry-secret-value';
  try {
    await configure(stateRoot, {
      name: 'production-health',
      observability: {
        command: [process.execPath, 'observability-provider.cjs'],
        target: 'production',
        windowSeconds: 300,
        credentialRefs: [{ provider: 'environment', name: 'VETERAN_OBS_TOKEN', targetEnv: 'OBSERVABILITY_TOKEN' }]
      }
    });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const result = await app.services.validationService.run({ projectId: project.id, capability: 'production-health' });
    assert.equal(result.passed, true);
    assert.equal(result.failureStage, null);
    assert.equal(result.observability.contract, 'veteran-observability-validation-v1');
    assert.equal(result.observability.observedSourceHead, project.sourceIdentity.head);
    assert.equal(result.observability.checks.length, 2);
    assert.equal(result.observability.checks.every((item) => item.passed), true);

    const [evidence] = await app.services.evidenceService.query({ ids: [result.evidenceId] });
    const summary = parseEvidenceSummary(evidence);
    assert.equal(summary.observability.summary, 'production telemetry healthy');
    assert.equal(summary.observability.observedSourceHead, project.sourceIdentity.head);
    assert.doesNotMatch(JSON.stringify(evidence), /telemetry-secret-value/);
    const artifactText = await fs.readFile(path.join(app.store.artifactsDir, path.basename(evidence.artifactPointer)), 'utf8');
    assert.doesNotMatch(artifactText, /telemetry-secret-value/);
  } finally {
    if (previous === undefined) delete process.env.VETERAN_OBS_TOKEN;
    else process.env.VETERAN_OBS_TOKEN = previous;
    await cleanup(root);
  }
});

test('observability validation redacts materialized credential values echoed by a provider before evidence persistence', async () => {
  const secret = 'echoed-observability-secret-7f2a';
  const provider = `
let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const p=JSON.parse(input);const s=process.env.OBS_TOKEN;process.stdout.write(JSON.stringify({contract:p.contract,passed:true,summary:'summary '+s,observedSourceHead:p.expectedSourceHead,checks:[{name:'redaction',passed:true,observed:s,threshold:'must-not-'+s,detail:'detail '+s}]}));});`;
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'provider.cjs': provider } });
  const previous = process.env.VETERAN_OBS_REDACT;
  process.env.VETERAN_OBS_REDACT = secret;
  try {
    await configure(stateRoot, { name: 'redaction', observability: { command: [process.execPath, 'provider.cjs'], target: 'production', credentialRefs: [{ provider: 'environment', name: 'VETERAN_OBS_REDACT', targetEnv: 'OBS_TOKEN' }] } });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const result = await app.services.validationService.run({ projectId: project.id, capability: 'redaction' });
    assert.equal(result.passed, true);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
    assert.match(result.observability.summary, /\[REDACTED\]/);
    const [evidence] = await app.services.evidenceService.query({ ids: [result.evidenceId] });
    const artifactText = await fs.readFile(path.join(app.store.artifactsDir, path.basename(evidence.artifactPointer)), 'utf8');
    assert.doesNotMatch(JSON.stringify(evidence), new RegExp(secret));
    assert.doesNotMatch(artifactText, new RegExp(secret));
  } finally {
    if (previous === undefined) delete process.env.VETERAN_OBS_REDACT;
    else process.env.VETERAN_OBS_REDACT = previous;
    await cleanup(root);
  }
});

test('observability validation fails closed when deployed source identity does not match the validated commit', async () => {
  const provider = `
let input=''; process.stdin.on('data', c => input += c); process.stdin.on('end', () => {
  const payload=JSON.parse(input);
  process.stdout.write(JSON.stringify({ contract: payload.contract, passed: true, summary:'healthy but stale', observedSourceHead:'0000000000000000000000000000000000000000', checks:[{name:'availability',passed:true,observed:1,threshold:0.999}] }));
});`;
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'provider.cjs': provider } });
  try {
    await configure(stateRoot, { name: 'source-bound', observability: { command: [process.execPath, 'provider.cjs'], target: 'staging' } });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const result = await app.services.validationService.run({ projectId: project.id, capability: 'source-bound' });
    assert.equal(result.passed, false);
    assert.equal(result.failureStage, 'observability-validation');
    assert.equal(result.observability.failureCode, 'OBSERVABILITY_SOURCE_IDENTITY_MISMATCH');
    assert.equal(result.observability.observedSourceHead, '0000000000000000000000000000000000000000');
  } finally {
    await cleanup(root);
  }
});

test('malformed observability provider output fails closed without persisting raw output', async () => {
  const provider = `process.stdout.write('not-json telemetry-secret-like-output');`;
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'provider.cjs': provider } });
  try {
    await configure(stateRoot, { name: 'malformed', observability: { command: [process.execPath, 'provider.cjs'], target: 'production' } });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const result = await app.services.validationService.run({ projectId: project.id, capability: 'malformed' });
    assert.equal(result.passed, false);
    assert.equal(result.observability.failureCode, 'OBSERVABILITY_PROVIDER_RESULT_INVALID');
    const [evidence] = await app.services.evidenceService.query({ ids: [result.evidenceId] });
    const artifactText = await fs.readFile(path.join(app.store.artifactsDir, path.basename(evidence.artifactPointer)), 'utf8');
    assert.doesNotMatch(JSON.stringify(evidence), /telemetry-secret-like-output/);
    assert.doesNotMatch(artifactText, /telemetry-secret-like-output/);
  } finally {
    await cleanup(root);
  }
});

test('observability provider stderr is never copied into durable evidence on provider failure', async () => {
  const provider = `console.error('provider-secret-error-body'); process.exit(9);`;
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'provider.cjs': provider } });
  try {
    await configure(stateRoot, { name: 'provider-fail', observability: { command: [process.execPath, 'provider.cjs'], target: 'production' } });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const result = await app.services.validationService.run({ projectId: project.id, capability: 'provider-fail' });
    assert.equal(result.passed, false);
    assert.equal(result.observability.failureCode, 'OBSERVABILITY_PROVIDER_FAILED');
    assert.ok(result.observability.diagnostics.stderrBytes > 0);
    const [evidence] = await app.services.evidenceService.query({ ids: [result.evidenceId] });
    const artifactText = await fs.readFile(path.join(app.store.artifactsDir, path.basename(evidence.artifactPointer)), 'utf8');
    assert.doesNotMatch(JSON.stringify(evidence), /provider-secret-error-body/);
    assert.doesNotMatch(artifactText, /provider-secret-error-body/);
  } finally {
    await cleanup(root);
  }
});

test('observability capability rejects ambiguous execution modes and protected credential targets', async () => {
  for (const [name, capability, expected] of [
    ['ambiguous', { name: 'ambiguous', command: [process.execPath, '-e', 'process.exit(0)'], observability: { command: [process.execPath, '-e', 'process.exit(0)'], target: 'production' } }, 'VALIDATION_CAPABILITY_AMBIGUOUS'],
    ['protected', { name: 'protected', observability: { command: [process.execPath, '-e', 'process.exit(0)'], target: 'production', credentialRefs: [{ provider: 'environment', name: 'TOKEN', targetEnv: 'NODE_OPTIONS' }] } }, 'CREDENTIAL_TARGET_INVALID']
  ]) {
    const { root, repo, stateRoot } = await createGitRepo();
    try {
      await configure(stateRoot, capability);
      const app = await createVeteranApp({ stateRoot });
      const project = await app.services.projectService.open({ repoPath: repo });
      await assert.rejects(app.services.validationService.capabilities({ projectId: project.id }), (error) => error.code === expected, name);
    } finally {
      await cleanup(root);
    }
  }
});

test('observability provider rejects inconsistent passed result with a failed structured check', async () => {
  const provider = `
let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const p=JSON.parse(input);process.stdout.write(JSON.stringify({contract:p.contract,passed:true,observedSourceHead:p.expectedSourceHead,checks:[{name:'error budget',passed:false}]}));});`;
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'provider.cjs': provider } });
  try {
    await configure(stateRoot, { name: 'inconsistent', observability: { command: [process.execPath, 'provider.cjs'], target: 'production' } });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const result = await app.services.validationService.run({ projectId: project.id, capability: 'inconsistent' });
    assert.equal(result.passed, false);
    assert.equal(result.observability.failureCode, 'OBSERVABILITY_PROVIDER_RESULT_INVALID');
  } finally {
    await cleanup(root);
  }
});

test('observability provider timeout terminates the managed provider process tree', async () => {
  if (process.platform === 'win32') return;
  const { root, repo, stateRoot } = await createGitRepo({ files: { 'provider.cjs': `
const fs=require('node:fs'),cp=require('node:child_process');
const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
fs.writeFileSync(process.env.OBS_CHILD_PID_FILE,String(child.pid));
setInterval(()=>{},1000);
` } });
  const pidFile = path.join(root, 'obs-child.pid');
  const previous = process.env.OBS_CHILD_PID_FILE;
  process.env.OBS_CHILD_PID_FILE = pidFile;
  try {
    await configure(stateRoot, {
      name: 'timeout',
      observability: {
        command: [process.execPath, 'provider.cjs'],
        target: 'production',
        timeoutMs: 1000,
        credentialRefs: [{ provider: 'environment', name: 'OBS_CHILD_PID_FILE', targetEnv: 'OBS_CHILD_PID_FILE' }]
      }
    });
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const result = await app.services.validationService.run({ projectId: project.id, capability: 'timeout' });
    assert.equal(result.passed, false);
    assert.equal(result.observability.failureCode, 'OBSERVABILITY_PROVIDER_TIMEOUT');
    const childPid = Number(await fs.readFile(pidFile, 'utf8'));
    let alive = true;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const stat = await fs.readFile(`/proc/${childPid}/stat`, 'utf8');
        alive = !['Z', 'X'].includes(stat.split(' ')[2]);
      } catch (error) {
        if (error?.code === 'ENOENT') alive = false;
        else throw error;
      }
      if (!alive) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(alive, false);
  } finally {
    if (previous === undefined) delete process.env.OBS_CHILD_PID_FILE;
    else process.env.OBS_CHILD_PID_FILE = previous;
    await cleanup(root);
  }
});
