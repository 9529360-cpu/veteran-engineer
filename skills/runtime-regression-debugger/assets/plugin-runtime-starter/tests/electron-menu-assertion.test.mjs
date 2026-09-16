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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-electron-menu-assertion-'));
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
    windows: [{ index: 0, id: 1, type: 'window', title: 'Veteran Menu', url: 'file:///menu.html', hostId: null }],
    webviews: []
  };
  return {
    async launch() {
      return {
        async listSurfaces() { return surfaces; },
        async command(_target, operation) {
          if (operation === 'menuInventory') {
            state.calls = (state.calls || 0) + 1;
            const sequence = state.sequence || [state.menu];
            const menu = sequence[Math.min(state.calls - 1, sequence.length - 1)];
            return { ok: true, menu };
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

function menu(items, truncated = false) {
  return { items, truncated, maxItems: 256, maxDepth: 8 };
}

test('assertMenuItem accepts only bounded application-level inert metadata expectations', () => {
  const scenario = normalizeElectronScenario({
    contract: ELECTRON_SCENARIO_CONTRACT,
    steps: [{
      action: 'assertMenuItem',
      item: {
        id: 'open-project',
        label: 'Open Project',
        accelerator: 'CommandOrControl+O',
        enabled: true,
        visible: true
      }
    }]
  });
  assert.deepEqual(scenario.steps[0].item, {
    id: 'open-project',
    label: 'Open Project',
    accelerator: 'CommandOrControl+O',
    enabled: true,
    visible: true
  });
  assert.throws(
    () => normalizeElectronScenario({ contract: ELECTRON_SCENARIO_CONTRACT, steps: [{ action: 'assertMenuItem', target: { type: 'window' }, item: { id: 'open-project' } }] }),
    (error) => error.code === 'ELECTRON_SCENARIO_INVALID'
  );
  assert.throws(
    () => normalizeElectronScenario({ contract: ELECTRON_SCENARIO_CONTRACT, steps: [{ action: 'assertMenuItem', item: { enabled: true } }] }),
    (error) => error.code === 'ELECTRON_SCENARIO_INVALID'
  );
  assert.throws(
    () => normalizeElectronScenario({ contract: ELECTRON_SCENARIO_CONTRACT, steps: [{ action: 'assertMenuItem', item: { id: 'open-project', click: true } }] }),
    (error) => error.code === 'ELECTRON_SCENARIO_INVALID'
  );
  assert.throws(
    () => normalizeElectronScenario({ contract: ELECTRON_SCENARIO_CONTRACT, steps: [{ action: 'assertMenuItem', item: { id: undefined } }] }),
    (error) => error.code === 'ELECTRON_SCENARIO_INVALID'
  );
  assert.throws(
    () => normalizeElectronScenario({ contract: ELECTRON_SCENARIO_CONTRACT, steps: [{ action: 'assertMenuItem', item: { id: 'open-project', checked: 'yes' } }] }),
    (error) => error.code === 'ELECTRON_SCENARIO_INVALID'
  );
});

test('assertMenuItem polls menu inventory until the bounded expectation is satisfied', async () => {
  const root = await fixture();
  const state = {
    sequence: [
      menu([{ id: 'open-project', label: 'Open Project', role: null, type: 'normal', accelerator: 'Ctrl+O', enabled: false, visible: true, checked: false }]),
      menu([{ id: 'open-project', label: 'Open Project', role: null, type: 'normal', accelerator: 'Ctrl+O', enabled: true, visible: true, checked: false }])
    ]
  };
  try {
    await fs.writeFile(path.join(root, 'scenario.json'), `${JSON.stringify({
      contract: ELECTRON_SCENARIO_CONTRACT,
      steps: [{ action: 'assertMenuItem', item: { id: 'open-project', accelerator: 'Ctrl+O', enabled: true }, timeoutMs: 1000 }]
    })}\n`);
    const config = normalizeElectronValidation({ executablePath: 'electron-bin', scenarioFile: 'scenario.json', timeoutMs: 2000, stepTimeoutMs: 1000 });
    const result = await runElectronValidation(config, { cwd: root, automation: fakeAutomation(state), environment: { PATH: process.env.PATH || '' } });
    assert.equal(result.passed, true, result.summary);
    assert.equal(result.assertions[0].passed, true);
    assert.ok(state.calls >= 2);
    assert.match(result.assertions[0].detail, /matched=true/);
    assert.equal(state.closed, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('assertMenuItem fails as an assertion when a complete menu never matches', async () => {
  const root = await fixture();
  const state = {
    menu: menu([{ id: 'open-project', label: 'Open Project', role: null, type: 'normal', accelerator: 'Ctrl+O', enabled: false, visible: true, checked: false }])
  };
  try {
    await fs.writeFile(path.join(root, 'scenario.json'), `${JSON.stringify({
      contract: ELECTRON_SCENARIO_CONTRACT,
      steps: [{ action: 'assertMenuItem', item: { id: 'open-project', enabled: true }, timeoutMs: 250 }]
    })}\n`);
    const config = normalizeElectronValidation({ executablePath: 'electron-bin', scenarioFile: 'scenario.json', timeoutMs: 2000, stepTimeoutMs: 250 });
    const result = await runElectronValidation(config, { cwd: root, automation: fakeAutomation(state), environment: { PATH: process.env.PATH || '' } });
    assert.equal(result.passed, false);
    assert.equal(result.failureCode, 'ELECTRON_ASSERTION_FAILED');
    assert.equal(result.assertions[0].passed, false);
    assert.match(result.assertions[0].detail, /truncated=false/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('assertMenuItem fails closed when truncated inventory cannot prove absence', async () => {
  const root = await fixture();
  const state = {
    menu: menu([{ id: 'other', label: 'Other', role: null, type: 'normal', accelerator: null, enabled: true, visible: true, checked: false }], true)
  };
  try {
    await fs.writeFile(path.join(root, 'scenario.json'), `${JSON.stringify({
      contract: ELECTRON_SCENARIO_CONTRACT,
      steps: [{ action: 'assertMenuItem', item: { id: 'open-project' }, timeoutMs: 250 }]
    })}\n`);
    const config = normalizeElectronValidation({ executablePath: 'electron-bin', scenarioFile: 'scenario.json', timeoutMs: 2000, stepTimeoutMs: 250 });
    const result = await runElectronValidation(config, { cwd: root, automation: fakeAutomation(state), environment: { PATH: process.env.PATH || '' } });
    assert.equal(result.passed, false);
    assert.equal(result.failureCode, 'ELECTRON_MENU_INVENTORY_TRUNCATED');
    assert.equal(result.assertions[0].passed, false);
    assert.match(result.assertions[0].detail, /truncated=true/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
