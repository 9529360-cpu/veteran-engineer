#!/usr/bin/env python3
"""Validate a structured Product Analysis evidence/claim manifest.

The gate enforces evidence provenance and claim classification. It does not judge
whether a product conclusion is substantively correct.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
from typing import Any

ALLOWED_STATUSES = {"observed", "inferred", "unknown"}
ALLOWED_CONFIDENCE = {"high", "medium", "low"}
ALLOWED_EVIDENCE_KINDS = {
    "screenshot",
    "dom",
    "accessibility",
    "interaction",
    "network",
    "documentation",
    "source",
    "manual-observation",
}


def non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def load_payload(path: pathlib.Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("manifest root must be an object")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=pathlib.Path)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    blockers: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    try:
        payload = load_payload(args.manifest)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        result = {
            "gate_passed": False,
            "blockers": [{"code": "MANIFEST_INVALID", "detail": str(exc)}],
            "warnings": [],
        }
        print(json.dumps(result, indent=2, sort_keys=True) if args.json else "FAIL MANIFEST_INVALID")
        return 1

    target = payload.get("target")
    if not isinstance(target, dict):
        blockers.append({"code": "TARGET_REQUIRED"})
    else:
        if not non_empty_string(target.get("name")):
            blockers.append({"code": "TARGET_NAME_REQUIRED"})
        if not non_empty_string(target.get("question")):
            blockers.append({"code": "TARGET_QUESTION_REQUIRED"})
        if not non_empty_string(target.get("scope")):
            blockers.append({"code": "TARGET_SCOPE_REQUIRED"})

    evidence = payload.get("evidence")
    if not isinstance(evidence, list):
        blockers.append({"code": "EVIDENCE_ARRAY_REQUIRED"})
        evidence = []

    evidence_ids: set[str] = set()
    for index, item in enumerate(evidence):
        if not isinstance(item, dict):
            blockers.append({"code": "EVIDENCE_ITEM_INVALID", "index": index})
            continue
        evidence_id = item.get("id")
        if not non_empty_string(evidence_id):
            blockers.append({"code": "EVIDENCE_ID_REQUIRED", "index": index})
            continue
        if evidence_id in evidence_ids:
            blockers.append({"code": "EVIDENCE_ID_DUPLICATE", "id": evidence_id})
        evidence_ids.add(evidence_id)
        kind = item.get("kind")
        if kind not in ALLOWED_EVIDENCE_KINDS:
            blockers.append({"code": "EVIDENCE_KIND_INVALID", "id": evidence_id, "kind": kind})
        if not non_empty_string(item.get("summary")):
            blockers.append({"code": "EVIDENCE_SUMMARY_REQUIRED", "id": evidence_id})

    claims = payload.get("claims")
    if not isinstance(claims, list) or not claims:
        blockers.append({"code": "CLAIMS_REQUIRED"})
        claims = []

    claim_ids: set[str] = set()
    for index, claim in enumerate(claims):
        if not isinstance(claim, dict):
            blockers.append({"code": "CLAIM_ITEM_INVALID", "index": index})
            continue

        claim_id = claim.get("id")
        if not non_empty_string(claim_id):
            blockers.append({"code": "CLAIM_ID_REQUIRED", "index": index})
            claim_id = f"index:{index}"
        elif claim_id in claim_ids:
            blockers.append({"code": "CLAIM_ID_DUPLICATE", "id": claim_id})
        else:
            claim_ids.add(claim_id)

        if not non_empty_string(claim.get("statement")):
            blockers.append({"code": "CLAIM_STATEMENT_REQUIRED", "id": claim_id})

        status = claim.get("status")
        if status not in ALLOWED_STATUSES:
            blockers.append({"code": "CLAIM_STATUS_INVALID", "id": claim_id, "status": status})
            continue

        confidence = claim.get("confidence")
        if confidence is not None and confidence not in ALLOWED_CONFIDENCE:
            blockers.append({"code": "CLAIM_CONFIDENCE_INVALID", "id": claim_id, "confidence": confidence})

        refs = claim.get("evidence_ids", [])
        if not isinstance(refs, list) or any(not non_empty_string(ref) for ref in refs):
            blockers.append({"code": "CLAIM_EVIDENCE_IDS_INVALID", "id": claim_id})
            refs = []

        missing = sorted({ref for ref in refs if ref not in evidence_ids})
        if missing:
            blockers.append({"code": "CLAIM_EVIDENCE_MISSING", "id": claim_id, "evidence_ids": missing})

        if status == "observed" and not refs:
            blockers.append({"code": "OBSERVED_CLAIM_REQUIRES_EVIDENCE", "id": claim_id})

        if status == "inferred":
            if not refs:
                blockers.append({"code": "INFERRED_CLAIM_REQUIRES_EVIDENCE", "id": claim_id})
            if not non_empty_string(claim.get("rationale")):
                blockers.append({"code": "INFERRED_CLAIM_REQUIRES_RATIONALE", "id": claim_id})
            if not non_empty_string(claim.get("falsifier")):
                blockers.append({"code": "INFERRED_CLAIM_REQUIRES_FALSIFIER", "id": claim_id})

        if status == "unknown" and confidence == "high":
            warnings.append({"code": "UNKNOWN_HIGH_CONFIDENCE", "id": claim_id})

    result = {
        "gate_passed": not blockers,
        "counts": {
            "evidence": len(evidence),
            "claims": len(claims),
            "observed": sum(1 for claim in claims if isinstance(claim, dict) and claim.get("status") == "observed"),
            "inferred": sum(1 for claim in claims if isinstance(claim, dict) and claim.get("status") == "inferred"),
            "unknown": sum(1 for claim in claims if isinstance(claim, dict) and claim.get("status") == "unknown"),
        },
        "blockers": blockers,
        "warnings": warnings,
        "note": "This gate validates evidence discipline, not substantive truth of the analysis.",
    }

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print("PASS" if result["gate_passed"] else "FAIL")
        for blocker in blockers:
            print(f"- {blocker['code']}: {json.dumps(blocker, sort_keys=True)}")
        for warning in warnings:
            print(f"- warning {warning['code']}: {json.dumps(warning, sort_keys=True)}")

    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
