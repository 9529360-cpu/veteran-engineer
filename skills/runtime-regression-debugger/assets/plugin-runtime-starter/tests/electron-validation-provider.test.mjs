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

function zeroDiagnostics(overrides = {}) {
  return {
    consoleMessages: 0,
    pageErrors: 0,
    crashes: 0,
    unresponsiveEvents: 0,
    responsiveEvents: 0,
    activeUnresponsive: 0,
    webContentsObserved: 2,
    ...overrides
  };
}

function fakeAutomation(state = {}) {
  const surfaces = {
    windows: [{ index: 0, id: 1, type: 'window', title: 'Veteran Electron Fixture', url: 'file:///main.html?secret=redacted', hostId: null }],
    webviews: [{ index: 0, id: 7, type: 'webview', title: 'Guest', url: 'file:///guest.html?token=redacted', hostId: 1 }]
  };
  const command = async (target, operation, params = {}) => {
    const webview = target?.type === 'webview';
    if (operation === 'diagnostics') return { ok: true, diagnostics: state.runtimeDiagnostics || zeroDiagnostics() };
    if (operation === 'fill') {
      if (webview) state.guestValue = params.value;
      else state.windowValue = params.value;
      return { ok: true };
    }
    if (operation === 'click') {
      if (webview) state.guestClicked = true;
      else state.windowClicked = true;
      return { ok: true };
    }
    if (operation === 'press') {
      state.lastKey = params.key;
      return { ok: true };
    }
    if (operation === 'url') return { ok: true, url: webview ? surfaces.webviews[0].url : surfaces.windows[0].url };
    if (operation === 'inspect') {
      if (webview) return { ok: true, found: true, visible: true, text: 'guest-ready', value: state.guestValue || '' };
      return { ok: true, found: true, visible: true, text: params.selector === '#status' ? 'ready' : '', value: params.selector === '#field' ? 'abc' : '' };
    }
    if (operation === 'screenshot') return { ok: true, pngBase64: Buffer.from(webview ? 'guest-png' : 'window-png').toString('base64') };
    return { ok: false, code: 'UNEXPECTED_OPERATION' };
  };
  return {
    async launch(options) {
      state.launchOptions = options;
      if (typeof state.onLaunch === 'function') await state.onLaunch(options);
      return {
        async listSurfaces() { return surfaces; },
        command,
        async close() { state.closed = true; }
      };
    }
  };
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
  assert.equal(normalized.captureFinalScreenshot, true);
  assert.equal(normalized.captureFailureScreenshots, true);
  assert.equal(normalized.chromiumSandbox, true);
  assert.equal(normalizeElectronValidation({
    executablePath: '/opt/electron/electron',
    scenarioFile: 'tests/electron/smoke.json',
    captureFinalScreenshot: false
  }).captureFinalScreenshot, false);
  assert.throws(
    () => normalizeElectronValidation({ executablePath: '/opt/electron/electron', scenarioFile: '../secret.json' }),
    (error) => error.code === 'ELECTRON_SCENARIO_PATH_ESCAPE'
  );
  for (const variable of ['HOME', 'UserProfile', 'APPDATA', 'localappdata', 'HomeDrive', 'HomePath']) {
    assert.throws(
      () => normalizeElectronValidation({ executablePath: '/opt/electron/electron', scenarioFile: 'smoke.json', envAllowlist: [variable] }),
      (error) => error.code === 'ELECTRON_ENV_INVALID',
      variable
    );
  }
  assert.throws(
    () => normalizeElectronValidation({ executablePath: '/opt/electron/electron', scenarioFile: 'smoke.json', chromiumSandbox: 'yes' }),
    (error) => error.code === 'ELECTRON_VALIDATION_CONFIG_INVALID'
  );
  assert.throws(
    () => normalizeElectronValidation({ executablePath: '/opt/electron/electron', scenarioFile: 'smoke.json', captureFinalScreenshot: 'no' }),
    (error) => error.code === 'ELECTRON_VALIDATION_CONFIG_INVALID'
  );
  assert.throws(
    () => normalizeElectronValidation({ executablePath: '/opt/electron/electron', scenarioFile: 'smoke.json', captureFailureScreenshots: 'no' }),
    (error) => error.code === 'ELECTRON_VALIDATION_CONFIG_INVALID'
  );
});

test('electron validation can suppress automatic success screenshots for privacy-sensitive authenticated surfaces', async () => {
  const root = await fixture();
  const state = {};
  try {
    await fs.writeFile(path.join(root, 'scenario.json'), JSON.stringify({
      contract: ELECTRON_SCENARIO_CONTRACT,
      steps: [{ action: 'waitForSurface', target: { type: 'window', index: 0 } }]
    }) + '\n');
    const config = normalizeElectronValidation({
      executablePath: 'electron-bin',
      scenarioFile: 'scenario.json',
      timeoutMs: 5000,
      stepTimeoutMs: 1000,
      captureFinalScreenshot: false,
      captureFailureScreenshots: false
    });
    const result = await runElectronValidation(config, {
      cwd: root,
      automation: fakeAutomation(state),
      environment: { PATH: process.env.PATH || '' }
    });
    assert.equal(result.passed, true, result.summary);
    assert.deepEqual(result.attachments, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('electron validation can suppress automatic failure screenshots for privacy-sensitive authenticated surfaces', async () => {
  const root = await fixture();
  const state = {};
  try {
    await fs.writeFile(path.join(root, 'scenario.json'), JSON.stringify({
      contract: ELECTRON_SCENARIO_CONTRACT,
      steps: [{ action: 'assertText', selector: '#status', text: 'never-matches', match: 'equals', timeoutMs: 250 }]
    }) + '\n');
    const config = normalizeElectronValidation({
      executablePath: 'electron-bin',
      scenarioFile: 'scenario.json',
      timeoutMs: 1000,
      stepTimeoutMs: 250,
      captureFinalScreenshot: false,
      captureFailureScreenshots: false
    });
    const result = await runElectronValidation(config, {
      cwd: root,
      automation: fakeAutomation(state),
      environment: { PATH: process.env.PATH || '' }
    });
    assert.equal(result.passed, false);
    assert.deepEqual(result.attachments, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('electron scenario exposes bounded BrowserWindow and webview lifecycle assertions without arbitrary JavaScript', () => {
  const scenario = normalizeElectronScenario({
    contract: ELECTRON_SCENARIO_CONTRACT,
    steps: [
      { action: 'assertSurfaceCount', target: { type: 'window', titleIncludes: 'Veteran' }, count: 1 },
      { action: 'click', selector: '#save' },
      { action: 'fill', target: { type: 'webview', urlIncludes: 'guest' }, selector: '#name', value: 'Ada' },
      { action: 'press', target: { type: 'webview' }, selector: '#name', key: 'Enter' },
      { action: 'assertText', selector: '#status', text: 'saved' },
      { action: 'screenshot', filename: 'final.png' }
    ]
  });
  assert.equal(scenario.steps.length, 6);
  assert.equal(scenario.steps[0].count, 1);
  assert.equal(scenario.steps[2].target.type, 'webview');
  assert.throws(
    () => normalizeElectronScenario({ contract: ELECTRON_SCENARIO_CONTRACT, steps: [{ action: 'assertSurfaceCount', count: 65 }] }),
    (error) => error.code === 'ELECTRON_SCENARIO_INVALID'
  );
  assert.throws(
    () => normalizeElectronScenario({ contract: ELECTRON_SCENARIO_CONTRACT, steps: [{ action: 'evaluate', script: 'process.exit()' }] }),
    (error) => error.code === 'ELECTRON_SCENARIO_INVALID'
  );
});

test('electron validation owns a complete private Windows profile before launch', async () => {
  const root = await fixture();
  const state = {
    async onLaunch(options) {
      assert.notEqual(options.env.HOME, 'caller-home-secret');
      assert.equal(options.env.USERPROFILE, options.env.HOME);
      assert.equal(options.env.VETERAN_DESKTOP_TEST, 'explicitly-allowed');
      assert.equal(options.env.VETERAN_PRIVATE_SECRET, undefined);
      if (process.platform === 'win32') {
        assert.equal(options.env.HOMEDRIVE + options.env.HOMEPATH, options.env.HOME);
        assert.equal(options.env.APPDATA, path.join(options.env.HOME, 'AppData', 'Roaming'));
        assert.equal(options.env.LOCALAPPDATA, path.join(options.env.HOME, 'AppData', 'Local'));
        assert.equal((await fs.stat(options.env.APPDATA)).isDirectory(), true);
        assert.equal((await fs.stat(options.env.LOCALAPPDATA)).isDirectory(), true);
      }
    }
  };
  try {
    await fs.writeFile(path.join(root, 'scenario.json'), `${JSON.stringify({
      contract: ELECTRON_SCENARIO_CONTRACT,
      steps: [{ action: 'waitForSurface', target: { type: 'window', index: 0 } }]
    })}\n`);
    const config = normalizeElectronValidation({
      executablePath: 'electron-bin',
      scenarioFile: 'scenario.json',
      timeoutMs: 5000,
      stepTimeoutMs: 1000,
      envAllowlist: ['VETERAN_DESKTOP_TEST']
    });
    const result = await runElectronValidation(config, {
      cwd: root,
      automation: fakeAutomation(state),
      environment: {
        PATH: process.env.PATH || '',
        HOME: 'caller-home-secret',
        USERPROFILE: 'caller-profile-secret',
        HOMEDRIVE: 'Z:',
        HOMEPATH: '\\caller-profile-secret',
        APPDATA: 'caller-roaming-secret',
        LOCALAPPDATA: 'caller-local-secret',
        VETERAN_DESKTOP_TEST: 'explicitly-allowed',
        VETERAN_PRIVATE_SECRET: 'must-not-leak'
      }
    });
    assert.equal(result.passed, true, result.summary);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('electron validation drives windows and webview guests, asserts surface counts, captures evidence, sanitizes URLs, and closes the app', async () => {
  const root = await fixture();
  const state = {};
  try {
    await fs.writeFile(path.join(root, 'scenario.json'), `${JSON.stringify({
      contract: ELECTRON_SCENARIO_CONTRACT,
      steps: [
        { action: 'assertSurfaceCount', target: { type: 'window', titleIncludes: 'Veteran' }, count: 1 },
        { action: 'waitForSurface', target: { type: 'window', titleIncludes: 'Veteran' } },
        { action: 'assertText', selector: '#status', text: 'ready', match: 'equals' },
        { action: 'click', selector: '#go' },
        { action: 'assertValue', selector: '#field', value: 'abc' },
        { action: 'screenshot', filename: 'window.png' },
        { action: 'assertSurfaceCount', target: { type: 'webview', urlIncludes: 'guest' }, count: 1 },
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
    assert.equal(result.assertions.length, 5);
    assert.deepEqual(result.assertions.slice(0, 1), [{ name: 'assertSurfaceCount step 1', passed: true, detail: 'expected=1 observed=1' }]);
    assert.deepEqual(result.attachments.map((item) => item.name), ['electron/window.png', 'electron/guest.png']);
    assert.equal(result.surfaces.windows[0].url, 'file:///main.html');
    assert.equal(result.surfaces.webviews[0].url, 'file:///guest.html');
    assert.equal(result.diagnostics.crashes, 0);
    assert.equal(result.diagnostics.webContentsObserved, 2);
    assert.equal(state.guestValue, 'hello');
    assert.equal(state.guestClicked, true);
    assert.equal(state.launchOptions.chromiumSandbox, true);
    assert.equal(state.closed, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('electron surface count assertion polls until matching windows disappear', async () => {
  const root = await fixture();
  let listCalls = 0;
  const sequence = [1, 1, 0];
  const automation = {
    async launch() {
      return {
        async listSurfaces() {
          const count = sequence[Math.min(listCalls++, sequence.length - 1)];
          return {
            windows: Array.from({ length: count }, (_, index) => ({ index, id: index + 10, type: 'window', title: `Secondary ${index}`, url: `file:///secondary-${index}.html`, hostId: null })),
            webviews: []
          };
        },
        async command() { return { ok: false, code: 'UNEXPECTED_OPERATION' }; },
        async close() {}
      };
    }
  };
  try {
    await fs.writeFile(path.join(root, 'scenario.json'), `${JSON.stringify({
      contract: ELECTRON_SCENARIO_CONTRACT,
      steps: [{ action: 'assertSurfaceCount', target: { type: 'window', titleIncludes: 'Secondary' }, count: 0, timeoutMs: 1000 }]
    })}\n`);
    const config = normalizeElectronValidation({ executablePath: 'electron-bin', scenarioFile: 'scenario.json', timeoutMs: 2000, stepTimeoutMs: 1000 });
    const result = await runElectronValidation(config, { cwd: root, automation, environment: { PATH: process.env.PATH || '' } });
    assert.equal(result.passed, true, result.summary);
    assert.equal(result.assertions[0].detail, 'expected=0 observed=0');
    assert.ok(listCalls >= 3);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('electron renderer crash diagnostics fail closed even when scenario steps complete', async () => {
  const root = await fixture();
  const state = { runtimeDiagnostics: zeroDiagnostics({ crashes: 1 }) };
  try {
    await fs.writeFile(path.join(root, 'scenario.json'), `${JSON.stringify({
      contract: ELECTRON_SCENARIO_CONTRACT,
      steps: [{ action: 'waitForSurface', target: { type: 'window', titleIncludes: 'Veteran' } }]
    })}\n`);
    const config = normalizeElectronValidation({ executablePath: 'electron-bin', scenarioFile: 'scenario.json', timeoutMs: 2000, stepTimeoutMs: 500 });
    const result = await runElectronValidation(config, { cwd: root, automation: fakeAutomation(state), environment: { PATH: process.env.PATH || '' } });
    assert.equal(result.passed, false);
    assert.equal(result.failureCode, 'ELECTRON_RENDERER_CRASHED');
    assert.equal(result.diagnostics.crashes, 1);
    assert.match(result.summary, /renderer crash event/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('electron recovered unresponsive episode stays diagnostic without false failure', async () => {
  const root = await fixture();
  const state = { runtimeDiagnostics: zeroDiagnostics({ unresponsiveEvents: 1, responsiveEvents: 1, activeUnresponsive: 0 }) };
  try {
    await fs.writeFile(path.join(root, 'scenario.json'), `${JSON.stringify({
      contract: ELECTRON_SCENARIO_CONTRACT,
      steps: [{ action: 'waitForSurface', target: { type: 'window', titleIncludes: 'Veteran' } }]
    })}\n`);
    const config = normalizeElectronValidation({ executablePath: 'electron-bin', scenarioFile: 'scenario.json', timeoutMs: 2000, stepTimeoutMs: 500 });
    const result = await runElectronValidation(config, { cwd: root, automation: fakeAutomation(state), environment: { PATH: process.env.PATH || '' } });
    assert.equal(result.passed, true, result.summary);
    assert.equal(result.diagnostics.unresponsiveEvents, 1);
    assert.equal(result.diagnostics.responsiveEvents, 1);
    assert.equal(result.diagnostics.activeUnresponsive, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('electron validation fails closed when a renderer remains unresponsive', async () => {
  const root = await fixture();
  const state = { runtimeDiagnostics: zeroDiagnostics({ unresponsiveEvents: 1, activeUnresponsive: 1 }) };
  try {
    await fs.writeFile(path.join(root, 'scenario.json'), `${JSON.stringify({
      contract: ELECTRON_SCENARIO_CONTRACT,
      steps: [{ action: 'waitForSurface', target: { type: 'window', titleIncludes: 'Veteran' } }]
    })}\n`);
    const config = normalizeElectronValidation({ executablePath: 'electron-bin', scenarioFile: 'scenario.json', timeoutMs: 2000, stepTimeoutMs: 500 });
    const result = await runElectronValidation(config, { cwd: root, automation: fakeAutomation(state), environment: { PATH: process.env.PATH || '' } });
    assert.equal(result.passed, false);
    assert.equal(result.failureCode, 'ELECTRON_RENDERER_UNRESPONSIVE');
    assert.equal(result.diagnostics.activeUnresponsive, 1);
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
