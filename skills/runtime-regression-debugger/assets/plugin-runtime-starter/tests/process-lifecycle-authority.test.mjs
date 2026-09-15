import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROCESS_LIFECYCLE_STATE,
  probeProcess,
  probeProcessGroup,
  processGroupMayBeAlive,
  signalProcessTree,
  validProcessId
} from '../src/process-lifecycle-authority.mjs';

test('process lifecycle authority validates pid identity without coercion', () => {
  assert.equal(validProcessId(1), true);
  assert.equal(validProcessId(0), false);
  assert.equal(validProcessId(-1), false);
  assert.equal(validProcessId('12'), false);
});

test('process probe distinguishes alive, missing, permission-owned, and unknown states', () => {
  assert.equal(probeProcess(42, { kill() {} }).state, PROCESS_LIFECYCLE_STATE.ALIVE);
  assert.equal(probeProcess(42, { kill() { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); } }).state, PROCESS_LIFECYCLE_STATE.MISSING);
  assert.equal(probeProcess(42, { kill() { throw Object.assign(new Error('denied'), { code: 'EPERM' }); } }).state, PROCESS_LIFECYCLE_STATE.ALIVE);
  assert.equal(probeProcess(42, { kill() { throw Object.assign(new Error('odd'), { code: 'EIO' }); } }).state, PROCESS_LIFECYCLE_STATE.UNKNOWN);
});

test('process-group probe keeps unsupported and unknown distinct from missing', () => {
  const unsupported = probeProcessGroup(42, { platform: 'win32' });
  assert.equal(unsupported.state, PROCESS_LIFECYCLE_STATE.UNSUPPORTED);
  assert.equal(processGroupMayBeAlive(unsupported), true);

  const unknown = probeProcessGroup(42, {
    platform: 'linux',
    kill() { throw Object.assign(new Error('odd'), { code: 'EIO' }); }
  });
  assert.equal(unknown.state, PROCESS_LIFECYCLE_STATE.UNKNOWN);
  assert.equal(processGroupMayBeAlive(unknown), true);

  const missing = probeProcessGroup(42, {
    platform: 'linux',
    kill() { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); }
  });
  assert.equal(missing.state, PROCESS_LIFECYCLE_STATE.MISSING);
  assert.equal(processGroupMayBeAlive(missing), false);
});

test('POSIX tree signalling owns group-first fallback semantics', () => {
  const calls = [];
  const result = signalProcessTree(77, 'SIGTERM', {
    platform: 'linux',
    kill(pid, signal) {
      calls.push([pid, signal]);
      if (pid < 0) throw Object.assign(new Error('no group'), { code: 'ESRCH' });
    }
  });
  assert.deepEqual(calls, [[-77, 'SIGTERM'], [77, 'SIGTERM']]);
  assert.equal(result.signalled, true);
  assert.equal(result.scope, 'process');
});

test('Windows tree signalling owns taskkill tree and force flags', () => {
  const calls = [];
  const result = signalProcessTree(88, 'SIGKILL', {
    platform: 'win32',
    runSync(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0 };
    }
  });
  assert.equal(result.signalled, true);
  assert.equal(result.scope, 'tree');
  assert.deepEqual(calls[0].args, ['/PID', '88', '/T', '/F']);
  assert.equal(calls[0].command, 'taskkill');
  assert.equal(calls[0].options.windowsHide, true);
});
