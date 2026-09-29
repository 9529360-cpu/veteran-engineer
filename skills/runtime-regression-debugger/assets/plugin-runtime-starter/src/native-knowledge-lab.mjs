#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const NATIVE_KNOWLEDGE_LAB_CONTRACT = 'veteran-native-knowledge-lab-v1';

const SUPPORTED_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.rst']);
const DEFAULT_IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.cache']);
const MAX_FILES = 2_000;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CHUNKS = 20_000;
const MAX_CHUNK_CHARS = 2_400;
const MAX_QUERY_CHARS = 1_000;
const MAX_RESULTS = 50;
const MAX_INDEX_BYTES = 64 * 1024 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function codedError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function text(value, fallback = '', max = 4_000) {
  const out = value === undefined || value === null ? fallback : String(value).trim();
  if (out.length > max) throw codedError(`Knowledge Lab value exceeds ${max} characters`, 'KNOWLEDGE_LAB_VALUE_TOO_LONG');
  return out;
}

function portablePath(value) {
  return String(value).split(path.sep).join('/');
}

function stableHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeSearchText(value) {
  return String(value).normalize('NFKC').toLowerCase();
}

function isHan(char) {
  return /^\p{Script=Han}$/u.test(char);
}

export function tokenizeKnowledge(value) {
  const source = normalizeSearchText(value);
  const tokens = [];
  for (const match of source.matchAll(/[\p{L}\p{N}_-]+/gu)) {
    const word = match[0];
    if (![...word].some(isHan)) tokens.push(word);
  }
  for (const match of source.matchAll(/\p{Script=Han}+/gu)) {
    const chars = [...match[0]];
    for (const char of chars) tokens.push(char);
    for (let index = 0; index + 1 < chars.length; index += 1) tokens.push(`${chars[index]}${chars[index + 1]}`);
  }
  return tokens.filter((token) => token.length > 0 && !FORBIDDEN_KEYS.has(token));
}

function termCounts(tokens) {
  const counts = Object.create(null);
  for (const token of tokens) counts[token] = (counts[token] || 0) + 1;
  return counts;
}

function markdownHeading(line) {
  const match = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  return match ? { level: match[1].length, text: match[2].trim() } : null;
}

function fileTitle(relativePath, lines) {
  for (const line of lines.slice(0, 80)) {
    const heading = markdownHeading(line);
    if (heading?.text) return heading.text;
  }
  return path.basename(relativePath, path.extname(relativePath));
}

function makeChunk({ relativePath, title, heading, startLine, endLine, content }) {
  const clean = content.trim();
  if (!clean) return null;
  const tokens = tokenizeKnowledge(`${title}\n${heading || ''}\n${clean}`);
  const counts = termCounts(tokens);
  return {
    id: stableHash(`${relativePath}:${startLine}:${endLine}:${clean}`),
    path: portablePath(relativePath),
    title,
    heading: heading || null,
    startLine,
    endLine,
    text: clean,
    tokenCount: tokens.length,
    terms: counts
  };
}

function chunkDocument(relativePath, source) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const title = fileTitle(relativePath, lines);
  const chunks = [];
  let heading = null;
  let buffer = [];
  let startLine = 1;

  const flush = (endLine) => {
    if (!buffer.length) return;
    let part = [];
    let partStart = startLine;
    let chars = 0;
    for (let index = 0; index < buffer.length; index += 1) {
      const item = buffer[index];
      const nextChars = chars + item.text.length + (part.length ? 1 : 0);
      if (part.length && nextChars > MAX_CHUNK_CHARS) {
        const chunk = makeChunk({ relativePath, title, heading, startLine: partStart, endLine: part[part.length - 1].line, content: part.map((entry) => entry.text).join('\n') });
        if (chunk) chunks.push(chunk);
        part = [];
        chars = 0;
        partStart = item.line;
      }
      part.push(item);
      chars += item.text.length + (part.length > 1 ? 1 : 0);
    }
    if (part.length) {
      const chunk = makeChunk({ relativePath, title, heading, startLine: partStart, endLine: endLine ?? part[part.length - 1].line, content: part.map((entry) => entry.text).join('\n') });
      if (chunk) chunks.push(chunk);
    }
    buffer = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index];
    const parsedHeading = markdownHeading(line);
    if (parsedHeading) {
      flush(lineNumber - 1);
      heading = parsedHeading.text;
      startLine = lineNumber + 1;
      continue;
    }
    if (!line.trim()) {
      flush(lineNumber - 1);
      startLine = lineNumber + 1;
      continue;
    }
    if (!buffer.length) startLine = lineNumber;
    buffer.push({ line: lineNumber, text: line });
  }
  flush(lines.length);
  return chunks;
}

async function listKnowledgeFiles(root) {
  const files = [];
  let totalBytes = 0;
  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (DEFAULT_IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile() || !SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const stat = await fs.stat(full);
      if (stat.size > MAX_FILE_BYTES) throw codedError(`Knowledge file exceeds ${MAX_FILE_BYTES} bytes`, 'KNOWLEDGE_LAB_FILE_TOO_LARGE', { file: portablePath(path.relative(root, full)), bytes: stat.size });
      totalBytes += stat.size;
      if (totalBytes > MAX_TOTAL_BYTES) throw codedError(`Knowledge corpus exceeds ${MAX_TOTAL_BYTES} bytes`, 'KNOWLEDGE_LAB_CORPUS_TOO_LARGE', { bytes: totalBytes });
      files.push({ full, relative: path.relative(root, full), bytes: stat.size });
      if (files.length > MAX_FILES) throw codedError(`Knowledge corpus exceeds ${MAX_FILES} files`, 'KNOWLEDGE_LAB_FILE_LIMIT');
    }
  }
  await walk(root);
  return { files, totalBytes };
}

export async function buildKnowledgeIndex({ rootDir = process.cwd() } = {}) {
  const root = await fs.realpath(path.resolve(rootDir));
  const { files, totalBytes } = await listKnowledgeFiles(root);
  const chunks = [];
  for (const file of files) {
    const source = await fs.readFile(file.full, 'utf8');
    if (source.includes('\0')) throw codedError('Knowledge corpus contains a binary-looking text file', 'KNOWLEDGE_LAB_BINARY_FILE', { file: portablePath(file.relative) });
    chunks.push(...chunkDocument(file.relative, source));
    if (chunks.length > MAX_CHUNKS) throw codedError(`Knowledge corpus exceeds ${MAX_CHUNKS} chunks`, 'KNOWLEDGE_LAB_CHUNK_LIMIT');
  }
  const documentFrequency = Object.create(null);
  for (const chunk of chunks) {
    for (const term of Object.keys(chunk.terms)) documentFrequency[term] = (documentFrequency[term] || 0) + 1;
  }
  const averageTokenCount = chunks.length ? chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0) / chunks.length : 0;
  const contentIdentity = stableHash(JSON.stringify(chunks.map((chunk) => [chunk.path, chunk.startLine, chunk.endLine, chunk.id])));
  return {
    contract: NATIVE_KNOWLEDGE_LAB_CONTRACT,
    version: 1,
    source: { files: files.length, bytes: totalBytes, root: '.' },
    stats: { chunks: chunks.length, averageTokenCount },
    contentIdentity,
    documentFrequency,
    chunks
  };
}

function validateIndex(index) {
  if (!index || typeof index !== 'object' || Array.isArray(index) || index.contract !== NATIVE_KNOWLEDGE_LAB_CONTRACT || index.version !== 1) {
    throw codedError('Knowledge index contract is invalid', 'KNOWLEDGE_LAB_INDEX_INVALID');
  }
  if (!Array.isArray(index.chunks) || index.chunks.length > MAX_CHUNKS) throw codedError('Knowledge index chunks are invalid', 'KNOWLEDGE_LAB_INDEX_INVALID');
  if (!index.documentFrequency || typeof index.documentFrequency !== 'object' || Array.isArray(index.documentFrequency)) throw codedError('Knowledge index document frequency is invalid', 'KNOWLEDGE_LAB_INDEX_INVALID');
  return index;
}

function scoreChunk(chunk, queryTokens, index, rawQuery) {
  const unique = [...new Set(queryTokens)];
  const totalChunks = Math.max(1, index.chunks.length);
  const average = Math.max(1, Number(index.stats?.averageTokenCount) || 1);
  const length = Math.max(1, Number(chunk.tokenCount) || 1);
  let score = 0;
  let matched = 0;
  for (const token of unique) {
    const tf = Number(chunk.terms?.[token] || 0);
    if (!tf) continue;
    matched += 1;
    const df = Math.max(0, Number(index.documentFrequency[token] || 0));
    const idf = Math.log(1 + (totalChunks - df + 0.5) / (df + 0.5));
    const normalizedTf = (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (length / average)));
    score += idf * normalizedTf;
  }
  if (!matched) return null;
  const normalizedQuery = normalizeSearchText(rawQuery).trim();
  const haystack = normalizeSearchText(`${chunk.title}\n${chunk.heading || ''}\n${chunk.text}`);
  if (normalizedQuery && haystack.includes(normalizedQuery)) score += 3.5;
  const headingText = normalizeSearchText(`${chunk.title} ${chunk.heading || ''}`);
  for (const token of unique) if (headingText.includes(token)) score += 0.35;
  score += (matched / unique.length) * 0.5;
  return { score, matched, terms: unique.length };
}

function excerpt(textValue, queryTokens, maxChars = 700) {
  const source = String(textValue).replace(/\s+/g, ' ').trim();
  if (source.length <= maxChars) return source;
  const lower = normalizeSearchText(source);
  let first = -1;
  for (const token of queryTokens) {
    const at = lower.indexOf(normalizeSearchText(token));
    if (at >= 0 && (first < 0 || at < first)) first = at;
  }
  const start = Math.max(0, (first < 0 ? 0 : first) - Math.floor(maxChars * 0.25));
  const end = Math.min(source.length, start + maxChars);
  return `${start > 0 ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
}

export function searchKnowledgeIndex(indexRaw, queryRaw, { limit = 8 } = {}) {
  const index = validateIndex(indexRaw);
  const query = text(queryRaw, '', MAX_QUERY_CHARS);
  if (!query) throw codedError('Knowledge search query is required', 'KNOWLEDGE_LAB_QUERY_REQUIRED');
  const queryTokens = tokenizeKnowledge(query);
  if (!queryTokens.length) throw codedError('Knowledge search query produced no searchable terms', 'KNOWLEDGE_LAB_QUERY_EMPTY');
  const resultLimit = Number(limit);
  if (!Number.isInteger(resultLimit) || resultLimit < 1 || resultLimit > MAX_RESULTS) throw codedError(`Knowledge search limit must be within 1..${MAX_RESULTS}`, 'KNOWLEDGE_LAB_LIMIT_INVALID');
  const scored = [];
  for (const chunk of index.chunks) {
    const metric = scoreChunk(chunk, queryTokens, index, query);
    if (!metric) continue;
    scored.push({ chunk, ...metric });
  }
  scored.sort((a, b) => b.score - a.score || a.chunk.path.localeCompare(b.chunk.path) || a.chunk.startLine - b.chunk.startLine);
  return {
    contract: NATIVE_KNOWLEDGE_LAB_CONTRACT,
    query,
    indexIdentity: index.contentIdentity || null,
    totalMatches: scored.length,
    results: scored.slice(0, resultLimit).map(({ chunk, score, matched, terms }) => ({
      path: chunk.path,
      title: chunk.title,
      heading: chunk.heading,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      citation: `${chunk.path}:L${chunk.startLine}-L${chunk.endLine}`,
      score: Number(score.toFixed(6)),
      matchedTerms: matched,
      queryTerms: terms,
      excerpt: excerpt(chunk.text, queryTokens)
    }))
  };
}

async function containedOutput(rootDir, outputPath) {
  const root = await fs.realpath(path.resolve(rootDir));
  const target = path.resolve(root, outputPath);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) throw codedError('Knowledge index output escapes the allowed root', 'KNOWLEDGE_LAB_ROOT_ESCAPE', { outputPath });
  const parent = await fs.realpath(path.dirname(target));
  if (parent !== root && !parent.startsWith(`${root}${path.sep}`)) throw codedError('Knowledge index output parent escapes the allowed root', 'KNOWLEDGE_LAB_ROOT_ESCAPE', { outputPath });
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw codedError('Knowledge index output must be a regular file', 'KNOWLEDGE_LAB_OUTPUT_INVALID', { outputPath });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return target;
}

export async function writeKnowledgeIndex(indexRaw, outputPath, { rootDir = process.cwd() } = {}) {
  const index = validateIndex(indexRaw);
  const serialized = `${JSON.stringify(index)}\n`;
  if (Buffer.byteLength(serialized) > MAX_INDEX_BYTES) throw codedError(`Knowledge index exceeds ${MAX_INDEX_BYTES} bytes`, 'KNOWLEDGE_LAB_INDEX_TOO_LARGE');
  const target = await containedOutput(rootDir, outputPath);
  await fs.writeFile(target, serialized, { encoding: 'utf8', mode: 0o600 });
  return { path: portablePath(path.relative(await fs.realpath(path.resolve(rootDir)), target)), bytes: Buffer.byteLength(serialized), sha256: stableHash(serialized) };
}

export async function readKnowledgeIndex(indexPath, { rootDir = process.cwd() } = {}) {
  const root = await fs.realpath(path.resolve(rootDir));
  const target = path.resolve(root, indexPath);
  const real = await fs.realpath(target).catch((error) => { throw codedError('Knowledge index is unavailable', 'KNOWLEDGE_LAB_INDEX_UNAVAILABLE', { cause: error?.code || null }); });
  if (real !== root && !real.startsWith(`${root}${path.sep}`)) throw codedError('Knowledge index escapes the allowed root', 'KNOWLEDGE_LAB_ROOT_ESCAPE');
  const stat = await fs.stat(real);
  if (!stat.isFile() || stat.size > MAX_INDEX_BYTES) throw codedError('Knowledge index file is invalid or too large', 'KNOWLEDGE_LAB_INDEX_INVALID', { bytes: stat.size });
  let parsed;
  try { parsed = JSON.parse(await fs.readFile(real, 'utf8')); }
  catch { throw codedError('Knowledge index JSON is invalid', 'KNOWLEDGE_LAB_INDEX_INVALID'); }
  return validateIndex(parsed);
}

function usage() {
  return `Veteran Native Knowledge Lab\n\nUsage:\n  node src/native-knowledge-lab.mjs index --root <directory> --out <index.json>\n  node src/native-knowledge-lab.mjs search <query> --root <directory> [--limit <n>]\n  node src/native-knowledge-lab.mjs search-index <query> --root <directory> --index <index.json> [--limit <n>]\n\nIndexes local Markdown/MDX/TXT/RST and returns ranked excerpts with path+line citations. No Notion, Confluence, vector database, embedding API, or paid service is required.\n`;
}

function requiredValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) throw codedError(`${option} requires a value`, 'KNOWLEDGE_LAB_ARGUMENT_VALUE_REQUIRED');
  return value;
}

async function cli(argv) {
  const command = argv[0] || 'help';
  if (['help', '-h', '--help'].includes(command)) { process.stdout.write(usage()); return 0; }
  if (!['index', 'search', 'search-index'].includes(command)) throw codedError(`Unknown Knowledge Lab command: ${command}`, 'KNOWLEDGE_LAB_COMMAND_UNKNOWN');
  let query = null;
  let cursor = 1;
  if (command !== 'index') {
    query = argv[cursor++];
    if (!query || query.startsWith('-')) throw codedError(`${command} requires a query`, 'KNOWLEDGE_LAB_QUERY_REQUIRED');
  }
  let rootDir = process.cwd();
  let outPath = null;
  let indexPath = null;
  let limit = 8;
  for (; cursor < argv.length; cursor += 1) {
    const arg = argv[cursor];
    if (arg === '--root') rootDir = requiredValue(argv, cursor++, arg);
    else if (arg === '--out') outPath = requiredValue(argv, cursor++, arg);
    else if (arg === '--index') indexPath = requiredValue(argv, cursor++, arg);
    else if (arg === '--limit') limit = Number(requiredValue(argv, cursor++, arg));
    else throw codedError(`Unknown Knowledge Lab argument: ${arg}`, 'KNOWLEDGE_LAB_ARGUMENT_UNKNOWN');
  }
  if (command === 'index') {
    if (!outPath) throw codedError('index requires --out', 'KNOWLEDGE_LAB_OUTPUT_REQUIRED');
    const index = await buildKnowledgeIndex({ rootDir });
    const artifact = await writeKnowledgeIndex(index, outPath, { rootDir });
    process.stdout.write(`${JSON.stringify({ contract: NATIVE_KNOWLEDGE_LAB_CONTRACT, source: index.source, stats: index.stats, contentIdentity: index.contentIdentity, artifact }, null, 2)}\n`);
    return 0;
  }
  const index = command === 'search-index'
    ? await readKnowledgeIndex(indexPath || (() => { throw codedError('search-index requires --index', 'KNOWLEDGE_LAB_INDEX_REQUIRED'); })(), { rootDir })
    : await buildKnowledgeIndex({ rootDir });
  process.stdout.write(`${JSON.stringify(searchKnowledgeIndex(index, query, { limit }), null, 2)}\n`);
  return 0;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  cli(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error.code ? `[${error.code}] ` : ''}${error.message || String(error)}\n`);
    process.exitCode = 1;
  });
}
