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
  const win = new BrowserWindow({ width: 900, height: 700, show: true });
  await win.loadFile(path.join(__dirname, 'index.html'));
});
app.on('window-all-closed', () => app.quit());
`;

const html = '<!doctype html><html><head><title>Veteran Window State Fixture</title></head><body>ready</body></html>';

async function waitForWindow(session) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const surfaces = await session.listSurfaces(1_000);
    const found = surfaces.windows.find((item) => item.title === 'Veteran Window State Fixture');
    if (found) return found;
    if (Date.now() >= deadline) throw new Error('Electron test window did not become ready');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test('native Electron bridge exposes bounded BrowserWindow state without global OS control', { skip: !electronPath, timeout: 120_000 }, async () => {
  const { root, repo } = await createGitRepo({ files: {
    'main.cjs': mainSource,
    'index.html': html
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
    const result = await session.command(
      { type: 'window', titleIncludes: 'Veteran Window State Fixture' },
      'windowState',
      {},
      5_000
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.state, {
      visible: true,
      minimized: false,
      maximized: false,
      fullScreen: false,
      bounds: { width: 900, height: 700 }
    });
  } finally {
    if (session) await session.close().catch(() => {});
    await cleanup(root);
  }
});
