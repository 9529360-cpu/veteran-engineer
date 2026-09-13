#!/usr/bin/env python3
"""Build a compact validation baseline from explicit engineering risk signals."""
from __future__ import annotations
import argparse, json

BASE = ["static/type/lint where repository-standard", "focused deterministic tests for changed logic"]
ROUTES = {
    "ui": (["component/browser evidence for visible flow"], ["reload/navigation/lifecycle where relevant"]),
    "api": (["API/schema contract tests", "representative caller compatibility"], ["invalid/unknown fields and old-client behavior"]),
    "auth": (["negative authorization tests"], ["privilege escalation and missing/expired credential"]),
    "tenant": (["tenant isolation tests"], ["cross-tenant identifier substitution"]),
    "database": (["integration test with real database semantics"], ["constraint violation and concurrent update"]),
    "migration": (["old/new schema compatibility", "migration resume/failure evidence"], ["partial batch and rollback/forward-repair"]),
    "queue": (["consumer integration evidence"], ["duplicate/redelivery/reorder/poison message"]),
    "concurrency": (["deterministic ordering/race test"], ["late completion and concurrent writer"]),
    "payment": (["idempotency and reconciliation evidence"], ["duplicate request and timeout-after-commit"]),
    "external": (["dependency contract/fake or sandbox evidence"], ["timeout/429/5xx/unknown outcome"]),
    "release": (["exact-artifact startup/health evidence"], ["old/new overlap and recovery path"]),
    "performance": (["same-workload baseline vs candidate"], ["p95/p99, saturation, overload/degraded mode"]),
}
ALIASES = {"db": "database", "payments": "payment", "race": "concurrency", "async": "queue"}


def split(value: str) -> list[str]:
    return [ALIASES.get(x.strip().lower(), x.strip().lower()) for x in value.split(",") if x.strip()]


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--risks", required=True)
    p.add_argument("--json", action="store_true")
    a = p.parse_args()
    risks = split(a.risks)
    required, adversarial, unmatched = list(BASE), [], []
    for risk in risks:
        route = ROUTES.get(risk)
        if not route:
            unmatched.append(risk)
            continue
        for item in route[0]:
            if item not in required: required.append(item)
        for item in route[1]:
            if item not in adversarial: adversarial.append(item)
    payload = {
        "risks": risks, "required_evidence": required, "adversarial_cases": adversarial,
        "unmatched_risks": unmatched,
        "note": "Baseline only. Remove irrelevant evidence and add repository-specific proof when the actual owner crosses another boundary.",
    }
    if a.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("# Validation plan")
        for item in required: print("required:", item)
        for item in adversarial: print("adversarial:", item)
        if unmatched: print("unmatched:", ", ".join(unmatched))
        print("note:", payload["note"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
