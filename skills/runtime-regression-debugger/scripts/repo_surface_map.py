#!/usr/bin/env python3
"""Print a privacy-safe repository surface map.

Usage:
  repo_surface_map.py <repo-root>
  repo_surface_map.py <repo-root> --json

The script reads only well-known manifests/config filenames and directory names.
It never reads .env files, secret files, binary assets, or arbitrary source contents.
It uses only the Python standard library.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from collections import defaultdict

SKIP_DIRS = {
    '.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt',
    '.cache', '.venv', 'venv', 'vendor', 'target', 'Pods', '__pycache__',
    '.turbo', '.nx', '.pytest_cache', '.mypy_cache', '.ruff_cache',
}

MANIFEST_NAMES = {
    'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
    'pyproject.toml', 'requirements.txt', 'Pipfile', 'Pipfile.lock', 'poetry.lock',
    'uv.lock', 'go.mod', 'go.sum', 'Cargo.toml', 'Cargo.lock', 'composer.json',
    'bun.lock', 'bun.lockb', 'deno.json', 'deno.jsonc', 'deno.lock', 'Package.swift',
    'composer.lock', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'Gemfile',
    'Gemfile.lock', 'mix.exs', 'mix.lock', 'pubspec.yaml', 'pubspec.lock',
}

INFRA_NAMES = {
    'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml',
    'compose.yaml', 'wrangler.toml', 'wrangler.json', 'wrangler.jsonc',
    'vercel.json', 'netlify.toml', 'fly.toml', 'serverless.yml',
    'serverless.yaml', 'sst.config.ts', 'Pulumi.yaml', 'pulumi.yaml',
    'kustomization.yaml', 'kustomization.yml', 'Chart.yaml', 'Procfile',
    'render.yaml', 'railway.json', 'railway.toml',
}

DB_MARKERS = {'migrations', 'migration', 'prisma', 'drizzle', 'schema', 'seeds', 'seed'}
API_DIR_MARKERS = {'api', 'routes', 'controllers', 'handlers', 'server', 'functions', 'workers'}
FRONTEND_DIR_MARKERS = {'ui', 'web', 'frontend', 'client', 'pages', 'app', 'components', 'renderer'}
JOB_DIR_MARKERS = {'jobs', 'queues', 'queue', 'workers', 'workflows', 'cron', 'scheduler', 'tasks'}

MONOREPO_NAMES = {
    'pnpm-workspace.yaml', 'turbo.json', 'nx.json', 'lerna.json', 'rush.json',
    'workspace.json', 'moon.yml', 'moon.yaml', 'go.work', 'MODULE.bazel',
    'WORKSPACE', 'WORKSPACE.bazel', 'settings.gradle', 'settings.gradle.kts',
}

CONTRACT_NAMES = {
    'openapi.json', 'openapi.yaml', 'openapi.yml', 'swagger.json', 'swagger.yaml',
    'swagger.yml', 'asyncapi.json', 'asyncapi.yaml', 'asyncapi.yml', 'schema.graphql',
    'schema.gql', 'buf.yaml', 'buf.gen.yaml',
}

OWNERSHIP_SECURITY_NAMES = {
    'CODEOWNERS', 'SECURITY.md', 'CONTRIBUTING.md', 'dependabot.yml', 'dependabot.yaml',
    'renovate.json', 'renovate.json5', '.renovaterc', '.renovaterc.json',
}

REPOSITORY_INSTRUCTION_NAMES = {
    'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'CONTRIBUTING.md', 'DEVELOPING.md',
    'DEVELOPMENT.md', 'HACKING.md', 'BUILDING.md', 'TESTING.md',
}

CODEGEN_NAMES = {
    'buf.gen.yaml', 'buf.gen.yml', 'graphql-codegen.yml', 'graphql-codegen.yaml',
    'graphql.config.yml', 'graphql.config.yaml', 'openapi-generator-config.yaml',
    'openapi-generator-config.yml', 'orval.config.ts', 'orval.config.js',
    'swagger-codegen-config.json', 'codegen.yml', 'codegen.yaml',
}

BUILD_GRAPH_NAMES = {
    'MODULE.bazel', 'WORKSPACE', 'WORKSPACE.bazel', 'BUILD', 'BUILD.bazel',
    'settings.gradle', 'settings.gradle.kts', 'gradle.properties', 'go.work',
    'turbo.json', 'nx.json', 'pnpm-workspace.yaml', 'rush.json', 'moon.yml', 'moon.yaml',
}

RELEASE_CONFIG_NAMES = {
    '.releaserc', '.releaserc.json', '.releaserc.yml', '.releaserc.yaml',
    'release.config.js', 'release.config.cjs', 'release.config.mjs', 'release.config.ts',
    'release-please-config.json', '.release-please-manifest.json',
    'changeset.config.js', 'changeset.config.cjs', 'changeset.config.mjs', 'changeset.config.ts',
}

TEST_CONFIG_NAMES = {
    'playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs',
    'cypress.config.ts', 'cypress.config.js', 'vitest.config.ts', 'vitest.config.js',
    'jest.config.ts', 'jest.config.js', 'pytest.ini', 'tox.ini', 'noxfile.py',
}

PACKAGE_TECH = {
    'frontend': {
        'react', 'react-dom', 'next', 'vue', 'nuxt', 'svelte', '@sveltejs/kit',
        'solid-js', '@angular/core', 'vite', '@tanstack/react-query', '@remix-run/react',
        'astro', '@builder.io/qwik',
    },
    'backend': {
        'express', 'fastify', '@nestjs/core', 'hono', 'koa', 'elysia', 'next',
        '@trpc/server', 'graphql', 'apollo-server', '@apollo/server', 'h3',
    },
    'database': {
        'prisma', '@prisma/client', 'drizzle-orm', 'sequelize', 'typeorm',
        'knex', 'mongoose', 'pg', 'mysql2', 'better-sqlite3', 'sqlite3', 'kysely',
        'postgres', 'redis', 'ioredis',
    },
    'jobs': {
        'bull', 'bullmq', 'agenda', 'bee-queue', '@temporalio/client',
        '@temporalio/worker', 'inngest', 'trigger.dev',
    },
    'desktop': {'electron', 'electron-builder', '@electron-forge/cli'},
    'auth': {'@auth/core', 'next-auth', 'passport', 'jose', '@clerk/nextjs', '@clerk/backend', 'better-auth'},
    'contracts': {'zod', '@trpc/server', 'graphql', '@apollo/server', 'openapi-types', 'openapi-typescript', 'protobufjs'},
    'feature-flags': {'@openfeature/server-sdk', '@openfeature/web-sdk', 'unleash-client', 'launchdarkly-node-server-sdk', 'launchdarkly-react-client-sdk'},
    'payments': {'stripe', '@stripe/stripe-js'},
    'testing': {'playwright', '@playwright/test', 'vitest', 'jest', 'cypress', '@testing-library/react', '@testing-library/vue'},
    'observability': {'@opentelemetry/api', '@sentry/node', '@sentry/electron', '@sentry/react', 'prom-client', 'pino', 'winston'},
}

NEXT_INSPECTION = [
    'Read repository/maintainer instructions and current deployment/release truth.',
    'For release tasks, inspect current release/version workflow contents and determine whether merge, tag, bot, or manual dispatch owns publishing before mutating release state.',
    'Trace one requested product contract through registration, active callers, authority, data/async effects, projection, and delivery.',
    'Distinguish authoritative source from generated output before editing codegen/schema bindings.',
    'Inspect workspace/build graphs and affected targets before whole-repository builds in large monorepos.',
    'Inspect public schemas, CODEOWNERS/security policy, test config, and ADRs when the change crosses those boundaries.',
    'Treat this map as hints only; file presence does not prove a path is active.',
]


def iter_paths(root: pathlib.Path):
    for path in root.rglob('*'):
        try:
            rel = path.relative_to(root)
        except ValueError:
            continue
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        yield path, rel


def rels_with_name(paths, names):
    return sorted(str(rel) for path, rel in paths if path.is_file() and path.name in names)


def is_infra_file(path: pathlib.Path, rel: pathlib.Path) -> bool:
    name = path.name
    lower = name.lower()
    parts = {part.lower() for part in rel.parts}
    if name in INFRA_NAMES or lower in {n.lower() for n in INFRA_NAMES}:
        return True
    if lower.startswith('dockerfile') or path.suffix.lower() == '.tf':
        return True
    if lower.startswith('pulumi.') or lower.startswith('docker-compose'):
        return True
    if 'helm' in parts and lower in {'chart.yaml', 'values.yaml', 'values.yml'}:
        return True
    if parts.intersection({'k8s', 'kubernetes', 'manifests', 'deploy', 'deployment'}) and path.suffix.lower() in {'.yaml', '.yml'}:
        return True
    return False


def is_ci_file(path: pathlib.Path, rel: pathlib.Path) -> bool:
    lower = path.name.lower()
    if len(rel.parts) >= 3 and rel.parts[0] == '.github' and rel.parts[1] == 'workflows' and path.suffix.lower() in {'.yml', '.yaml'}:
        return True
    if str(rel).replace('\\', '/').lower() == '.circleci/config.yml':
        return True
    return lower in {'.gitlab-ci.yml', '.gitlab-ci.yaml', 'jenkinsfile', 'azure-pipelines.yml', 'azure-pipelines.yaml', 'bitbucket-pipelines.yml'}


def top_dirs(root: pathlib.Path, markers: set[str]):
    found = set()
    try:
        children = list(root.iterdir())
    except OSError:
        return []
    for child in children:
        if child.is_dir() and child.name not in SKIP_DIRS and child.name.lower() in markers:
            found.add(child.name)
    return sorted(found)


def inspect_package_json(path: pathlib.Path):
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    deps = {}
    for field in ('dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'):
        value = data.get(field)
        if isinstance(value, dict):
            deps.update({str(k): str(v) for k, v in value.items()})
    tech = defaultdict(list)
    for category, names in PACKAGE_TECH.items():
        for name in sorted(names):
            if name in deps:
                tech[category].append(f'{name}@{deps[name]}')
    scripts = data.get('scripts') if isinstance(data.get('scripts'), dict) else {}
    interesting_scripts = sorted(
        key for key in scripts
        if any(word in key.lower() for word in (
            'test', 'lint', 'type', 'build', 'dev', 'start', 'migrat', 'seed',
            'deploy', 'release', 'e2e', 'pack', 'dist', 'worker',
        ))
    )
    return {
        'name': data.get('name'),
        'version': data.get('version'),
        'type': data.get('type'),
        'tech': dict(tech),
        'scripts': interesting_scripts,
    }


def build_surface_map(root: pathlib.Path) -> dict:
    paths = list(iter_paths(root))
    manifests = rels_with_name(paths, MANIFEST_NAMES)
    package_hints = []
    for rel in manifests:
        if pathlib.Path(rel).name != 'package.json':
            continue
        package_file = root / rel
        info = inspect_package_json(package_file)
        package_hints.append({'path': rel, 'info': info})
        if len(package_hints) >= 20:
            break

    infra = sorted(str(rel) for path, rel in paths if path.is_file() and is_infra_file(path, rel))
    workflows = sorted(str(rel) for path, rel in paths if path.is_file() and is_ci_file(path, rel))
    monorepo = rels_with_name(paths, MONOREPO_NAMES)
    contracts = sorted(str(rel) for path, rel in paths if path.is_file() and (path.name in CONTRACT_NAMES or path.suffix.lower() == '.proto'))
    ownership_security = sorted(
        str(rel) for path, rel in paths
        if path.is_file() and (
            path.name in OWNERSHIP_SECURITY_NAMES
            or (len(rel.parts) >= 3 and rel.parts[0] == '.github' and rel.parts[1] in {'CODEOWNERS', 'ISSUE_TEMPLATE'})
        )
    )
    decision_docs = sorted(
        str(rel) for path, rel in paths
        if path.is_file()
        and any(part.lower() in {'adr', 'adrs', 'decisions', 'architecture'} for part in rel.parts[:-1])
        and path.suffix.lower() in {'.md', '.mdx', '.txt'}
    )
    repository_instructions = rels_with_name(paths, REPOSITORY_INSTRUCTION_NAMES)
    codegen = sorted(
        str(rel) for path, rel in paths
        if path.is_file() and (
            path.name in CODEGEN_NAMES
            or 'codegen' in path.name.lower()
            or 'openapi-generator' in path.name.lower()
            or any(part.lower() in {'generated', 'codegen'} for part in rel.parts[:-1])
        )
    )
    test_configs = rels_with_name(paths, TEST_CONFIG_NAMES)
    build_graph = rels_with_name(paths, BUILD_GRAPH_NAMES)
    release_automation = sorted(
        str(rel) for path, rel in paths
        if path.is_file() and (
            path.name in RELEASE_CONFIG_NAMES
            or (len(rel.parts) >= 2 and rel.parts[0] == '.changeset' and path.name == 'config.json')
            or (is_ci_file(path, rel) and any(word in path.name.lower() for word in ('release', 'publish', 'deploy', 'version', 'tag')))
        )
    )
    migration_candidates = sorted(
        str(rel) for path, rel in paths
        if path.is_file()
        and any(part.lower() in DB_MARKERS for part in rel.parts[:-1])
        and path.suffix.lower() in {'.sql', '.js', '.cjs', '.mjs', '.ts', '.py', '.rb'}
    )
    runtime_markers = []
    for path, rel in paths:
        if not path.is_file():
            continue
        name = path.name.lower()
        if name in {'main.cjs', 'main.js', 'main.ts', 'preload.cjs', 'preload.js', 'preload.ts'}:
            runtime_markers.append(str(rel))
        elif name.startswith('wrangler.') or name in {'dockerfile', 'serverless.yml', 'serverless.yaml'}:
            runtime_markers.append(str(rel))

    return {
        'schema': 'veteran-repository-surface-map-v2',
        'root': str(root),
        'privacy': 'file names and selected manifest metadata only; .env/secret contents and arbitrary source contents are not read',
        'manifests': manifests,
        'package_json_hints': package_hints,
        'infrastructure': infra,
        'ci_workflows': workflows,
        'repository_instructions': repository_instructions[:80],
        'monorepo_workspace': monorepo,
        'build_graph': build_graph[:120],
        'contracts': contracts[:80],
        'codegen': codegen[:80],
        'test_configs': test_configs[:80],
        'release_automation': release_automation[:80],
        'ownership_security': ownership_security[:80],
        'architecture_docs': decision_docs[:80],
        'top_level_dirs': {
            'frontend': top_dirs(root, FRONTEND_DIR_MARKERS),
            'backend': top_dirs(root, API_DIR_MARKERS),
            'jobs': top_dirs(root, JOB_DIR_MARKERS),
            'database': top_dirs(root, DB_MARKERS),
        },
        'migration_candidates': migration_candidates[:80],
        'runtime_markers': sorted(set(runtime_markers))[:80],
        'next_inspection': list(NEXT_INSPECTION),
        'note': 'Seed evidence only. Presence of a file, dependency, or directory does not prove liveness, authority, or product semantics.',
    }


def print_list(title: str, items):
    print(f'\n## {title}')
    if not items:
        print('- none detected')
        return
    for item in items:
        print(f'- {item}')


def print_human(data: dict):
    print('# Repository surface map')
    print('root:', data['root'])
    print('privacy:', data['privacy'])
    print_list('Manifests', data['manifests'])

    print('\n## package.json technology hints')
    if not data['package_json_hints']:
        print('- none detected')
    for item in data['package_json_hints']:
        info = item['info']
        if info is None:
            print(f"- {item['path']}: unreadable/invalid JSON")
            continue
        label = f"{info.get('name') or '(unnamed)'} {info.get('version') or ''}".strip()
        print(f"- {item['path']}: {label}")
        for category in sorted(info['tech']):
            print(f"  - {category}: {', '.join(info['tech'][category])}")
        if info['scripts']:
            print(f"  - scripts: {', '.join(info['scripts'][:30])}")

    print_list('Infrastructure/deployment config', data['infrastructure'])
    print_list('CI workflows', data['ci_workflows'])
    print_list('Repository/maintainer instructions', data['repository_instructions'])
    print_list('Monorepo/workspace config', data['monorepo_workspace'])
    print_list('Workspace/build graph markers', data['build_graph'])
    print_list('API/schema contract candidates', data['contracts'])
    print_list('Code generation/generated-output markers', data['codegen'])
    print_list('Test runner/config markers', data['test_configs'])
    print_list('Release/version automation markers', data['release_automation'])
    print_list('Ownership/security automation', data['ownership_security'])
    print_list('Architecture/decision docs', data['architecture_docs'])
    print_list('Top-level frontend/UI dirs', data['top_level_dirs']['frontend'])
    print_list('Top-level API/backend dirs', data['top_level_dirs']['backend'])
    print_list('Top-level job/queue dirs', data['top_level_dirs']['jobs'])
    print_list('Top-level database/migration dirs', data['top_level_dirs']['database'])
    print_list('Migration/schema candidates', data['migration_candidates'])
    print_list('Runtime entry/config markers', data['runtime_markers'])

    print('\n## Next inspection')
    for item in data['next_inspection']:
        print('- ' + item)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('repo_root')
    parser.add_argument('--json', action='store_true', help='emit a machine-readable seed for a Project Intelligence Snapshot')
    args = parser.parse_args()

    root = pathlib.Path(args.repo_root).resolve()
    if not root.is_dir():
        print(f'error: repository not found: {root}', file=sys.stderr)
        return 2

    data = build_surface_map(root)
    if args.json:
        print(json.dumps(data, indent=2, sort_keys=True))
    else:
        print_human(data)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
