import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { ProjectBootstrapExecutor } from '../src/bootstrap-executor.mjs';
import { git } from '../src/git.mjs';
import { cleanup, createGitRepo } from './helpers.mjs';

const PLAN = {
  contract: 'veteran-project-bootstrap-plan-v1',
  status: 'planned',
  steps: [{
    id: 'path-probe',
    command: ['veteran-bootstrap-path-probe'],
    cwd: '.',
    network: false,
    reproducible: true,
    executesThirdPartyCode: false,
    requiresAuthorization: true,
    executionPolicy: 'approval-required'
  }]
};

const AUTHORIZATION = {
  contract: 'veteran-bootstrap-authorization-v1',
  execute: true,
  allowNetwork: false,
  allowThirdPartyCode: false,
  credentialRefs: []
};

async function executable(target, content) {
  await fs.writeFile(target, content);
  await fs.chmod(target, 0o755);
}

test('bootstrap executable lookup ignores relative and worktree-contained PATH entries', { skip: process.platform === 'win32' }, async () => {
  const fixture = await createGitRepo();
  try {
    const malicious = path.join(fixture.repo, 'veteran-bootstrap-path-probe');
    await executable(malicious, '#!/bin/sh\nexit 47\n');
    await git(fixture.repo, ['add', 'veteran-bootstrap-path-probe']);
    await git(fixture.repo, ['commit', '-q', '-m', 'add path probe']);

    const hostBin = path.join(fixture.root, 'host-bin');
    const marker = path.join(fixture.root, 'host-marker.txt');
    await fs.mkdir(hostBin, { recursive: true });
    await executable(path.join(hostBin, 'veteran-bootstrap-path-probe'), `#!/bin/sh\nprintf host > ${JSON.stringify(marker)}\n`);

    const linkedWorktree = path.join(fixture.root, 'linked-worktree');
    await fs.symlink(fixture.repo, linkedWorktree, 'dir');
    const environment = {
      PATH: ['.', 'relative-bin', fixture.repo, linkedWorktree, hostBin, hostBin].join(path.delimiter)
    };
    const executor = new ProjectBootstrapExecutor({ environment });
    const result = await executor.prepare({ worktreePath: fixture.repo, plan: PLAN, authorization: AUTHORIZATION });

    assert.equal(result.status, 'completed');
    assert.equal(await fs.readFile(marker, 'utf8'), 'host');
  } finally {
    await cleanup(fixture.root);
  }
});

test('bootstrap fails closed when PATH has no safe absolute executable directory', { skip: process.platform === 'win32' }, async () => {
  const fixture = await createGitRepo();
  try {
    const malicious = path.join(fixture.repo, 'veteran-bootstrap-path-probe');
    await executable(malicious, '#!/bin/sh\nexit 0\n');
    await git(fixture.repo, ['add', 'veteran-bootstrap-path-probe']);
    await git(fixture.repo, ['commit', '-q', '-m', 'add path probe']);

    const linkedWorktree = path.join(fixture.root, 'linked-worktree');
    await fs.symlink(fixture.repo, linkedWorktree, 'dir');
    const executor = new ProjectBootstrapExecutor({
      environment: { PATH: ['.', 'relative-bin', fixture.repo, linkedWorktree].join(path.delimiter) }
    });

    await assert.rejects(
      () => executor.prepare({ worktreePath: fixture.repo, plan: PLAN, authorization: AUTHORIZATION }),
      (error) => error?.code === 'BOOTSTRAP_HOST_PATH_UNSAFE'
    );
  } finally {
    await cleanup(fixture.root);
  }
});
