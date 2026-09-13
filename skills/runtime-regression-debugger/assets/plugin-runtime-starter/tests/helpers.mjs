import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runProcess, git } from '../src/git.mjs';

export async function tempDir(prefix = 'veteran-test-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function createGitRepo({ files = { 'README.md': 'hello\n' } } = {}) {
  const root = await tempDir();
  const repo = path.join(root, 'repo');
  await fs.mkdir(repo, { recursive: true });
  await runProcess('git', ['init', '-q'], { cwd: repo });
  await git(repo, ['config', 'user.name', 'Veteran Test']);
  await git(repo, ['config', 'user.email', 'veteran-test@example.invalid']);
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(repo, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-q', '-m', 'initial']);
  const head = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  return { root, repo, head, stateRoot: path.join(root, 'state') };
}

export async function cleanup(target) {
  await fs.rm(target, { recursive: true, force: true });
}
