#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const MIGRATION_SPEC_CONTRACT = 'veteran-native-migration-spec-v1';
export const MIGRATION_REPORT_CONTRACT = 'veteran-native-migration-report-v1';
const LIMIT = { spec: 256 * 1024, files: 2000, file: 8 * 1024 * 1024, total: 64 * 1024 * 1024, statements: 50000, findings: 5000, roots: 32 };
const SEVERITY = { low: 1, medium: 2, high: 3, critical: 4 };
const TOP_KEYS = new Set(['contract', 'roots', 'policy']);
const POLICY_KEYS = new Set(['idMode', 'requireTransaction', 'requireDownPair', 'minFiles']);

function err(message, code, details) { const e = new Error(message); e.code = code; if (details !== undefined) e.details = details; return e; }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function portable(value) { return String(value).split(path.sep).join('/'); }
function contained(root, target) { const rel = path.relative(root, target); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); }
async function statOrNull(target) { try { return await fs.lstat(target); } catch (e) { if (e?.code === 'ENOENT') return null; throw e; } }
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])])); return value; }

function relativePath(value, label) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0') || path.isAbsolute(value)) throw err(`${label} must be a relative path`, 'MIGRATION_PATH_INVALID');
  const normalized = path.normalize(value);
  if (normalized === '.' || normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw err(`${label} escapes root`, 'MIGRATION_PATH_INVALID');
  return portable(normalized);
}
function knownKeys(object, allowed, label) { for (const key of Object.keys(object)) if (!allowed.has(key)) throw err(`${label} contains unknown field ${key}`, 'MIGRATION_SPEC_INVALID'); }

export function normalizeMigrationSpec(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.contract !== MIGRATION_SPEC_CONTRACT) throw err(`Migration spec must use contract ${MIGRATION_SPEC_CONTRACT}`, 'MIGRATION_SPEC_INVALID');
  knownKeys(raw, TOP_KEYS, 'Migration spec');
  if (!Array.isArray(raw.roots) || raw.roots.length < 1 || raw.roots.length > LIMIT.roots) throw err(`Migration roots must contain 1-${LIMIT.roots} directories`, 'MIGRATION_SPEC_INVALID');
  const roots = [...new Set(raw.roots.map((v) => relativePath(v, 'Migration root')))];
  for (let i = 0; i < roots.length; i += 1) for (let j = i + 1; j < roots.length; j += 1) {
    const a = `${roots[i].replace(/\/$/, '')}/`, b = `${roots[j].replace(/\/$/, '')}/`;
    if (a.startsWith(b) || b.startsWith(a)) throw err('Migration roots must not overlap', 'MIGRATION_SPEC_INVALID');
  }
  const policy = raw.policy ?? {};
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw err('Migration policy must be an object', 'MIGRATION_SPEC_INVALID');
  knownKeys(policy, POLICY_KEYS, 'Migration policy');
  const idMode = policy.idMode ?? 'none';
  if (!['none', 'numeric-prefix'].includes(idMode)) throw err('Migration idMode must be none or numeric-prefix', 'MIGRATION_SPEC_INVALID');
  const requireTransaction = policy.requireTransaction ?? false, requireDownPair = policy.requireDownPair ?? false;
  if (typeof requireTransaction !== 'boolean' || typeof requireDownPair !== 'boolean') throw err('Migration boolean policy is invalid', 'MIGRATION_SPEC_INVALID');
  const minFiles = policy.minFiles ?? 1;
  if (!Number.isInteger(minFiles) || minFiles < 0 || minFiles > LIMIT.files) throw err(`Migration minFiles must be 0-${LIMIT.files}`, 'MIGRATION_SPEC_INVALID');
  return Object.freeze({ contract: MIGRATION_SPEC_CONTRACT, roots: Object.freeze(roots), policy: Object.freeze({ idMode, requireTransaction, requireDownPair, minFiles }) });
}

async function readInput(root, rel) {
  const safe = relativePath(rel, 'Input path'), target = path.resolve(root, safe);
  if (!contained(root, target)) throw err('Input path escapes root', 'MIGRATION_PATH_ESCAPE');
  const info = await statOrNull(target);
  if (!info || info.isSymbolicLink() || !info.isFile() || info.size > LIMIT.spec) throw err('Migration spec file is invalid', 'MIGRATION_SPEC_INVALID');
  const real = await fs.realpath(target);
  if (!contained(root, real)) throw err('Input real path escapes root', 'MIGRATION_PATH_ESCAPE');
  return fs.readFile(real, 'utf8');
}
async function migrationRoot(root, rel) {
  const safe = relativePath(rel, 'Migration root'), target = path.resolve(root, safe);
  if (!contained(root, target)) throw err('Migration root escapes project root', 'MIGRATION_PATH_ESCAPE');
  const info = await statOrNull(target);
  if (!info || info.isSymbolicLink() || !info.isDirectory()) throw err('Migration root must be a real directory', 'MIGRATION_ROOT_INVALID', { path: safe });
  const real = await fs.realpath(target);
  if (!contained(root, real)) throw err('Migration root real path escapes project root', 'MIGRATION_PATH_ESCAPE');
  return real;
}
async function discover(root, roots) {
  const files = new Map(); let bytes = 0;
  for (const owner of roots) {
    const start = await migrationRoot(root, owner), stack = [start];
    while (stack.length) {
      const dir = stack.pop(), entries = await fs.readdir(dir, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const entry = entries[i], full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { stack.push(full); continue; }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.sql')) continue;
        const info = await fs.stat(full);
        if (info.size > LIMIT.file) throw err('Migration SQL file exceeds byte limit', 'MIGRATION_FILE_LIMIT', { path: portable(path.relative(root, full)), bytes: info.size });
        const real = await fs.realpath(full);
        if (!contained(root, real)) throw err('Migration SQL real path escapes root', 'MIGRATION_PATH_ESCAPE');
        if (files.has(real)) continue;
        bytes += info.size;
        if (bytes > LIMIT.total) throw err('Migration SQL input exceeds total byte limit', 'MIGRATION_TOTAL_BYTES_LIMIT');
        files.set(real, { full: real, path: portable(path.relative(root, real)), owner, bytes: info.size });
        if (files.size > LIMIT.files) throw err('Migration SQL file count exceeded limit', 'MIGRATION_FILE_LIMIT');
      }
    }
  }
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function maskSql(source) {
  let out = '', state = 'normal', tag = null, depth = 0;
  for (let i = 0; i < source.length;) {
    const ch = source[i], next = source[i + 1] || '';
    if (state === 'line') { out += ch === '\n' ? '\n' : ' '; if (ch === '\n') state = 'normal'; i += 1; continue; }
    if (state === 'block') {
      if (ch === '/' && next === '*') { out += '  '; depth += 1; i += 2; continue; }
      if (ch === '*' && next === '/') { out += '  '; depth -= 1; i += 2; if (!depth) state = 'normal'; continue; }
      out += ch === '\n' ? '\n' : ' '; i += 1; continue;
    }
    if (state === 'single') {
      if (ch === '\\' && next) { out += next === '\n' ? ' \n' : '  '; i += 2; continue; }
      if (ch === "'" && next === "'") { out += '  '; i += 2; continue; }
      out += ch === '\n' ? '\n' : ' '; if (ch === "'") state = 'normal'; i += 1; continue;
    }
    if (state === 'double') { if (ch === '"' && next === '"') { out += '  '; i += 2; continue; } out += ch === '\n' ? '\n' : ' '; if (ch === '"') state = 'normal'; i += 1; continue; }
    if (state === 'dollar') { if (source.startsWith(tag, i)) { out += ' '.repeat(tag.length); i += tag.length; state = 'normal'; tag = null; continue; } out += ch === '\n' ? '\n' : ' '; i += 1; continue; }
    if (ch === '-' && next === '-') { out += '  '; state = 'line'; i += 2; continue; }
    if (ch === '/' && next === '*') { out += '  '; state = 'block'; depth = 1; i += 2; continue; }
    if (ch === "'") { out += ' '; state = 'single'; i += 1; continue; }
    if (ch === '"') { out += 'I'; state = 'double'; i += 1; continue; }
    if (ch === '$') { const m = source.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/); if (m) { tag = m[0]; out += ' '.repeat(tag.length); state = 'dollar'; i += tag.length; continue; } }
    out += ch; i += 1;
  }
  if (['block', 'single', 'double', 'dollar'].includes(state)) throw err('Migration SQL contains an unterminated quoted/comment block', 'MIGRATION_SQL_INVALID');
  return out;
}
function statements(masked) {
  const out = []; let start = 0, line = 1, startLine = 1;
  for (let i = 0; i <= masked.length; i += 1) {
    const ch = masked[i] || ';'; if (ch === '\n') line += 1; if (ch !== ';') continue;
    const raw = masked.slice(start, i), text = raw.trim();
    if (text) { const leading = raw.length - raw.trimStart().length; out.push({ text, line: startLine + raw.slice(0, leading).split('\n').length - 1 }); if (out.length > LIMIT.statements) throw err('Migration SQL statement count exceeded limit', 'MIGRATION_STATEMENT_LIMIT'); }
    start = i + 1; startLine = line;
  }
  return out;
}
function sql(text) { return text.replace(/\s+/g, ' ').trim().toUpperCase(); }
function begin(s) { return /^(BEGIN(?:\s+TRANSACTION)?|START\s+TRANSACTION)\b/.test(s); }
function end(s) { return /^(COMMIT|END(?:\s+TRANSACTION)?|ROLLBACK)\b/.test(s); }
function concurrent(s) { return /^(CREATE|DROP)\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/.test(s); }
function mutating(s) { return /^(CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|REPLACE|MERGE|GRANT|REVOKE|COMMENT)\b/.test(s); }
function risk(s) {
  const rules = [
    [/^DROP\s+DATABASE\b/, 'drop-database', 'critical'], [/^DROP\s+SCHEMA\b/, 'drop-schema', 'critical'], [/^DROP\s+TABLE\b/, 'drop-table', 'high'],
    [/^TRUNCATE(?:\s+TABLE)?\b/, 'truncate-table', 'high'], [/^ALTER\s+TABLE\b.*\bDROP\s+COLUMN\b/, 'drop-column', 'high'],
    [/^ALTER\s+TABLE\b.*\bALTER\s+COLUMN\b.*\bTYPE\b/, 'alter-column-type', 'high'], [/^DROP\s+TYPE\b/, 'drop-type', 'high'],
    [/^DELETE\s+FROM\b(?!.*\bWHERE\b)/, 'delete-without-where', 'high'], [/^UPDATE\s+(?:ONLY\s+)?\S+\s+SET\b(?!.*\bWHERE\b)/, 'update-without-where', 'high']
  ];
  for (const [pattern, rule, severity] of rules) if (pattern.test(s)) return { rule, severity };
  return null;
}
function add(findings, item) { findings.push(item); if (findings.length > LIMIT.findings) throw err('Migration findings exceeded limit', 'MIGRATION_FINDING_LIMIT'); }
function idFor(file, mode) { if (mode === 'none') return null; return path.basename(file).match(/^(\d+)(?:[_\-.]|$)/)?.[1] || null; }

function analyze(file, content, policy, findings) {
  let open = false, starts = 0, ends = 0; const parts = statements(maskSql(content));
  for (const part of parts) {
    const normalized = sql(part.text), fingerprint = hash(normalized);
    if (begin(normalized)) { starts += 1; if (open) add(findings, { rule: 'nested-explicit-transaction', severity: 'medium', path: file, line: part.line, fingerprint }); open = true; continue; }
    if (end(normalized)) { ends += 1; if (!open) add(findings, { rule: 'transaction-end-without-begin', severity: 'high', path: file, line: part.line, fingerprint }); open = false; continue; }
    const classified = risk(normalized); if (classified) add(findings, { ...classified, path: file, line: part.line, fingerprint });
    if (concurrent(normalized) && open) add(findings, { rule: 'concurrent-index-inside-transaction', severity: 'high', path: file, line: part.line, fingerprint });
    if (policy.requireTransaction && mutating(normalized) && !open && !concurrent(normalized)) add(findings, { rule: 'statement-outside-explicit-transaction', severity: 'medium', path: file, line: part.line, fingerprint });
  }
  if (open || starts !== ends) add(findings, { rule: 'unbalanced-explicit-transaction', severity: 'high', path: file });
  return { statements: parts.length, transactionStarts: starts, transactionEnds: ends };
}
function rank(value) { return SEVERITY[value] || 0; }
export function evaluateMigrationReport(report, failOn = 'high') {
  if (!report || report.contract !== MIGRATION_REPORT_CONTRACT || !Array.isArray(report.findings)) throw err('Invalid migration report', 'MIGRATION_REPORT_INVALID');
  const level = String(failOn).toLowerCase(); if (!['none', 'low', 'medium', 'high', 'critical'].includes(level)) throw err('Invalid migration failOn severity', 'MIGRATION_FAIL_LEVEL_INVALID');
  const threshold = level === 'none' ? Infinity : rank(level), failing = report.findings.filter((v) => rank(v.severity) >= threshold);
  return { passed: failing.length === 0, failOn: level, failing: failing.length };
}

export async function auditMigrations(rootDir, rawSpec) {
  const root = await fs.realpath(path.resolve(rootDir)), spec = normalizeMigrationSpec(rawSpec), files = await discover(root, spec.roots), findings = [];
  if (files.length < spec.policy.minFiles) add(findings, { rule: 'minimum-migration-files-not-met', severity: 'high', expected: spec.policy.minFiles, actual: files.length });
  const ids = new Map(), previous = new Map(), migrations = [];
  for (const file of files) {
    const content = await fs.readFile(file.full, 'utf8'); if (content.includes('\0')) throw err('Migration SQL contains a NUL byte', 'MIGRATION_SQL_INVALID', { path: file.path });
    const id = idFor(file.path, spec.policy.idMode);
    if (spec.policy.idMode !== 'none' && !id) add(findings, { rule: 'migration-id-missing', severity: 'medium', path: file.path });
    if (id) {
      const ownerIds = ids.get(file.owner) || new Map(); ids.set(file.owner, ownerIds);
      if (ownerIds.has(id)) add(findings, { rule: 'duplicate-migration-id', severity: 'high', path: file.path, id, otherPath: ownerIds.get(id) }); else ownerIds.set(id, file.path);
      const prior = previous.get(file.owner), value = BigInt(id); if (prior && value <= prior.value) add(findings, { rule: 'migration-id-order', severity: 'medium', path: file.path, id, previousPath: prior.path, previousId: prior.id }); previous.set(file.owner, { value, id, path: file.path });
    }
    migrations.push({ path: file.path, root: file.owner, id, bytes: file.bytes, sha256: hash(content), ...analyze(file.path, content, spec.policy, findings) });
  }
  if (spec.policy.requireDownPair) {
    const paths = new Set(migrations.map((m) => m.path.toLowerCase()));
    for (const m of migrations) if (m.path.toLowerCase().endsWith('.up.sql')) { const expected = `${m.path.slice(0, -7)}.down.sql`; if (!paths.has(expected.toLowerCase())) add(findings, { rule: 'down-migration-missing', severity: 'medium', path: m.path, expected }); }
  }
  findings.sort((a, b) => rank(b.severity) - rank(a.severity) || String(a.path || '').localeCompare(String(b.path || '')) || a.rule.localeCompare(b.rule) || Number(a.line || 0) - Number(b.line || 0));
  const counts = { critical: 0, high: 0, medium: 0, low: 0 }; for (const f of findings) counts[f.severity] += 1;
  return { contract: MIGRATION_REPORT_CONTRACT, root: '.', spec: { contract: spec.contract, identity: hash(JSON.stringify(stable(spec))), roots: [...spec.roots], policy: { ...spec.policy } }, source: { files: migrations.length, bytes: migrations.reduce((n, m) => n + m.bytes, 0), identity: hash(migrations.map((m) => `${m.path}\0${m.sha256}`).join('\n')) }, migrations, findings, counts, limitations: ['Offline static SQL audit only; migrations are not executed against a database.', 'SQL classification is conservative and does not claim full dialect semantics.', 'Explicit transaction policy cannot infer wrappers supplied by an external migration framework.'] };
}

async function safeParent(root, target) {
  const rel = path.relative(root, path.dirname(target)); if (!rel || rel === '.') return; let current = root;
  for (const part of rel.split(path.sep)) { current = path.join(current, part); const info = await statOrNull(current); if (info) { if (info.isSymbolicLink() || !info.isDirectory()) throw err('Output parent contains a symlink or non-directory', 'MIGRATION_PATH_ESCAPE'); } else await fs.mkdir(current, { mode: 0o700 }); }
}
async function writeReport(rootDir, rel, payload) {
  const root = await fs.realpath(path.resolve(rootDir)), safe = relativePath(rel, 'Output path'), target = path.resolve(root, safe); if (!contained(root, target)) throw err('Output path escapes root', 'MIGRATION_PATH_ESCAPE');
  await safeParent(root, target); const info = await statOrNull(target); if (info && (info.isSymbolicLink() || !info.isFile())) throw err('Output target must be a regular file', 'MIGRATION_OUTPUT_INVALID');
  const content = `${JSON.stringify(payload, null, 2)}\n`; await fs.writeFile(target, content, { mode: 0o600 }); await fs.chmod(target, 0o600).catch(() => {}); return { path: portable(path.relative(root, target)), bytes: Buffer.byteLength(content), sha256: hash(content) };
}
async function loadSpec(rootDir, rel) { const root = await fs.realpath(path.resolve(rootDir)), content = await readInput(root, rel); try { return normalizeMigrationSpec(JSON.parse(content)); } catch (e) { if (e?.code) throw e; throw err('Migration spec must be valid JSON', 'MIGRATION_SPEC_INVALID'); } }
function usage() { return `Veteran Native Migration Lab\n\nUsage:\n  node src/native-migration-lab.mjs audit <spec.json> [--root .] [--fail-on high] [--out report.json]\n\nAudits local SQL migration files without executing them or using a network service.\n`; }
export async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || 'help'; if (['help', '-h', '--help'].includes(command)) { process.stdout.write(usage()); return 0; } if (command !== 'audit') throw err(`Unknown command: ${command}`, 'MIGRATION_COMMAND_UNKNOWN');
  const specPath = argv[1]; if (!specPath || specPath.startsWith('--')) throw err('audit requires a spec path', 'MIGRATION_ARGUMENT_REQUIRED'); let rootDir = process.cwd(), failOn = 'high', out = null;
  for (let i = 2; i < argv.length; i += 1) { const arg = argv[i]; if (arg === '--root') rootDir = argv[++i]; else if (arg === '--fail-on') failOn = argv[++i]; else if (arg === '--out') out = argv[++i]; else throw err(`Unknown argument: ${arg}`, 'MIGRATION_ARGUMENT_UNKNOWN'); if (!argv[i] && ['--root', '--fail-on', '--out'].includes(arg)) throw err(`${arg} requires a value`, 'MIGRATION_ARGUMENT_REQUIRED'); }
  const spec = await loadSpec(rootDir, specPath), report = await auditMigrations(rootDir, spec), evaluation = evaluateMigrationReport(report, failOn), result = { ...report, evaluation }, artifact = out ? await writeReport(rootDir, out, result) : null; process.stdout.write(`${JSON.stringify({ ...result, artifact }, null, 2)}\n`); return evaluation.passed ? 0 : 2;
}
const invoked = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invoked) main().then((code) => { process.exitCode = code; }).catch((e) => { process.stderr.write(`${e?.code || 'MIGRATION_ERROR'}: ${String(e?.message || e)}\n`); process.exitCode = 1; });
