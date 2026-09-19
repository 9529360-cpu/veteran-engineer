#!/usr/bin/env python3
"""Validate a capability-aware execution envelope.

This gate checks that an engineering plan does not claim evidence that the current
host cannot actually produce. It does not discover tools, grant authorization, or
decide whether an action is advisable.

Manifest shape:
{
  "capabilities": [
    {"id": "source-read", "state": "available", "evidence": "local checkout + search"},
    {"id": "browser-render", "state": "unavailable", "evidence": "no browser/render tool exposed"}
  ],
  "requirements": [
    {
      "claim": "visible UI acceptance",
      "requires_any": ["browser-render"],
      "disposition": "degraded",
      "fallback": "run component/integration checks and report rendered QA as unproven"
    }
  ]
}
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

CAPABILITY_STATES = {"available", "unavailable", "unknown"}
DISPOSITIONS = {"supported", "degraded", "blocked", "deferred", "not-needed"}

# Stable, host-neutral capability classes. Hosts may have several concrete tools
# behind one class; the manifest should record the actual evidence in `evidence`.
KNOWN_CAPABILITIES = {
    "source-read",
    "source-write",
    "history-search",
    "terminal-process",
    "browser-render",
    "desktop-gui",
    "remote-repository",
    "ci-workflow",
    "network-web",
    "design-canvas",
    "database-runtime",
    "observability",
    "cloud-runtime",
    "deployment-mutation",
    "durable-background",
    "external-credentials",
}


def nonempty(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def string_list(value) -> bool:
    return isinstance(value, list) and all(nonempty(item) for item in value)


def add(blockers, code, path, message):
    blockers.append({"code": code, "path": path, "message": message})


def load(path: str):
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return None, [{"code": "MANIFEST_UNREADABLE", "path": path, "message": str(exc)}]
    if not isinstance(value, dict):
        return None, [{"code": "MANIFEST_OBJECT_REQUIRED", "path": "$", "message": "manifest must be a JSON object"}]
    return value, []


def envelope_hash(capabilities: dict[str, dict]) -> str:
    normalized = [
        {
            "id": cid,
            "state": capabilities[cid]["state"],
            "evidence": capabilities[cid]["evidence"].strip(),
        }
        for cid in sorted(capabilities)
    ]
    raw = json.dumps(normalized, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def validate(doc: dict) -> dict:
    blockers = []
    raw_caps = doc.get("capabilities")
    if not isinstance(raw_caps, list) or not raw_caps:
        add(blockers, "CAPABILITIES_REQUIRED", "capabilities", "record at least one observed host capability")
        raw_caps = []

    capabilities: dict[str, dict] = {}
    for index, item in enumerate(raw_caps):
        path = f"capabilities[{index}]"
        if not isinstance(item, dict):
            add(blockers, "CAPABILITY_OBJECT_REQUIRED", path, "capability must be an object")
            continue
        cid = item.get("id")
        if not nonempty(cid):
            add(blockers, "CAPABILITY_ID_REQUIRED", f"{path}.id", "capability id is required")
            continue
        cid = cid.strip()
        if cid not in KNOWN_CAPABILITIES:
            add(blockers, "CAPABILITY_ID_UNKNOWN", f"{path}.id", f"unknown capability class: {cid}")
        if cid in capabilities:
            add(blockers, "CAPABILITY_ID_DUPLICATE", f"{path}.id", f"duplicate capability id: {cid}")
            continue
        state = item.get("state")
        if state not in CAPABILITY_STATES:
            add(blockers, "CAPABILITY_STATE_INVALID", f"{path}.state", f"state must be one of: {', '.join(sorted(CAPABILITY_STATES))}")
        if not nonempty(item.get("evidence")):
            add(blockers, "CAPABILITY_EVIDENCE_REQUIRED", f"{path}.evidence", "record how this capability state was established")
        capabilities[cid] = {
            "state": state,
            "evidence": item.get("evidence") if nonempty(item.get("evidence")) else "",
        }

    requirements = doc.get("requirements")
    if not isinstance(requirements, list) or not requirements:
        add(blockers, "REQUIREMENTS_REQUIRED", "requirements", "record at least one evidence or execution requirement")
        requirements = []

    supported = degraded = blocked = deferred = 0
    for index, item in enumerate(requirements):
        path = f"requirements[{index}]"
        if not isinstance(item, dict):
            add(blockers, "REQUIREMENT_OBJECT_REQUIRED", path, "requirement must be an object")
            continue
        if not nonempty(item.get("claim")):
            add(blockers, "REQUIREMENT_CLAIM_REQUIRED", f"{path}.claim", "claim is required")
        required = item.get("requires_any")
        if not string_list(required) or not required:
            add(blockers, "REQUIREMENT_CAPABILITIES_REQUIRED", f"{path}.requires_any", "requires_any must contain one or more capability ids")
            required = []
        unknown_ids = [cid for cid in required if cid not in capabilities]
        if unknown_ids:
            add(blockers, "REQUIREMENT_CAPABILITY_UNOBSERVED", f"{path}.requires_any", "required capability was not recorded in the execution envelope: " + ", ".join(sorted(set(unknown_ids))))

        disposition = item.get("disposition")
        if disposition not in DISPOSITIONS:
            add(blockers, "REQUIREMENT_DISPOSITION_INVALID", f"{path}.disposition", f"disposition must be one of: {', '.join(sorted(DISPOSITIONS))}")
            continue

        available = [cid for cid in required if capabilities.get(cid, {}).get("state") == "available"]
        if disposition == "supported":
            supported += 1
            if required and not available:
                add(blockers, "UNSUPPORTED_CLAIM", path, "disposition=supported but none of requires_any is currently available")
        elif disposition == "degraded":
            degraded += 1
            if available:
                # Degraded can still be intentional for another reason, but make the
                # reason explicit so capability availability is not blamed falsely.
                if not nonempty(item.get("reason")):
                    add(blockers, "DEGRADED_REASON_REQUIRED", f"{path}.reason", "a required capability is available; explain why this claim remains degraded")
            if not nonempty(item.get("fallback")):
                add(blockers, "FALLBACK_REQUIRED", f"{path}.fallback", "degraded claims require the strongest honest fallback")
        elif disposition == "blocked":
            blocked += 1
            if not nonempty(item.get("reason")):
                add(blockers, "BLOCK_REASON_REQUIRED", f"{path}.reason", "blocked claims require a reason")
        elif disposition == "deferred":
            deferred += 1
            if not nonempty(item.get("reason")):
                add(blockers, "DEFER_REASON_REQUIRED", f"{path}.reason", "deferred claims require a reason")

    result = {
        "gate_passed": not blockers,
        "envelope_hash": envelope_hash(capabilities) if capabilities else None,
        "counts": {
            "capabilities": len(capabilities),
            "available": sum(1 for item in capabilities.values() if item["state"] == "available"),
            "unknown": sum(1 for item in capabilities.values() if item["state"] == "unknown"),
            "requirements": len(requirements),
            "supported": supported,
            "degraded": degraded,
            "blocked": blocked,
            "deferred": deferred,
        },
        "blockers": blockers,
        "note": (
            "Capability evidence is not authorization. This gate checks whether the host can produce the planned evidence; "
            "user/platform/repository authorization and engineering advisability remain separate decisions."
        ),
    }
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a capability-aware engineering execution envelope")
    parser.add_argument("manifest")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    doc, blockers = load(args.manifest)
    if doc is None:
        result = {
            "gate_passed": False,
            "envelope_hash": None,
            "counts": {"capabilities": 0, "available": 0, "unknown": 0, "requirements": 0, "supported": 0, "degraded": 0, "blocked": 0, "deferred": 0},
            "blockers": blockers,
            "note": "Capability evidence is not authorization.",
        }
    else:
        result = validate(doc)

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print("PASS" if result["gate_passed"] else "FAIL")
        print(
            f"capabilities={result['counts']['capabilities']} available={result['counts']['available']} "
            f"requirements={result['counts']['requirements']} degraded={result['counts']['degraded']}"
        )
        for item in result["blockers"]:
            print(f"- {item['code']} {item['path']}: {item['message']}")
        print("note:", result["note"])
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
