import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
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
    assertions: [],
    currentUrl: payload.baseUrl
  }));
});
`;

function browserConfig(scenarioFile) {
  return normalizeBrowserValidation({
    command: [process.execPath, '-e', providerSource],
    scenarioFile,
    baseUrl: 'http://127.0.0.1:3000/'
  });
}

test('browser validation accepts a contained scenario filename beginning with two dots', async () => {
  const root = await tempDir('veteran-browser-dotdot-scenario-');
  const cwd = path.join(root, 'worktree');
  try {
    await fs.mkdir(cwd, { recursive: true });
    await fs.writeFile(path.join(cwd, '..scenario.json'), '{}\n');
    const browser = browserConfig('..scenario.json');
    assert.equal(browser.scenarioFile, '..scenario.json');

    const result = await runBrowserValidation(browser, { cwd });
    assert.equal(result.passed, true);
    assert.equal(result.failureCode, null);
    assert.equal(result.currentUrl, 'http://127.0.0.1:3000/');
  } finally {
    await cleanup(root);
  }
});

test('browser scenario normalization still rejects actual parent traversal', () => {
  assert.throws(
    () => browserConfig('../outside.json'),
    (error) => error?.code === 'BROWSER_SCENARIO_PATH_ESCAPE'
  );
});
