#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectReleaseContract } from './release-contract.mjs';
import { writeRuntimeBundle } from '../src/installer/runtime-bundle.mjs';

const self = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(self), '..');
const skillRoot = path.join(root, 'skills', 'runtime-regression-debugger');
const exporter = path.join(skillRoot, 'scripts', 'export_plugin_bundle.py');
const bootstrapSource = path.join(root, 'scripts', 'release-bootstrap.mjs');
const PROFILES = ['desktop', 'codex', 'web'];

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) {
    const error = new Error(`${command} ${args.join(' ')} failed with exit ${result.status}: ${result.stderr || result.stdout}`.trim());
    error.code = 'RELEASE_CANDIDATE_BUILD_FAILED';
    throw error;
  }
  return result.stdout.trim();
}

async function sha256(target) {
  return crypto.createHash('sha256').update(await fs.readFile(target)).digest('hex');
}

function parseArgs(argv) {
  let output = path.join(root, 'dist');
  let tag = null;
  let commit = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') {
      output = path.resolve(argv[index + 1] || '');
      if (!argv[index + 1]) throw new Error('--output requires a value');
      index += 1;
    } else if (arg === '--tag') {
      tag = argv[index + 1];
      if (!tag) throw new Error('--tag requires a value');
      index += 1;
    } else if (arg === '--commit') {
      commit = argv[index + 1];
      if (!commit) throw new Error('--commit requires a value');
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { output, tag, commit };
}

export async function buildReleaseCandidate({ output, tag = null, commit = null }) {
  const contract = await inspectReleaseContract({ root, tag });
  await fs.mkdir(output, { recursive: true });
  const assets = [];

  const bootstrapFilename = 'veteran-engineer-bootstrap.mjs';
  const bootstrapTarget = path.join(output, bootstrapFilename);
  const bootstrapBytes = await fs.readFile(bootstrapSource);
  await fs.writeFile(bootstrapTarget, bootstrapBytes);
  const bootstrapDigest = crypto.createHash('sha256').update(bootstrapBytes).digest('hex');
  const bootstrapChecksum = 'veteran-engineer-bootstrap.sha256';
  await fs.writeFile(path.join(output, bootstrapChecksum), `${bootstrapDigest}  ${bootstrapFilename}\n`, 'utf8');
  assets.push({ profile: 'bootstrap', filename: bootstrapFilename, checksumFile: bootstrapChecksum, sha256: bootstrapDigest, bytes: bootstrapBytes.length });

  const runtimeFilename = 'veteran-engineer-runtime.json';
  const runtimeTarget = path.join(output, runtimeFilename);
  const runtimeRebuilt = path.join(output, '.veteran-engineer-runtime-rebuilt.json');
  const firstRuntime = await writeRuntimeBundle({ root, output: runtimeTarget, version: contract.version });
  const secondRuntime = await writeRuntimeBundle({ root, output: runtimeRebuilt, version: contract.version });
  if (firstRuntime.sha256 !== secondRuntime.sha256) throw new Error(`Non-reproducible runtime release bundle: ${firstRuntime.sha256} != ${secondRuntime.sha256}`);
  await fs.rm(runtimeRebuilt, { force: true });
  const runtimeStat = await fs.stat(runtimeTarget);
  const runtimeChecksum = 'veteran-engineer-runtime.sha256';
  await fs.writeFile(path.join(output, runtimeChecksum), `${firstRuntime.sha256}  ${runtimeFilename}\n`, 'utf8');
  assets.push({ profile: 'runtime', filename: runtimeFilename, checksumFile: runtimeChecksum, sha256: firstRuntime.sha256, bytes: runtimeStat.size });

  for (const profile of PROFILES) {
    const filename = `veteran-engineer-${profile}.zip`;
    const target = path.join(output, filename);
    const rebuilt = path.join(output, `.veteran-engineer-${profile}-rebuilt.zip`);
    run('python3', [exporter, skillRoot, '--profile', profile, '--output', target]);
    run('python3', [exporter, skillRoot, '--profile', profile, '--output', rebuilt]);
    const [digest, rebuiltDigest] = await Promise.all([sha256(target), sha256(rebuilt)]);
    if (digest !== rebuiltDigest) throw new Error(`Non-reproducible ${profile} release bundle: ${digest} != ${rebuiltDigest}`);
    await fs.rm(rebuilt, { force: true });
    const stat = await fs.stat(target);
    const checksumName = `veteran-engineer-${profile}.sha256`;
    await fs.writeFile(path.join(output, checksumName), `${digest}  ${filename}\n`, 'utf8');
    assets.push({ profile, filename, checksumFile: checksumName, sha256: digest, bytes: stat.size });
  }
  const manifest = {
    schemaVersion: 1,
    product: contract.product,
    version: contract.version,
    tag: tag || null,
    commit: commit || null,
    stateSchemaVersion: contract.stateSchemaVersion,
    assets
  };
  const manifestPath = path.join(output, 'veteran-engineer-release-manifest.json');
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { ...contract, output, commit: commit || null, assets, manifest: path.basename(manifestPath) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const args = parseArgs(process.argv.slice(2));
  const result = await buildReleaseCandidate(args);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
