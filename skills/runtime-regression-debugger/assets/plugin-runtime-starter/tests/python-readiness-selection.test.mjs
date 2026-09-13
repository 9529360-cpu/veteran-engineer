import assert from 'node:assert/strict';
import test from 'node:test';
import { assessProjectEnvironmentReadiness } from '../src/project-environment-readiness.mjs';

function result(version) {
  return { available: true, exitCode: 0, version, reason: 'ok' };
}

test('python readiness prefers an available interpreter that satisfies the repository version requirement', async () => {
  const calls = [];
  const profile = {
    runtimeFamilies: ['python'],
    versionHints: [{ path: '.python-version', value: '3.12' }],
    packageManagers: { python: ['pip'] }
  };
  const readiness = await assessProjectEnvironmentReadiness(profile, {
    probe: async (spec) => {
      calls.push({ command: spec.command, args: spec.args });
      if (spec.command === 'python3') return result('3.10.14');
      if (spec.command === 'python' && spec.args[0] === '--version') return result('3.12.7');
      if (spec.command === 'python' && spec.args[0] === '-m') return result('24.2');
      return { available: false, exitCode: null, version: null, reason: 'not-found' };
    }
  });

  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.usable, true);
  assert.deepEqual(readiness.issues, []);
  const python = readiness.checks.find((item) => item.id === 'python');
  assert.equal(python.version, '3.12.7');
  assert.equal(python.compatibility, 'match');
  assert.ok(calls.some((call) => call.command === 'python3' && call.args[0] === '--version'));
  assert.ok(calls.some((call) => call.command === 'python' && call.args[0] === '--version'));
  assert.ok(calls.some((call) => call.command === 'python' && call.args.join(' ') === '-m pip --version'), 'pip must be probed through the selected compatible interpreter');
  assert.ok(!calls.some((call) => call.command === 'python3' && call.args[0] === '-m'), 'the mismatching interpreter must not own the pip probe');
});

test('python readiness keeps the existing python3 preference when no version requirement exists', async () => {
  const calls = [];
  const readiness = await assessProjectEnvironmentReadiness(
    { runtimeFamilies: ['python'], packageManagers: { python: [] } },
    {
      probe: async (spec) => {
        calls.push(spec.command);
        if (spec.command === 'python3') return result('3.10.14');
        if (spec.command === 'python') return result('3.12.7');
        return { available: false, exitCode: null, version: null, reason: 'not-found' };
      }
    }
  );
  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.checks.find((item) => item.id === 'python').version, '3.10.14');
  assert.deepEqual(calls, ['python3']);
});
