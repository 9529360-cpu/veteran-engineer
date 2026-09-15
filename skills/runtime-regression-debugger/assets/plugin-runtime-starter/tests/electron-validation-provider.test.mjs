import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ELECTRON_SCENARIO_CONTRACT,
  ELECTRON_VALIDATION_CONTRACT,
  normalizeElectronScenario,
  normalizeElectronValidation,
  runElectronValidation
} from '../src/electron-validation-provider.mjs';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-electron-provider-'));
  await fs.writeFile(path.join(root, 'electron-bin'), 'fake');
  return root;
}

function fakeAutomation(state = {}) {
  const locator = (selector) => ({
    async click() { state.clicks = [...(state.clicks || []), selector]; },
    async fill(value) { state.fills = [...(state.fills || []), [selector, value]]; },
    async press(key) { state.keys = [...(state.keys || []), [selector, key]]; },
    async waitFor() {},
    async textContent() { return selector === '#status' ? 'ready' : ''; },
    async inputValue() { return selector === '#field' ? 'abc' : ''; }
  });
  const page = {
    isClosed: () => false,
    title: async () => 'Veteran Electron Fixture',
    url: () => 'file:///main.html?secret=redacted',
    locator,
    keyboard: { press: async (key) => { state.keys = [...(state.keys || []), [null, key]]; } },
    screenshot: async () => Buffer.from('window-png'),
    on() {}
  };
  const app = {
    windows: () => [page],
    on() {},
    async close() { state.closed = true; },
    async evaluate(_fn, input) {
      if (!input) {
        return [{ index: 0, id: 7, type: 'webview', title: 'Guest', url: 'file:///guest.html?token=redacted', hostId: 1 }];
      }
      if (input.operation === 'inventory') return { ok: true, id: 7, type: 'webview', title: 'Guest', url: 'file:///guest.html', hostId: 1 };
      if (input.operation === 'fill') { state.guestValue = input.params.value; return { ok: true }; }
      if (input.operation === 'click') { state.guestClicked = true; return { ok: true }; }
      if (input.operation === 'press') { state.guestKey = input.params.key; return { ok: true }; }
      if (input.operation === 'inspect') return { ok: true, found: true, visible: true, text: 'guest-ready', value: state.guestValue || '' };
      if (input.operation === 'url') return { ok: true, url: 'file:///guest.html?token=redacted' };
      if (input.operation === 'screenshot') return { ok: true, pngBase64: Buffer.from('guest-png').toString('base64') };
      throw new Error(`unexpected guest operation ${input.operation}`);
    }
  };
  return { launch: async (options) => { state.launchOptions = options; return app; } };
}

test('electron validation config is bounded and rejects repository-escaping scenario paths and protected env overrides', () => {
  const normalized = normalizeElectronValidation({
    executablePath: '/opt/electron/electron',
    args: ['main.cjs'],
    scenarioFile: 'tests/electron/smoke.json',
    timeoutMs: 5000,
    stepTimeoutMs: 1000,
    envAllowlist: ['VETERAN_DESKTOP_TEST']
  });
  assert.equal(normalized.contract, ELECTRON_VALIDATION_CONTRACT);
  assert.deepEqual(normalized.args, ['main.cjs']);
  assert.equal(normalized.stepTimeoutMs, 1000);
  assert.equal(normalized.chromiumSandbox, true);
  assert.throws(
    () => normalizeElectronValidation({ executablePath: '/opt/electron/electron', scenarioFile: '../secret.json' }),
    (error) => error.code === 'ELECTRON_SCENARIO_PATH_ESCAPE'
  );
  assert.throws(
    () => normalizeElectronValidation({ executablePath: '/opt/electron/electron', scenarioFile: 'smoke.json', envAllowlist: ['HOME'] }),
    (error) => error.code === 'ELECTRON_ENV_INVALID'
  );
  assert.throws(
    () => normalizeElectronValidation({ executablePath: '/opt/electron/electron', scenarioFile: 'smoke.json', chromiumSandbox: 'yes' }),
    (error) => error.code === 'ELECTRON_VALIDATION_CONFIG_INVALID'
  );
});

test('electron scenario exposes a bounded BrowserWindow and webview interaction DSL without arbitrary JavaScript', () => {
  const scenario = normalizeElectronScenario({
    contract: ELECTRON_SCENARIO_CONTRACT,
    steps: [
      { action: 'click', selector: '#save' },
      { action: 'fill', target: { type: 'webview', urlIncludes: 'guest' }, selector: '#name', value: 'Ada' },
      { action: 'press', target: { type: 'webview' }, selector: '#name', key: 'Enter' },
      { action: 'assertText', selector: '#status', text: 'saved' },
      { action: 'screenshot', filename: 'final.png' }
    ]
  });
  assert.equal(scenario.steps.length, 5);
  assert.equal(scenario.steps[1].target.type, 'webview');
  assert.throws(
    () => normalizeElectronScenario({ contract: ELECTRON_SCENARIO_CONTRACT, steps: [{ action: 'evaluate', script: 'process.exit()' }] }),
    (error) => error.code === 'ELECTRON_SCENARIO_INVALID'
  );
});

test('electron validation drives windows and webview guests, captures evidence, sanitizes URLs, and closes the app', async () => {
  const root = await fixture();
  const state = {};
  try {
    await fs.writeFile(path.join(root, 'scenario.json'), `${JSON.stringify({
      contract: ELECTRON_SCENARIO_CONTRACT,
      steps: [
        { action: 'waitForSurface', target: { type: 'window', titleIncludes: 'Veteran' } },
        { action: 'assertText', selector: '#status', text: 'ready', match: 'equals' },
        { action: 'click', selector: '#go' },
        { action: 'assertValue', selector: '#field', value: 'abc' },
        { action: 'screenshot', filename: 'window.png' },
        { action: 'waitForSurface', target: { type: 'webview', urlIncludes: 'guest' } },
        { action: 'fill', target: { type: 'webview', urlIncludes: 'guest' }, selector: '#field', value: 'hello' },
        { action: 'click', target: { type: 'webview', urlIncludes: 'guest' }, selector: '#go' },
        { action: 'assertText', target: { type: 'webview', urlIncludes: 'guest' }, selector: '#status', text: 'guest-ready', match: 'equals' },
        { action: 'screenshot', target: { type: 'webview', urlIncludes: 'guest' }, filename: 'guest.png' }
      ]
    })}\n`);
    const config = normalizeElectronValidation({ executablePath: 'electron-bin', scenarioFile: 'scenario.json', timeoutMs: 5000, stepTimeoutMs: 1000 });
    const result = await runElectronValidation(config, { cwd: root, automation: fakeAutomation(state), environment: { PATH: process.env.PATH || '' } });
    assert.equal(result.passed, true, result.summary);
    assert.equal(result.assertions.length, 3);
    assert.deepEqual(result.attachments.map((item) => item.name), ['electron/window.png', 'electron/guest.png']);
    assert.equal(result.surfaces.windows[0].url, 'file:///main.html');
    assert.equal(result.surfaces.webviews[0].url, 'file:///guest.html');
    assert.equal(state.guestValue, 'hello');
    assert.equal(state.guestClicked, true);
    assert.equal(state.launchOptions.chromiumSandbox, true);
    assert.equal(state.closed, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('electron assertion failure fails closed and captures a best-effort failure screenshot', async () => {
  const root = await fixture();
  try {
    await fs.writeFile(path.join(root, 'scenario.json'), `${JSON.stringify({
      contract: ELECTRON_SCENARIO_CONTRACT,
      steps: [{ action: 'assertText', selector: '#status', text: 'not-ready', match: 'equals' }]
    })}\n`);
    const config = normalizeElectronValidation({ executablePath: 'electron-bin', scenarioFile: 'scenario.json', timeoutMs: 2000, stepTimeoutMs: 300 });
    const result = await runElectronValidation(config, { cwd: root, automation: fakeAutomation(), environment: { PATH: process.env.PATH || '' } });
    assert.equal(result.passed, false);
    assert.equal(result.failureCode, 'ELECTRON_ASSERTION_FAILED');
    assert.equal(result.assertions[0].passed, false);
    assert.equal(result.attachments[0].kind, 'electron-failure-screenshot');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
