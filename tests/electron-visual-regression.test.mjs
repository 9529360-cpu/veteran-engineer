import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import visualModule from '../src/electron-visual-regression.cjs';

const {
  normalizeVisualCompareRequest,
  compareVisualSnapshot
} = visualModule;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function png(id) {
  return Buffer.concat([PNG_SIGNATURE, Buffer.from([id])]);
}

function fakeNativeImage(definitions) {
  return {
    createFromBuffer(buffer) {
      const definition = definitions.get(buffer[PNG_SIGNATURE.length]);
      if (!definition) return { isEmpty: () => true };
      return {
        isEmpty: () => false,
        getSize: () => ({ width: definition.width, height: definition.height }),
        toBitmap: () => Buffer.from(definition.bitmap)
      };
    }
  };
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-electron-visual-'));
  await fs.mkdir(path.join(root, 'baselines'), { recursive: true });
  return root;
}

function image(width, height, pixels) {
  const bitmap = Buffer.alloc(width * height * 4);
  for (let index = 0; index < pixels.length; index += 1) {
    const offset = index * 4;
    const pixel = pixels[index];
    bitmap[offset] = pixel[0];
    bitmap[offset + 1] = pixel[1];
    bitmap[offset + 2] = pixel[2];
    bitmap[offset + 3] = pixel[3];
  }
  return { width, height, bitmap };
}

test('visual comparison request is bounded, relative, PNG-only, and rejects arbitrary controls', () => {
  assert.deepEqual(normalizeVisualCompareRequest({ baselinePath: 'baselines/home.png' }), {
    baselinePath: 'baselines/home.png',
    maxDiffPixels: 0,
    channelThreshold: 0
  });
  assert.throws(() => normalizeVisualCompareRequest({ baselinePath: '../home.png' }), (error) => error.code === 'ELECTRON_VISUAL_BASELINE_PATH_ESCAPE');
  assert.throws(() => normalizeVisualCompareRequest({ baselinePath: '/tmp/home.png' }), (error) => error.code === 'ELECTRON_VISUAL_BASELINE_PATH_ESCAPE');
  assert.throws(() => normalizeVisualCompareRequest({ baselinePath: 'C:\\tmp\\home.png' }), (error) => error.code === 'ELECTRON_VISUAL_BASELINE_PATH_ESCAPE');
  assert.throws(() => normalizeVisualCompareRequest({ baselinePath: 'baselines/home.jpg' }), (error) => error.code === 'ELECTRON_VISUAL_BASELINE_PATH_ESCAPE');
  assert.throws(() => normalizeVisualCompareRequest({ baselinePath: 'home.png', maxDiffPixels: -1 }), (error) => error.code === 'ELECTRON_VISUAL_REQUEST_INVALID');
  assert.throws(() => normalizeVisualCompareRequest({ baselinePath: 'home.png', channelThreshold: 256 }), (error) => error.code === 'ELECTRON_VISUAL_REQUEST_INVALID');
  assert.throws(() => normalizeVisualCompareRequest({ baselinePath: 'home.png', mask: '#timestamp' }), (error) => error.code === 'ELECTRON_VISUAL_REQUEST_INVALID');
});

test('visual comparison reports exact match with stable hashes and no host path leakage', async () => {
  const root = await fixture();
  try {
    await fs.writeFile(path.join(root, 'baselines', 'home.png'), png(1));
    const definitions = new Map([
      [1, image(2, 1, [[10, 20, 30, 255], [40, 50, 60, 255]])],
      [2, image(2, 1, [[10, 20, 30, 255], [40, 50, 60, 255]])]
    ]);
    const result = await compareVisualSnapshot({
      nativeImage: fakeNativeImage(definitions),
      currentPng: png(2),
      request: { baselinePath: 'baselines/home.png' },
      root
    });
    assert.equal(result.passed, true);
    assert.equal(result.reason, 'within-threshold');
    assert.equal(result.diffPixels, 0);
    assert.equal(result.totalPixels, 2);
    assert.equal(result.diffRatio, 0);
    assert.deepEqual(result.baseline, { width: 2, height: 1 });
    assert.deepEqual(result.current, { width: 2, height: 1 });
    assert.match(result.baselineHash, /^[a-f0-9]{64}$/);
    assert.match(result.currentHash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(result).includes(root), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('visual comparison applies per-channel noise tolerance and bounded changed-pixel allowance', async () => {
  const root = await fixture();
  try {
    await fs.writeFile(path.join(root, 'baselines', 'home.png'), png(1));
    const definitions = new Map([
      [1, image(2, 1, [[10, 20, 30, 255], [40, 50, 60, 255]])],
      [2, image(2, 1, [[11, 20, 30, 255], [90, 50, 60, 255]])]
    ]);
    const tolerant = await compareVisualSnapshot({
      nativeImage: fakeNativeImage(definitions),
      currentPng: png(2),
      request: { baselinePath: 'baselines/home.png', channelThreshold: 1, maxDiffPixels: 1 },
      root
    });
    assert.equal(tolerant.passed, true);
    assert.equal(tolerant.diffPixels, 1);
    assert.equal(tolerant.diffRatio, 0.5);

    const strict = await compareVisualSnapshot({
      nativeImage: fakeNativeImage(definitions),
      currentPng: png(2),
      request: { baselinePath: 'baselines/home.png', channelThreshold: 1, maxDiffPixels: 0 },
      root
    });
    assert.equal(strict.passed, false);
    assert.equal(strict.reason, 'pixel-diff-exceeded');
    assert.equal(strict.diffPixels, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('visual comparison treats dimensions as authority and never rescales a baseline implicitly', async () => {
  const root = await fixture();
  try {
    await fs.writeFile(path.join(root, 'baselines', 'home.png'), png(1));
    const definitions = new Map([
      [1, image(2, 1, [[0, 0, 0, 255], [0, 0, 0, 255]])],
      [2, image(1, 1, [[0, 0, 0, 255]])]
    ]);
    const result = await compareVisualSnapshot({
      nativeImage: fakeNativeImage(definitions),
      currentPng: png(2),
      request: { baselinePath: 'baselines/home.png', maxDiffPixels: 50 },
      root
    });
    assert.equal(result.passed, false);
    assert.equal(result.reason, 'dimension-mismatch');
    assert.equal(result.diffPixels, null);
    assert.deepEqual(result.baseline, { width: 2, height: 1 });
    assert.deepEqual(result.current, { width: 1, height: 1 });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('visual comparison rejects invalid PNG input and unsupported bitmap layout', async () => {
  const root = await fixture();
  try {
    await fs.writeFile(path.join(root, 'baselines', 'bad.png'), Buffer.from('not-png'));
    await assert.rejects(
      () => compareVisualSnapshot({ nativeImage: fakeNativeImage(new Map()), currentPng: png(2), request: { baselinePath: 'baselines/bad.png' }, root }),
      (error) => error.code === 'ELECTRON_VISUAL_BASELINE_INVALID'
    );

    await fs.writeFile(path.join(root, 'baselines', 'home.png'), png(1));
    const invalidBitmap = new Map([
      [1, { width: 1, height: 1, bitmap: Buffer.alloc(3) }],
      [2, image(1, 1, [[0, 0, 0, 255]])]
    ]);
    await assert.rejects(
      () => compareVisualSnapshot({ nativeImage: fakeNativeImage(invalidBitmap), currentPng: png(2), request: { baselinePath: 'baselines/home.png' }, root }),
      (error) => error.code === 'ELECTRON_VISUAL_BITMAP_UNSUPPORTED'
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('visual comparison rejects symlink baseline files even when they resolve inside the project', { skip: process.platform === 'win32' }, async () => {
  const root = await fixture();
  try {
    await fs.writeFile(path.join(root, 'baselines', 'real.png'), png(1));
    await fs.symlink(path.join(root, 'baselines', 'real.png'), path.join(root, 'baselines', 'link.png'));
    await assert.rejects(
      () => compareVisualSnapshot({
        nativeImage: fakeNativeImage(new Map()),
        currentPng: png(2),
        request: { baselinePath: 'baselines/link.png' },
        root
      }),
      (error) => error.code === 'ELECTRON_VISUAL_BASELINE_INVALID'
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
