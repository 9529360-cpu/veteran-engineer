#!/usr/bin/env python3
"""Check acceptance-criterion continuity from requirements through delivery.

Usage:
  requirements_delivery_trace_gate.py requirements.json delivery.json trace.json [--json]

This gate checks structural and semantic traceability. It does not prove that
requirements, implementation paths, or evidence are substantively correct.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

TRACE_SCHEMA = "veteran-requirements-delivery-trace-v2"
DELIVERY_SCHEMA = "veteran-delivery-slice-v2"
ACCEPTANCE_FINGERPRINT_FIELDS = (
    "id",
    "requirement_id",
    "given",
    "when",
    "then",
    "evidence",
)
DELIVERY_KINDS = {
    "transition": "transitions",
    "companion": "companions",
    "consumer": "consumers",
}


def nonempty(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def string_list(value, *, nonempty_list=False) -> bool:
    return (
        isinstance(value, list)
        and (not nonempty_list or bool(value))
        and all(nonempty(item) for item in value)
    )


def acceptance_fingerprint(criterion: dict) -> str:
    canonical = {
        key: criterion.get(key)
        for key in ACCEPTANCE_FINGERPRINT_FIELDS
    }
    encoded = json.dumps(
        canonical,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def load_json(path: str) -> dict:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path}: root must be an object")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("requirements")
    parser.add_argument("delivery")
    parser.add_argument("trace")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    try:
        requirements = load_json(args.requirements)
        delivery = load_json(args.delivery)
        trace = load_json(args.trace)
    except Exception as exc:
        print(json.dumps({
            "gate_passed": False,
            "blockers": [{"code": "INPUT_INVALID", "message": str(exc)}],
        }))
        return 2

    blockers = []

    def add(code, message, path=None):
        item = {"code": code, "message": message}
        if path:
            item["path"] = path
        blockers.append(item)

    criteria = requirements.get("acceptance_criteria")
    if not isinstance(criteria, list) or not criteria:
        add(
            "ACCEPTANCE_CRITERIA_REQUIRED",
            "requirements acceptance_criteria must be a non-empty array",
            "requirements.acceptance_criteria",
        )
        criteria = []

    criterion_set = set()
    criterion_fingerprints = {}
    for index, criterion in enumerate(criteria):
        path = f"requirements.acceptance_criteria[{index}]"
        if not isinstance(criterion, dict) or not nonempty(criterion.get("id")):
            add("ACCEPTANCE_ID_REQUIRED", f"{path}.id must be non-empty", f"{path}.id")
            continue
        criterion_id = criterion["id"]
        if criterion_id in criterion_set:
            add(
                "ACCEPTANCE_ID_DUPLICATE",
                f"duplicate acceptance criterion {criterion_id}",
                f"{path}.id",
            )
        criterion_set.add(criterion_id)

        missing_semantics = [
            key
            for key in ACCEPTANCE_FINGERPRINT_FIELDS
            if not nonempty(criterion.get(key))
        ]
        if missing_semantics:
            add(
                "ACCEPTANCE_SEMANTICS_REQUIRED",
                f"acceptance criterion {criterion_id} cannot be fingerprinted; missing non-empty fields: {', '.join(missing_semantics)}",
                path,
            )
            continue
        criterion_fingerprints[criterion_id] = acceptance_fingerprint(criterion)

    if delivery.get("schema") != DELIVERY_SCHEMA:
        add(
            "DELIVERY_SCHEMA_INVALID",
            f"delivery.schema must be {DELIVERY_SCHEMA!r}",
            "delivery.schema",
        )

    change_identity = delivery.get("change_identity")
    if not isinstance(change_identity, dict):
        change_identity = {}
    delivery_change_id = change_identity.get("change_id")
    if not nonempty(delivery_change_id):
        add(
            "DELIVERY_CHANGE_ID_REQUIRED",
            "delivery change_identity.change_id must be non-empty",
            "delivery.change_identity.change_id",
        )

    write_set = delivery.get("write_set")
    if not isinstance(write_set, dict):
        write_set = {}
    actual = write_set.get("actual")
    if not string_list(actual, nonempty_list=True):
        add(
            "DELIVERY_WRITE_SET_REQUIRED",
            "delivery write_set.actual must be a non-empty string array",
            "delivery.write_set.actual",
        )
        actual = []
    actual_set = set(actual)

    delivery_elements = {}
    for kind, key in DELIVERY_KINDS.items():
        names = set()
        rows = delivery.get(key, [])
        if isinstance(rows, list):
            for row in rows:
                if isinstance(row, dict) and nonempty(row.get("name")):
                    names.add(row["name"])
        delivery_elements[kind] = names

    if trace.get("schema") != TRACE_SCHEMA:
        add(
            "TRACE_SCHEMA_INVALID",
            f"trace.schema must be {TRACE_SCHEMA!r}",
            "trace.schema",
        )
    if trace.get("change_id") != delivery_change_id:
        add(
            "TRACE_CHANGE_ID_MISMATCH",
            "trace.change_id must equal delivery change_identity.change_id",
            "trace.change_id",
        )

    rows = trace.get("criteria")
    if not isinstance(rows, list) or not rows:
        add(
            "TRACE_ROWS_REQUIRED",
            "trace.criteria must be a non-empty array",
            "trace.criteria",
        )
        rows = []

    seen_criteria = set()
    traced_paths = set()
    linked_delivery_elements = set()

    for index, row in enumerate(rows):
        path = f"trace.criteria[{index}]"
        if not isinstance(row, dict):
            add("TRACE_ROW_INVALID", f"{path} must be an object", path)
            continue

        criterion_id = row.get("criterion_id")
        if not nonempty(criterion_id) or criterion_id not in criterion_set:
            add(
                "TRACE_CRITERION_UNKNOWN",
                f"{path}.criterion_id must reference an acceptance criterion",
                f"{path}.criterion_id",
            )
            continue
        if criterion_id in seen_criteria:
            add(
                "TRACE_CRITERION_DUPLICATE",
                f"acceptance criterion {criterion_id} is traced more than once",
                f"{path}.criterion_id",
            )
        seen_criteria.add(criterion_id)

        expected_fingerprint = criterion_fingerprints.get(criterion_id)
        supplied_fingerprint = row.get("criterion_fingerprint")
        if not nonempty(supplied_fingerprint):
            add(
                "TRACE_CRITERION_FINGERPRINT_REQUIRED",
                f"{criterion_id} requires a semantic criterion fingerprint",
                f"{path}.criterion_fingerprint",
            )
        elif expected_fingerprint is not None and supplied_fingerprint != expected_fingerprint:
            add(
                "TRACE_CRITERION_STALE",
                f"{criterion_id} trace fingerprint does not match the current acceptance semantics",
                f"{path}.criterion_fingerprint",
            )

        if row.get("status") != "done":
            add(
                "TRACE_CRITERION_NOT_DONE",
                f"{criterion_id} status must be done",
                f"{path}.status",
            )

        if not string_list(row.get("implementation_owners"), nonempty_list=True):
            add(
                "TRACE_OWNER_REQUIRED",
                f"{criterion_id} requires at least one implementation owner",
                f"{path}.implementation_owners",
            )

        implementation_paths = row.get("implementation_paths")
        if not string_list(implementation_paths, nonempty_list=True):
            add(
                "TRACE_PATH_REQUIRED",
                f"{criterion_id} requires at least one implementation path",
                f"{path}.implementation_paths",
            )
            implementation_paths = []
        for implementation_path in implementation_paths:
            if implementation_path not in actual_set:
                add(
                    "TRACE_PATH_OUTSIDE_DELIVERY",
                    f"{criterion_id} path {implementation_path!r} is absent from delivery actual write set",
                    f"{path}.implementation_paths",
                )
            else:
                traced_paths.add(implementation_path)

        if not string_list(row.get("validation_evidence"), nonempty_list=True):
            add(
                "TRACE_VALIDATION_REQUIRED",
                f"{criterion_id} requires validation evidence",
                f"{path}.validation_evidence",
            )

        links = row.get("delivery_links")
        if not isinstance(links, list) or not links:
            add(
                "TRACE_DELIVERY_LINK_REQUIRED",
                f"{criterion_id} requires at least one delivery link",
                f"{path}.delivery_links",
            )
            links = []
        for link_index, link in enumerate(links):
            link_path = f"{path}.delivery_links[{link_index}]"
            if (
                not isinstance(link, dict)
                or link.get("kind") not in DELIVERY_KINDS
                or not nonempty(link.get("name"))
            ):
                add(
                    "TRACE_DELIVERY_LINK_INVALID",
                    f"{link_path} requires a valid kind and non-empty name",
                    link_path,
                )
                continue
            kind = link["kind"]
            name = link["name"]
            if name not in delivery_elements[kind]:
                add(
                    "TRACE_DELIVERY_LINK_UNKNOWN",
                    f"{link_path} references unknown delivery {kind} {name!r}",
                    link_path,
                )
            else:
                linked_delivery_elements.add((kind, name))

    for criterion_id in sorted(criterion_set - seen_criteria):
        add(
            "ACCEPTANCE_CRITERION_UNTRACED",
            f"acceptance criterion {criterion_id} has no delivery trace",
        )

    shared_paths = trace.get("shared_paths", [])
    if not isinstance(shared_paths, list):
        add("SHARED_PATHS_INVALID", "trace.shared_paths must be an array", "trace.shared_paths")
        shared_paths = []
    explained_paths = set()
    for index, item in enumerate(shared_paths):
        path = f"trace.shared_paths[{index}]"
        if (
            not isinstance(item, dict)
            or not nonempty(item.get("path"))
            or not nonempty(item.get("reason"))
        ):
            add("SHARED_PATH_INVALID", f"{path} requires path and reason", path)
            continue
        if item["path"] not in actual_set:
            add(
                "SHARED_PATH_OUTSIDE_DELIVERY",
                f"{item['path']!r} is absent from delivery actual write set",
                f"{path}.path",
            )
        explained_paths.add(item["path"])

    for actual_path in sorted(actual_set - traced_paths - explained_paths):
        add(
            "DELIVERY_PATH_UNTRACED",
            f"delivery write-set path {actual_path!r} is neither criterion-traced nor explained as shared",
        )

    shared_elements = trace.get("shared_delivery_elements", [])
    if not isinstance(shared_elements, list):
        add(
            "SHARED_ELEMENTS_INVALID",
            "trace.shared_delivery_elements must be an array",
            "trace.shared_delivery_elements",
        )
        shared_elements = []
    explained_elements = set()
    for index, item in enumerate(shared_elements):
        path = f"trace.shared_delivery_elements[{index}]"
        if (
            not isinstance(item, dict)
            or item.get("kind") not in DELIVERY_KINDS
            or not nonempty(item.get("name"))
            or not nonempty(item.get("reason"))
        ):
            add(
                "SHARED_ELEMENT_INVALID",
                f"{path} requires valid kind, name, and reason",
                path,
            )
            continue
        pair = (item["kind"], item["name"])
        if item["name"] not in delivery_elements[item["kind"]]:
            add("SHARED_ELEMENT_UNKNOWN", f"{path} references unknown delivery element", path)
        explained_elements.add(pair)

    material_elements = {
        (kind, name)
        for kind, names in delivery_elements.items()
        for name in names
    }
    for kind, name in sorted(material_elements - linked_delivery_elements - explained_elements):
        add(
            "DELIVERY_ELEMENT_UNTRACED",
            f"delivery {kind} {name!r} is neither acceptance-traced nor explained as shared",
        )

    result = {
        "gate_passed": not blockers,
        "blockers": blockers,
        "counts": {
            "acceptance_criteria": len(criterion_set),
            "fingerprinted_criteria": len(criterion_fingerprints),
            "traced_criteria": len(seen_criteria),
            "actual_write_set": len(actual_set),
            "traced_paths": len(traced_paths),
            "delivery_elements": len(material_elements),
            "linked_delivery_elements": len(linked_delivery_elements),
        },
        "note": "Traceability aid only; semantic fingerprints prevent stale acceptance traces but referenced implementation and evidence still require repository/runtime proof.",
    }
    print(json.dumps(result, indent=2, sort_keys=True) if args.json else json.dumps(result))
    return 0 if result["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
