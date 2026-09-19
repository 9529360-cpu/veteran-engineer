#!/usr/bin/env python3
"""Validate declared engineering claims against scoped, fresh evidence metadata.

This script validates metadata only; it cannot determine whether the underlying
observation is truthful or semantically sufficient.
"""
from __future__ import annotations
import argparse, datetime as dt, json, math, pathlib, sys

LEVELS = {
    "implemented": 0,
    "focused": 1,
    "integration": 2,
    "end-to-end": 3,
    "release-candidate": 4,
    "production": 5,
}


def parse_time(value: str) -> dt.datetime:
    value = value.strip().replace("Z", "+00:00")
    parsed = dt.datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def require_nonempty_string(value, path: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{path} must be a non-empty string")
    return value.strip()


def resolved_id(row: dict, index: int, prefix: str) -> str:
    if "id" not in row:
        return f"{prefix}-{index}"
    return require_nonempty_string(row.get("id"), f"{prefix}[{index - 1}].id")


def optional_string_list(row: dict, key: str, path: str) -> list[str]:
    value = row.get(key, [])
    if not isinstance(value, list):
        raise ValueError(f"{path} must be a string list")
    result = []
    for index, item in enumerate(value):
        result.append(require_nonempty_string(item, f"{path}[{index}]"))
    return result



def optional_string_map(value, path: str) -> dict[str, str]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError(f"{path} must be an object of non-empty string identities")
    out: dict[str, str] = {}
    for key, item in value.items():
        clean_key = require_nonempty_string(key, f"{path}.<key>")
        out[clean_key] = require_nonempty_string(item, f"{path}.{clean_key}")
    return out

def validate_bundle(data: dict, *, now: dt.datetime | None = None) -> dict:
    """Return the proof-bundle verdict without duplicating CLI freshness logic."""
    if not isinstance(data, dict):
        raise ValueError("proof bundle root must be an object")
    change_identity = require_nonempty_string(data.get("change_identity"), "change_identity")
    claims = data.get("claims")
    evidence = data.get("evidence")
    current_bindings = optional_string_map(data.get("current_bindings"), "current_bindings")
    if not isinstance(claims, list) or not claims or not isinstance(evidence, list):
        raise ValueError("require a non-empty claims list and an evidence list")
    now = (now or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc)

    ev_by_id: dict[str, dict] = {}
    ev_problems: dict[str, list[str]] = {}
    ev_levels: dict[str, str] = {}
    seen_evidence_ids: set[str] = set()
    for i, ev in enumerate(evidence, 1):
        if not isinstance(ev, dict):
            raise ValueError(f"evidence[{i - 1}] must be an object")
        eid = resolved_id(ev, i, "evidence")
        if eid in seen_evidence_ids:
            raise ValueError(f"duplicate evidence id: {eid}")
        seen_evidence_ids.add(eid)
        problems: list[str] = []
        level_value = ev.get("level", "")
        level = level_value.strip().lower() if isinstance(level_value, str) else ""
        if level not in LEVELS:
            problems.append("invalid_level")
        applies = optional_string_list(ev, "applies_to", f"evidence[{i - 1}].applies_to")
        if change_identity not in applies:
            problems.append("foreign_identity")
        result_value = ev.get("result", "")
        result = result_value.strip().lower() if isinstance(result_value, str) else ""
        if result not in {"pass", "supports"}:
            problems.append("not_supporting")
        freshness_bindings = optional_string_map(
            ev.get("freshness_bindings"),
            f"evidence[{i - 1}].freshness_bindings",
        )
        for binding_key, expected_identity in freshness_bindings.items():
            current_identity = current_bindings.get(binding_key)
            if current_identity is None:
                problems.append(f"freshness_unverifiable:{binding_key}")
            elif current_identity != expected_identity:
                problems.append(f"stale_identity:{binding_key}")
        max_age = ev.get("max_age_hours")
        observed_value = ev.get("observed_at")
        if max_age is not None:
            if isinstance(max_age, bool) or not isinstance(max_age, (int, float)):
                raise ValueError(f"evidence[{i - 1}].max_age_hours must be a finite non-negative number")
            age_limit = float(max_age)
            if not math.isfinite(age_limit) or age_limit < 0:
                problems.append("invalid_freshness")
            elif observed_value is None or (isinstance(observed_value, str) and not observed_value.strip()):
                problems.append("freshness_unverifiable")
            elif not isinstance(observed_value, str):
                raise ValueError(f"evidence[{i - 1}].observed_at must be a timestamp string when max_age_hours is set")
            else:
                try:
                    age_hours = (now - parse_time(observed_value)).total_seconds() / 3600
                    if age_hours < -0.01:
                        problems.append("evidence_from_future")
                    elif age_hours > age_limit:
                        problems.append("expired")
                except (ValueError, TypeError):
                    problems.append("invalid_freshness")
        ev_by_id[eid] = ev
        ev_levels[eid] = level
        ev_problems[eid] = problems

    rows, blockers = [], []
    seen_claim_ids: set[str] = set()
    for i, claim in enumerate(claims, 1):
        if not isinstance(claim, dict):
            raise ValueError(f"claims[{i - 1}] must be an object")
        cid = resolved_id(claim, i, "claim")
        if cid in seen_claim_ids:
            raise ValueError(f"duplicate claim id: {cid}")
        seen_claim_ids.add(cid)
        text_value = claim.get("claim")
        text = text_value.strip() if isinstance(text_value, str) else ""
        required_value_raw = claim.get("required_level", "focused")
        required = required_value_raw.strip().lower() if isinstance(required_value_raw, str) else ""
        refs = optional_string_list(claim, "evidence_ids", f"claims[{i - 1}].evidence_ids")
        problems: list[str] = []
        if not text:
            problems.append("missing_claim")
        if required not in LEVELS:
            problems.append("invalid_required_level")
            required_value = 999
        else:
            required_value = LEVELS[required]
        if not refs:
            problems.append("missing_evidence")
        usable_levels = []
        for ref in refs:
            if ref not in ev_by_id:
                problems.append(f"unknown_evidence:{ref}")
                continue
            if ev_problems.get(ref):
                problems.append(f"unusable_evidence:{ref}")
                continue
            usable_levels.append(LEVELS[ev_levels[ref]])
        if usable_levels and max(usable_levels) < required_value:
            problems.append("insufficient_evidence_level")
        if not usable_levels and refs:
            problems.append("no_usable_evidence")
        if problems:
            blockers.append(cid)
        rows.append({"id": cid, "claim": text, "required_level": required, "problems": sorted(set(problems))})

    return {
        "change_identity": change_identity,
        "current_bindings": current_bindings,
        "claims": rows,
        "evidence_problems": {k: v for k, v in ev_problems.items() if v},
        "gate_passed": not blockers,
        "blockers": blockers,
        "note": "Metadata gate only; evidence quality and semantic coverage still require engineering judgment.",
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("path")
    p.add_argument("--now", help="ISO timestamp for deterministic freshness checks")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()
    try:
        data = json.loads(pathlib.Path(a.path).read_text(encoding="utf-8"))
        now = parse_time(a.now) if a.now else None
        payload = validate_bundle(data, now=now)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if a.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("# Proof bundle gate")
        for row in payload["claims"]:
            suffix = f" problems={','.join(row['problems'])}" if row["problems"] else ""
            print(f"- {row['id']}: required={row['required_level']}{suffix}")
        print("status:", "PASS" if payload["gate_passed"] else "BLOCKED")
    return 0 if payload["gate_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
