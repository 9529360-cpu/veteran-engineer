import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizeBrowserValidation, runBrowserValidation } from '../src/browser-validation-provider.mjs';

async function startupFixture(t, executablePath) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-native-startup-'));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  await fs.writeFile(path.join(cwd, 'scenario.json'), JSON.stringify({
    contract: 'veteran-browser-scenario-v1',
    steps: [{ action: 'screenshot', filename: 'screen.png' }]
  }));
  const browser = normalizeBrowserValidation({
    native: { executablePath: executablePath || path.join(cwd, 'private-secret-missing-browser') },
    scenarioFile: 'scenario.json', baseUrl: 'http://127.0.0.1:34567/', timeoutMs: 5000
  });
  return { cwd, browser };
}

test('native browser spawn failure survives provider boundary without leaking executable paths', { timeout: 10000 }, async (t) => {
  const { cwd, browser } = await startupFixture(t);
  const result = await runBrowserValidation(browser, { cwd });
  assert.equal(result.passed, false);
  assert.equal(result.failureCode, 'BROWSER_NATIVE_SPAWN_FAILED');
  assert.equal(result.providerDiagnostics?.phase, 'startup');
  assert.deepEqual(result.assertions, []);
  assert.equal(result.diagnostics.stdoutTruncated, false);
  assert.doesNotMatch(JSON.stringify(result), /private-secret-missing-browser|node:internal|Error: spawn/);
});

test('native browser early exit survives provider boundary as a classified failure', { timeout: 10000 }, async (t) => {
  // Node is an executable but rejects Chromium flags, deterministically exiting
  // before a CDP handshake. This is a real child process, not a fake browser.
  const { cwd, browser } = await startupFixture(t, process.execPath);
  const result = await runBrowserValidation(browser, { cwd });
  assert.equal(result.passed, false);
  assert.ok(['BROWSER_NATIVE_PROCESS_EXITED', 'BROWSER_NATIVE_CDP_PIPE_FAILED'].includes(result.failureCode), JSON.stringify(result));
  assert.equal(result.providerDiagnostics?.phase, 'startup');
  assert.deepEqual(result.assertions, []);
  assert.equal(result.diagnostics.timedOut, false);
});
