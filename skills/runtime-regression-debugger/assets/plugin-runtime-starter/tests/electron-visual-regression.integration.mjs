import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  ELECTRON_SCENARIO_CONTRACT,
  normalizeElectronValidation,
  runElectronValidation
} from '../src/electron-validation-provider.mjs';
import { nativeElectronAutomation } from '../src/electron-validation-driver.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

const electronPath = process.env.VETERAN_TEST_ELECTRON_PATH || null;

const mainSource = String.raw`
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 480, height: 320, show: true });
  await win.loadFile(path.join(__dirname, 'index.html'));
});
app.on('window-all-closed', () => app.quit());
`;

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Veteran Visual Fixture</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
    body { background: rgb(24, 48, 72); }
  </style>
</head>
<body>
  <span id="state" style="display:none">stable</span>
  <script>
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        document.body.style.background = 'rgb(196, 36, 64)';
        document.querySelector('#state').textContent = 'changed';
      }
    });
  </script>
</body>
</html>`;

async function waitForWindow(session) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const requestTimeout = Math.max(1, Math.min(1_000, deadline - Date.now()));
      const surfaces = await session.listSurfaces(requestTimeout);
      const found = surfaces.windows.find((item) => item.title === 'Veteran Visual Fixture');
      if (found) return found;
    } catch (error) {
      if (error?.code !== 'ELECTRON_BRIDGE_TIMEOUT') throw error;
    }
    if (Date.now() >= deadline) throw new Error('Electron visual regression test window did not become ready');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function waitForState(session, target, expected) {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const inspected = await session.command(target, 'inspect', { selector: '#state' }, 2_000);
    if (inspected.ok && inspected.found && inspected.text === expected) return inspected;
    if (Date.now() >= deadline) throw new Error(`Electron visual fixture did not reach state: ${expected}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function writeStableBaseline({ root, repo }) {
  const home = path.join(root, 'electron-home-baseline');
  await fs.mkdir(home, { recursive: true });
  const automation = nativeElectronAutomation();
  let session = null;
  try {
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
    const target = { type: 'window', titleIncludes: 'Veteran Visual Fixture' };
    await waitForState(session, target, 'stable');
    const captured = await session.command(target, 'screenshot', {}, 15_000);
    assert.equal(captured.ok, true);
    assert.equal(typeof captured.pngBase64, 'string');
    assert.ok(captured.pngBase64.length > 0);
    await fs.mkdir(path.join(repo, 'baselines'), { recursive: true });
    await fs.writeFile(path.join(repo, 'baselines', 'stable.png'), Buffer.from(captured.pngBase64, 'base64'));
    return target;
  } finally {
    if (session) await session.close().catch(() => {});
  }
}

test('real Electron bridge compares a captured baseline and detects a real rendered visual change', { skip: !electronPath, timeout: 120_000 }, async () => {
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

    const target = { type: 'window', titleIncludes: 'Veteran Visual Fixture' };
    await waitForState(session, target, 'stable');
    const captured = await session.command(target, 'screenshot', {}, 15_000);
    assert.equal(captured.ok, true);
    assert.equal(typeof captured.pngBase64, 'string');
    assert.ok(captured.pngBase64.length > 0);

    await fs.mkdir(path.join(repo, 'baselines'), { recursive: true });
    await fs.writeFile(path.join(repo, 'baselines', 'stable.png'), Buffer.from(captured.pngBase64, 'base64'));

    const exact = await session.command(target, 'visualCompare', {
      baselinePath: 'baselines/stable.png',
      maxDiffPixels: 0,
      channelThreshold: 0
    }, 15_000);
    assert.equal(exact.ok, true);
    assert.equal(exact.passed, true);
    assert.equal(exact.reason, 'within-threshold');
    assert.equal(exact.diffPixels, 0);
    assert.equal(exact.diffRatio, 0);
    assert.ok(exact.totalPixels > 0);
    assert.match(exact.baselineHash, /^[a-f0-9]{64}$/);
    assert.match(exact.currentHash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(exact).includes(repo), false);

    const pressed = await session.command(target, 'press', { key: 'Enter' }, 5_000);
    assert.equal(pressed.ok, true);
    await waitForState(session, target, 'changed');

    const changed = await session.command(target, 'visualCompare', {
      baselinePath: 'baselines/stable.png',
      maxDiffPixels: 0,
      channelThreshold: 0
    }, 15_000);
    assert.equal(changed.ok, true);
    assert.equal(changed.passed, false);
    assert.equal(changed.reason, 'pixel-diff-exceeded');
    assert.ok(changed.diffPixels > 0);
    assert.ok(changed.totalPixels > 0);
    assert.ok(changed.diffRatio > 0);
    assert.deepEqual(changed.current, changed.baseline);
    assert.equal(JSON.stringify(changed).includes(repo), false);
  } finally {
    if (session) await session.close().catch(() => {});
    await cleanup(root);
  }
});

test('Electron scenario exposes bounded assertVisual without creating a second screenshot authority', { skip: !electronPath, timeout: 180_000 }, async () => {
  const { root, repo } = await createGitRepo({ files: {
    'main.cjs': mainSource,
    'index.html': html
  } });
  const target = { type: 'window', titleIncludes: 'Veteran Visual Fixture' };
  const visual = {
    baselinePath: 'baselines/stable.png',
    maxDiffPixels: 0,
    channelThreshold: 0
  };
  try {
    await writeStableBaseline({ root, repo });

    await fs.writeFile(path.join(repo, 'visual-pass.json'), `${JSON.stringify({
      contract: ELECTRON_SCENARIO_CONTRACT,
      steps: [{ action: 'assertVisual', target, visual, timeoutMs: 15_000 }]
    }, null, 2)}\n`);
    const passConfig = normalizeElectronValidation({
      executablePath: electronPath,
      args: ['main.cjs'],
      scenarioFile: 'visual-pass.json',
      timeoutMs: 45_000,
      stepTimeoutMs: 15_000
    });
    const passed = await runElectronValidation(passConfig, { cwd: repo, environment: process.env });
    assert.equal(passed.passed, true, JSON.stringify(passed, null, 2));
    assert.equal(passed.assertions.length, 1);
    assert.equal(passed.assertions[0].passed, true);
    assert.match(passed.assertions[0].detail, /reason=within-threshold/);
    assert.match(passed.assertions[0].detail, /diffPixels=0/);
    assert.equal(JSON.stringify(passed).includes(repo), false);
    assert.equal(JSON.stringify(passed).includes('baselines/stable.png'), false);

    await fs.writeFile(path.join(repo, 'visual-fail.json'), `${JSON.stringify({
      contract: ELECTRON_SCENARIO_CONTRACT,
      steps: [
        { action: 'waitForSurface', target, timeoutMs: 15_000 },
        { action: 'press', target, key: 'Enter', timeoutMs: 5_000 },
        { action: 'assertText', target, selector: '#state', text: 'changed', match: 'equals', timeoutMs: 5_000 },
        { action: 'assertVisual', target, visual, timeoutMs: 5_000 }
      ]
    }, null, 2)}\n`);
    const failConfig = normalizeElectronValidation({
      executablePath: electronPath,
      args: ['main.cjs'],
      scenarioFile: 'visual-fail.json',
      timeoutMs: 45_000,
      stepTimeoutMs: 15_000
    });
    const failed = await runElectronValidation(failConfig, { cwd: repo, environment: process.env });
    assert.equal(failed.passed, false);
    assert.equal(failed.failureCode, 'ELECTRON_ASSERTION_FAILED');
    assert.equal(failed.assertions.length, 2);
    assert.equal(failed.assertions[0].passed, true);
    assert.equal(failed.assertions[1].passed, false);
    assert.match(failed.assertions[1].detail, /reason=pixel-diff-exceeded/);
    assert.match(failed.assertions[1].detail, /diffPixels=[1-9][0-9]*/);
    assert.ok(failed.attachments.some((item) => item.kind === 'electron-failure-screenshot'));
    assert.equal(JSON.stringify(failed).includes(repo), false);
    assert.equal(JSON.stringify(failed).includes('baselines/stable.png'), false);
  } finally {
    await cleanup(root);
  }
});
