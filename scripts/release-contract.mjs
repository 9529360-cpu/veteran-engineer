#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNTIME_VERSION, STATE_SCHEMA_VERSION } from '../src/constants.mjs';

const self = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(self), '..');
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

async function readJson(target) {
  return JSON.parse(await fs.readFile(target, 'utf8'));
}

export function validateReleaseVersions({ packageVersion, lockVersion, lockRootVersion, pluginVersion, runtimeVersion, tag = null }) {
  assert.match(packageVersion, SEMVER, `package version is not valid semver: ${packageVersion}`);
  assert.equal(runtimeVersion, packageVersion, 'runtime version must match package.json');
  assert.equal(pluginVersion, packageVersion, 'plugin manifest version must match package.json');
  assert.equal(lockVersion, packageVersion, 'package-lock top-level version must match package.json');
  assert.equal(lockRootVersion, packageVersion, 'package-lock root package version must match package.json');
  if (tag !== null) assert.equal(tag, `v${packageVersion}`, `release tag must exactly match package version: expected v${packageVersion}`);
  return packageVersion;
}

export async function inspectReleaseContract({ root = defaultRoot, tag = null } = {}) {
  const [packageJson, packageLock, plugin] = await Promise.all([
    readJson(path.join(root, 'package.json')),
    readJson(path.join(root, 'package-lock.json')),
    readJson(path.join(root, '.codex-plugin', 'plugin.json'))
  ]);
  const version = validateReleaseVersions({
    packageVersion: packageJson.version,
    lockVersion: packageLock.version,
    lockRootVersion: packageLock.packages?.['']?.version,
    pluginVersion: plugin.version,
    runtimeVersion: RUNTIME_VERSION,
    tag
  });
  return { ok: true, product: 'veteran-engineer', version, tag: tag || null, stateSchemaVersion: STATE_SCHEMA_VERSION };
}

function parseArgs(argv) {
  let tag = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--tag') {
      tag = argv[index + 1];
      if (!tag) throw new Error('--tag requires a value');
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { tag };
}

if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const result = await inspectReleaseContract(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
