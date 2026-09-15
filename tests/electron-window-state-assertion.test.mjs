import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ELECTRON_SCENARIO_CONTRACT,
  normalizeElectronScenario,
  normalizeElectronValidation,
  runElectronValidation
} from '../src/electron-validation-provider.mjs';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-electron-window-state-'));
  await fs.writeFile(path.join(root, 'electron-bin'), 'fake');
  return root;
}

function zeroDiagnostics() {
  return {
    consoleMessages: 0,
    pageErrors: 0,
    crashes: 0,
    unresponsiveEvents: 0,
    responsiveEvents: 0,
    activeUnresponsive: 0,
    webContentsObserved: 1
  };
}

function fakeAutomation(state) {
  const surfaces = {
    windows: [{ index: 0, id: 1, type: 'window', title: 'Veteran Window', url: 'file:///window.html', hostId: null }],
    webviews: []
  };
  return {
    async launch() {
      return {
        async listSurfaces() { return surfaces; },
        async command(_target, operation) {
          if (operation === 'windowState') {
            state.calls = (state.calls || 0) + 1;
            const sequence = state.sequence || [state.windowState];
            const observed = sequence[Math.min(state.calls - 1, sequence.length - 1)];
            return { ok: true, state: observed };
          }
          if (operation === 'diagnostics') return { ok: true, diagnostics: zeroDiagnostics() };
          if (operation === 'screenshot') return { ok: true, pngBase64: Buffer.from('png').toString('base64') };
          return { ok: false, code: 'UNEXPECTED_OPERATION' };
        },
        async close() { state.closed = true; }
      };
    }
  };
}

test('assertWindowState accepts only bounded BrowserWindow expectations', () => {
  const scenario = normalizeElectronScenario({
    contract: ELECTRON_SCENARIO_CONTRACT,
    steps: [{
      action: 'assertWindowState',
      target: { type: 'window', titleIncludes: 'Veteran' },
      state: { visible: true, maximized: false, bounds: { width: 900, height: 700 } }
    }]
  });
  assert.deepEqual(scenario.steps[0].state, {
    visible: true,
    maximized: false,
    bounds: { width: 900, height: 700 }
  });
  assert.throws(
    () => normalizeElectronScenario({ contract: ELECTRON_SCENARIO_CONTRACT, steps: [{ action: 'assertWindowState', target: { type: 'webview' }, state: { visible: true } }] }),
    (error) => error.code === 'ELECTRON_SCENARIO_INVALID'
  );
  assert.throws(
    () => normalizeElectronScenario({ contract: ELECTRON_SCENARIO_CONTRACT, steps: [{ action: 'assertWindowState', state: {} }] }),
    (error) => error.code === 'ELECTRON_SCENARIO_INVALID'
  );
  assert.throws(
    () => normalizeElectronScenario({ contract: ELECTRON_SCENARIO_CONTRACT, steps: [{ action: 'assertWindowState', state: { x: 10 } }] }),
    (error) => error.code === 'ELECTRON_SCENARIO_INVALID'
  );
  assert.throws(
    () => normalizeElectronScenario({ contract: ELECTRON_SCENARIO_CONTRACT, steps: [{ action: 'assertWindowState', state: { bounds: { width: '900' } } }] }),
    (error) => error.code === 'ELECTRON_SCENARIO_INVALID'
  );
});

test('assertWindowState polls native state until the bounded expectation is satisfied', async () => {
  const root = await fixture();
  const state = {
    sequence: [
      { visible: false, minimized: false, maximized: false, fullScreen: false, bounds: { width: 900, height: 700 } },
      { visible: true, minimized: false, maximized: false, fullScreen: false, bounds: { width: 900, height: 700 } }
    ]
  };
  try {
    await fs.writeFile(path.join(root, 'scenario.json'), `${JSON.stringify({
      contract: ELECTRON_SCENARIO_CONTRACT,
      steps: [{ action: 'assertWindowState', state: { visible: true, bounds: { width: 900 } }, timeoutMs: 1000 }]
    })}\n`);
    const config = normalizeElectronValidation({ executablePath: 'electron-bin', scenarioFile: 'scenario.json', timeoutMs: 2000, stepTimeoutMs: 1000 });
    const result = await runElectronValidation(config, { cwd: root, automation: fakeAutomation(state), environment: { PATH: process.env.PATH || '' } });
    assert.equal(result.passed, true, result.summary);
    assert.equal(result.assertions[0].passed, true);
    assert.ok(state.calls >= 2);
    assert.match(result.assertions[0].detail, /"visible":true/);
    assert.equal(state.closed, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('assertWindowState fails closed when native state never matches', async () => {
  const root = await fixture();
  const state = {
    windowState: { visible: true, minimized: false, maximized: false, fullScreen: false, bounds: { width: 900, height: 700 } }
  };
  try {
    await fs.writeFile(path.join(root, 'scenario.json'), `${JSON.stringify({
      contract: ELECTRON_SCENARIO_CONTRACT,
      steps: [{ action: 'assertWindowState', state: { maximized: true }, timeoutMs: 250 }]
    })}\n`);
    const config = normalizeElectronValidation({ executablePath: 'electron-bin', scenarioFile: 'scenario.json', timeoutMs: 2000, stepTimeoutMs: 250 });
    const result = await runElectronValidation(config, { cwd: root, automation: fakeAutomation(state), environment: { PATH: process.env.PATH || '' } });
    assert.equal(result.passed, false);
    assert.equal(result.failureCode, 'ELECTRON_ASSERTION_FAILED');
    assert.equal(result.assertions[0].passed, false);
    assert.match(result.assertions[0].detail, /"maximized":false/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
