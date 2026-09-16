import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ELECTRON_SCENARIO_CONTRACT,
  normalizeElectronValidation,
  runElectronValidation
} from '../src/electron-validation-provider.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

const electronPath = process.env.VETERAN_TEST_ELECTRON_PATH || null;

const mainSource = String.raw`
const path = require('node:path');
const { app, BrowserWindow, Menu } = require('electron');
app.whenReady().then(async () => {
  const menu = Menu.buildFromTemplate([{
    id: 'file-menu',
    label: 'File',
    submenu: [
      { id: 'open-project', label: 'Open Project', accelerator: 'CommandOrControl+O', click() {} },
      { type: 'separator' },
      { id: 'feature-toggle', label: 'Feature Enabled', type: 'checkbox', checked: true, enabled: false }
    ]
  }]);
  Menu.setApplicationMenu(menu);
  const win = new BrowserWindow({ width: 900, height: 700, show: true });
  await win.loadFile(path.join(__dirname, 'index.html'));
});
app.on('window-all-closed', () => app.quit());
`;

const html = '<!doctype html><html><head><title>Veteran Menu Assertion Fixture</title></head><body>ready</body></html>';

test('Electron scenario asserts bounded application-menu and accelerator metadata without executing menu items', { skip: !electronPath, timeout: 120_000 }, async () => {
  const scenario = {
    contract: ELECTRON_SCENARIO_CONTRACT,
    steps: [
      {
        action: 'assertMenuItem',
        item: {
          id: 'open-project',
          label: 'Open Project',
          accelerator: 'CommandOrControl+O',
          enabled: true,
          visible: true
        },
        timeoutMs: 15_000
      },
      {
        action: 'assertMenuItem',
        item: {
          id: 'feature-toggle',
          type: 'checkbox',
          checked: true,
          enabled: false,
          visible: true
        },
        timeoutMs: 15_000
      }
    ]
  };
  const { root, repo } = await createGitRepo({ files: {
    'main.cjs': mainSource,
    'index.html': html,
    'menu-assertion.json': `${JSON.stringify(scenario, null, 2)}\n`
  } });
  try {
    const config = normalizeElectronValidation({
      executablePath: electronPath,
      args: ['main.cjs'],
      scenarioFile: 'menu-assertion.json',
      timeoutMs: 45_000,
      stepTimeoutMs: 15_000
    });
    const result = await runElectronValidation(config, { cwd: repo, environment: process.env });
    assert.equal(result.passed, true, JSON.stringify(result, null, 2));
    assert.equal(result.assertions.length, 2);
    assert.equal(result.assertions.every((item) => item.passed), true);
    assert.equal(result.assertions[0].name, 'assertMenuItem step 1');
    assert.equal(result.assertions[1].name, 'assertMenuItem step 2');
    assert.match(result.assertions[0].detail, /matched=true/);
    assert.match(result.assertions[1].detail, /matched=true/);
    assert.equal(result.failureCode, null);
  } finally {
    await cleanup(root);
  }
});
