#!/usr/bin/env python3
"""Compare an explicit before/after semantic manifest and flag risky deltas."""
from __future__ import annotations
import argparse, json, pathlib, sys

FIELDS = {
    "state_writers": "high",
    "durable_effects": "high",
    "public_contracts": "high",
    "authz_guards": "critical",
    "background_triggers": "moderate",
    "deploy_units": "moderate",
}
SEVERITY = {"moderate": 1, "high": 2, "critical": 3}


def values(obj: dict, field: str) -> set[str]:
    raw = obj.get(field, [])
    if not isinstance(raw, list):
        raise ValueError(f"{field} must be a list")
    return {str(x).strip() for x in raw if str(x).strip()}


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("path")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()
    try:
        data = json.loads(pathlib.Path(a.path).read_text(encoding="utf-8"))
        before, after = data["before"], data["after"]
        if not isinstance(before, dict) or not isinstance(after, dict):
            raise ValueError("before/after must be objects")
        findings = []
        for field, severity in FIELDS.items():
            b, n = values(before, field), values(after, field)
            added, removed = sorted(n - b), sorted(b - n)
            if added:
                findings.append({"field": field, "kind": "added", "items": added, "severity": severity})
            if removed:
                sev = "critical" if field == "authz_guards" else severity
                findings.append({"field": field, "kind": "removed", "items": removed, "severity": sev})
    except (OSError, json.JSONDecodeError, KeyError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    max_sev = max((SEVERITY[f["severity"]] for f in findings), default=0)
    band = "none" if max_sev == 0 else {1: "moderate", 2: "high", 3: "critical"}[max_sev]
    payload = {"semantic_deltas": findings, "risk_band": band, "note": "Input must be derived from repository/runtime evidence; this script does not infer semantics from source."}
    if a.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("# Semantic change gate")
        print("risk:", band)
        for f in findings:
            print(f"- {f['severity']} {f['field']} {f['kind']}: {', '.join(f['items'])}")
        print("note:", payload["note"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
