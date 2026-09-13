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


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("path")
    p.add_argument("--now", help="ISO timestamp for deterministic freshness checks")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()
    try:
        data = json.loads(pathlib.Path(a.path).read_text(encoding="utf-8"))
        change_identity = str(data.get("change_identity", "")).strip()
        claims = data.get("claims")
        evidence = data.get("evidence")
        if not change_identity or not isinstance(claims, list) or not claims or not isinstance(evidence, list):
            raise ValueError("require change_identity plus a non-empty claims list and an evidence list")
        now = parse_time(a.now) if a.now else dt.datetime.now(dt.timezone.utc)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    ev_by_id: dict[str, dict] = {}
    ev_problems: dict[str, list[str]] = {}
    for i, ev in enumerate(evidence, 1):
        if not isinstance(ev, dict):
            continue
        eid = str(ev.get("id", "")).strip() or f"evidence-{i}"
        problems: list[str] = []
        level = str(ev.get("level", "")).strip().lower()
        if level not in LEVELS:
            problems.append("invalid_level")
        applies = ev.get("applies_to", [])
        if not isinstance(applies, list) or change_identity not in [str(x) for x in applies]:
            problems.append("foreign_identity")
        result = str(ev.get("result", "")).strip().lower()
        if result not in {"pass", "supports"}:
            problems.append("not_supporting")
        max_age = ev.get("max_age_hours")
        observed = str(ev.get("observed_at", "")).strip()
        if max_age is not None:
            try:
                age_limit = float(max_age)
                if not math.isfinite(age_limit) or age_limit < 0:
                    problems.append("invalid_freshness")
                elif not observed:
                    problems.append("freshness_unverifiable")
                else:
                    age_hours = (now - parse_time(observed)).total_seconds() / 3600
                    if age_hours < -0.01:
                        problems.append("evidence_from_future")
                    elif age_hours > age_limit:
                        problems.append("expired")
            except (ValueError, TypeError):
                problems.append("invalid_freshness")
        ev_by_id[eid] = ev
        ev_problems[eid] = problems

    rows, blockers = [], []
    for i, claim in enumerate(claims, 1):
        if not isinstance(claim, dict):
            blockers.append(f"claim-{i}:invalid")
            continue
        cid = str(claim.get("id", "")).strip() or f"claim-{i}"
        text = str(claim.get("claim", "")).strip()
        required = str(claim.get("required_level", "focused")).strip().lower()
        refs = claim.get("evidence_ids", [])
        problems: list[str] = []
        if not text:
            problems.append("missing_claim")
        if required not in LEVELS:
            problems.append("invalid_required_level")
            required_value = 999
        else:
            required_value = LEVELS[required]
        if not isinstance(refs, list) or not refs:
            problems.append("missing_evidence")
            refs = []
        usable_levels = []
        for ref in [str(x) for x in refs]:
            if ref not in ev_by_id:
                problems.append(f"unknown_evidence:{ref}")
                continue
            if ev_problems.get(ref):
                problems.append(f"unusable_evidence:{ref}")
                continue
            usable_levels.append(LEVELS[str(ev_by_id[ref].get("level", "")).lower()])
        if usable_levels and max(usable_levels) < required_value:
            problems.append("insufficient_evidence_level")
        if not usable_levels and refs:
            problems.append("no_usable_evidence")
        if problems:
            blockers.append(cid)
        rows.append({"id": cid, "claim": text, "required_level": required, "problems": sorted(set(problems))})

    payload = {
        "change_identity": change_identity,
        "claims": rows,
        "evidence_problems": {k: v for k, v in ev_problems.items() if v},
        "gate_passed": not blockers,
        "blockers": blockers,
        "note": "Metadata gate only; evidence quality and semantic coverage still require engineering judgment.",
    }
    if a.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("# Proof bundle gate")
        for row in rows:
            suffix = f" problems={','.join(row['problems'])}" if row["problems"] else ""
            print(f"- {row['id']}: required={row['required_level']}{suffix}")
        print("status:", "PASS" if not blockers else "BLOCKED")
    return 0 if not blockers else 1


if __name__ == "__main__":
    raise SystemExit(main())
