import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ELECTRON_SCENARIO_CONTRACT,
  normalizeElectronValidation,
  runElectronValidation
} from '../src/electron-validation-provider.mjs';

async function fixture(scenario) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-electron-probe-'));
  await fs.writeFile(path.join(root, 'electron-bin'), 'fake');
  await fs.writeFile(path.join(root, 'scenario.json'), `${JSON.stringify({
    contract: ELECTRON_SCENARIO_CONTRACT,
    steps: scenario
  })}\n`);
  return root;
}

function bridgeTimeout() {
  return Object.assign(new Error('Electron bridge operation inventory timed out'), { code: 'ELECTRON_BRIDGE_TIMEOUT' });
}

function diagnostics() {
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

test('waitForSurface retries transient inventory timeouts inside the step deadline', async () => {
  const root = await fixture([
    { action: 'waitForSurface', target: { type: 'window', titleIncludes: 'Ready' }, timeoutMs: 2500 }
  ]);
  let probes = 0;
  const automation = {
    async launch() {
      return {
        async listSurfaces() {
          probes += 1;
          if (probes <= 2) throw bridgeTimeout();
          return {
            windows: [{ index: 0, id: 1, type: 'window', title: 'Ready Window', url: 'file:///ready.html', hostId: null }],
            webviews: []
          };
        },
        async command(_target, operation) {
          if (operation === 'diagnostics') return { ok: true, diagnostics: diagnostics() };
          if (operation === 'screenshot') return { ok: true, pngBase64: Buffer.from('png').toString('base64') };
          return { ok: false, code: 'UNEXPECTED_OPERATION' };
        },
        async close() {}
      };
    }
  };

  try {
    const config = normalizeElectronValidation({
      executablePath: 'electron-bin',
      scenarioFile: 'scenario.json',
      timeoutMs: 4000,
      stepTimeoutMs: 2500
    });
    const result = await runElectronValidation(config, {
      cwd: root,
      automation,
      environment: { PATH: process.env.PATH || '' }
    });
    assert.equal(result.passed, true, result.summary);
    assert.equal(result.failureCode, null);
    assert.equal(result.diagnostics.stepsCompleted, 1);
    assert.ok(probes >= 3);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('assertSurfaceCount never treats an unavailable inventory as a valid zero-surface observation', async () => {
  const root = await fixture([
    { action: 'assertSurfaceCount', target: { type: 'window' }, count: 0, timeoutMs: 250 }
  ]);
  let probes = 0;
  const automation = {
    async launch() {
      return {
        async listSurfaces() {
          probes += 1;
          throw bridgeTimeout();
        },
        async command(_target, operation) {
          if (operation === 'diagnostics') return { ok: true, diagnostics: diagnostics() };
          return { ok: false, code: 'UNEXPECTED_OPERATION' };
        },
        async close() {}
      };
    }
  };

  try {
    const config = normalizeElectronValidation({
      executablePath: 'electron-bin',
      scenarioFile: 'scenario.json',
      timeoutMs: 800,
      stepTimeoutMs: 250
    });
    const result = await runElectronValidation(config, {
      cwd: root,
      automation,
      environment: { PATH: process.env.PATH || '' }
    });
    assert.equal(result.passed, false);
    assert.equal(result.failureCode, 'ELECTRON_BRIDGE_TIMEOUT');
    assert.match(result.summary, /inventory timed out/);
    assert.equal(result.assertions.length, 0, 'no surface-count assertion may pass without a successful inventory');
    assert.ok(probes >= 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
