#!/usr/bin/env python3
"""Detect repository technology stacks and suggest relevant skill playbooks.

Usage:
  stack_fingerprint.py <repo-root>
  stack_fingerprint.py <repo-root> --json

Privacy/safety:
- Reads selected dependency/build manifests and file/directory names only.
- Never reads .env files, credential files, arbitrary application source, or secret values.
- Prints dependency/tool names and package script names, not script command bodies.

The detector is heuristic. Confirm active entrypoints, lockfile/runtime versions, deployed topology,
and repository-native commands before changing code.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from collections import defaultdict
from typing import Any

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover
    tomllib = None

SKIP_DIRS = {
    ".git", "node_modules", "dist", "build", "out", "coverage", ".next", ".nuxt",
    ".cache", ".venv", "venv", "vendor", "target", "Pods", "__pycache__",
    ".turbo", ".nx", ".pytest_cache", ".mypy_cache", ".ruff_cache",
}

JS_TECH = {
    "frontend": {
        "react": "React", "react-dom": "React", "next": "Next.js", "vite": "Vite",
        "vue": "Vue", "nuxt": "Nuxt", "svelte": "Svelte", "@sveltejs/kit": "SvelteKit",
        "@angular/core": "Angular", "@remix-run/react": "Remix", "astro": "Astro",
        "@tanstack/react-query": "TanStack Query", "swr": "SWR",
    },
    "mobile": {
        "react-native": "React Native", "expo": "Expo", "expo-router": "Expo Router",
        "@react-navigation/native": "React Navigation",
    },
    "browser-extension": {
        "webextension-polyfill": "WebExtension Polyfill", "wxt": "WXT", "plasmo": "Plasmo",
        "@crxjs/vite-plugin": "CRXJS", "web-ext": "web-ext",
    },
    "cli": {
        "commander": "Commander", "yargs": "Yargs", "cac": "CAC",
        "@oclif/core": "oclif", "clipanion": "Clipanion", "ink": "Ink",
    },
    "sdk-library": {
        "@hey-api/openapi-ts": "Hey API OpenAPI generator",
        "@openapitools/openapi-generator-cli": "OpenAPI Generator CLI",
        "openapi-typescript": "openapi-typescript",
        "orval": "Orval",
        "swagger-typescript-api": "swagger-typescript-api",
    },
    "node-backend": {
        "express": "Express", "fastify": "Fastify", "@nestjs/core": "NestJS",
        "koa": "Koa", "hono": "Hono", "elysia": "Elysia", "@trpc/server": "tRPC",
        "@apollo/server": "Apollo Server", "graphql": "GraphQL", "socket.io": "Socket.IO",
    },
    "data": {
        "pg": "PostgreSQL", "postgres": "PostgreSQL", "@prisma/client": "Prisma",
        "prisma": "Prisma", "drizzle-orm": "Drizzle", "kysely": "Kysely",
        "typeorm": "TypeORM", "sequelize": "Sequelize", "knex": "Knex",
        "redis": "Redis", "ioredis": "Redis", "mongoose": "MongoDB/Mongoose",
        "mongodb": "MongoDB", "mysql": "MySQL", "mysql2": "MySQL",
        "better-sqlite3": "SQLite", "sqlite3": "SQLite",
        "@elastic/elasticsearch": "Elasticsearch", "@opensearch-project/opensearch": "OpenSearch",
    },
    "messaging-workflows": {
        "bullmq": "BullMQ", "bull": "Bull", "kafkajs": "KafkaJS",
        "node-rdkafka": "Kafka", "@confluentinc/kafka-javascript": "Kafka",
        "@temporalio/client": "Temporal", "@temporalio/worker": "Temporal",
        "@temporalio/workflow": "Temporal", "inngest": "Inngest",
    },
    "auth": {
        "@auth/core": "Auth.js", "next-auth": "NextAuth/Auth.js", "passport": "Passport",
        "jose": "JOSE/JWT", "better-auth": "Better Auth", "@clerk/nextjs": "Clerk",
    },
    "testing": {
        "@playwright/test": "Playwright", "playwright": "Playwright", "vitest": "Vitest",
        "jest": "Jest", "cypress": "Cypress", "@testing-library/react": "Testing Library",
    },
    "observability": {
        "@opentelemetry/api": "OpenTelemetry", "@sentry/node": "Sentry",
        "@sentry/react": "Sentry", "@sentry/electron": "Sentry", "prom-client": "Prometheus",
        "pino": "Pino", "winston": "Winston",
    },
    "desktop-runtime": {
        "electron": "Electron", "electron-builder": "Electron Builder",
        "@electron-forge/cli": "Electron Forge",
    },
}

PY_TECH = {
    "python-web": {
        "fastapi": "FastAPI", "starlette": "Starlette", "django": "Django", "flask": "Flask",
        "uvicorn": "Uvicorn", "gunicorn": "Gunicorn", "pydantic": "Pydantic",
    },
    "cli": {
        "click": "Click", "typer": "Typer", "textual": "Textual",
        "prompt-toolkit": "prompt_toolkit",
    },
    "sdk-library": {
        "openapi-python-client": "OpenAPI Python client generator",
    },
    "data": {
        "sqlalchemy": "SQLAlchemy", "alembic": "Alembic", "psycopg": "PostgreSQL",
        "psycopg2": "PostgreSQL", "psycopg2-binary": "PostgreSQL", "asyncpg": "PostgreSQL",
        "redis": "Redis", "pymongo": "MongoDB", "motor": "MongoDB",
        "mysqlclient": "MySQL", "pymysql": "MySQL", "aiomysql": "MySQL",
        "elasticsearch": "Elasticsearch", "opensearch-py": "OpenSearch",
    },
    "messaging-workflows": {
        "celery": "Celery", "dramatiq": "Dramatiq", "rq": "RQ", "temporalio": "Temporal",
        "confluent-kafka": "Kafka", "aiokafka": "Kafka",
    },
    "testing": {
        "pytest": "pytest", "pytest-asyncio": "pytest-asyncio", "anyio": "AnyIO",
        "httpx": "HTTPX", "hypothesis": "Hypothesis",
    },
    "observability": {
        "opentelemetry-api": "OpenTelemetry", "opentelemetry-sdk": "OpenTelemetry",
        "sentry-sdk": "Sentry", "prometheus-client": "Prometheus",
    },
}

REFERENCE_RULES = {
    "staff": "references/staff-engineering-execution.md",
    "frontend-react": "references/stack-react-nextjs.md",
    "frontend-other": "references/stack-web-frameworks.md",
    "mobile": "references/mobile-product-engineering.md",
    "browser-extension": "references/browser-extension-product-engineering.md",
    "cli": "references/cli-tui-product-engineering.md",
    "sdk-library": "references/sdk-library-product-engineering.md",
    "desktop-runtime": "references/runtime-lifecycle-patterns.md",
    "desktop-shell": "references/host-shell-platform-patterns.md",
    "desktop-packaging": "references/release-promotion-patterns.md",
    "node-backend": "references/stack-node-typescript.md",
    "python-web": "references/stack-python-fastapi.md",
    "data-primary": "references/stack-postgres-redis.md",
    "data-other": "references/stack-data-stores.md",
    "messaging-workflows": "references/stack-messaging-workflows.md",
    "containers-kubernetes": "references/stack-containers-kubernetes.md",
    "jvm": "references/stack-jvm-spring.md",
    "dotnet": "references/stack-dotnet-aspnet.md",
    "go-services": "references/stack-go-services.md",
    "legacy-web": "references/stack-legacy-web.md",
}

PACKAGE_LOCKS = {
    "pnpm-lock.yaml": "pnpm", "package-lock.json": "npm", "npm-shrinkwrap.json": "npm",
    "yarn.lock": "Yarn", "bun.lock": "Bun", "bun.lockb": "Bun",
}
PY_LOCKS = {"uv.lock": "uv", "poetry.lock": "Poetry", "Pipfile.lock": "Pipenv"}
MONOREPO_MARKERS = {
    "pnpm-workspace.yaml", "turbo.json", "nx.json", "lerna.json", "rush.json",
    "workspace.json", "moon.yml", "moon.yaml", "go.work", "MODULE.bazel",
    "WORKSPACE", "WORKSPACE.bazel", "settings.gradle", "settings.gradle.kts",
}


def iter_paths(root: pathlib.Path):
    for path in root.rglob("*"):
        try:
            rel = path.relative_to(root)
        except ValueError:
            continue
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        yield path, rel


def read_manifest(path: pathlib.Path, limit: int = 2_000_000) -> str:
    try:
        raw = path.read_bytes()
    except OSError:
        return ""
    return raw[:limit].decode("utf-8", errors="ignore")


def norm_python_name(raw: str) -> str:
    return re.sub(r"[-_.]+", "-", raw.strip().lower())


def parse_requirement_name(line: str) -> str | None:
    text = line.strip()
    if not text or text.startswith("#") or text.startswith("-"):
        return None
    text = text.split(";", 1)[0].strip()
    text = re.split(r"\s*@\s*|===|==|~=|!=|<=|>=|<|>", text, maxsplit=1)[0].strip()
    if "[" in text:
        text = text.split("[", 1)[0]
    if not text or "/" in text or "://" in text:
        return None
    return norm_python_name(text)


def collect_package_json(path: pathlib.Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    deps: set[str] = set()
    for field in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
        value = data.get(field)
        if isinstance(value, dict):
            deps.update(str(k) for k in value)
    scripts = data.get("scripts") if isinstance(data.get("scripts"), dict) else {}
    private = data.get("private") is True
    has_types = any(isinstance(data.get(field), str) and data.get(field) for field in ("types", "typings"))
    library_surface = not private and (
        "exports" in data or has_types or isinstance(data.get("publishConfig"), dict)
    )
    return {
        "name": data.get("name"),
        "deps": deps,
        "scripts": sorted(str(k) for k in scripts),
        "node_engine": (data.get("engines") or {}).get("node") if isinstance(data.get("engines"), dict) else None,
        "package_manager": data.get("packageManager"),
        "workspaces": bool(data.get("workspaces")),
        "library_surface": library_surface,
    }


def pyproject_dependencies(path: pathlib.Path) -> tuple[set[str], str | None]:
    deps: set[str] = set()
    requires_python: str | None = None
    try:
        raw = path.read_bytes()
    except OSError:
        return deps, requires_python
    if tomllib is not None:
        try:
            data = tomllib.loads(raw.decode("utf-8"))
            project = data.get("project") if isinstance(data, dict) else None
            if isinstance(project, dict):
                requires_python = project.get("requires-python") if isinstance(project.get("requires-python"), str) else None
                for item in project.get("dependencies", []) or []:
                    if isinstance(item, str) and (name := parse_requirement_name(item)):
                        deps.add(name)
                optional = project.get("optional-dependencies")
                if isinstance(optional, dict):
                    for values in optional.values():
                        if isinstance(values, list):
                            for item in values:
                                if isinstance(item, str) and (name := parse_requirement_name(item)):
                                    deps.add(name)
            tool = data.get("tool") if isinstance(data, dict) else None
            poetry = tool.get("poetry") if isinstance(tool, dict) else None
            if isinstance(poetry, dict):
                pdeps = poetry.get("dependencies")
                if isinstance(pdeps, dict):
                    for name in pdeps:
                        if str(name).lower() != "python":
                            deps.add(norm_python_name(str(name)))
            return deps, requires_python
        except (UnicodeDecodeError, ValueError, TypeError):
            pass
    text = raw.decode("utf-8", errors="ignore")
    for match in re.finditer(r"[\"']([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?(?:\s*(?:==|>=|<=|~=|!=|>|<).*)?[\"']", text):
        deps.add(norm_python_name(match.group(1)))
    m = re.search(r"requires-python\s*=\s*[\"']([^\"']+)", text)
    if m:
        requires_python = m.group(1)
    return deps, requires_python


def detect_from_deps(deps: set[str], mapping: dict[str, dict[str, str]], out: dict[str, set[str]]) -> None:
    lowered = {d.lower() for d in deps}
    normalized_py = {norm_python_name(d) for d in deps}
    for category, names in mapping.items():
        for package, label in names.items():
            if package.lower() in lowered or norm_python_name(package) in normalized_py:
                out[category].add(label)


def detect_infra(paths: list[tuple[pathlib.Path, pathlib.Path]], out: dict[str, set[str]]) -> None:
    for path, rel in paths:
        if not path.is_file():
            continue
        lower = str(rel).replace("\\", "/").lower()
        name = path.name.lower()
        if name.startswith("dockerfile"):
            out["containers-kubernetes"].add("Docker")
        if name in {"compose.yml", "compose.yaml", "docker-compose.yml", "docker-compose.yaml"}:
            out["containers-kubernetes"].add("Docker Compose")
        if name in {"chart.yaml", "kustomization.yaml", "kustomization.yml"} or any(part.lower() in {"k8s", "kubernetes", "helm"} for part in rel.parts):
            out["containers-kubernetes"].add("Kubernetes/Helm")
        if path.suffix.lower() == ".tf" or "terraform" in lower or "opentofu" in lower:
            out["infrastructure"].add("Terraform/OpenTofu")
        if name == "pulumi.yaml" or name.startswith("pulumi."):
            out["infrastructure"].add("Pulumi")
        if name in {"template.yaml", "template.yml"} and "sam" in lower:
            out["infrastructure"].add("AWS SAM/CloudFormation")
        if name in {"wrangler.toml", "wrangler.json", "wrangler.jsonc"}:
            out["infrastructure"].add("Cloudflare Workers")
        if name == "vercel.json":
            out["infrastructure"].add("Vercel")


def detect_browser_extensions(files_by_name: dict[str, list[pathlib.Path]], detected: dict[str, set[str]]) -> None:
    for path in files_by_name.get("manifest.json", [])[:40]:
        try:
            data = json.loads(read_manifest(path))
        except json.JSONDecodeError:
            continue
        version = data.get("manifest_version") if isinstance(data, dict) else None
        if isinstance(version, int) and not isinstance(version, bool) and version in {2, 3}:
            detected["browser-extension"].add(f"Manifest V{version}")


def detect_mobile(paths: list[tuple[pathlib.Path, pathlib.Path]], files_by_name: dict[str, list[pathlib.Path]], detected: dict[str, set[str]], languages: set[str], managers: set[str]) -> None:
    for path in files_by_name.get("pubspec.yaml", [])[:20]:
        text = read_manifest(path).lower()
        if re.search(r"(?m)^\s*flutter\s*:", text) or re.search(r"(?m)^\s*sdk\s*:\s*flutter\s*$", text):
            detected["mobile"].add("Flutter")
            languages.add("Dart")
            managers.add("pub")
            break

    for path, rel in paths:
        if not path.is_file():
            continue
        lower_name = path.name.lower()
        lower_parts = [part.lower() for part in rel.parts]
        if lower_name == "project.pbxproj":
            text = read_manifest(path)
            if "IPHONEOS_DEPLOYMENT_TARGET" in text or "TARGETED_DEVICE_FAMILY" in text:
                detected["mobile"].add("iOS/Xcode")
                languages.add("Swift/Objective-C")
        if lower_name == "androidmanifest.xml":
            has_gradle = bool(files_by_name.get("build.gradle") or files_by_name.get("build.gradle.kts") or files_by_name.get("settings.gradle") or files_by_name.get("settings.gradle.kts"))
            if has_gradle or "android" in lower_parts:
                detected["mobile"].add("Android")
                languages.add("Kotlin/Java")
                managers.add("Gradle")


def detect_go(files_by_name: dict[str, list[pathlib.Path]], detected: dict[str, set[str]], languages: set[str], managers: set[str]) -> None:
    if "go.mod" not in files_by_name and "go.work" not in files_by_name:
        return
    languages.add("Go")
    managers.add("Go modules")
    mapping = {
        "github.com/gin-gonic/gin": "Gin", "github.com/gofiber/fiber": "Fiber",
        "github.com/labstack/echo": "Echo", "github.com/go-chi/chi": "Chi",
        "google.golang.org/grpc": "gRPC", "github.com/jackc/pgx": "pgx/PostgreSQL",
        "gorm.io/gorm": "GORM", "github.com/redis/go-redis": "Redis",
        "github.com/segmentio/kafka-go": "Kafka", "github.com/nats-io/nats.go": "NATS",
    }
    cli_mapping = {
        "github.com/spf13/cobra": "Cobra", "github.com/urfave/cli": "urfave/cli",
        "github.com/charmbracelet/bubbletea": "Bubble Tea",
    }
    for path in files_by_name.get("go.mod", [])[:20]:
        text = read_manifest(path).lower()
        for needle, label in mapping.items():
            if needle.lower() in text:
                detected["go-services"].add(label)
                if "postgres" in label.lower() or "redis" in label.lower():
                    detected["data"].add("PostgreSQL" if "postgres" in label.lower() else "Redis")
        for needle, label in cli_mapping.items():
            if needle.lower() in text:
                detected["cli"].add(label)


def detect_rust_cli(files_by_name: dict[str, list[pathlib.Path]], detected: dict[str, set[str]]) -> None:
    mapping = {"clap": "Clap", "ratatui": "Ratatui", "crossterm": "Crossterm"}
    for path in files_by_name.get("Cargo.toml", [])[:30]:
        text = read_manifest(path).lower()
        for dependency, label in mapping.items():
            if re.search(rf"(?m)^\s*{re.escape(dependency)}\s*=", text):
                detected["cli"].add(label)


def detect_library_packages(files_by_name: dict[str, list[pathlib.Path]], detected: dict[str, set[str]]) -> None:
    for path in files_by_name.get("Cargo.toml", [])[:30]:
        text = read_manifest(path)
        if re.search(r"(?m)^\s*\[lib\]\s*$", text):
            detected["sdk-library"].add("Rust library crate")

    for name, paths in files_by_name.items():
        if not name.lower().endswith((".csproj", ".fsproj", ".vbproj")):
            continue
        for path in paths[:30]:
            text = read_manifest(path).lower()
            if re.search(r"<ispackable>\s*true\s*</ispackable>", text):
                detected["sdk-library"].add("NuGet packable library")


def detect_jvm(files_by_name: dict[str, list[pathlib.Path]], detected: dict[str, set[str]], languages: set[str], managers: set[str]) -> None:
    manifests = []
    for name in ("pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"):
        manifests.extend(files_by_name.get(name, []))
    if not manifests:
        return
    languages.add("JVM")
    if files_by_name.get("pom.xml"):
        managers.add("Maven")
    if files_by_name.get("build.gradle") or files_by_name.get("build.gradle.kts"):
        managers.add("Gradle")
    needles = {
        "spring-boot": "Spring Boot", "org.springframework": "Spring",
        "io.micronaut": "Micronaut", "io.quarkus": "Quarkus",
        "org.hibernate": "Hibernate", "kotlin": "Kotlin",
    }
    for path in manifests[:40]:
        text = read_manifest(path).lower()
        for needle, label in needles.items():
            if needle in text:
                detected["jvm"].add(label)
        if "postgresql" in text:
            detected["data"].add("PostgreSQL")
        if "mysql" in text or "mariadb" in text:
            detected["data"].add("MySQL")
        if "redis" in text:
            detected["data"].add("Redis")
        if "kafka" in text:
            detected["messaging-workflows"].add("Kafka")


def detect_dotnet(paths: list[tuple[pathlib.Path, pathlib.Path]], detected: dict[str, set[str]], languages: set[str], managers: set[str]) -> None:
    projects = [path for path, _ in paths if path.is_file() and path.suffix.lower() in {".csproj", ".fsproj", ".vbproj"}][:50]
    if not projects:
        return
    languages.add(".NET")
    managers.add("NuGet")
    for path in projects:
        text = read_manifest(path).lower()
        if "microsoft.net.sdk.web" in text or "microsoft.aspnetcore" in text:
            detected["dotnet"].add("ASP.NET Core")
        if "microsoft.entityframeworkcore" in text:
            detected["dotnet"].add("EF Core")
        if "dapper" in text:
            detected["dotnet"].add("Dapper")
        if "masstransit" in text:
            detected["dotnet"].add("MassTransit")
            detected["messaging-workflows"].add("MassTransit")
        if "hangfire" in text:
            detected["dotnet"].add("Hangfire")
        if "npgsql" in text:
            detected["data"].add("PostgreSQL")
        if "mysql" in text or "mariadb" in text:
            detected["data"].add("MySQL")


def detect_legacy_web(files_by_name: dict[str, list[pathlib.Path]], detected: dict[str, set[str]], languages: set[str], managers: set[str]) -> None:
    if "Gemfile" in files_by_name or "Gemfile.lock" in files_by_name:
        languages.add("Ruby")
        managers.add("Bundler")
        for path in files_by_name.get("Gemfile", [])[:20]:
            text = read_manifest(path).lower()
            for needle, label in {"rails": "Rails", "sinatra": "Sinatra", "sidekiq": "Sidekiq", "resque": "Resque"}.items():
                if re.search(rf"\b{re.escape(needle)}\b", text):
                    detected["legacy-web"].add(label)
            if "gem 'pg'" in text or 'gem "pg"' in text:
                detected["data"].add("PostgreSQL")
            if "mysql2" in text:
                detected["data"].add("MySQL")
            if "redis" in text:
                detected["data"].add("Redis")
    if "composer.json" in files_by_name:
        languages.add("PHP")
        managers.add("Composer")
        for path in files_by_name.get("composer.json", [])[:20]:
            try:
                data = json.loads(read_manifest(path))
            except json.JSONDecodeError:
                continue
            reqs = set()
            for field in ("require", "require-dev"):
                value = data.get(field)
                if isinstance(value, dict):
                    reqs.update(str(k).lower() for k in value)
            if "laravel/framework" in reqs:
                detected["legacy-web"].add("Laravel")
            if any(name.startswith("symfony/") for name in reqs):
                detected["legacy-web"].add("Symfony")
            if "doctrine/orm" in reqs:
                detected["legacy-web"].add("Doctrine ORM")
            if any("mysql" in name or "mariadb" in name for name in reqs):
                detected["data"].add("MySQL")


def suggested_references(detected: dict[str, set[str]], monorepo: bool) -> set[str]:
    refs: set[str] = set()
    # A normal full-stack repository may legitimately contain frontend, backend,
    # data, and messaging technologies. That does not make staff-level execution
    # guidance relevant. Load it only when repository shape proves a coordination
    # boundary such as a monorepo; task/mechanism routing handles cross-layer work.
    if monorepo:
        refs.add(REFERENCE_RULES["staff"])

    frontend = detected.get("frontend", set())
    if frontend.intersection({"React", "Next.js"}):
        refs.add(REFERENCE_RULES["frontend-react"])
    if frontend.intersection({"Vue", "Nuxt", "Svelte", "SvelteKit", "Angular", "Remix", "Astro"}):
        refs.add(REFERENCE_RULES["frontend-other"])
    if detected.get("mobile"):
        refs.add(REFERENCE_RULES["mobile"])
    if detected.get("browser-extension"):
        refs.add(REFERENCE_RULES["browser-extension"])
    if detected.get("cli"):
        refs.add(REFERENCE_RULES["cli"])
    if detected.get("sdk-library"):
        refs.add(REFERENCE_RULES["sdk-library"])
    desktop = detected.get("desktop-runtime", set())
    if desktop:
        refs.add(REFERENCE_RULES["desktop-runtime"])
        refs.add(REFERENCE_RULES["desktop-shell"])
    if desktop.intersection({"Electron Builder", "Electron Forge"}):
        refs.add(REFERENCE_RULES["desktop-packaging"])
    for category in ("node-backend", "python-web", "messaging-workflows", "containers-kubernetes", "jvm", "dotnet", "go-services", "legacy-web"):
        if detected.get(category):
            refs.add(REFERENCE_RULES[category])

    data = detected.get("data", set())
    if data.intersection({"PostgreSQL", "Redis", "Prisma", "Drizzle", "Kysely", "TypeORM", "Sequelize", "Knex", "SQLAlchemy", "Alembic", "pgx/PostgreSQL", "GORM"}):
        refs.add(REFERENCE_RULES["data-primary"])
    if data.intersection({"MySQL", "MongoDB", "MongoDB/Mongoose", "SQLite", "Elasticsearch", "OpenSearch"}):
        refs.add(REFERENCE_RULES["data-other"])
    return refs


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("repo_root")
    parser.add_argument("--json", action="store_true", help="emit JSON instead of Markdown")
    args = parser.parse_args()

    root = pathlib.Path(args.repo_root).resolve()
    if not root.is_dir():
        print(f"error: repository not found: {root}", file=sys.stderr)
        return 2

    paths = list(iter_paths(root))
    files_by_name: dict[str, list[pathlib.Path]] = defaultdict(list)
    for path, _rel in paths:
        if path.is_file():
            files_by_name[path.name].append(path)

    detected: dict[str, set[str]] = defaultdict(set)
    managers: set[str] = set()
    languages: set[str] = set()
    package_summaries: list[dict[str, Any]] = []
    python_summaries: list[dict[str, Any]] = []
    monorepo = any(name in files_by_name for name in MONOREPO_MARKERS)

    for lock, manager in PACKAGE_LOCKS.items():
        if lock in files_by_name:
            managers.add(manager)
            languages.add("JavaScript/TypeScript")
    for lock, manager in PY_LOCKS.items():
        if lock in files_by_name:
            managers.add(manager)
            languages.add("Python")

    if "tsconfig.json" in files_by_name or "tsconfig.base.json" in files_by_name:
        languages.add("TypeScript")
    if any(path.suffix.lower() in {".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"} for path, _ in paths if path.is_file()):
        languages.add("JavaScript/TypeScript")
    if any(path.suffix.lower() == ".py" for path, _ in paths if path.is_file()):
        languages.add("Python")

    for path in files_by_name.get("package.json", [])[:40]:
        info = collect_package_json(path)
        if not info:
            continue
        detect_from_deps(info["deps"], JS_TECH, detected)
        if info["library_surface"]:
            detected["sdk-library"].add("JavaScript/TypeScript package surface")
        if info["workspaces"]:
            monorepo = True
        pm = info.get("package_manager")
        if isinstance(pm, str) and pm:
            managers.add(pm.split("@", 1)[0])
        package_summaries.append({
            "path": str(path.relative_to(root)), "name": info.get("name"),
            "node_engine": info.get("node_engine"), "script_names": info.get("scripts", [])[:80],
        })

    detect_browser_extensions(files_by_name, detected)

    pyproject_paths = files_by_name.get("pyproject.toml", [])[:30]
    requirement_paths = [path for path, rel in paths if path.is_file() and rel.name.lower().startswith("requirements") and rel.suffix.lower() in {".txt", ".in"}][:30]
    for path in pyproject_paths:
        deps, requires_python = pyproject_dependencies(path)
        detect_from_deps(deps, PY_TECH, detected)
        languages.add("Python")
        python_summaries.append({"path": str(path.relative_to(root)), "requires_python": requires_python, "dependency_count": len(deps)})
    for path in requirement_paths:
        deps = {name for line in read_manifest(path).splitlines() if (name := parse_requirement_name(line))}
        detect_from_deps(deps, PY_TECH, detected)
        languages.add("Python")

    detect_go(files_by_name, detected, languages, managers)
    detect_jvm(files_by_name, detected, languages, managers)
    detect_dotnet(paths, detected, languages, managers)
    detect_legacy_web(files_by_name, detected, languages, managers)
    detect_mobile(paths, files_by_name, detected, languages, managers)
    detect_rust_cli(files_by_name, detected)
    detect_library_packages(files_by_name, detected)

    if "Cargo.toml" in files_by_name:
        languages.add("Rust")
        managers.add("Cargo")

    detect_infra(paths, detected)

    lower_paths = [str(rel).replace("\\", "/").lower() for _, rel in paths]
    if any("prisma/" in p for p in lower_paths):
        detected["data"].add("Prisma")
    if any("alembic" in p for p in lower_paths):
        detected["data"].add("Alembic")
    if any(any(part in {"migration", "migrations", "alembic", "prisma"} for part in p.split("/")[:-1]) for p in lower_paths):
        detected["data"].add("Database migrations present")
    if monorepo:
        detected["repository-shape"].add("Monorepo/workspace")

    refs = suggested_references(detected, monorepo)
    report = {
        "root": str(root),
        "privacy": "selected manifests and path names only; no .env/credential/arbitrary source contents read",
        "languages": sorted(languages),
        "package_managers": sorted(managers),
        "monorepo": monorepo,
        "detected": {k: sorted(v) for k, v in sorted(detected.items())},
        "package_manifests": package_summaries,
        "python_manifests": python_summaries,
        "suggested_references": sorted(refs),
    }

    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0

    print("# Stack fingerprint")
    print(f"root: {root}")
    print("privacy: selected manifests and path names only; no .env/credential/arbitrary source contents read")
    print(f"repository shape: {'monorepo/workspace' if monorepo else 'single-root or undetected'}")
    print(f"languages: {', '.join(report['languages']) if report['languages'] else 'none detected'}")
    print(f"package managers: {', '.join(report['package_managers']) if report['package_managers'] else 'none detected'}")

    print("\n## Detected technology")
    if not report["detected"]:
        print("- none detected from selected manifests/path markers")
    for category, values in report["detected"].items():
        print(f"- {category}: {', '.join(values)}")

    if package_summaries:
        print("\n## JavaScript/TypeScript manifest hints")
        for item in package_summaries:
            label = item["name"] or "(unnamed)"
            engine = f"; node {item['node_engine']}" if item.get("node_engine") else ""
            scripts = ", ".join(item["script_names"][:30]) or "none"
            print(f"- {item['path']}: {label}{engine}; script names: {scripts}")

    if python_summaries:
        print("\n## Python manifest hints")
        for item in python_summaries:
            py = f"; requires-python {item['requires_python']}" if item.get("requires_python") else ""
            print(f"- {item['path']}: dependencies detected {item['dependency_count']}{py}")

    print("\n## Suggested skill references")
    if refs:
        for ref in sorted(refs):
            print(f"- {ref}")
    else:
        print("- use core full-stack references; no stack-specific reference confidently selected")

    print("\n## Reminder")
    print("- Fingerprints are hints, not proof of the active runtime. Confirm entrypoints, lockfile/runtime versions, deployed topology, and repository-native commands before implementation.")
    print("- Re-check current official framework/platform documentation for version-sensitive behavior instead of assuming the playbook is version-specific API truth.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())