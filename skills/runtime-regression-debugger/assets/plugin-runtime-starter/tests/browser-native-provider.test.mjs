import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  normalizeBrowserProviderResult,
  normalizeBrowserValidation
} from '../src/browser-validation-provider.mjs';
import {
  NATIVE_BROWSER_SCENARIO_CONTRACT,
  normalizeNativeBrowserScenario
} from '../src/browser-native-provider.mjs';

test('native browser validation materializes the existing provider and session protocols', () => {
  const config = normalizeBrowserValidation({
    native: { executablePath: '/opt/chromium/chrome' },
    scenarioFile: 'tests/browser/smoke.json',
    timeoutMs: 30_000,
    session: { timeoutMs: 7_500 }
  });
  assert.equal(config.native.provider, 'native-chromium');
  assert.equal(config.native.executablePath, '/opt/chromium/chrome');
  assert.equal(config.command[0], process.execPath);
  assert.equal(path.basename(config.command[1]), 'browser-native-provider.mjs');
  assert.deepEqual(config.command.slice(-2), ['--executable', '/opt/chromium/chrome']);
  assert.ok(config.session.command.includes('--session'));
  assert.equal(config.session.timeoutMs, 7_500);

  assert.throws(
    () => normalizeBrowserValidation({ native: { executablePath: '/opt/chromium/chrome' }, command: ['external-provider'], scenarioFile: 'smoke.json' }),
    (error) => error.code === 'BROWSER_PROVIDER_CONFIG_AMBIGUOUS'
  );
  assert.throws(
    () => normalizeBrowserValidation({ native: { executablePath: 'chromium' }, scenarioFile: 'smoke.json' }),
    (error) => error.code === 'BROWSER_NATIVE_EXECUTABLE_PATH_INVALID'
  );
});

test('external browser provider configuration remains compatible', () => {
  const config = normalizeBrowserValidation({
    command: [process.execPath, 'provider.cjs'],
    scenarioFile: 'scenario.json',
    baseUrl: 'http://127.0.0.1:3000/'
  });
  assert.deepEqual(config.command, [process.execPath, 'provider.cjs']);
  assert.equal(config.native, undefined);
});

test('native browser scenario is bounded and does not expose arbitrary evaluation or external navigation', () => {
  const scenario = normalizeNativeBrowserScenario({
    contract: NATIVE_BROWSER_SCENARIO_CONTRACT,
    steps: [
      { action: 'fill', selector: '#name', value: 'Ada' },
      { action: 'click', selector: '#save' },
      { action: 'assertText', selector: '#result', text: 'saved:Ada', match: 'equals' },
      { action: 'screenshot', filename: 'fullstack.png' }
    ]
  });
  assert.equal(scenario.steps.length, 4);
  assert.throws(
    () => normalizeNativeBrowserScenario({ contract: NATIVE_BROWSER_SCENARIO_CONTRACT, steps: [{ action: 'evaluate', script: 'process.exit()' }] }),
    (error) => error.code === 'BROWSER_NATIVE_SCENARIO_INVALID'
  );
  assert.throws(
    () => normalizeNativeBrowserScenario({ contract: NATIVE_BROWSER_SCENARIO_CONTRACT, steps: [{ action: 'goto', path: 'https://example.com/' }] }),
    (error) => error.code === 'BROWSER_NATIVE_SCENARIO_INVALID'
  );
});

test('browser provider result preserves bounded root-cause diagnostics without changing the base contract', () => {
  const result = normalizeBrowserProviderResult({
    contract: 'veteran-browser-validation-v1',
    passed: false,
    failureCode: 'BROWSER_PAGE_ERROR',
    assertions: [],
    currentUrl: 'http://127.0.0.1:3000/',
    diagnostics: { pageErrors: 1, crashes: 0, nested: { ignored: true } }
  }, 'http://127.0.0.1:3000/');
  assert.equal(result.failureCode, 'BROWSER_PAGE_ERROR');
  assert.deepEqual(result.providerDiagnostics, { pageErrors: 1, crashes: 0 });
});
