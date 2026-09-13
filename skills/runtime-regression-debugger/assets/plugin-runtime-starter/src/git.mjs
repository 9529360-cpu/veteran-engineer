import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_COMMAND_TIMEOUT_MS } from './constants.mjs';
import { errorWithCode, normalizePathList, within } from './util.mjs';

const SAFE_SUBPROCESS_ENV_KEYS = ['PATH', 'HOME', 'USERPROFILE', 'TMP', 'TEMP', 'TMPDIR', 'SYSTEMROOT', 'COMSPEC', 'LANG', 'LC_ALL', 'SHELL'];

export function allowlistedProcessEnvironment(extraKeys = [], source = process.env) {
  if (!Array.isArray(extraKeys) || extraKeys.some((key) => typeof key !== 'string' || !key.trim())) {
    throw errorWithCode('Subprocess envAllowlist must contain non-empty environment variable names', 'PROCESS_ENV_ALLOWLIST_INVALID');
  }
  const env = {};
  for (const key of new Set([...SAFE_SUBPROCESS_ENV_KEYS, ...extraKeys.map((key) => key.trim())])) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  return env;
}

export function runProcess(command, args = [], { cwd, env, inheritEnv = true, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, input, allowFailure = false } = {}) {
  const childEnv = inheritEnv
    ? (env ? { ...process.env, ...env } : process.env)
    : { ...(env || {}) };
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: childEnv,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const result = { code, signal, stdout, stderr };
      if (code === 0 || allowFailure) return resolve(result);
      const error = errorWithCode(`${command} ${args.join(' ')} failed with code ${code}`, 'PROCESS_FAILED', result);
      reject(error);
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

export async function git(repo, args, options = {}) {
  return runProcess('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, ...options });
}

export async function resolveRepository(inputPath) {
  const candidate = path.resolve(inputPath);
  const { stdout } = await git(candidate, ['rev-parse', '--show-toplevel']);
  return (await fs.realpath(stdout.trim())).replaceAll('\\', '/');
}

export async function sourceIdentity(repo) {
  const [head, branch, status] = await Promise.all([
    git(repo, ['rev-parse', 'HEAD']),
    git(repo, ['branch', '--show-current']),
    git(repo, ['status', '--porcelain=v1', '-z'])
  ]);
  const dirtyPaths = status.stdout.split('\0').filter(Boolean).map((line) => line.slice(3));
  return {
    head: head.stdout.trim(),
    branch: branch.stdout.trim() || null,
    dirty: dirtyPaths.length > 0,
    dirtyPaths: normalizePathList(dirtyPaths)
  };
}

export async function changedPaths(repo, base = 'HEAD') {
  const tracked = await git(repo, ['diff', '--name-only', '-z', base], { allowFailure: false });
  const untracked = await git(repo, ['ls-files', '--others', '--exclude-standard', '-z']);
  return normalizePathList([
    ...tracked.stdout.split('\0').filter(Boolean),
    ...untracked.stdout.split('\0').filter(Boolean)
  ]);
}

export async function assertPathsWithinScope(repo, paths, writeSet) {
  const scopes = normalizePathList(writeSet);
  if (paths.length === 0) return;
  const broad = scopes.includes('.');
  for (const rel of paths) {
    if (rel.startsWith('../') || path.isAbsolute(rel)) {
      throw errorWithCode(`Write escaped repository: ${rel}`, 'WRITE_SCOPE_VIOLATION', { path: rel });
    }
    const abs = path.join(repo, rel);
    let real = abs;
    try { real = await fs.realpath(abs); } catch { real = path.resolve(abs); }
    if (!within(repo, real)) {
      throw errorWithCode(`Symlink traversal escaped repository: ${rel}`, 'SYMLINK_SCOPE_VIOLATION', { path: rel, real });
    }
    const allowed = broad || scopes.some((scope) => rel === scope || rel.startsWith(`${scope}/`));
    if (!allowed) throw errorWithCode(`Path outside declared write scope: ${rel}`, 'WRITE_SCOPE_VIOLATION', { path: rel, writeSet: scopes });
  }
}

export function writeSetsConflict(a = [], b = []) {
  const left = normalizePathList(a);
  const right = normalizePathList(b);
  if (left.includes('.') || right.includes('.')) return left.length > 0 && right.length > 0;
  return left.some((x) => right.some((y) => x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)));
}
