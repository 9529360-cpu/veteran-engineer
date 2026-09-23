import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MachineActionService } from '../src/machine-action-service.mjs';

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
    await service.act({ operation: 'fs.write', path: file, content: 'alpha\nbeta\n' });
    const read = await service.inspect({ operation: 'fs.read', path: file });
    assert.equal(read.data, 'alpha\nbeta\n');

    const search = await service.inspect({ operation: 'fs.search', path: root, query: 'beta' });
    assert.equal(search.matches.some((item) => item.path === file && item.kind === 'content'), true);

    const moved = path.join(dir, 'moved.txt');
    await service.act({ operation: 'fs.move', path: file, destination: moved });
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
    await service.act({ operation: 'process.input', sessionId, input: 'hello\n' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    let output = await service.inspect({ operation: 'process.output', sessionId });
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
