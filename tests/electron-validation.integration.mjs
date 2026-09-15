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
  <webview id="guest" src="guest.html" style="display:block;width:640px;height:360px"></webview>
  <script>
    document.getElementById('host-button').addEventListener('click', () => {
      document.getElementById('host-status').textContent = 'clicked';
    });
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

function parseEvidenceSummary(evidence) {
  return JSON.parse(evidence.summary);
}

test('validation_run controls real BrowserWindow and webview guest and persists screenshot evidence', { skip: !electronPath, timeout: 120_000 }, async () => {
  const scenario = {
    contract: ELECTRON_SCENARIO_CONTRACT,
    steps: [
      { action: 'waitForSurface', target: { type: 'window', titleIncludes: 'Veteran Electron Fixture' }, timeoutMs: 15000 },
      { action: 'assertText', selector: '#host-status', text: 'ready', match: 'equals' },
      { action: 'click', selector: '#host-button' },
      { action: 'assertText', selector: '#host-status', text: 'clicked', match: 'equals' },
      { action: 'screenshot', filename: 'window.png' },
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
    'guest.html': guestHtml,
    'tests/electron/smoke.json': `${JSON.stringify(scenario, null, 2)}\n`
  } });
  try {
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
    assert.equal(result.electron.assertions.length, 4);
    assert.equal(result.electron.assertions.every((item) => item.passed), true);
    assert.ok(result.electron.surfaces.windows.some((item) => item.title === 'Veteran Electron Fixture'));
    assert.ok(result.electron.surfaces.webviews.some((item) => item.title === 'Veteran Guest Fixture'));

    const [evidence] = await app.services.evidenceService.query({ ids: [result.evidenceId] });
    const summary = parseEvidenceSummary(evidence);
    assert.equal(summary.electron.passed, true);
    assert.equal(summary.failureStage, null);
    assert.deepEqual(evidence.attachments.map((item) => [item.name, item.kind]), [
      ['electron/window.png', 'electron-screenshot'],
      ['electron/guest.png', 'electron-webview-screenshot']
    ]);
    assert.ok(evidence.attachments.every((item) => item.bytes > 0 && item.artifactHash));
  } finally {
    await cleanup(root);
  }
});
