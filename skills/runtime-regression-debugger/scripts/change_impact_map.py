#!/usr/bin/env python3
"""Map Git change paths to full-stack risk surfaces without reading source contents.

Usage:
  change_impact_map.py <repo-root>
  change_impact_map.py <repo-root> --base origin/main
  change_impact_map.py <repo-root> --base origin/main --json

Without --base, inspect staged, unstaged, and untracked files.
With --base, inspect base...HEAD plus current staged/unstaged/untracked files.

The script uses file paths only. It never opens source, .env, credential, or secret files.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
from collections import defaultdict


SURFACE_RULES = {
    "frontend-ui": (
        "frontend/", "client/", "web/", "ui/", "components/", "pages/", "app/",
        "renderer/", "views/", "templates/", "styles/", "public/",
    ),
    "api-backend": (
        "api/", "routes/", "controllers/", "handlers/", "server/", "backend/",
        "services/", "rpc/", "graphql/", "rest/",
    ),
    "auth-security-tenancy": (
        "auth", "oauth", "oidc", "sso", "session", "permission", "policy", "rbac",
        "acl", "tenant", "tenancy", "secret", "credential", "crypto", "csrf", "csp",
        "security",
    ),
    "data-migrations": (
        "migration", "migrations/", "schema", "prisma", "drizzle", "database/", "db/",
        "models/", "entities/", "seed", "backfill",
    ),
    "async-jobs": (
        "jobs/", "job/", "queue", "queues/", "workers/", "worker/", "workflow",
        "cron", "scheduler", "tasks/", "temporal", "inngest", "bullmq",
    ),
    "runtime-desktop": (
        "electron", "preload", "webcontents", "browserwindow", "main.ts", "main.js",
        "main.cjs", "desktop/", "runtime/", "native/",
    ),
    "observability-ops": (
        "observability", "telemetry", "metrics", "tracing", "trace", "logging", "logs/",
        "sentry", "opentelemetry", "prometheus", "grafana", "alerts", "runbook",
    ),
    "infra-deployment": (
        "terraform", ".tf", "k8s/", "kubernetes", "helm/", "chart.yaml", "values.yaml",
        "dockerfile", "compose", "deploy", "deployment", "serverless", "wrangler",
        "vercel", "netlify", "fly.toml", "pulumi", "cloudformation",
    ),
    "ci-release": (
        ".github/workflows/", ".gitlab-ci", ".circleci/", "jenkinsfile", "azure-pipelines",
        "release", "updater", "publish", "signing", "notar", "codecov",
    ),
    "dependencies-build": (
        "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock",
        "pyproject.toml", "requirements.txt", "poetry.lock", "uv.lock", "go.mod", "go.sum",
        "cargo.toml", "cargo.lock", "composer.json", "composer.lock", "pom.xml",
        "build.gradle", "gradle.lockfile", "gemfile", "gemfile.lock", "mix.exs", "mix.lock",
        "turbo.json", "nx.json", "pnpm-workspace.yaml", "vite.config", "webpack", "rollup",
        "tsconfig", "build/", "scripts/build",
    ),
    "public-contracts": (
        "openapi", "swagger", ".proto", "graphql", "schema.graphql", "asyncapi",
        "contracts/", "events/", "webhook",
    ),
    "tests-quality": (
        "test/", "tests/", "__tests__/", ".test.", ".spec.", "playwright", "cypress",
        "vitest", "jest", "pytest", "fixtures/", "e2e/", "integration/",
    ),
    "docs-decisions": (
        "docs/", "adr", "architecture", "readme", "changelog", "contributing",
        "runbook", "decision",
    ),
    "billing-entitlements": (
        "billing", "payment", "stripe", "invoice", "subscription", "entitlement", "license",
        "quota", "plan/", "pricing", "ledger", "wallet", "balance", "refund", "payout",
        "settlement", "reconciliation", "charge", "checkout",
    ),
    "network-runtime": (
        "nginx", "envoy", "haproxy", "caddy", "ingress", "gateway", "reverse-proxy",
        "reverse_proxy", "networkpolicy", "network-policy", "istio", "linkerd", "service-mesh",
        "systemd", "sysctl", "ulimit",
    ),
    "resilience-dr": (
        "backup", "restore", "disaster", "failover", "fail-back", "failback", "multi-region",
        "multiregion", "replication", "recovery", "rto", "rpo", "game-day", "gameday",
    ),
    "coordination-consensus": (
        "raft", "consensus", "quorum", "leader-election", "leader_election", "fencing",
        "lease/", "lease-", "_lease", ".lease", "etcd", "zookeeper", "consul",
        "lock-service", "lock_service",
    ),
    "partitioning-scale": (
        "shard", "partition", "rebalance", "placement", "consistent-hash", "consistent_hash",
        "hash-ring", "hash_ring", "hot-key", "hot_key", "hotspot", "routing-table", "routing_table",
    ),
    "data-movement-search": (
        "cdc", "debezium", "change-data-capture", "change_data_capture", "opensearch",
        "elasticsearch", "search-index", "search_index", "object-storage", "object_storage",
        "s3/", "blob-storage", "blob_storage", "data-move", "data_move", "reindex",
    ),
    "global-traffic-cells": (
        "global-traffic", "global_traffic", "geo-routing", "geo_routing", "geodns", "anycast",
        "active-active", "active_active", "cell-router", "cell_router", "cell/", "cells/",
        "region-router", "region_router", "traffic-manager", "traffic_manager",
    ),
    "sre-chaos": (
        "error-budget", "error_budget", "burn-rate", "burn_rate", "slo/", "slo-",
        "_slo", ".slo", "chaos",
        "fault-injection", "fault_injection", "toxiproxy", "litmus", "gremlin",
    ),
    "decommissioning": (
        "decommission", "sunset", "retire", "remove-legacy", "remove_legacy",
        "legacy-cleanup", "legacy_cleanup", "dead-code", "dead_code",
    ),
    "database-recovery": (
        "wal/", "wal-", "_wal", ".wal", "binlog", "pitr", "pgbackrest",
        "wal-g", "wal_g", "redo-log", "redo_log", "point-in-time-recovery",
    ),
    "kernel-io": (
        "numa", "ebpf", "bpf/", "iostat", "vmstat", "pidstat", "cgroup",
        "oom", "io-uring", "io_uring", "fsync", "epoll", "kqueue",
    ),
    "transport-connection": (
        "tcp/", "tcp-", "_tcp", ".tcp", "tls/", "tls-", "_tls", ".tls",
        "keepalive", "conntrack", "ephemeral-port", "ephemeral_port", "socket/",
        "socket-", "connection-pool", "connection_pool", "mtu",
    ),
    "runtime-gc": (
        "jvm", "heapdump", "heap-dump", "heap_dump", "jfr", "gc/", "gc-",
        "_gc", ".gc", "event-loop", "event_loop", "thread-pool", "thread_pool",
    ),
    "cache-admission": (
        "cache/", "cache-", "_cache", ".cache", "rate-limit", "rate_limit",
        "ratelimit", "load-shed", "load_shed", "admission-control",
        "admission_control", "token-bucket", "token_bucket", "concurrency-limit",
    ),
    "stream-processing": (
        "flink", "kinesis", "stream-processing", "stream_processing", "event-sourcing",
        "event_sourcing", "event-store", "event_store", "watermark", "consumer-lag",
        "consumer_lag", "state-store", "state_store",
    ),
    "search-relevance": (
        "ranking", "relevance", "rerank", "embedding", "vector-index", "vector_index",
        "bm25", "ann-index", "ann_index", "query-understanding", "query_understanding",
    ),
    "saas-isolation": (
        "noisy-neighbor", "noisy_neighbor", "tenant-move", "tenant_move",
        "tenant-placement", "tenant_placement", "per-tenant", "per_tenant",
        "fair-scheduler", "fair_scheduler",
    ),
    "incident-command": (
        "incident/", "incidents/", "postmortem", "post-mortem", "sev1", "sev2",
        "oncall", "on-call", "pagerduty", "mitigation-plan", "mitigation_plan",
    ),
    "storage-engine-replication": (
        "storage-engine", "storage_engine", "compaction", "sstable", "lsm", "checkpoint",
        "vacuum", "autovacuum", "replica-apply", "replica_apply", "replication-slot",
        "replication_slot", "logical-replication", "logical_replication",
    ),
    "production-profiling": (
        "perf/", "perf-", "_perf", ".perf", "flamegraph", "flame-graph", "profile/",
        "profiles/", "profiler", "bpftrace", "bcc/", "offcpu", "off-cpu",
    ),
    "broker-internals": (
        "kafka", "rabbitmq", "amqp", "pulsar", "nats", "sqs", "pubsub", "pub-sub",
        "consumer-offset", "consumer_offset", "visibility-timeout", "visibility_timeout",
        "rebalance-listener", "rebalance_listener", "dead-letter", "dead_letter",
    ),
    "distributed-transactions": (
        "saga", "two-phase-commit", "two_phase_commit", "2pc", "xa/", "tcc/",
        "transactional-outbox", "transactional_outbox", "outbox/", "inbox/", "compensation",
    ),
    "analytics-data-platform": (
        "warehouse", "lakehouse", "data-lake", "data_lake", "olap", "etl/", "elt/",
        "airflow", "dagster", "prefect", "spark", "trino", "presto", "clickhouse",
        "bigquery", "snowflake", "redshift", "parquet", "iceberg", "delta-lake", "delta_lake",
    ),
    "system-rescue": (
        "architecture-rescue", "architecture_rescue", "stabilization", "stabilisation",
        "system-rescue", "system_rescue", "entropy-reduction", "entropy_reduction",
        "ownership-map", "ownership_map",
    ),
}


HIGH_RISK_SURFACES = {
    "auth-security-tenancy",
    "data-migrations",
    "billing-entitlements",
    "infra-deployment",
    "ci-release",
    "resilience-dr",
    "coordination-consensus",
    "global-traffic-cells",
    "database-recovery",
    "saas-isolation",
    "storage-engine-replication",
    "distributed-transactions",
}

MEDIUM_RISK_SURFACES = {
    "api-backend",
    "async-jobs",
    "runtime-desktop",
    "public-contracts",
    "dependencies-build",
    "observability-ops",
    "network-runtime",
    "partitioning-scale",
    "data-movement-search",
    "sre-chaos",
    "decommissioning",
    "kernel-io",
    "transport-connection",
    "runtime-gc",
    "cache-admission",
    "stream-processing",
    "search-relevance",
    "incident-command",
    "production-profiling",
    "broker-internals",
    "analytics-data-platform",
    "system-rescue",
}

VALIDATION_HINTS = {
    "frontend-ui": "Exercise user-visible states, accessibility, navigation/reload, slow/error responses, and stale async commits.",
    "api-backend": "Run API/contract integration tests; verify validation, error semantics, timeouts, retries, and idempotency.",
    "auth-security-tenancy": "Add negative object/tenant authorization cases; inspect secret exposure, revocation, audit, and fail-closed behavior.",
    "data-migrations": "Validate invariants, transaction/concurrency behavior, old/new coexistence, backfill/resume, and rollback/recovery.",
    "async-jobs": "Test duplicate delivery, retry classification, idempotency, ordering assumptions, terminal state, and tenant scope.",
    "runtime-desktop": "Validate lifecycle generations, Session/WebContents ownership, IPC/security boundaries, package/runtime behavior, and cleanup.",
    "observability-ops": "Verify correlation, low-cardinality telemetry, redaction, actionable alerts, and user-facing success signals.",
    "infra-deployment": "Validate config defaults, health/draining, environment scope, IaC plan/diff, rollback, and disaster-recovery implications.",
    "ci-release": "Verify exact source/artifact identity, required gates, promotion order, signing/updater metadata, previous stable, and rollback.",
    "dependencies-build": "Review changelogs/transitive impact; run reproducible build/type/test/package checks and avoid unrelated dependency churn.",
    "public-contracts": "Check compatibility/versioning and test old/new producers/consumers when simultaneous versions can exist.",
    "tests-quality": "Confirm tests fail for the intended regression and are isolated/deterministic rather than implementation-coupled.",
    "docs-decisions": "Keep docs/ADRs aligned with current behavior and do not let documentation substitute for runtime evidence.",
    "billing-entitlements": "Validate money/entitlement invariants, stable operation identity, exact amount/currency handling, idempotency, provider state, reconciliation, auditability, and bounded recovery.",
    "network-runtime": "Trace DNS/proxy/TCP-TLS/listener/runtime/dependency boundaries; verify timeout layering, connection pools, resource limits, draining, and retry amplification.",
    "resilience-dr": "Verify RTO/RPO assumptions, backup restore evidence, failover authority/fencing, data-loss windows, degraded modes, traffic shift, and failback/reconciliation.",
    "coordination-consensus": "State the safety invariant; verify quorum/term/lease behavior, stale-owner fencing, membership changes, partition behavior, and fail-closed/open semantics.",
    "partitioning-scale": "Model hottest-key/shard load, routing ownership, fanout, placement headroom, rebalance safety, stale routers, and recovery time rather than fleet averages.",
    "data-movement-search": "Verify source-of-truth, checkpoint/replay, schema evolution, backfill/live-tail correctness, projection freshness, rebuild path, deletes/tombstones, and cutover parity.",
    "global-traffic-cells": "Verify region/cell routing ownership, control/data-plane dependencies, data affinity, blast radius, failover authority, propagation delay, and localized telemetry.",
    "sre-chaos": "Tie changes to user-observable SLOs/error-budget policy; bound failure injection with a steady-state hypothesis, stop conditions, recovery path, and limited blast radius.",
    "decommissioning": "Prove no live callers/consumers/tenants/versions remain, then remove code, credentials, infra, data retention, telemetry, alerts, and ownership artifacts as one lifecycle change.",
    "database-recovery": "Verify write acknowledgement/durability, WAL/binlog retention, backup/PITR chain, promotion fencing, measured restore time, corruption handling, and application-level invariant checks.",
    "kernel-io": "Correlate scheduler/throttling, memory reclaim/OOM, fsync/storage latency, FD/socket limits, and NUMA evidence to the affected workload before tuning kernel settings.",
    "transport-connection": "Separate connect/TLS/request/idle/drain phases; test reconnect storms, stacked retries, timeout budgets, backlog/port/NAT pressure, and graceful drain/failover.",
    "runtime-gc": "Capture runtime version and heap/RSS/allocation/GC or event-loop/thread-pool evidence; compare under equivalent warmup and container limits before changing flags.",
    "cache-admission": "Verify cache authority/key scope/freshness/invalidation, stampede protection, limiter scope/fairness, overload shedding, degraded modes, and recovery from cache/limiter loss.",
    "stream-processing": "Test partition ordering, duplicate/replay, late events/watermarks, checkpoint-state-offset consistency, sink idempotency, rescale/repartition, and schema evolution.",
    "search-relevance": "Verify auth filtering, representative relevance metrics, index/embedding versioning, freshness/deletes, rebuild path, shard/ANN/rerank latency, and rollback/cohort behavior.",
    "saas-isolation": "Add cross-tenant negative tests plus noisy-neighbor/fairness checks across compute, pools, queues, caches, quotas, cells, tenant moves, backup/restore, and deletion lifecycle.",
    "incident-command": "Preserve a timeline and exact versions, distinguish observations from hypotheses, bound mitigation blast radius/stop conditions, verify user/data recovery, and record temporary safeguards for removal.",
    "storage-engine-replication": "Verify acknowledgement and durability points, checkpoint/flush/compaction or vacuum debt, replication receive/apply lag, retention, failover fencing, and crash-recovery semantics before tuning.",
    "production-profiling": "Tie perf/eBPF/runtime profiles to an exact question, build, workload, host/cgroup limits, and latency interval; quantify profiler overhead and distinguish on-CPU from off-CPU waits.",
    "broker-internals": "Verify producer ack/durability, ownership/rebalance generations, offset/ack/visibility semantics, ordering scope, redelivery, retention/replay, lag rates, and downstream idempotency.",
    "distributed-transactions": "State the cross-authority invariant and unknown-outcome semantics; test every partial history, idempotent retry/compensation, reconciliation, and whether one authoritative commit plus async projection would be simpler.",
    "analytics-data-platform": "Validate freshness/completeness, schema/lineage, partition pruning/layout, skew/shuffle/spill, compaction, backfill throttling, scheduler fairness, reproducibility, and live-path protection.",
    "system-rescue": "Stabilize critical contracts, freeze unrelated churn, map authorities and dependency edges, characterize risky seams, reduce amplification first, migrate ownership incrementally, and delete obsolete paths only after proof.",
}


SENSITIVE_PATH_MARKERS = (
    ".env", "secret", "credential", "private-key", "private_key", "id_rsa", "token",
)


def run_git(root: pathlib.Path, args: list[str], allow_failure: bool = False) -> list[str]:
    proc = subprocess.run(
        ["git", "-C", str(root), *args],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode != 0:
        if allow_failure:
            return []
        msg = proc.stderr.strip() or proc.stdout.strip() or "git command failed"
        raise RuntimeError(msg)
    return [line.strip() for line in proc.stdout.splitlines() if line.strip()]


def changed_paths(root: pathlib.Path, base: str | None) -> tuple[str, list[str]]:
    run_git(root, ["rev-parse", "--is-inside-work-tree"])
    paths: set[str] = set()

    if base:
        run_git(root, ["rev-parse", "--verify", base])
        for path in run_git(root, ["diff", "--name-only", "--diff-filter=ACMRD", f"{base}...HEAD"]):
            paths.add(path)
        mode = f"{base}...HEAD plus working tree"
    else:
        mode = "working tree (staged + unstaged + untracked)"

    for args in (
        ["diff", "--name-only", "--diff-filter=ACMRD", "HEAD"],
        ["diff", "--cached", "--name-only", "--diff-filter=ACMRD"],
        ["ls-files", "--others", "--exclude-standard"],
    ):
        for path in run_git(root, args, allow_failure=True):
            paths.add(path)

    return mode, sorted(paths)


def classify(path: str) -> set[str]:
    normalized = path.replace("\\", "/")
    lower = normalized.lower()
    found: set[str] = set()

    for surface, markers in SURFACE_RULES.items():
        for marker in markers:
            if marker in lower:
                found.add(surface)
                break

    # CI workflow directories are delivery automation, not product async-job code.
    if lower.startswith('.github/workflows/') or lower.startswith('.circleci/'):
        found.discard('async-jobs')

    if not found:
        suffix = pathlib.PurePosixPath(normalized).suffix.lower()
        if suffix in {".tsx", ".jsx", ".vue", ".svelte", ".css", ".scss", ".html"}:
            found.add("frontend-ui")
        elif suffix in {".sql"}:
            found.add("data-migrations")
        elif suffix in {".tf", ".yaml", ".yml"} and any(part in lower for part in ("deploy", "infra", "k8", "helm")):
            found.add("infra-deployment")

    return found


def summarize(paths: list[str]) -> dict:
    by_surface: dict[str, list[str]] = defaultdict(list)
    uncategorized: list[str] = []
    sensitive_names: list[str] = []

    for path in paths:
        surfaces = classify(path)
        if not surfaces:
            uncategorized.append(path)
        for surface in surfaces:
            by_surface[surface].append(path)
        lower = path.lower()
        if any(marker in lower for marker in SENSITIVE_PATH_MARKERS):
            sensitive_names.append(path)

    high = sorted(surface for surface in by_surface if surface in HIGH_RISK_SURFACES)
    medium = sorted(surface for surface in by_surface if surface in MEDIUM_RISK_SURFACES)
    other = sorted(surface for surface in by_surface if surface not in HIGH_RISK_SURFACES | MEDIUM_RISK_SURFACES)

    if high:
        overall = "high"
    elif medium:
        overall = "medium"
    elif paths:
        overall = "low-or-local"
    else:
        overall = "none-detected"

    return {
        "changed_files": paths,
        "surfaces": {surface: sorted(items) for surface, items in sorted(by_surface.items())},
        "uncategorized": uncategorized,
        "sensitive_path_names": sensitive_names,
        "risk": {
            "overall": overall,
            "high_risk_surfaces": high,
            "medium_risk_surfaces": medium,
            "other_surfaces": other,
        },
    }


def print_markdown(root: pathlib.Path, mode: str, report: dict) -> None:
    print("# Change impact map")
    print(f"root: {root}")
    print(f"mode: {mode}")
    print("privacy: path names only; source and secret contents are not read")
    print(f"changed files: {len(report['changed_files'])}")
    print(f"risk cue: {report['risk']['overall']}")

    print("\n## Surfaces")
    if not report["surfaces"]:
        print("- none detected")
    for surface, items in report["surfaces"].items():
        print(f"- {surface} ({len(items)})")
        for path in items[:40]:
            print(f"  - {path}")
        if len(items) > 40:
            print(f"  - ... {len(items) - 40} more")

    if report["uncategorized"]:
        print("\n## Uncategorized paths")
        for path in report["uncategorized"][:60]:
            print(f"- {path}")
        if len(report["uncategorized"]) > 60:
            print(f"- ... {len(report['uncategorized']) - 60} more")

    print("\n## Risk cues")
    for label, key in (
        ("high", "high_risk_surfaces"),
        ("medium", "medium_risk_surfaces"),
        ("other", "other_surfaces"),
    ):
        values = report["risk"][key]
        print(f"- {label}: {', '.join(values) if values else 'none'}")

    if report["sensitive_path_names"]:
        print("- sensitive-looking path names detected; do not print file contents or secrets during review")

    print("\n## Validation prompts")
    if not report["surfaces"]:
        print("- No classified change surface detected. Read the actual diff before concluding the change is low risk.")
    for surface in report["surfaces"]:
        hint = VALIDATION_HINTS.get(surface)
        if hint:
            print(f"- {surface}: {hint}")

    print("\n## Reminder")
    print("- Path classification is a triage aid only. Read active callers, contracts, and the complete diff before approval or release.")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("repo_root")
    parser.add_argument("--base", help="compare base...HEAD and include current working-tree changes")
    parser.add_argument("--json", action="store_true", help="emit JSON instead of Markdown")
    args = parser.parse_args()

    root = pathlib.Path(args.repo_root).resolve()
    if not root.is_dir():
        print(f"error: repository not found: {root}", file=sys.stderr)
        return 2

    try:
        mode, paths = changed_paths(root, args.base)
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    report = summarize(paths)
    if args.json:
        payload = {"root": str(root), "mode": mode, **report}
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print_markdown(root, mode, report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
