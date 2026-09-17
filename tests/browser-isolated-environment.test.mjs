import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createBrowserIsolatedEnvironment, normalizeBrowserValidation } from '../src/browser-validation-provider.mjs';

test('browser environment owns a complete private profile and does not inherit caller home or secrets', async () => {
  const caller = { ...process.env, HOME: 'private-caller-home', USERPROFILE: 'private-caller-profile',
    APPDATA: 'private-caller-roaming', LOCALAPPDATA: 'private-caller-local',
    HOMEDRIVE: 'Z:', HOMEPATH: '\\private-caller',
    VETERAN_TEST_SECRET: 'must-not-leak', VETERAN_TEST_ALLOWED: 'explicitly-allowed' };
  const { env, home } = await createBrowserIsolatedEnvironment(['VETERAN_TEST_ALLOWED'], caller);
  try {
    assert.equal(env.HOME, home);
    assert.equal(env.USERPROFILE, home);
    assert.equal(env.XDG_CONFIG_HOME, path.join(home, '.config'));
    assert.equal(env.XDG_CACHE_HOME, path.join(home, '.cache'));
    assert.equal(env.VETERAN_TEST_ALLOWED, 'explicitly-allowed');
    assert.equal(env.VETERAN_TEST_SECRET, undefined);
    assert.doesNotMatch(JSON.stringify(env), /private-caller|must-not-leak/);
    assert.equal(caller.HOME, 'private-caller-home');
    if (process.platform === 'win32') {
      assert.equal(env.APPDATA, path.join(home, 'AppData', 'Roaming'));
      assert.equal(env.LOCALAPPDATA, path.join(home, 'AppData', 'Local'));
      assert.equal(env.HOMEDRIVE + env.HOMEPATH, home);
      for (const dir of [env.APPDATA, env.LOCALAPPDATA]) {
        assert.equal((await fs.stat(dir)).isDirectory(), true);
        assert.equal(path.isAbsolute(path.relative(home, dir)), false);
        assert.equal(path.relative(home, dir).startsWith('..'), false);
      }
    }
  } finally { await fs.rm(home, { recursive: true, force: true }); }
});

test('browser configuration cannot opt out of home isolation through Windows environment aliases', () => {
  for (const name of ['HOME', 'UserProfile', 'APPDATA', 'localappdata', 'HomeDrive', 'HomePath']) {
    assert.throws(() => normalizeBrowserValidation({
      command: [process.execPath], scenarioFile: 'scenario.json', envAllowlist: [name]
    }), { code: 'BROWSER_PROVIDER_ENV_INVALID' });
  }
});
