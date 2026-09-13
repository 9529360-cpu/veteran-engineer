import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { normalizeBrowserValidation, runBrowserValidation } from '../src/browser-validation-provider.mjs';
import { cleanup, tempDir } from './helpers.mjs';

const providerSource = `
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const payload = JSON.parse(input);
  process.stdout.write(JSON.stringify({
    contract: payload.contract,
    passed: true,
    assertions: [{ name: 'scenario accepted', passed: payload.scenario.path === '..scenario.json' }],
    currentUrl: payload.baseUrl
  }));
});
`;

test('browser validation accepts a contained scenario filename beginning with two dots', async () => {
  const cwd = await tempDir('veteran-browser-dotdot-scenario-');
  try {
    await fs.writeFile(`${cwd}/..scenario.json`, '{"steps":[]}\n');
    const browser = normalizeBrowserValidation({
      command: [process.execPath, '-e', providerSource],
      scenarioFile: '..scenario.json',
      baseUrl: 'http://127.0.0.1:3000/'
    });
    const result = await runBrowserValidation(browser, { cwd });

    assert.equal(result.passed, true);
    assert.equal(result.failureCode, null);
    assert.equal(result.assertions[0].passed, true);
  } finally {
    await cleanup(cwd);
  }
});

test('browser scenario normalization still rejects real parent traversal', () => {
  assert.throws(
    () => normalizeBrowserValidation({
      command: [process.execPath, '-e', providerSource],
      scenarioFile: '../scenario.json',
      baseUrl: 'http://127.0.0.1:3000/'
    }),
    (error) => error?.code === 'BROWSER_SCENARIO_PATH_ESCAPE'
  );
});
