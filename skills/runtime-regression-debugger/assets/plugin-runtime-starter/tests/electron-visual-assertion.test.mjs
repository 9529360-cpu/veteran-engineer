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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-electron-visual-assertion-'));
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

function comparison(overrides = {}) {
  return {
    ok: true,
    passed: true,
    reason: 'within-threshold',
    baselineHash: 'a'.repeat(64),
    currentHash: 'a'.repeat(64),
    baseline: { width: 10, height: 10 },
    current: { width: 10, height: 10 },
    diffPixels: 0,
    totalPixels: 100,
    diffRatio: 0,
    maxDiffPixels: 0,
    channelThreshold: 0,
    ...overrides
  };
}

function fakeAutomation(state) {
  const surfaces = {
    windows: [{ index: 0, id: 1, type: 'window', title: 'Veteran Visual', url: 'file:///visual.html', hostId: null }],
    webviews: []
  };
  return {
    async launch() {
      return {
        async listSurfaces() { return surfaces; },
        async command(_target, operation, params) {
          if (operation === 'visualCompare') {
            state.visualCalls = (state.visualCalls || 0) + 1;
            state.visualParams = params;
            if (state.visualError) return { ok: false, code: state.visualError };
            const sequence = state.visualSequence || [comparison()];
            return sequence[Math.min(state.visualCalls - 1, sequence.length - 1)];
          }
          if (operation === 'diagnostics') return { ok: true, diagnostics: zeroDiagnostics() };
          if (operation === 'screenshot') {
            state.screenshotCalls = (state.screenshotCalls || 0) + 1;
            return { ok: true, pngBase64: Buffer.from('png').toString('base64') };
          }
          return { ok: false, code: 'UNEXPECTED_OPERATION' };
        },
        async close() { state.closed = true; }
      };
    }
  };
}

async function runScenario(root, steps, state, { timeoutMs = 2000, stepTimeoutMs = 500 } = {}) {
  await fs.writeFile(path.join(root, 'scenario.json'), `${JSON.stringify({ contract: ELECTRON_SCENARIO_CONTRACT, steps })}\n`);
  const config = normalizeElectronValidation({ executablePath: 'electron-bin', scenarioFile: 'scenario.json', timeoutMs, stepTimeoutMs });
  return runElectronValidation(config, { cwd: root, automation: fakeAutomation(state), environment: { PATH: process.env.PATH || '' } });
}

test('assertVisual reuses the bounded visual-comparison request contract', () => {
  const scenario = normalizeElectronScenario({
    contract: ELECTRON_SCENARIO_CONTRACT,
    steps: [{
      action: 'assertVisual',
      target: { type: 'window', titleIncludes: 'Veteran Visual' },
      visual: { baselinePath: 'baselines/home.png' }
    }]
  });
  assert.deepEqual(scenario.steps[0].visual, {
    baselinePath: 'baselines/home.png',
    maxDiffPixels: 0,
    channelThreshold: 0
  });

  for (const visual of [
    { baselinePath: '../home.png' },
    { baselinePath: '/tmp/home.png' },
    { baselinePath: 'baselines/home.jpg' },
    { baselinePath: 'baselines/home.png', maxDiffPixels: -1 },
    { baselinePath: 'baselines/home.png', channelThreshold: 256 },
    { baselinePath: 'baselines/home.png', mask: '#clock' }
  ]) {
    assert.throws(
      () => normalizeElectronScenario({ contract: ELECTRON_SCENARIO_CONTRACT, steps: [{ action: 'assertVisual', visual }] }),
      (error) => error.code === 'ELECTRON_SCENARIO_INVALID'
    );
  }
});

test('assertVisual polls a rendered mismatch until the bounded expectation passes', async () => {
  const root = await fixture();
  const state = {
    visualSequence: [
      comparison({ passed: false, reason: 'pixel-diff-exceeded', currentHash: 'b'.repeat(64), diffPixels: 2, diffRatio: 0.02 }),
      comparison()
    ]
  };
  try {
    const result = await runScenario(root, [{
      action: 'assertVisual',
      name: 'home matches baseline',
      visual: { baselinePath: 'baselines/home.png', maxDiffPixels: 0, channelThreshold: 0 }
    }], state, { stepTimeoutMs: 1000 });
    assert.equal(result.passed, true, result.summary);
    assert.equal(result.assertions.length, 1);
    assert.equal(result.assertions[0].name, 'home matches baseline');
    assert.equal(result.assertions[0].passed, true);
    assert.match(result.assertions[0].detail, /reason=within-threshold/);
    assert.match(result.assertions[0].detail, /diffPixels=0/);
    assert.equal(result.assertions[0].detail.includes('baselines/home.png'), false);
    assert.ok(state.visualCalls >= 2);
    assert.deepEqual(state.visualParams, { baselinePath: 'baselines/home.png', maxDiffPixels: 0, channelThreshold: 0 });
    assert.equal(state.closed, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('assertVisual reports a stable pixel mismatch as an assertion failure and captures failure evidence', async () => {
  const root = await fixture();
  const state = {
    visualSequence: [comparison({
      passed: false,
      reason: 'pixel-diff-exceeded',
      currentHash: 'b'.repeat(64),
      diffPixels: 25,
      diffRatio: 0.25
    })]
  };
  try {
    const result = await runScenario(root, [{
      action: 'assertVisual',
      visual: { baselinePath: 'baselines/home.png' },
      timeoutMs: 250
    }], state, { stepTimeoutMs: 250 });
    assert.equal(result.passed, false);
    assert.equal(result.failureCode, 'ELECTRON_ASSERTION_FAILED');
    assert.equal(result.assertions.length, 1);
    assert.equal(result.assertions[0].passed, false);
    assert.match(result.assertions[0].detail, /reason=pixel-diff-exceeded/);
    assert.match(result.assertions[0].detail, /diffPixels=25/);
    assert.equal(result.assertions[0].detail.includes('baselines/home.png'), false);
    assert.equal(result.attachments.length, 1);
    assert.equal(result.attachments[0].kind, 'electron-failure-screenshot');
    assert.ok(state.visualCalls >= 1);
    assert.ok(state.screenshotCalls >= 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('assertVisual preserves baseline authority errors instead of misclassifying them as pixel mismatches', async () => {
  const root = await fixture();
  const state = { visualError: 'ELECTRON_VISUAL_BASELINE_INVALID' };
  try {
    const result = await runScenario(root, [{
      action: 'assertVisual',
      visual: { baselinePath: 'baselines/missing.png' }
    }], state);
    assert.equal(result.passed, false);
    assert.equal(result.failureCode, 'ELECTRON_VISUAL_BASELINE_INVALID');
    assert.equal(result.assertions.length, 0);
    assert.ok(state.screenshotCalls >= 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
