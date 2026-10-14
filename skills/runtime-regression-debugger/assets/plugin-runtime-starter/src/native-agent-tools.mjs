import fs from 'node:fs/promises';
import path from 'node:path';

function fail(code, message) { return Object.assign(new Error(message), { code }); }
const MAX_READ_BYTES = 100_000;
const MAX_WRITE_BYTES = 100_000;
const PRIVATE_FILE = /(^|\/)(\.env(?:\..*)?|\.git|\.ssh|id_rsa|id_ed25519|[^/]+\.(?:pem|key|p12|pfx))($|\/)/i;
function under(parent, candidate) {
  const r = path.relative(parent, candidate);
  return r === '' || (r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r));
}
function relativeWindowsCanonical(p) { return p.replaceAll('\\', '/'); }

export async function createScopedRepositoryTools({ worktreePath, writeSet = [], protectedPaths = [] } = {}) {
  if (typeof worktreePath !== 'string' || !worktreePath) throw fail('NATIVE_AGENT_WORKTREE_REQUIRED', 'A task worktree is required');
  const root = await fs.realpath(worktreePath);
  if (!Array.isArray(writeSet) || !Array.isArray(protectedPaths)) throw fail('NATIVE_AGENT_SCOPE_INVALID', 'Write scope must be an array');
  const writers = writeSet.map((scope) => {
    if (typeof scope !== 'string' || !scope.trim() || path.isAbsolute(scope)) throw fail('NATIVE_AGENT_SCOPE_INVALID', 'Invalid write scope');
    const resolved = path.resolve(root, scope);
    if (!under(root, resolved)) throw fail('NATIVE_AGENT_SCOPE_INVALID', 'Write scope escapes worktree');
    return resolved;
  });
  const protectedOwners = protectedPaths.map((scope) => path.resolve(root, scope));

  async function resolveSafe(relative, writing = false) {
    if (typeof relative !== 'string' || !relative.trim() || path.isAbsolute(relative) || relative.includes('\0')) {
      throw fail('NATIVE_AGENT_PATH_INVALID', 'Expected a relative worktree path');
    }
    const target = path.resolve(root, relative);
    if (!under(root, target) || PRIVATE_FILE.test(relativeWindowsCanonical(path.relative(root, target)))) {
      throw fail('NATIVE_AGENT_PATH_DENIED', 'Path is outside authorized repository scope');
    }
    const actualRoot = await fs.realpath(root);
    let cursor = target;
    const missing = [];
    let existed = false;
    while (!existed) {
      try {
        const stat = await fs.lstat(cursor);
        if (stat.isSymbolicLink()) throw fail('NATIVE_AGENT_SYMLINK_DENIED', 'Symbolic-link paths are unavailable to the Agent');
        const real = await fs.realpath(cursor);
        cursor = path.join(real, ...missing.reverse());
        existed = true;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        const parent = path.dirname(cursor);
        if (parent === cursor) throw error;
        missing.push(path.basename(cursor));
        cursor = parent;
      }
    }
    if (!under(actualRoot, cursor)) throw fail('NATIVE_AGENT_PATH_DENIED', 'Path resolves outside worktree');
    if (writing) {
      if (!writers.some((scope) => under(scope, target)) || protectedOwners.some((scope) => under(scope, target))) {
        throw fail('NATIVE_AGENT_WRITE_SCOPE_DENIED', 'Write is outside the declared task writeSet');
      }
      if (target === root) throw fail('NATIVE_AGENT_WRITE_SCOPE_DENIED', 'Root directory cannot be overwritten');
    }
    return target;
  }

  const read = {
    name: 'read_file', description: 'Read a repository file for evidence (relative path).', readOnly: true,
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    async execute({ path: file }) {
      const target = await resolveSafe(file);
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.size > MAX_READ_BYTES) throw fail('NATIVE_AGENT_READ_LIMIT', 'File is not a small regular text file');
      return await fs.readFile(target, 'utf8');
    }
  };
  const list = {
    name: 'list_files', description: 'List files in a relative repository directory.', readOnly: true,
    parameters: { type: 'object', properties: { path: { type: 'string' } } },
    async execute({ path: dirname = '.' } = {}) {
      const target = dirname === '.' ? root : await resolveSafe(dirname);
      const entries = await fs.readdir(target, { withFileTypes: true });
      return entries.filter((entry) => !PRIVATE_FILE.test(relativeWindowsCanonical(entry.name)))
        .slice(0, 150).map((entry) => ({ name: entry.name, type: entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'directory' : 'file' }));
    }
  };
  const search = {
    name: 'search_text', description: 'Find text evidence in repository files. Returns bounded path:line results.', readOnly: true,
    parameters: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' } }, required: ['query'] },
    async execute({ query, path: subdir = '.' }) {
      if (typeof query !== 'string' || !query.trim() || query.length > 200) throw fail('NATIVE_AGENT_SEARCH_INVALID', 'Search string must be 1-200 characters');
      const start = subdir === '.' ? root : await resolveSafe(subdir);
      const hits = [];
      let visited = 0;
      const pending = [start];
      while (pending.length && visited < 400 && hits.length < 60) {
        const target = pending.shift();
        visited++;
        const stat = await fs.lstat(target);
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) {
          if (path.relative(root, target).split(path.sep).length > 10) continue;
          const entries = await fs.readdir(target, { withFileTypes: true });
          for (const entry of entries) {
            if (PRIVATE_FILE.test(entry.name) || ['node_modules', 'dist', 'build', 'coverage', '.git'].includes(entry.name)) continue;
            if (entry.isFile() || entry.isDirectory()) pending.push(path.join(target, entry.name));
          }
        } else if (stat.isFile() && stat.size <= MAX_READ_BYTES) {
          const content = await fs.readFile(target, 'utf8');
          for (const [index, line] of content.split('\n').entries()) {
            if (line.includes(query)) hits.push({ path: path.relative(root, target), line: index + 1, preview: line.slice(0, 240) });
            if (hits.length >= 60) break;
          }
        }
      }
      return { matches: hits, filesInspected: visited, truncated: pending.length > 0 || hits.length === 60 };
    }
  };
  const write = {
    name: 'write_file', description: 'Create or replace a text file strictly inside the task writeSet. The runtime owns git commits.', readOnly: false,
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    async execute({ path: file, content }) {
      if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) throw fail('NATIVE_AGENT_WRITE_LIMIT', 'Content must be bounded UTF-8 text');
      const target = await resolveSafe(file, true);
      await fs.mkdir(path.dirname(target), { recursive: true });
      // Recheck after directory creation; fail closed on symlinked owners.
      await resolveSafe(file, true);
      const handle = await fs.open(target, 'w', 0o600);
      try { await handle.writeFile(content, 'utf8'); } finally { await handle.close(); }
      return { path: file, writtenBytes: Buffer.byteLength(content, 'utf8') };
    }
  };
  const edit = {
    name: 'edit_file', description: 'Replace exactly one occurrence of old_text in a scoped repository file.', readOnly: false,
    parameters: { type: 'object', properties: {
      path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' }
    }, required: ['path', 'old_text', 'new_text'] },
    async execute({ path: file, old_text, new_text }) {
      if (typeof old_text !== 'string' || !old_text.length || typeof new_text !== 'string') throw fail('NATIVE_AGENT_EDIT_INVALID', 'Specify non-empty old_text and replacement');
      const target = await resolveSafe(file, true);
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.size > MAX_READ_BYTES) throw fail('NATIVE_AGENT_READ_LIMIT', 'File too large to edit');
      const current = await fs.readFile(target, 'utf8');
      if (current.split(old_text).length !== 2) throw fail('NATIVE_AGENT_EDIT_AMBIGUOUS', 'old_text must occur exactly once');
      return write.execute({ path: file, content: current.replace(old_text, new_text) });
    }
  };
  return [list, read, search, write, edit];
}
