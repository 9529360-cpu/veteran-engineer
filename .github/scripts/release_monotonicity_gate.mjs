#!/usr/bin/env node
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const STABLE = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseStableVersion(value) {
  if (typeof value !== 'string') return null;
  const match = STABLE.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersion(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

export function validateReleaseMonotonicity({ candidate, releases, latestTag = null }) {
  const candidateVersion = parseStableVersion(candidate);
  if (!candidateVersion) {
    throw new Error(
      `stable release pipeline requires plain x.y.z version without prerelease/build metadata: ${candidate}`,
    );
  }

  const stable = releases
    .filter((release) => release && release.draft !== true && release.prerelease !== true)
    .map((release) => ({ tag: release.tag_name, version: parseStableVersion(release.tag_name) }))
    .filter((release) => release.version !== null)
    .sort((left, right) => compareVersion(left.version, right.version));

  const highest = stable.at(-1) ?? null;
  if (highest && compareVersion(candidateVersion, highest.version) <= 0) {
    throw new Error(
      `candidate v${candidateVersion.join('.')} must be newer than highest public stable ${highest.tag}`,
    );
  }

  if (highest && latestTag !== null && latestTag !== highest.tag) {
    throw new Error(
      `public latest pointer is inconsistent with highest stable release: latest=${latestTag} highest=${highest.tag}`,
    );
  }

  return {
    candidate: `v${candidateVersion.join('.')}`,
    highestPublicStable: highest?.tag ?? null,
    latestPublicRelease: latestTag,
    monotonic: true,
  };
}

function parseArgs(argv) {
  let candidate = null;
  let repository = process.env.GITHUB_REPOSITORY ?? null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--candidate') {
      candidate = argv[++index] ?? null;
    } else if (arg === '--repository') {
      repository = argv[++index] ?? null;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!candidate) throw new Error('--candidate requires a value');
  if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) throw new Error('--repository requires owner/name');
  return { candidate, repository };
}

async function githubJson(url, token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'veteran-runtime-release-monotonicity-gate',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${url}`);
  return { value: await response.json(), link: response.headers.get('link') };
}

function nextLink(link) {
  if (!link) return null;
  for (const part of link.split(',')) {
    const match = /<([^>]+)>;\s*rel="([^"]+)"/.exec(part.trim());
    if (match?.[2] === 'next') return match[1];
  }
  return null;
}

export async function fetchPublicReleaseState({ repository, token = process.env.GITHUB_TOKEN ?? null }) {
  let url = `https://api.github.com/repos/${repository}/releases?per_page=100`;
  const releases = [];
  for (let page = 0; url && page < 20; page += 1) {
    const response = await githubJson(url, token);
    if (!Array.isArray(response.value)) throw new Error('GitHub releases response must be an array');
    releases.push(...response.value);
    url = nextLink(response.link);
  }
  if (url) throw new Error('GitHub release pagination exceeded safety limit');

  let latestTag = null;
  try {
    const latest = await githubJson(
      `https://api.github.com/repos/${repository}/releases/latest`,
      token,
    );
    latestTag = latest.value?.tag_name ?? null;
  } catch (error) {
    if (!String(error?.message ?? error).includes('GitHub API 404')) throw error;
  }
  return { releases, latestTag };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = await fetchPublicReleaseState({ repository: args.repository });
  const result = validateReleaseMonotonicity({
    candidate: args.candidate,
    releases: state.releases,
    latestTag: state.latestTag,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
