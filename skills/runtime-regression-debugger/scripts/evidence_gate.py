#!/usr/bin/env python3
"""Suggest minimum validation evidence from engineering risk surfaces.

This is a planning aid, not a correctness proof or repository-policy replacement.

Examples:
  evidence_gate.py --surfaces auth-security-tenancy,data-migrations --evidence focused,negative-auth,compatibility,rollback
  evidence_gate.py --surfaces billing-entitlements --evidence focused,idempotency,reconciliation --json
"""

from __future__ import annotations

import argparse
import json
import sys

BASELINE = {"active-path", "focused", "diff-review"}

SURFACE_REQUIREMENTS = {
    "auth-security-tenancy": {"negative-auth", "integration"},
    "data-migrations": {"compatibility", "restartability", "rollback-or-forward-repair"},
    "billing-entitlements": {"idempotency", "unknown-outcome", "reconciliation"},
    "public-contracts": {"contract", "compatibility"},
    "async-jobs": {"redelivery", "idempotency", "terminal-state"},
    "runtime-desktop": {"lifecycle", "package-runtime"},
    "infra-deployment": {"rendered-config", "rollback", "black-box"},
    "ci-release": {"exact-artifact", "promotion", "rollback"},
    "performance-scale": {"baseline", "candidate", "tail", "saturation-recovery"},
    "partitioning-scale": {"skew", "movement", "failure-recovery"},
    "resilience-dr": {"restore-or-failover", "fencing", "invariant-check"},
    "global-traffic-cells": {"regional-failure", "fencing", "black-box"},
    "distributed-transactions": {"unknown-outcome", "compensation-or-reconcile", "failure-recovery"},
    "database-recovery": {"restore-or-failover", "invariant-check"},
    "storage-engine-replication": {"failure-recovery", "fencing"},
    "broker-internals": {"redelivery", "ordering-scope", "idempotency"},
    "cache-admission": {"stampede-or-overload", "saturation-recovery"},
    "transport-connection": {"timeout-budget", "recovery-ramp"},
    "saas-isolation": {"negative-auth", "fairness", "failure-isolation"},
    "search-relevance": {"authorization", "representative-queries", "freshness"},
    "data-movement-search": {"checkpoint-replay", "parity", "cutover"},
    "sre-chaos": {"steady-state", "stop-condition", "recovery"},
}

ALIASES = {
    "rollback-or-forward-repair": {"rollback", "forward-repair"},
    "restore-or-failover": {"restore", "failover"},
    "compensation-or-reconcile": {"compensation", "reconciliation"},
    "stampede-or-overload": {"stampede", "overload"},
}


def split_csv(value: str) -> set[str]:
    return {item.strip() for item in value.split(",") if item.strip()}


def satisfied(requirement: str, evidence: set[str]) -> bool:
    if requirement in evidence:
        return True
    alternatives = ALIASES.get(requirement)
    return bool(alternatives and alternatives.intersection(evidence))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--surfaces", required=True, help="Comma-separated change/risk surfaces")
    parser.add_argument("--evidence", default="", help="Comma-separated evidence already obtained")
    parser.add_argument("--no-baseline", action="store_true", help="Omit generic baseline suggestions")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    surfaces = split_csv(args.surfaces)
    if not surfaces:
        parser.error("--surfaces must include at least one known surface")
    unknown_surfaces = sorted(surfaces - set(SURFACE_REQUIREMENTS))
    if unknown_surfaces:
        parser.error("unknown surfaces: " + ",".join(unknown_surfaces))
    evidence = split_csv(args.evidence)
    required = set() if args.no_baseline else set(BASELINE)
    matched = {}
    for surface in sorted(surfaces):
        req = SURFACE_REQUIREMENTS.get(surface, set())
        if req:
            matched[surface] = sorted(req)
            required.update(req)

    missing = sorted(req for req in required if not satisfied(req, evidence))
    payload = {
        "surfaces": sorted(surfaces),
        "matched_surface_requirements": matched,
        "evidence": sorted(evidence),
        "required": sorted(required),
        "missing": missing,
        "gate_passed": not missing,
        "note": "Planning aid only. Repository policy and mechanism-specific evidence override these defaults.",
    }

    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("# Engineering evidence gate")
        print("surfaces:", ", ".join(payload["surfaces"]) or "none")
        print("required:", ", ".join(payload["required"]) or "none")
        print("evidence:", ", ".join(payload["evidence"]) or "none")
        print("missing:", ", ".join(missing) or "none")
        print("status:", "PASS" if not missing else "INCOMPLETE")
        print("note:", payload["note"])
    return 0 if not missing else 1


if __name__ == "__main__":
    raise SystemExit(main())
