import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { normalizeBrowserValidation, runBrowserValidation } from '../src/browser-validation-provider.mjs';
import { cleanup, tempDir } from './helpers.mjs';

const providerSource = `
const fs = require('node:fs');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const payload = JSON.parse(input);
  fs.writeFileSync(process.env.VETERAN_BROWSER_HOME_MARKER, JSON.stringify({
    HOME: process.env.HOME || null,
    USERPROFILE: process.env.USERPROFILE || null,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || null,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || null,
    APPDATA: process.env.APPDATA || null,
    LOCALAPPDATA: process.env.LOCALAPPDATA || null
  }));
  process.stdout.write(JSON.stringify({
    contract: payload.contract,
    passed: true,
    assertions: [],
    currentUrl: payload.baseUrl
  }));
});
`;

function browserConfig(envAllowlist = ['VETERAN_BROWSER_HOME_MARKER']) {
  return normalizeBrowserValidation({
    command: [process.execPath, '-e', providerSource],
    scenarioFile: 'scenario.json',
    baseUrl: 'http://127.0.0.1:3000/',
    envAllowlist
  });
}

test('browser provider receives an ephemeral home that is cleaned after execution', async () => {
  const root = await tempDir('veteran-browser-home-test-');
  const cwd = path.join(root, 'worktree');
  const marker = path.join(root, 'observed-home.json');
  const hostHome = path.join(root, 'host-home-secret');
  const hostProfile = path.join(root, 'host-profile-secret');
  try {
    await fs.mkdir(cwd, { recursive: true });
    await fs.writeFile(path.join(cwd, 'scenario.json'), '{}\n');
    const environment = {
      ...process.env,
      HOME: hostHome,
      USERPROFILE: hostProfile,
      XDG_CONFIG_HOME: path.join(hostHome, '.config'),
      XDG_CACHE_HOME: path.join(hostHome, '.cache'),
      APPDATA: path.join(hostProfile, 'AppData', 'Roaming'),
      LOCALAPPDATA: path.join(hostProfile, 'AppData', 'Local'),
      VETERAN_BROWSER_HOME_MARKER: marker
    };

    const result = await runBrowserValidation(browserConfig(), { cwd, environment });
    assert.equal(result.passed, true);

    const observed = JSON.parse(await fs.readFile(marker, 'utf8'));
    assert.notEqual(observed.HOME, hostHome);
    assert.notEqual(observed.USERPROFILE, hostProfile);
    assert.equal(observed.USERPROFILE, observed.HOME);
    assert.equal(observed.XDG_CONFIG_HOME, path.join(observed.HOME, '.config'));
    assert.equal(observed.XDG_CACHE_HOME, path.join(observed.HOME, '.cache'));
    assert.equal(observed.APPDATA, null);
    assert.equal(observed.LOCALAPPDATA, null);
    await assert.rejects(fs.stat(observed.HOME), (error) => error?.code === 'ENOENT');
  } finally {
    await cleanup(root);
  }
});

test('browser provider allowlist cannot restore host home or config variables with casing changes', () => {
  for (const variable of ['HOME', 'home', 'UserProfile', 'HOMEDRIVE', 'homepath', 'Xdg_Config_Home', 'xdg_cache_home', 'AppData', 'localappdata']) {
    assert.throws(
      () => browserConfig([variable]),
      (error) => error?.code === 'BROWSER_PROVIDER_ENV_INVALID',
      variable
    );
  }
});
