#!/usr/bin/env python3
"""Suggest a small set of skill references from explicit engineering signals.

This is a deterministic routing aid, not a classifier or correctness proof.
Example:
  engineering_context_router.py --signals bug,async,frontend,lifecycle
"""
from __future__ import annotations
import argparse, json

CORE = [
    "references/autonomous-repository-engineering.md",
    "references/cognitive-routing-invariant-compiler.md",
]
ROUTES = {
    "bug": ["references/decision-compression-learning-loop.md", "references/causal-debugging-experiment-design.md"],
    "fullstack": ["references/full-stack-product-engineering.md"],
    "cross-layer": ["references/full-stack-product-engineering.md"],
    "takeover": ["references/project-takeover-engineering.md"],
    "monorepo": ["references/project-takeover-engineering.md", "references/staff-engineering-execution.md"],
    "workspace": ["references/project-takeover-engineering.md"],
    "frontend": ["references/frontend-product-patterns.md"],
    "ui": ["references/frontend-product-patterns.md"],
    "ux": ["references/frontend-product-patterns.md"],
    "product-design": ["references/frontend-product-patterns.md", "references/full-stack-product-engineering.md"],
    "visual-design": ["references/frontend-product-patterns.md"],
    "interaction-design": ["references/frontend-product-patterns.md"],
    "wireframe": ["references/frontend-product-patterns.md"],
    "design-system": ["references/frontend-product-patterns.md"],
    "responsive-design": ["references/frontend-product-patterns.md"],
    "lifecycle": ["references/temporal-debugging-state-transitions.md", "references/runtime-lifecycle-patterns.md"],
    "async": ["references/temporal-debugging-state-transitions.md", "references/async-edge-job-patterns.md"],
    "concurrency": ["references/temporal-debugging-state-transitions.md", "references/causal-debugging-experiment-design.md", "references/distributed-systems-consistency.md"],
    "api": ["references/api-backend-patterns.md"],
    "auth": ["references/security-multitenancy-patterns.md"],
    "tenant": ["references/security-multitenancy-patterns.md"],
    "database": ["references/database-internals-query-engineering.md"],
    "migration": ["references/data-consistency-migration-patterns.md", "references/change-entropy-rollback-paradox.md"],
    "queue": ["references/stack-messaging-workflows.md"],
    "payment": ["references/payments-ledger-integrity.md", "references/change-entropy-rollback-paradox.md"],
    "performance": ["references/performance-scale-patterns.md"],
    "incident": ["references/incident-command-uncertainty.md"],
    "release": ["references/release-promotion-patterns.md", "references/infrastructure-deployment-patterns.md", "references/change-entropy-rollback-paradox.md", "references/operations-reliability-patterns.md"],
    "iac": ["references/infrastructure-deployment-patterns.md", "references/change-entropy-rollback-paradox.md"],
    "terraform": ["references/infrastructure-deployment-patterns.md"],
    "cloud-infra": ["references/infrastructure-deployment-patterns.md", "references/operability-control-plane-contract.md"],
    "review": ["references/code-review-patterns.md", "references/semantic-diff-behavior-change.md", "references/negative-space-patch-compression.md"],
    "refactor": ["references/architecture-refactoring-patterns.md", "references/negative-space-patch-compression.md"],
    "codemod": ["references/architecture-refactoring-patterns.md", "references/project-takeover-engineering.md"],
    "large-refactor": ["references/architecture-refactoring-patterns.md", "references/staff-engineering-execution.md"],
    "rollback": ["references/change-entropy-rollback-paradox.md"],
    "compatibility": ["references/change-entropy-rollback-paradox.md"],
    "causality": ["references/causal-debugging-experiment-design.md"],
    "semantic-diff": ["references/semantic-diff-behavior-change.md"],
    "validation": ["references/engineering-evidence-gates.md", "references/mutation-metamorphic-regression-testing.md"],
    "mutation": ["references/mutation-metamorphic-regression-testing.md"],
    "metamorphic": ["references/mutation-metamorphic-regression-testing.md"],
    "state-machine": ["references/temporal-debugging-state-transitions.md"],
    "workflow": ["references/temporal-debugging-state-transitions.md", "references/async-edge-job-patterns.md"],
    "assumption": ["references/decision-compression-learning-loop.md"],
    "evidence": ["references/proof-carrying-change-evidence.md"],
    "freshness": ["references/proof-carrying-change-evidence.md"],
    "operability": ["references/operability-control-plane-contract.md"],
    "observability": ["references/operations-reliability-patterns.md", "references/operability-control-plane-contract.md"],
    "kill-switch": ["references/operability-control-plane-contract.md"],
    "dependency": ["references/dependency-outcome-degradation.md"],
    "external": ["references/dependency-outcome-degradation.md"],
    "architecture": ["references/architecture-refactoring-patterns.md", "references/architecture-fitness-assumption-decay.md"],
    "architecture-fitness": ["references/architecture-fitness-assumption-decay.md"],
    "fitness": ["references/architecture-fitness-assumption-decay.md"],
    "delivery": ["references/full-stack-product-engineering.md"],
    "feature": ["references/full-stack-product-engineering.md"],
    "closure": ["references/full-stack-product-engineering.md", "references/lifecycle-closure-design-to-deletion.md"],
    "deletion": ["references/lifecycle-closure-design-to-deletion.md"],
    "multi-repo": ["references/cross-repo-contract-mesh.md", "references/staff-engineering-execution.md"],
    "cross-repo": ["references/cross-repo-contract-mesh.md", "references/staff-engineering-execution.md"],
    "requirements": ["references/full-stack-product-engineering.md"],
    "scope": ["references/full-stack-product-engineering.md"],
    "navigation": ["references/project-takeover-engineering.md"],
    "search": ["references/project-takeover-engineering.md"],
    "generated": ["references/project-takeover-engineering.md", "references/semantic-diff-behavior-change.md"],
    "codegen": ["references/project-takeover-engineering.md", "references/cross-repo-contract-mesh.md"],
    "final-review": ["references/code-review-patterns.md"],
    "audit": ["references/code-review-patterns.md"],
    "broker": ["references/stack-messaging-workflows.md"],
    "distributed-transaction": ["references/distributed-systems-consistency.md"],
    "storage-engine": ["references/database-internals-query-engineering.md"],
    "profiling": ["references/performance-scale-patterns.md", "references/kernel-io-numa-runtime.md"],
    "chaos": ["references/operations-reliability-patterns.md"],
    "error-budget": ["references/operations-reliability-patterns.md"],
    "modernization": ["references/architecture-fitness-assumption-decay.md", "references/architecture-refactoring-patterns.md"],
    "simplification": ["references/lifecycle-closure-design-to-deletion.md"],
    "system-rescue": ["references/project-takeover-engineering.md"],
}
ALIASES = {"publish": "release", "publishing": "release", "github-release": "release", "release-tag": "release", "autopublish": "release", "auto-publish": "release", "deployment": "release", "deploy": "release", "monorepository": "monorepo", "workspaces": "workspace", "ast-refactor": "codemod", "mass-refactor": "large-refactor", "infrastructure-as-code": "iac", "opentofu": "terraform", "pulumi": "iac", "full-stack": "fullstack", "full_stack": "fullstack", "crosslayer": "cross-layer", "vertical-slice": "delivery", "end-to-end": "delivery", "requirement": "requirements", "repo-search": "navigation", "code-search": "navigation", "generated-code": "generated", "code-generation": "codegen", "final-audit": "final-review", "db": "database", "payments": "payment", "jobs": "queue", "race": "concurrency", "cause": "causality", "fsm": "state-machine", "state": "state-machine", "test": "validation", "tests": "validation", "proof": "evidence", "provider": "dependency", "vendor": "dependency", "retire": "deletion", "multirepo": "multi-repo", "kafka": "broker", "rabbitmq": "broker", "2pc": "distributed-transaction", "saga": "distributed-transaction", "ebpf": "profiling", "bpftrace": "profiling", "slo": "error-budget", "decommission": "simplification", "rescue": "system-rescue", "interface-design": "ui", "ui-design": "ui", "screen-design": "ui", "ux-design": "ux", "product-designer": "product-design", "design-tokens": "design-system", "responsive-ui": "responsive-design"}

def split_csv(value: str) -> list[str]:
    out = []
    for item in value.split(","):
        item = item.strip().lower()
        if item:
            out.append(ALIASES.get(item, item))
    return out

def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--signals", required=True, help="Comma-separated explicit task/mechanism/risk signals")
    p.add_argument("--max", type=int, default=7, dest="max_refs")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()
    signals = split_csv(a.signals)
    refs, reasons = [], {}
    def add(ref: str, why: str) -> None:
        if ref not in refs:
            refs.append(ref)
            reasons.setdefault(ref, []).append(why)
        elif why not in reasons[ref]:
            reasons[ref].append(why)
    for ref in CORE:
        add(ref, "core")
    unmatched = []
    for signal in signals:
        routed = ROUTES.get(signal)
        if not routed:
            unmatched.append(signal)
            continue
        for ref in routed:
            add(ref, signal)
    limit = max(1, a.max_refs)
    selected = refs[:limit]
    payload = {
        "signals": signals,
        "references": [{"path": r, "reasons": reasons[r]} for r in selected],
        "unmatched_signals": unmatched,
        "truncated": len(refs) > limit,
        "note": "Routing aid only. Add or replace references when repository evidence crosses a different mechanism boundary.",
    }
    if a.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("# Engineering context route")
        print("signals:", ", ".join(signals) or "none")
        for item in payload["references"]:
            print(f"- {item['path']} [{','.join(item['reasons'])}]")
        if unmatched:
            print("unmatched:", ", ".join(unmatched))
        if payload["truncated"]:
            print("note: recommendations truncated; re-route after new evidence")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
