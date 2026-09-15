import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizeLocalLogObservability, runLocalLogObservability } from '../src/local-log-observability.mjs';
import { normalizeObservabilityValidation, runObservabilityValidation } from '../src/observability-validation-provider.mjs';

async function tempRoot(prefix = 'veteran-local-log-') { return fs.mkdtemp(path.join(os.tmpdir(), prefix)); }

test('local log observability counts errors warnings and text matchers without exposing lines', async () => {
  const root = await tempRoot();
  try {
    await fs.writeFile(path.join(root, 'app.log'), 'INFO ready\nWARN cache cold\nERROR database unavailable token=secret\n', 'utf8');
    const config = normalizeLocalLogObservability({ files: ['app.log'], maxErrors: 1, maxWarnings: 1, requireContains: ['ready'], forbidContains: ['panic'] });
    const result = await runLocalLogObservability(config, { cwd: root, expectedSourceHead: 'abc123' });
    assert.equal(result.passed, true);
    assert.equal(result.observedSourceHead, 'abc123');
    assert.equal(result.diagnostics.errors, 1);
    assert.equal(result.diagnostics.warnings, 1);
    assert.equal(JSON.stringify(result).includes('token=secret'), false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('local log observability fails bounded checks deterministically', async () => {
  const root = await tempRoot();
  try {
    await fs.writeFile(path.join(root, 'app.log'), 'INFO start\nERROR boom\nERROR again\n', 'utf8');
    const config = normalizeLocalLogObservability({ files: ['app.log'], maxErrors: 0, minEntries: 4, forbidContains: ['again'], requireContains: ['healthy'] });
    const result = await runLocalLogObservability(config, { cwd: root, expectedSourceHead: 'head' });
    assert.equal(result.passed, false);
    assert.equal(result.checks.filter((check) => !check.passed).length, 4);
    assert.equal(result.failureCode, 'OBSERVABILITY_CHECK_FAILED');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('JSONL timestamp windows exclude old entries and require valid timestamps', async () => {
  const root = await tempRoot();
  const now = Date.parse('2026-09-16T00:00:00Z');
  try {
    await fs.writeFile(path.join(root, 'app.jsonl'), [
      JSON.stringify({ timestamp: '2026-09-15T23:59:30Z', level: 'error', message: 'fresh error' }),
      JSON.stringify({ timestamp: '2026-09-15T20:00:00Z', level: 'error', message: 'old error' }),
      JSON.stringify({ timestamp: '2026-09-15T23:59:45Z', level: 'info', message: 'ready' })
    ].join('\n') + '\n', 'utf8');
    const config = normalizeLocalLogObservability({ files: ['app.jsonl'], timestampField: 'timestamp', maxErrors: 1, requireContains: ['ready'] });
    const result = await runLocalLogObservability(config, { cwd: root, expectedSourceHead: 'head', windowSeconds: 60, nowMs: now });
    assert.equal(result.passed, true);
    assert.equal(result.diagnostics.totalEntries, 3);
    assert.equal(result.diagnostics.observedEntries, 2);
    assert.equal(result.diagnostics.errors, 1);
    assert.equal(result.diagnostics.windowApplied, true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('local log path containment rejects parent traversal and symlink escapes', async (t) => {
  assert.throws(() => normalizeLocalLogObservability({ files: ['../outside.log'] }), (error) => error.code === 'OBSERVABILITY_LOCAL_LOG_PATH_INVALID');
  const root = await tempRoot();
  const outside = await tempRoot('veteran-local-log-outside-');
  try {
    await fs.writeFile(path.join(outside, 'secret.log'), 'ERROR secret\n', 'utf8');
    try { await fs.symlink(path.join(outside, 'secret.log'), path.join(root, 'escape.log')); }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('symlink creation unavailable'); return; }
      throw error;
    }
    const config = normalizeLocalLogObservability({ files: ['escape.log'] });
    await assert.rejects(() => runLocalLogObservability(config, { cwd: root, expectedSourceHead: 'head' }), (error) => error.code === 'OBSERVABILITY_LOCAL_LOG_PATH_ESCAPE');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('local log configuration rejects arbitrary formats and text timestamp parsing', () => {
  assert.throws(() => normalizeLocalLogObservability({ files: ['app.log'], format: 'regex-script' }), (error) => error.code === 'OBSERVABILITY_LOCAL_LOG_CONFIG_INVALID');
  assert.throws(() => normalizeLocalLogObservability({ files: ['app.log'], format: 'text', timestampField: 'timestamp' }), (error) => error.code === 'OBSERVABILITY_LOCAL_LOG_CONFIG_INVALID');
});

test('local log observability deduplicates repeated and aliased files before counting', async (t) => {
  const root = await tempRoot();
  try {
    await fs.writeFile(path.join(root, 'app.log'), 'ERROR once\n', 'utf8');
    const files = ['app.log', 'app.log'];
    try {
      await fs.symlink(path.join(root, 'app.log'), path.join(root, 'alias.log'));
      files.push('alias.log');
    } catch (error) {
      if (!['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) throw error;
      t.diagnostic('symlink creation unavailable; exact duplicate coverage still applies');
    }
    const config = normalizeLocalLogObservability({ files, maxErrors: 1 });
    assert.equal(config.files.filter((file) => file === 'app.log').length, 1);
    const result = await runLocalLogObservability(config, { cwd: root, expectedSourceHead: 'head' });
    assert.equal(result.diagnostics.errors, 1);
    assert.equal(result.diagnostics.totalEntries, 1);
    assert.deepEqual(result.diagnostics.files, ['app.log']);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('observability keeps command mode backward compatible', async () => {
  const config = normalizeObservabilityValidation({
    command: [process.execPath, '-e', `let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const p=JSON.parse(input);process.stdout.write(JSON.stringify({contract:'veteran-observability-validation-v1',passed:true,summary:'legacy ok',observedSourceHead:p.expectedSourceHead,checks:[{name:'legacy',passed:true}]}));});`],
    target: 'legacy-provider',
    windowSeconds: 30
  });
  assert.equal(config.localLog, null);
  const result = await runObservabilityValidation(config, { cwd: process.cwd(), expectedSourceHead: 'abc' });
  assert.equal(result.passed, true);
  assert.equal(result.summary, 'legacy ok');
  assert.equal(result.observedSourceHead, 'abc');
});

test('observability localLog mode runs inside the existing result contract', async () => {
  const root = await tempRoot('veteran-obs-local-');
  try {
    await fs.writeFile(path.join(root, 'app.log'), 'INFO ready\nERROR one\n', 'utf8');
    const config = normalizeObservabilityValidation({
      target: 'local-app',
      windowSeconds: 30,
      localLog: { files: ['app.log'], maxErrors: 1, requireContains: ['ready'] }
    });
    assert.equal(config.command, null);
    assert.equal(config.localLog.contract, 'veteran-local-log-observability-v1');
    const result = await runObservabilityValidation(config, { cwd: root, expectedSourceHead: 'source-head' });
    assert.equal(result.contract, 'veteran-observability-validation-v1');
    assert.equal(result.passed, true);
    assert.equal(result.observedSourceHead, 'source-head');
    assert.equal(result.diagnostics.provider, 'local-log');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('observability rejects ambiguous command plus localLog configuration', () => {
  assert.throws(() => normalizeObservabilityValidation({
    target: 'bad',
    command: [process.execPath, '-e', ''],
    localLog: { files: ['app.log'] }
  }), (error) => error.code === 'OBSERVABILITY_PROVIDER_MODE_AMBIGUOUS');
});

test('observability without localLog preserves legacy command validation failure', () => {
  assert.throws(() => normalizeObservabilityValidation({ target: 'missing-command' }), (error) => error.code === 'OBSERVABILITY_PROVIDER_COMMAND_INVALID');
});
