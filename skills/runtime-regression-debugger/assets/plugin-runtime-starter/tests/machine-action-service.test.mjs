import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MachineActionService } from '../src/machine-action-service.mjs';
import { git } from '../src/git.mjs';
import { createGitRepo, cleanup } from './helpers.mjs';

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'veteran-machine-actions-'));
}

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
  const fixture = await createGitRepo();
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

    const diff = await service.inspect({ operation: 'repo.diff', path: readme, contextLines: 1 });
    assert.equal(diff.repository.head, fixture.head);
    assert.equal(diff.staged, false);
    assert.equal(diff.contextLines, 1);
    assert.match(diff.patch, /\+changed/);
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
