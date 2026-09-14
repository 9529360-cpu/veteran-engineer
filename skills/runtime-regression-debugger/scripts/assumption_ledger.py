#!/usr/bin/env python3
"""Gate unresolved decision-sensitive assumptions in a task-local JSON ledger."""
from __future__ import annotations
import argparse, json, pathlib, sys
from proof_bundle_gate import parse_time, validate_bundle

VALID = {"proven", "refuted", "unknown"}


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("path")
    p.add_argument("--proof-bundle")
    p.add_argument("--now", help="ISO timestamp passed to proof-bundle freshness checks")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()
    try:
        data = json.loads(pathlib.Path(a.path).read_text(encoding="utf-8"))
        assumptions = data.get("assumptions")
        if not isinstance(assumptions, list):
            raise ValueError("top-level assumptions must be a list")
        now = parse_time(a.now) if a.now else None
        proof_payload = None
        if a.proof_bundle:
            proof_data = json.loads(pathlib.Path(a.proof_bundle).read_text(encoding="utf-8"))
            proof_payload = validate_bundle(proof_data, now=now)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    change_identity = str(data.get("change_identity", "")).strip()
    proof_claims = {row["id"]: row for row in (proof_payload or {}).get("claims", [])}
    proof_identity = str((proof_payload or {}).get("change_identity", "")).strip()
    rows, blockers = [], []
    for i, item in enumerate(assumptions, 1):
        if not isinstance(item, dict):
            rows.append({"index": i, "status": "invalid"})
            blockers.append(f"assumption-{i}:invalid")
            continue
        text = str(item.get("assumption", "")).strip()
        status = str(item.get("status", "unknown")).strip().lower()
        raw_sensitive = item.get("decision_sensitive", False)
        sensitive = raw_sensitive if isinstance(raw_sensitive, bool) else False
        evidence = item.get("evidence", [])
        falsifier = str(item.get("falsifier", "")).strip()
        proof_claim_id = str(item.get("proof_claim_id", "")).strip()
        problems = []
        if not text:
            problems.append("missing_assumption")
        if status not in VALID:
            problems.append("invalid_status")
        if not isinstance(raw_sensitive, bool):
            problems.append("invalid_decision_sensitive")
        if status == "proven" and not sensitive and not (isinstance(evidence, list) and evidence):
            problems.append("proven_without_evidence")
        if sensitive and status == "unknown":
            problems.append("decision_sensitive_unknown")
        if sensitive and not falsifier and status != "proven":
            problems.append("missing_falsifier")
        if sensitive and status in {"proven", "refuted"}:
            if not proof_claim_id:
                problems.append("missing_proof_claim")
            if proof_payload is None:
                problems.append("missing_proof_bundle")
            if not change_identity:
                problems.append("missing_change_identity")
            elif proof_payload is not None and change_identity != proof_identity:
                problems.append("proof_identity_mismatch")
            if proof_payload is not None and proof_claim_id:
                claim = proof_claims.get(proof_claim_id)
                if claim is None:
                    problems.append("unknown_proof_claim")
                elif claim.get("problems"):
                    problems.append("unusable_proof_claim")
        if problems:
            blockers.append(text or f"assumption-{i}")
        rows.append({
            "assumption": text,
            "status": status,
            "decision_sensitive": sensitive,
            "proof_claim_id": proof_claim_id or None,
            "problems": problems,
        })
    payload = {
        "change_identity": change_identity or None,
        "proof_change_identity": proof_identity or None,
        "proof_bundle_gate_passed": None if proof_payload is None else proof_payload["gate_passed"],
        "assumptions": rows,
        "gate_passed": not blockers,
        "blockers": blockers,
        "note": "Task-local reasoning aid; decision-sensitive proven or refuted assumptions must reference a usable claim from the current proof bundle. No persistence is required or implied.",
    }
    if a.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("# Assumption ledger")
        for row in rows:
            suffix = f" problems={','.join(row['problems'])}" if row["problems"] else ""
            print(f"- {row['assumption'] or 'unnamed'}: {row['status']}" + suffix)
        print("status:", "PASS" if not blockers else "BLOCKED")
    return 0 if not blockers else 1


if __name__ == "__main__":
    raise SystemExit(main())
