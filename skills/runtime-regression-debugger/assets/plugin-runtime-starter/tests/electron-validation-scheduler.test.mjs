import assert from 'node:assert/strict';
import test from 'node:test';
import { planValidationBatches } from '../src/validation-scheduler.mjs';

test('Electron validation is scheduled with other interactive validation at tier 2', () => {
  const catalog = [
    { name: 'unit', command: ['npm', 'test'] },
    { name: 'desktop', electron: { contract: 'veteran-electron-validation-v1' } },
    { name: 'browser', browser: { contract: 'veteran-browser-validation-v1' } }
  ];
  const planned = planValidationBatches({ required: ['unit', 'desktop', 'browser'], catalog, maxParallel: 4 });
  assert.deepEqual(planned.batches, [
    { tier: 0, capabilities: ['unit'] },
    { tier: 2, capabilities: ['desktop', 'browser'] }
  ]);
});
