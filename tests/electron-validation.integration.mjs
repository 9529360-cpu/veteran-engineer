import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createVeteranApp } from '../src/app.mjs';
import { ELECTRON_SCENARIO_CONTRACT } from '../src/electron-validation-provider.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

const electronPath = process.env.VETERAN_TEST_ELECTRON_PATH || null;

const mainSource = String.raw`
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    show: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      webviewTag: true
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.endsWith('/secondary.html')) return { action: 'deny' };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 620,
        height: 440,
        show: true
      }
    };
  });
  await win.loadFile(path.join(__dirname, 'host.html'));
});
app.on('window-all-closed', () => app.quit());
`;

const hostHtml = String.raw`<!doctype html>
<html>
<head><meta charset="utf-8"><title>Veteran Electron Fixture</title></head>
<body>
  <div id="host-status">ready</div>
  <button id="host-button">Click host</button>
  <button id="open-secondary">Open secondary</button>
  <webview id="guest" src="guest.html" style="display:block;width:640px;height:360px"></webview>
  <script>
    document.getElementById('host-button').addEventListener('click', () => {
      document.getElementById('host-status').textContent = 'clicked';
    });
    document.getElementById('open-secondary').addEventListener('click', () => {
      window.open('secondary.html', 'veteran-secondary');
    });
  </script>
</body>
</html>`;

const secondaryHtml = String.raw`<!doctype html>
<html>
<head><meta charset="utf-8"><title>Veteran Secondary Fixture</title></head>
<body>
  <div id="secondary-status">secondary-ready</div>
  <button id="secondary-button">Click secondary</button>
  <button id="secondary-close">Close secondary</button>
  <script>
    document.getElementById('secondary-button').addEventListener('click', () => {
      document.getElementById('secondary-status').textContent = 'secondary-clicked';
    });
    document.getElementById('secondary-close').addEventListener('click', () => window.close());
  </script>
</body>
</html>`;

const guestHtml = String.raw`<!doctype html>
<html>
<head><meta charset="utf-8"><title>Veteran Guest Fixture</title></head>
<body>
  <input id="guest-input" />
  <button id="guest-button">Commit guest</button>
  <div id="guest-status">guest-ready</div>
  <script>
    document.getElementById('guest-button').addEventListener('click', () => {
      document.getElementById('guest-status').textContent = document.getElementById('guest-input').value;
    });
  </script>
</body>
</html>`;

const crashMainSource = String.raw`
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
ipcMain.on('veteran-force-crash', (event) => {
  event.sender.forcefullyCrashRenderer();
});
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 700,
    height: 500,
    show: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'crash-preload.cjs')
    }
  });
  await win.loadFile(path.join(__dirname, 'crash.html'));
});
app.on('window-all-closed', () => app.quit());
`;

const crashPreloadSource = String.raw`
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('veteranCrashFixture', {
  trigger: () => ipcRenderer.send('veteran-force-crash')
});
`;

const crashHtml = String.raw`<!doctype html>
<html>
<head><meta charset="utf-8"><title>Veteran Crash Fixture</title></head>
<body>
  <div id="crash-status">ready</div>
  <button id="crash-button">Crash renderer</button>
  <script>
    document.getElementById('crash-button').addEventListener('click', () => {
      window.veteranCrashFixture.trigger();
    });
  </script>
</body>
</html>`;

function parseEvidenceSummary(evidence) {
  return JSON.parse(evidence.summary);
}

test('validation_run controls real multi-window BrowserWindow lifecycle and webview guest with screenshot evidence', { skip: !electronPath, timeout: 120_000 }, async () => {
  const scenario = {
    contract: ELECTRON_SCENARIO_CONTRACT,
    steps: [
      { action: 'waitForSurface', target: { type: 'window', titleIncludes: 'Veteran Electron Fixture' }, timeoutMs: 15000 },
      { action: 'assertText', selector: '#host-status', text: 'ready', match: 'equals' },
      { action: 'click', selector: '#host-button' },
      { action: 'assertText', selector: '#host-status', text: 'clicked', match: 'equals' },
      { action: 'screenshot', filename: 'window.png' },
      { action: 'click', selector: '#open-secondary' },
      { action: 'assertSurfaceCount', target: { type: 'window' }, count: 2, timeoutMs: 15000 },
      { action: 'waitForSurface', target: { type: 'window', titleIncludes: 'Veteran Secondary Fixture' }, timeoutMs: 15000 },
      { action: 'assertText', target: { type: 'window', titleIncludes: 'Veteran Secondary Fixture' }, selector: '#secondary-status', text: 'secondary-ready', match: 'equals' },
      { action: 'click', target: { type: 'window', titleIncludes: 'Veteran Secondary Fixture' }, selector: '#secondary-button' },
      { action: 'assertText', target: { type: 'window', titleIncludes: 'Veteran Secondary Fixture' }, selector: '#secondary-status', text: 'secondary-clicked', match: 'equals' },
      { action: 'screenshot', target: { type: 'window', titleIncludes: 'Veteran Secondary Fixture' }, filename: 'secondary.png' },
      { action: 'click', target: { type: 'window', titleIncludes: 'Veteran Secondary Fixture' }, selector: '#secondary-close' },
      { action: 'assertSurfaceCount', target: { type: 'window', titleIncludes: 'Veteran Secondary Fixture' }, count: 0, timeoutMs: 15000 },
      { action: 'waitForSurface', target: { type: 'webview', urlIncludes: 'guest.html' }, timeoutMs: 15000 },
      { action: 'assertText', target: { type: 'webview', urlIncludes: 'guest.html' }, selector: '#guest-status', text: 'guest-ready', match: 'equals' },
      { action: 'fill', target: { type: 'webview', urlIncludes: 'guest.html' }, selector: '#guest-input', value: 'hello-from-veteran' },
      { action: 'click', target: { type: 'webview', urlIncludes: 'guest.html' }, selector: '#guest-button' },
      { action: 'assertText', target: { type: 'webview', urlIncludes: 'guest.html' }, selector: '#guest-status', text: 'hello-from-veteran', match: 'equals' },
      { action: 'screenshot', target: { type: 'webview', urlIncludes: 'guest.html' }, filename: 'guest.png' }
    ]
  };
  const { root, repo, stateRoot } = await createGitRepo({ files: {
    'main.cjs': mainSource,
    'host.html': hostHtml,
    'secondary.html': secondaryHtml,
    'guest.html': guestHtml,
    'tests/electron/smoke.json': `${JSON.stringify(scenario, null, 2)}\n`
  } });
  try {
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({
      defaults: {
        validationCapabilities: [{
          name: 'electron-desktop-smoke',
          electron: {
            executablePath: electronPath,
            args: ['main.cjs'],
            scenarioFile: 'tests/electron/smoke.json',
            timeoutMs: 60_000,
            stepTimeoutMs: 10_000
          }
        }]
      }
    }, null, 2)}\n`);
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const result = await app.services.validationService.run({ projectId: project.id, capability: 'electron-desktop-smoke' });
    assert.equal(result.passed, true, JSON.stringify(result, null, 2));
    assert.equal(result.failureStage, null);
    assert.equal(result.electron.contract, 'veteran-electron-validation-v1');
    assert.equal(result.electron.assertions.length, 8);
    assert.equal(result.electron.assertions.every((item) => item.passed), true);
    assert.ok(result.electron.assertions.some((item) => item.detail === 'expected=2 observed=2'));
    assert.ok(result.electron.assertions.some((item) => item.detail === 'expected=0 observed=0'));
    assert.equal(result.electron.diagnostics.crashes, 0);
    assert.equal(result.electron.diagnostics.activeUnresponsive, 0);
    assert.ok(result.electron.surfaces.windows.some((item) => item.title === 'Veteran Electron Fixture'));
    assert.equal(result.electron.surfaces.windows.some((item) => item.title === 'Veteran Secondary Fixture'), false);
    assert.ok(result.electron.surfaces.webviews.some((item) => item.title === 'Veteran Guest Fixture'));

    const [evidence] = await app.services.evidenceService.query({ ids: [result.evidenceId] });
    const summary = parseEvidenceSummary(evidence);
    assert.equal(summary.electron.passed, true);
    assert.equal(summary.failureStage, null);
    assert.equal(summary.electron.diagnostics.crashes, 0);
    assert.deepEqual(evidence.attachments.map((item) => [item.name, item.kind]), [
      ['electron/window.png', 'electron-screenshot'],
      ['electron/secondary.png', 'electron-screenshot'],
      ['electron/guest.png', 'electron-webview-screenshot']
    ]);
    assert.ok(evidence.attachments.every((item) => item.bytes > 0 && item.artifactHash));
  } finally {
    await cleanup(root);
  }
});

test('validation_run classifies a real Electron renderer crash from render-process-gone evidence', { skip: !electronPath, timeout: 120_000 }, async () => {
  const scenario = {
    contract: ELECTRON_SCENARIO_CONTRACT,
    steps: [
      { action: 'waitForSurface', target: { type: 'window', titleIncludes: 'Veteran Crash Fixture' }, timeoutMs: 15000 },
      { action: 'assertText', selector: '#crash-status', text: 'ready', match: 'equals' },
      { action: 'click', selector: '#crash-button' },
      { action: 'assertText', selector: '#crash-status', text: 'still-alive', match: 'equals', timeoutMs: 5000 }
    ]
  };
  const { root, repo, stateRoot } = await createGitRepo({ files: {
    'crash-main.cjs': crashMainSource,
    'crash-preload.cjs': crashPreloadSource,
    'crash.html': crashHtml,
    'tests/electron/crash.json': `${JSON.stringify(scenario, null, 2)}\n`
  } });
  try {
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(path.join(stateRoot, 'operator.json'), `${JSON.stringify({
      defaults: {
        validationCapabilities: [{
          name: 'electron-renderer-crash-smoke',
          electron: {
            executablePath: electronPath,
            args: ['crash-main.cjs'],
            scenarioFile: 'tests/electron/crash.json',
            timeoutMs: 45_000,
            stepTimeoutMs: 5_000
          }
        }]
      }
    }, null, 2)}\n`);
    const app = await createVeteranApp({ stateRoot });
    const project = await app.services.projectService.open({ repoPath: repo });
    const result = await app.services.validationService.run({ projectId: project.id, capability: 'electron-renderer-crash-smoke' });
    assert.equal(result.passed, false, JSON.stringify(result, null, 2));
    assert.equal(result.failureStage, 'electron-validation');
    assert.equal(result.electron.failureCode, 'ELECTRON_RENDERER_CRASHED');
    assert.ok(result.electron.diagnostics.crashes >= 1, JSON.stringify(result.electron.diagnostics));

    const [evidence] = await app.services.evidenceService.query({ ids: [result.evidenceId] });
    const summary = parseEvidenceSummary(evidence);
    assert.equal(summary.failureStage, 'electron-validation');
    assert.equal(summary.electron.failureCode, 'ELECTRON_RENDERER_CRASHED');
    assert.ok(summary.electron.diagnostics.crashes >= 1);
  } finally {
    await cleanup(root);
  }
});
