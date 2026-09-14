#!/usr/bin/env python3
"""Rank explicit diagnostic probes by discriminating power versus cost/risk.

Input JSON:
{
  "hypotheses": [{"id":"h1"}, {"id":"h2"}],
  "probes": [{"id":"p1","cost":1,"blast_radius":0,
              "irreversible":false,"production_wide":false,
              "predictions":{"h1":"yes","h2":"no"}}]
}

Irreversible or production-wide probes are scored for comparison but are kept out
of the ordinary diagnostic ranking. They require separate authorization and an
explicit action threshold; information gain alone never makes them the default
recommended diagnostic action.
"""
from __future__ import annotations

import argparse
import itertools
import json
import math
import pathlib
import sys


def number_field(probe: dict, field: str, default: float) -> float:
    value = probe.get(field, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"probe {probe.get('id', '?')}: {field} must be a finite non-negative number")
    numeric = float(value)
    if not math.isfinite(numeric) or numeric < 0:
        raise ValueError(f"probe {probe.get('id', '?')}: {field} must be a finite non-negative number")
    return numeric


def bool_field(probe: dict, field: str, default: bool = False) -> bool:
    value = probe.get(field, default)
    if not isinstance(value, bool):
        raise ValueError(f"probe {probe.get('id', '?')}: {field} must be a boolean")
    return value


def load_manifest(path: pathlib.Path) -> tuple[list[str], list[dict]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read manifest: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("manifest root must be an object")

    hypotheses = data.get("hypotheses")
    probes = data.get("probes")
    if not isinstance(hypotheses, list) or len(hypotheses) < 2 or not isinstance(probes, list) or not probes:
        raise ValueError("require at least two hypotheses and one probe")

    ids = [str(h.get("id", "")).strip() for h in hypotheses if isinstance(h, dict)]
    if len(ids) != len(hypotheses) or any(not value for value in ids) or len(set(ids)) != len(ids):
        raise ValueError("hypothesis ids must be unique non-empty strings")

    normalized: list[dict] = []
    probe_ids: set[str] = set()
    hypothesis_ids = set(ids)
    for index, raw in enumerate(probes, 1):
        if not isinstance(raw, dict):
            raise ValueError(f"probe #{index} must be an object")
        probe_id = str(raw.get("id", "")).strip()
        if not probe_id:
            raise ValueError(f"probe #{index} needs a non-empty id")
        if probe_id in probe_ids:
            raise ValueError(f"duplicate probe id: {probe_id}")
        probe_ids.add(probe_id)

        predictions = raw.get("predictions")
        if not isinstance(predictions, dict):
            raise ValueError(f"probe {probe_id}: predictions must be an object")
        unknown = sorted(str(key) for key in predictions if str(key) not in hypothesis_ids)
        if unknown:
            raise ValueError(f"probe {probe_id}: predictions reference unknown hypotheses: {', '.join(unknown)}")

        cost = number_field(raw, "cost", 1.0)
        blast = number_field(raw, "blast_radius", 0.0)
        irreversible = bool_field(raw, "irreversible")
        production_wide = bool_field(raw, "production_wide")
        normalized.append({
            **raw,
            "id": probe_id,
            "predictions": predictions,
            "cost": cost,
            "blast_radius": blast,
            "irreversible": irreversible,
            "production_wide": production_wide,
        })
    return ids, normalized


def score_probe(probe: dict, ids: list[str], total_pairs: int) -> dict:
    predictions = probe["predictions"]
    distinguished = 0
    covered_pairs = 0
    for left, right in itertools.combinations(ids, 2):
        if left in predictions and right in predictions:
            covered_pairs += 1
            if str(predictions[left]) != str(predictions[right]):
                distinguished += 1

    coverage = covered_pairs / total_pairs if total_pairs else 0.0
    discrimination = distinguished / total_pairs if total_pairs else 0.0
    score = round(discrimination * 100 + coverage * 10 - probe["cost"] * 3 - probe["blast_radius"] * 8, 2)
    risk_reasons = []
    if probe["irreversible"]:
        risk_reasons.append("irreversible")
    if probe["production_wide"]:
        risk_reasons.append("production_wide")
    escalation_only = bool(risk_reasons)
    return {
        "id": probe["id"],
        "score": score,
        "distinguished_pairs": distinguished,
        "total_pairs": total_pairs,
        "coverage": round(coverage, 3),
        "cost": probe["cost"],
        "blast_radius": probe["blast_radius"],
        "irreversible": probe["irreversible"],
        "production_wide": probe["production_wide"],
        "risk_reasons": risk_reasons,
        "admissibility": "escalation-only" if escalation_only else "ordinary-diagnostic",
    }


def sort_key(item: dict) -> tuple:
    return (-item["score"], item["cost"], item["blast_radius"], str(item["id"]))


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("path")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()
    try:
        ids, probes = load_manifest(pathlib.Path(a.path))
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    total_pairs = len(list(itertools.combinations(ids, 2)))
    scored = [score_probe(probe, ids, total_pairs) for probe in probes]
    ranked = sorted((item for item in scored if item["admissibility"] == "ordinary-diagnostic"), key=sort_key)
    escalation_only = sorted((item for item in scored if item["admissibility"] == "escalation-only"), key=sort_key)
    recommended = ranked[0]["id"] if ranked else None
    status = "ready" if ranked else "blocked-no-reversible-bounded-probe"

    payload = {
        "ranked_probes": ranked,
        "escalation_only_probes": escalation_only,
        "recommended_probe": recommended,
        "status": status,
        "note": (
            "Ranking uses declared predictions only. Irreversible or production-wide probes are never "
            "ordinary recommendations; they require separate authorization and action-threshold judgment."
        ),
    }
    if a.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("# Causal discriminator")
        for item in ranked:
            print(
                f"- {item['id']}: score={item['score']} "
                f"distinguished={item['distinguished_pairs']}/{item['total_pairs']} "
                f"coverage={item['coverage']}"
            )
        for item in escalation_only:
            print(
                f"- escalation-only {item['id']}: score={item['score']} "
                f"reasons={','.join(item['risk_reasons'])}"
            )
        print("recommended:", recommended or "none")
        print("status:", status)
        print("note:", payload["note"])
    return 0 if ranked else 1


if __name__ == "__main__":
    raise SystemExit(main())
