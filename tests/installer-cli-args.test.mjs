import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, '..', 'bin', 'veteran-engineer.mjs');

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

function assertMissingValue(args, option) {
  const result = run(args);
  assert.notEqual(result.status, 0, `${option} without a value must fail`);
  assert.match(result.stderr, /\[CLI_ARGUMENT_VALUE_REQUIRED\]/);
  assert.match(result.stderr, new RegExp(`${option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} requires a value`));
}

test('installer CLI fails closed when value-taking options are missing or followed by another flag', () => {
  assertMissingValue(['status', '--home'], '--home');
  assertMissingValue(['status', '--host', '--json'], '--host');
  assertMissingValue(['hosts', '--trusted-adapter-dir', '--json'], '--trusted-adapter-dir');
  assertMissingValue(['install', 'generic', '--surface-profile', '--json'], '--surface-profile');
});
