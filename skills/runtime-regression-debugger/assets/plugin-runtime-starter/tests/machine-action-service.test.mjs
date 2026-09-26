import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MachineActionService, machineExecutablePresence, machinePackageManagerExecutionSupport } from '../src/machine-action-service.mjs';
import { git } from '../src/git.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'veteran-machine-actions-'));
}

test('machine package-manager execution support stays shell-free and platform honest', () => {
  assert.deepEqual(
    machinePackageManagerExecutionSupport('npm', { platform: 'linux', allowedExecutables: ['npm'] }),
    { available: true, reason: 'allowlisted-direct-executable' }
  );
  for (const manager of ['npm', 'pnpm', 'yarn']) {
    assert.deepEqual(
      machinePackageManagerExecutionSupport(manager, { platform: 'win32', allowedExecutables: [manager] }),
      { available: false, reason: 'windows-command-shim-requires-shell' }
    );
  }
  assert.deepEqual(
    machinePackageManagerExecutionSupport('bun', { platform: 'win32', allowedExecutables: ['bun'] }),
    { available: true, reason: 'allowlisted-direct-executable' }
  );
  assert.deepEqual(
    machinePackageManagerExecutionSupport('npm', { platform: 'linux', allowedExecutables: ['node'] }),
    { available: false, reason: 'package-manager-not-allowlisted' }
  );
});

test('machine executable presence distinguishes authorization from actual PATH availability', async () => {
  const seen = [];
  const present = await machineExecutablePresence('npm', {
    platform: 'linux',
    environment: { PATH: '/missing:/tools with spaces' },
    access: async (candidate, mode) => {
      seen.push({ candidate, mode });
      if (candidate === path.join('/tools with spaces', 'npm')) return;
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    }
  });
  assert.deepEqual(present, { available: true, reason: 'executable-present-on-path' });
  assert.equal(seen.at(-1).candidate, path.join('/tools with spaces', 'npm'));

  const missing = await machineExecutablePresence('pnpm', {
    platform: 'linux',
    environment: { PATH: '/missing' },
    access: async () => {
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    }
  });
  assert.deepEqual(missing, { available: false, reason: 'executable-not-found-on-path' });

  const noPath = await machineExecutablePresence('npm', { platform: 'linux', environment: {} });
  assert.deepEqual(noPath, { available: false, reason: 'executable-path-unavailable' });

  const invalid = await machineExecutablePresence('../npm', { platform: 'linux', environment: { PATH: '/bin' } });
  assert.deepEqual(invalid, { available: false, reason: 'executable-name-invalid' });
});

test('machine repo.commands derives a source-bound minimal validation plan without script bodies', async () => {
  const scriptBody = 'node -e "process.exit(0)"';
  const fixture = await createGitRepo({ files: {
    'package.json': `${JSON.stringify({
      private: true,
      scripts: {
        check: scriptBody,
        dev: 'node -e "setInterval(() => {}, 1000)"'
      }
    }, null, 2)}\n`,
    'package-lock.json': `${JSON.stringify({ lockfileVersion: 3 })}\n`,
    'src/app.mjs': 'export const value = 1;\n'
  } });
  const service = new MachineActionService({
    enabled: true,
    allowedLocalRoots: [fixture.repo],
    allowedExecutables: ['npm'],
    deviceId: 'device-command-plan',
    deviceName: 'command-plan-fixture'
  });
  try {
    const clean = await service.inspect({ operation: 'repo.commands', path: fixture.repo });
    assert.equal(clean.contract, 'veteran-machine-action-v2');
    assert.equal(clean.repository.head, fixture.head);
    assert.equal(clean.commandPlan.contract, 'veteran-project-command-plan-v1');
    assert.deepEqual(clean.commandPlan.changedPaths, []);
    assert.deepEqual(clean.commandPlan.validation.minimal, []);
    assert.doesNotMatch(JSON.stringify(clean.commandPlan), /process\.exit|setInterval/);

    await fs.writeFile(path.join(fixture.repo, 'src/app.mjs'), 'export const value = 2;\n');
    const changed = await service.inspect({ operation: 'repo.commands', path: path.join(fixture.repo, 'src/app.mjs') });
    assert.equal(changed.repository.head, fixture.head);
    assert.deepEqual(changed.commandPlan.changedPaths, ['src/app.mjs']);
    assert.doesNotMatch(JSON.stringify(changed.commandPlan), /process\.exit|setInterval/);
    if (process.platform === 'win32') {
      assert.equal(changed.commandPlan.status, 'blocked');
      assert.deepEqual(changed.commandPlan.validation.minimal, []);
      assert.equal(changed.commandPlan.commands.every((item) => item.runnable === false), true);
      assert.equal(changed.commandPlan.commands.every((item) => item.readinessReason === 'windows-command-shim-requires-shell'), true);
    } else {
      assert.equal(changed.commandPlan.status, 'ready');
      assert.deepEqual(changed.commandPlan.validation.minimal.map((item) => item.command), [['npm', 'run', 'check']]);
      assert.equal(changed.commandPlan.validation.minimal[0].runnable, true);
    }
  } finally {
    await service.shutdown();
    await cleanup(fixture.root);
  }
});

test('machine actions enforce workspace policy and support bounded files plus one-shot execution', async () => {
  const root = await tempRoot();
  const outside = await tempRoot();
  const service = new MachineActionService({
    enabled: true,
    allowedLocalRoots: [root],
    allowedExecutables: ['node'],
    deviceId: 'device-test',
    deviceName: 'fixture'
  });
  try {
    const status = await service.inspect({ operation: 'status' });
    assert.equal(status.enabled, true);
    assert.equal(status.device.id, 'device-test');
    assert.deepEqual(status.allowedExecutables, ['node']);

    const dir = path.join(root, 'src');
    await service.act({ operation: 'fs.mkdir', path: dir });
    const file = path.join(dir, 'hello.txt');
    const write = await service.act({ operation: 'fs.write', path: file, content: 'alpha\nbeta\n', requireAbsent: true });
    assert.equal(write.created, true);
    assert.match(write.afterSha256, /^[0-9a-f]{64}$/);
    assert.equal(write.receipt.contract, 'veteran-machine-action-receipt-v1');
    assert.match(write.receipt.actionId, /^machineaction_/);
    assert.equal(write.receipt.resultIdentity, 'sha256:' + write.afterSha256);

    const digest = await service.inspect({ operation: 'fs.digest', path: file });
    assert.equal(digest.algorithm, 'sha256');
    assert.equal(digest.digest, write.afterSha256);

    await assert.rejects(
      service.act({ operation: 'fs.write', path: file, content: 'stale\n', expectedSha256: '0'.repeat(64) }),
      (error) => error?.code === 'MACHINE_FILE_PRECONDITION_FAILED'
    );

    const append = await service.act({
      operation: 'fs.append',
      path: file,
      content: 'gamma\n',
      expectedSha256: write.afterSha256
    });
    assert.equal(append.beforeSha256, write.afterSha256);
    assert.notEqual(append.afterSha256, write.afterSha256);

    const replace = await service.act({
      operation: 'fs.replace',
      path: file,
      oldText: 'beta\n',
      newText: 'beta-edited\n',
      expectedOccurrences: 1,
      expectedSha256: append.afterSha256
    });
    assert.equal(replace.replacements, 1);
    assert.equal(replace.beforeSha256, append.afterSha256);
    assert.notEqual(replace.afterSha256, replace.beforeSha256);

    await assert.rejects(
      service.act({
        operation: 'fs.replace',
        path: file,
        oldText: 'beta-edited\n',
        newText: 'should-not-land\n',
        expectedOccurrences: 2,
        expectedSha256: replace.afterSha256
      }),
      (error) => error?.code === 'MACHINE_REPLACE_MATCH_COUNT_MISMATCH'
    );
    assert.equal((await service.inspect({ operation: 'fs.digest', path: file })).digest, replace.afterSha256);

    const binary = path.join(dir, 'binary.dat');
    await fs.writeFile(binary, Buffer.from([0xff, 0xfe, 0xfd]));
    const binaryDigest = await service.inspect({ operation: 'fs.digest', path: binary });
    await assert.rejects(
      service.act({
        operation: 'fs.replace',
        path: binary,
        oldText: 'x',
        newText: 'y',
        expectedSha256: binaryDigest.digest
      }),
      (error) => error?.code === 'MACHINE_TEXT_ENCODING_INVALID'
    );
    assert.equal((await service.inspect({ operation: 'fs.digest', path: binary })).digest, binaryDigest.digest);

    if (process.platform !== 'win32') {
      const symlink = path.join(dir, 'linked.txt');
      await fs.symlink(file, symlink);
      const symlinkDigest = await service.inspect({ operation: 'fs.digest', path: symlink });
      await assert.rejects(
        service.act({
          operation: 'fs.replace',
          path: symlink,
          oldText: 'beta-edited\n',
          newText: 'should-not-replace-link\n',
          expectedSha256: symlinkDigest.digest
        }),
        (error) => error?.code === 'MACHINE_REPLACE_SYMLINK_UNSUPPORTED'
      );
      assert.equal((await service.inspect({ operation: 'fs.digest', path: symlink })).digest, symlinkDigest.digest);
    }

    const read = await service.inspect({ operation: 'fs.read', path: file });
    assert.equal(read.data, 'alpha\nbeta-edited\ngamma\n');

    const search = await service.inspect({ operation: 'fs.search', path: root, query: 'beta-edited' });
    assert.equal(search.matches.some((item) => item.path === file && item.kind === 'content'), true);

    const moved = path.join(dir, 'moved.txt');
    const move = await service.act({
      operation: 'fs.move',
      path: file,
      destination: moved,
      expectedSha256: replace.afterSha256,
      requireAbsent: true
    });
    assert.equal(move.beforeSha256, replace.afterSha256);
    assert.equal(move.afterSha256, replace.afterSha256);
    assert.equal(move.receipt.resultIdentity, 'sha256:' + replace.afterSha256);
    assert.equal((await service.inspect({ operation: 'fs.stat', path: moved })).stat.type, 'file');

    const run = await service.act({
      operation: 'process.start',
      command: 'node',
      args: ['-e', 'process.stdout.write("machine-ok")'],
      cwd: root,
      timeoutMs: 10_000
    });
    assert.equal(run.exitCode, 0);
    assert.equal(run.stdout, 'machine-ok');
    assert.match(run.outputSha256, /^[0-9a-f]{64}$/);
    assert.equal(run.receipt.contract, 'veteran-machine-action-receipt-v1');
    assert.equal(run.receipt.resultIdentity, 'process-action:' + run.receipt.actionId);

    await assert.rejects(
      service.inspect({ operation: 'fs.read', path: path.join(outside, 'nope.txt') }),
      (error) => error?.code === 'REMOTE_WORKSPACE_NOT_ALLOWED'
    );
    await assert.rejects(
      service.act({ operation: 'process.start', command: 'curl', args: [], cwd: root }),
      (error) => error?.code === 'MACHINE_EXECUTABLE_NOT_ALLOWED'
    );
  } finally {
    await service.shutdown();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('machine actions preserve interactive process sessions and bounded output reads', async () => {
  const root = await tempRoot();
  const service = new MachineActionService({
    enabled: true,
    allowedLocalRoots: [root],
    allowedExecutables: ['node'],
    maxSessionOutputBytes: 64 * 1024
  });
  try {
    const started = await service.act({
      operation: 'process.start',
      command: 'node',
      args: ['-e', 'process.stdin.setEncoding("utf8"); process.stdin.on("data", d => { console.log("echo:"+d.trim()); if (d.includes("bye")) process.exit(0); });'],
      cwd: root,
      persistent: true,
      timeoutMs: 30_000
    });
    const sessionId = started.session.id;
    assert.equal(started.session.actionId, started.receipt.actionId);
    const inputReceipt = await service.act({ operation: 'process.input', sessionId, input: 'hello\n' });
    assert.equal(inputReceipt.receipt.parentActionId, started.receipt.actionId);
    let output = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      output = await service.inspect({ operation: 'process.output', sessionId });
      if (output.events.some((item) => item.text.includes('echo:hello'))) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(output.events.some((item) => item.text.includes('echo:hello')), true);

    await service.act({ operation: 'process.input', sessionId, input: 'bye\n' });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const current = await service.inspect({ operation: 'process.status', sessionId });
      if (current.session.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const final = await service.inspect({ operation: 'process.status', sessionId });
    assert.equal(final.session.status, 'exited');
    output = await service.inspect({ operation: 'process.output', sessionId });
    assert.equal(output.events.some((item) => item.text.includes('echo:bye')), true);
  } finally {
    await service.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('machine repo.status binds local repository truth before and after a guarded edit', async () => {
  const fixture = await createGitRepo({ files: { 'README.md': 'hello\n', 'other.txt': 'other\n' } });
  const service = new MachineActionService({
    enabled: true,
    allowedLocalRoots: [fixture.repo],
    deviceId: 'device-repo',
    deviceName: 'repo-fixture'
  });
  try {
    const initial = await service.inspect({ operation: 'repo.status', path: fixture.repo });
    assert.equal(initial.contract, 'veteran-machine-action-v2');
    assert.equal(initial.repository.head, fixture.head);
    assert.equal(initial.repository.dirty, false);
    assert.equal(initial.repository.detached, false);

    const readme = path.join(fixture.repo, 'README.md');
    const before = await service.inspect({ operation: 'fs.digest', path: readme });
    const write = await service.act({
      operation: 'fs.write',
      path: readme,
      content: 'hello\nchanged\n',
      expectedSha256: before.digest,
      expectedRepoHead: initial.repository.head
    });
    assert.equal(write.beforeSha256, before.digest);

    const after = await service.inspect({ operation: 'repo.status', path: readme });
    assert.equal(after.repository.root, await fs.realpath(fixture.repo));
    assert.equal(after.repository.head, fixture.head);
    assert.equal(after.repository.dirty, true);
    assert.equal(after.repository.unstaged >= 1, true);

    await fs.writeFile(path.join(fixture.repo, 'other.txt'), 'other\nunrelated\n');
    const diff = await service.inspect({ operation: 'repo.diff', path: readme, contextLines: 1 });
    assert.equal(diff.repository.head, fixture.head);
    assert.equal(diff.scope, 'README.md');
    assert.equal(diff.staged, false);
    assert.equal(diff.contextLines, 1);
    assert.match(diff.patch, /\+changed/);
    assert.doesNotMatch(diff.patch, /unrelated/);
    assert.equal(diff.truncated, false);

    await git(fixture.repo, ['add', 'README.md']);
    const stagedDiff = await service.inspect({ operation: 'repo.diff', path: fixture.repo, staged: true });
    assert.equal(stagedDiff.staged, true);
    assert.match(stagedDiff.patch, /\+changed/);
    await git(fixture.repo, ['commit', '-q', '-m', 'advance repository head']);
    const advanced = await service.inspect({ operation: 'repo.status', path: fixture.repo });
    assert.notEqual(advanced.repository.head, initial.repository.head);
    const currentDigest = await service.inspect({ operation: 'fs.digest', path: readme });
    await assert.rejects(
      service.act({
        operation: 'fs.append',
        path: readme,
        content: 'should-not-land\n',
        expectedSha256: currentDigest.digest,
        expectedRepoHead: initial.repository.head
      }),
      (error) => error?.code === 'MACHINE_REPOSITORY_PRECONDITION_FAILED'
    );
    assert.equal((await service.inspect({ operation: 'fs.digest', path: readme })).digest, currentDigest.digest);
  } finally {
    await service.shutdown();
    await cleanup(fixture.root);
  }
});
