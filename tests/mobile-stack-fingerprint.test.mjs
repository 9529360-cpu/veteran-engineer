import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const fingerprint = path.join(root, 'skills', 'runtime-regression-debugger', 'scripts', 'stack_fingerprint.py');

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function runFingerprint(repo) {
  for (const executable of ['python3', 'python']) {
    const result = spawnSync(executable, [fingerprint, repo, '--json'], { cwd: root, encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') continue;
    return result;
  }
  return null;
}

test('stack fingerprint detects cross-platform and native mobile repository evidence', async (t) => {
  if (!(await exists(fingerprint))) {
    t.skip('source Skill package is not present in the standalone runtime starter');
    return;
  }

  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'veteran-mobile-fingerprint-'));
  try {
    await fs.writeFile(path.join(repo, 'package.json'), JSON.stringify({
      name: 'mobile-fixture',
      dependencies: {
        'react-native': '0.81.0',
        expo: '54.0.0',
        'expo-router': '6.0.0',
        '@react-navigation/native': '7.1.0'
      }
    }, null, 2));
    await fs.writeFile(path.join(repo, 'pubspec.yaml'), [
      'name: flutter_fixture',
      'dependencies:',
      '  flutter:',
      '    sdk: flutter',
      ''
    ].join('\n'));

    const ios = path.join(repo, 'ios', 'Fixture.xcodeproj');
    await fs.mkdir(ios, { recursive: true });
    await fs.writeFile(path.join(ios, 'project.pbxproj'), 'IPHONEOS_DEPLOYMENT_TARGET = 17.0;\nTARGETED_DEVICE_FAMILY = "1,2";\n');

    const android = path.join(repo, 'android', 'app', 'src', 'main');
    await fs.mkdir(android, { recursive: true });
    await fs.writeFile(path.join(repo, 'android', 'build.gradle'), 'plugins {}\n');
    await fs.writeFile(path.join(android, 'AndroidManifest.xml'), '<manifest package="example.fixture" />\n');

    const result = runFingerprint(repo);
    assert.ok(result, 'Python is required to validate the stack fingerprint');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    const mobile = payload.detected.mobile || [];
    for (const expected of ['React Native', 'Expo', 'Expo Router', 'React Navigation', 'Flutter', 'iOS/Xcode', 'Android']) {
      assert.ok(mobile.includes(expected), `expected mobile fingerprint to include ${expected}: ${JSON.stringify(mobile)}`);
    }
    assert.ok(payload.suggested_references.includes('references/mobile-product-engineering.md'));
    assert.ok(payload.languages.includes('Dart'));
    assert.ok(payload.languages.includes('Swift/Objective-C'));
    assert.ok(payload.languages.includes('Kotlin/Java'));
    assert.ok(payload.package_managers.includes('pub'));
    assert.ok(payload.package_managers.includes('Gradle'));
  } finally {
    await fs.rm(repo, { recursive: true, force: true });
  }
});
