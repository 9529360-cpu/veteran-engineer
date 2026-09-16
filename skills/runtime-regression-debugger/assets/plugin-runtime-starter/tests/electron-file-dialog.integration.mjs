import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { nativeElectronAutomation } from '../src/electron-validation-driver.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

const electronPath = process.env.VETERAN_TEST_ELECTRON_PATH || null;

const mainSource = String.raw`
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 800, height: 600, show: true });
  await win.loadFile(path.join(__dirname, 'index.html'));
});
app.on('window-all-closed', () => app.quit());
`;

const html = '<!doctype html><html><head><title>Veteran File Dialog Fixture</title></head><body>ready</body></html>';

async function waitForWindow(session) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const requestTimeout = Math.max(1, Math.min(1_000, deadline - Date.now()));
      const surfaces = await session.listSurfaces(requestTimeout);
      const found = surfaces.windows.find((item) => item.title === 'Veteran File Dialog Fixture');
      if (found) return found;
    } catch (error) {
      if (error?.code !== 'ELECTRON_BRIDGE_TIMEOUT') throw error;
    }
    if (Date.now() >= deadline) throw new Error('Electron file dialog test window did not become ready');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test('real Electron bridge rejects unsafe native file-dialog requests before opening an OS picker', { skip: !electronPath, timeout: 120_000 }, async () => {
  const { root, repo } = await createGitRepo({ files: {
    'main.cjs': mainSource,
    'index.html': html,
    'docs/readme.txt': 'safe fixture\n'
  } });
  const home = path.join(root, 'electron-home');
  await fs.mkdir(home, { recursive: true });
  let session = null;
  try {
    const automation = nativeElectronAutomation();
    session = await automation.launch({
      executablePath: electronPath,
      args: ['main.cjs'],
      cwd: repo,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: path.join(home, '.config'),
        XDG_CACHE_HOME: path.join(home, '.cache')
      },
      timeout: 30_000,
      chromiumSandbox: true
    });
    await waitForWindow(session);

    const target = { type: 'window', titleIncludes: 'Veteran File Dialog Fixture' };
    const escaped = await session.command(target, 'openFileDialog', {
      selection: 'file',
      defaultPath: '../outside.txt'
    }, 5_000);
    assert.deepEqual(escaped, {
      id: escaped.id,
      ok: false,
      code: 'ELECTRON_FILE_DIALOG_PATH_ESCAPE'
    });

    const unsupported = await session.command(target, 'openFileDialog', {
      selection: 'file',
      showHiddenFiles: true
    }, 5_000);
    assert.deepEqual(unsupported, {
      id: unsupported.id,
      ok: false,
      code: 'ELECTRON_FILE_DIALOG_REQUEST_INVALID'
    });

    const wrongTarget = await session.command({ type: 'webview', index: 0 }, 'openFileDialog', {
      selection: 'file'
    }, 5_000);
    assert.equal(wrongTarget.ok, false);
    assert.equal(wrongTarget.code, 'ELECTRON_SURFACE_NOT_FOUND');
  } finally {
    if (session) await session.close().catch(() => {});
    await cleanup(root);
  }
});
