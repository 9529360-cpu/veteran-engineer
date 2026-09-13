#!/usr/bin/env python3
"""Validate product analytics / experimentation plans.

This gate checks decision and measurement discipline. It does not prove that
metrics are statistically valid or that observed product effects are causal.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

METRIC_ROLES = {"primary", "guardrail", "diagnostic"}
EVENT_KINDS = {"event", "exposure"}
EXPERIMENT_KINDS = {"experiment", "rollout"}


def blocker(code: str, message: str, path: str | None = None) -> dict:
    item = {"code": code, "message": message}
    if path:
        item["path"] = path
    return item


def nonempty(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def unique_ids(items: list, field: str, kind: str, out: list[dict]) -> set[str]:
    seen: set[str] = set()
    for index, item in enumerate(items):
        path = f"{kind}[{index}]"
        if not isinstance(item, dict):
            out.append(blocker("ITEM_INVALID", f"{kind} entries must be objects", path))
            continue
        value = item.get(field)
        if not nonempty(value):
            out.append(blocker("ID_REQUIRED", f"{kind} entry requires non-empty {field}", path))
            continue
        if value in seen:
            out.append(blocker("ID_DUPLICATE", f"duplicate {kind} id: {value}", path))
            continue
        seen.add(value)
    return seen


def validate(payload: dict) -> dict:
    blockers: list[dict] = []
    notes: list[dict] = []

    question = payload.get("question")
    decision = payload.get("decision")
    population = payload.get("population")
    if not nonempty(question):
        blockers.append(blocker("QUESTION_REQUIRED", "question must be non-empty", "question"))
    if not nonempty(decision):
        blockers.append(blocker("DECISION_REQUIRED", "decision must state what action the measurement can change", "decision"))
    if not nonempty(population):
        blockers.append(blocker("POPULATION_REQUIRED", "population must define the measured/eligible unit", "population"))

    metrics = payload.get("metrics", [])
    events = payload.get("events", [])
    experiments = payload.get("experiments", [])
    privacy = payload.get("privacy", {})
    quality = payload.get("data_quality", [])

    if not isinstance(metrics, list) or not metrics:
        blockers.append(blocker("METRIC_REQUIRED", "at least one metric is required", "metrics"))
        metrics = []
    if not isinstance(events, list):
        blockers.append(blocker("EVENTS_INVALID", "events must be a list", "events"))
        events = []
    if not isinstance(experiments, list):
        blockers.append(blocker("EXPERIMENTS_INVALID", "experiments must be a list", "experiments"))
        experiments = []
    if not isinstance(quality, list) or not quality:
        blockers.append(blocker("DATA_QUALITY_REQUIRED", "data_quality must contain at least one validity check", "data_quality"))
        quality = []
    if not isinstance(privacy, dict):
        blockers.append(blocker("PRIVACY_INVALID", "privacy must be an object", "privacy"))
        privacy = {}

    metric_ids = unique_ids(metrics, "id", "metrics", blockers)
    event_ids = unique_ids(events, "id", "events", blockers)
    unique_ids(experiments, "id", "experiments", blockers)

    primary_count = 0
    for index, metric in enumerate(metrics):
        if not isinstance(metric, dict):
            continue
        path = f"metrics[{index}]"
        role = metric.get("role")
        if role not in METRIC_ROLES:
            blockers.append(blocker("METRIC_ROLE_INVALID", f"metric role must be one of {sorted(METRIC_ROLES)}", path))
        if role == "primary":
            primary_count += 1
        for field in ("definition", "unit", "window"):
            if not nonempty(metric.get(field)):
                blockers.append(blocker("METRIC_CONTRACT_INCOMPLETE", f"metric requires non-empty {field}", f"{path}.{field}"))
        sources = metric.get("source_event_ids", [])
        if not isinstance(sources, list):
            blockers.append(blocker("METRIC_SOURCES_INVALID", "source_event_ids must be a list", path))
        else:
            for source in sources:
                if source not in event_ids:
                    blockers.append(blocker("METRIC_SOURCE_MISSING", f"metric references unknown event: {source}", path))
    if primary_count != 1:
        blockers.append(blocker("PRIMARY_METRIC_COUNT", "exactly one primary metric is required", "metrics"))

    for index, event in enumerate(events):
        if not isinstance(event, dict):
            continue
        path = f"events[{index}]"
        if event.get("kind") not in EVENT_KINDS:
            blockers.append(blocker("EVENT_KIND_INVALID", f"event kind must be one of {sorted(EVENT_KINDS)}", path))
        for field in ("trigger", "authority"):
            if not nonempty(event.get(field)):
                blockers.append(blocker("EVENT_CONTRACT_INCOMPLETE", f"event requires non-empty {field}", f"{path}.{field}"))
        props = event.get("properties", [])
        if not isinstance(props, list):
            blockers.append(blocker("EVENT_PROPERTIES_INVALID", "properties must be a list", path))

    for index, experiment in enumerate(experiments):
        if not isinstance(experiment, dict):
            continue
        path = f"experiments[{index}]"
        kind = experiment.get("kind")
        if kind not in EXPERIMENT_KINDS:
            blockers.append(blocker("EXPERIMENT_KIND_INVALID", f"kind must be one of {sorted(EXPERIMENT_KINDS)}", path))
            continue
        for field in ("eligibility", "decision_rule", "rollback_rule", "cleanup"):
            if not nonempty(experiment.get(field)):
                blockers.append(blocker("EXPERIMENT_CONTRACT_INCOMPLETE", f"{kind} requires non-empty {field}", f"{path}.{field}"))
        if kind == "experiment":
            for field in ("hypothesis", "randomization_unit", "assignment_authority", "exposure_event_id"):
                if not nonempty(experiment.get(field)):
                    blockers.append(blocker("EXPERIMENT_CONTRACT_INCOMPLETE", f"experiment requires non-empty {field}", f"{path}.{field}"))
            exposure = experiment.get("exposure_event_id")
            if nonempty(exposure) and exposure not in event_ids:
                blockers.append(blocker("EXPOSURE_EVENT_MISSING", f"experiment references unknown exposure event: {exposure}", path))
            variants = experiment.get("variants", [])
            if not isinstance(variants, list) or len(variants) < 2 or not all(nonempty(v) for v in variants):
                blockers.append(blocker("EXPERIMENT_VARIANTS_INVALID", "experiment requires at least two named variants", path))

    purpose = privacy.get("purpose")
    retention = privacy.get("retention")
    if not nonempty(purpose):
        blockers.append(blocker("PRIVACY_PURPOSE_REQUIRED", "privacy.purpose must explain why data is collected", "privacy.purpose"))
    if not nonempty(retention):
        blockers.append(blocker("PRIVACY_RETENTION_REQUIRED", "privacy.retention must define a retention expectation", "privacy.retention"))

    if not experiments:
        notes.append({"code": "NO_EXPERIMENT", "message": "No experiment/rollout declared; gate validates a descriptive product-measurement plan."})
    if not events:
        notes.append({"code": "NO_NEW_EVENTS", "message": "No event contract declared; ensure the metrics are intentionally sourced from existing trustworthy data."})

    counts = {
        "metrics": len(metrics),
        "events": len(events),
        "experiments": len(experiments),
        "data_quality_checks": len(quality),
        "primary_metrics": primary_count,
    }
    return {
        "gate_passed": not blockers,
        "blockers": blockers,
        "notes": notes,
        "counts": counts,
        "metric_ids": sorted(metric_ids),
        "event_ids": sorted(event_ids),
        "note": "This gate validates measurement discipline, not substantive metric truth or causal validity.",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", help="Path to product-improvement JSON manifest")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    try:
        payload = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        result = {"gate_passed": False, "blockers": [blocker("MANIFEST_INVALID", str(exc))], "notes": [], "counts": {}}
    else:
        if not isinstance(payload, dict):
            result = {"gate_passed": False, "blockers": [blocker("MANIFEST_INVALID", "manifest root must be an object")], "notes": [], "counts": {}}
        else:
            result = validate(payload)

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print("PASS" if result["gate_passed"] else "BLOCKED")
        for item in result.get("blockers", []):
            print(f"- {item['code']}: {item['message']}")
        for item in result.get("notes", []):
            print(f"- note {item['code']}: {item['message']}")
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
