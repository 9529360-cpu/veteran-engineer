#!/usr/bin/env python3
"""Rank explicit diagnostic probes by discriminating power versus cost/risk.

Input JSON:
{
  "hypotheses": [{"id":"h1"}, {"id":"h2"}],
  "probes": [{"id":"p1","cost":1,"blast_radius":0,
              "predictions":{"h1":"yes","h2":"no"}}]
}
"""
from __future__ import annotations
import argparse, itertools, json, pathlib, sys


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("path")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()
    try:
        data = json.loads(pathlib.Path(a.path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    hypotheses = data.get("hypotheses")
    probes = data.get("probes")
    if not isinstance(hypotheses, list) or len(hypotheses) < 2 or not isinstance(probes, list) or not probes:
        print("error: require at least two hypotheses and one probe", file=sys.stderr)
        return 2
    ids = [str(h.get("id", "")).strip() for h in hypotheses if isinstance(h, dict)]
    if len(ids) != len(hypotheses) or any(not x for x in ids) or len(set(ids)) != len(ids):
        print("error: hypothesis ids must be unique non-empty strings", file=sys.stderr)
        return 2
    total_pairs = len(list(itertools.combinations(ids, 2)))
    ranked = []
    for probe in probes:
        if not isinstance(probe, dict) or not str(probe.get("id", "")).strip():
            continue
        predictions = probe.get("predictions", {})
        if not isinstance(predictions, dict):
            continue
        distinguished = 0
        covered_pairs = 0
        for left, right in itertools.combinations(ids, 2):
            if left in predictions and right in predictions:
                covered_pairs += 1
                if str(predictions[left]) != str(predictions[right]):
                    distinguished += 1
        cost = max(0.0, float(probe.get("cost", 1)))
        blast = max(0.0, float(probe.get("blast_radius", 0)))
        irreversible = bool(probe.get("irreversible", False))
        coverage = covered_pairs / total_pairs if total_pairs else 0.0
        discrimination = distinguished / total_pairs if total_pairs else 0.0
        score = round(discrimination * 100 + coverage * 10 - cost * 3 - blast * 8 - (40 if irreversible else 0), 2)
        ranked.append({
            "id": probe["id"], "score": score, "distinguished_pairs": distinguished,
            "total_pairs": total_pairs, "coverage": round(coverage, 3), "cost": cost,
            "blast_radius": blast, "irreversible": irreversible,
        })
    ranked.sort(key=lambda x: (-x["score"], x["cost"], x["blast_radius"], str(x["id"])))
    payload = {"ranked_probes": ranked, "note": "Ranking uses declared predictions only; wrong hypotheses or predictions produce wrong rankings."}
    if a.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("# Causal discriminator")
        for item in ranked:
            print(f"- {item['id']}: score={item['score']} distinguished={item['distinguished_pairs']}/{item['total_pairs']} coverage={item['coverage']}")
        print("note:", payload["note"])
    return 0 if ranked else 2


if __name__ == "__main__":
    raise SystemExit(main())
