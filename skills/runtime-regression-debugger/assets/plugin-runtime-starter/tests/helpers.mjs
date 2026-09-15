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

function linuxProcessState(stat) {
  const close = stat.lastIndexOf(')');
  if (close === -1) return null;
  return stat.slice(close + 1).trim().split(/\s+/, 1)[0] || null;
}

export async function processRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (process.platform === 'linux') {
    try {
      const state = linuxProcessState(await fs.readFile(`/proc/${pid}/stat`, 'utf8'));
      return state !== null && !['Z', 'X'].includes(state);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ESRCH') return false;
      throw error;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

export async function waitForProcessStopped(pid, { timeoutMs = 4_000, pollMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await processRunning(pid))) return true;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return !(await processRunning(pid));
}

export async function cleanup(target) {
  await fs.rm(target, { recursive: true, force: true });
}
