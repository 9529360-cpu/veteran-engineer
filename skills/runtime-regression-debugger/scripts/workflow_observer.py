#!/usr/bin/env python3
"""Opt-in metadata-only workflow observation for hosts that expose tool-result hooks.

Only a host bridge that *already* has lawful post-tool metadata can emit these
events. This program does not install hooks, intercept ChatGPT conversations,
observe raw tool traffic, run in the background, or rewrite Skill files.

Example:
  workflow_observer.py /tmp/mission.json --source local-bridge --events events.jsonl
  workflow_observer.py /tmp/mission.json --source local-bridge --events -
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import sys

from engineering_journal import WORKFLOW_LABEL, WORKFLOW_PROOF, load, now, require_open, save

# Stable *semantic* activities, not tool names, command lines or raw output.
# A host bridge maps successful post-tool receipts to one of these activities.
ACTIVITY_TO_STEP = {
    "repo.inspect": "inspect-head",
    "source.change": "implement-change",
    "checks.focused": "run-focused-tests",
    "review.diff": "review-diff",
    "pr.create": "open-pr",
    "checks.ci": "verify-ci",
    "release.verify": "verify-release",
}

EVENT_KEYS = frozenset({"event_id", "workflow", "activity", "outcome", "evidence_ids"})
EVENT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
MAX_INPUT_BYTES = 65536
MAX_BATCH_EVENTS = 128
MAX_JOURNAL_EVENTS = 500


def event_rows(raw: bytes, source: str) -> list[dict]:
    if len(raw) > MAX_INPUT_BYTES:
        raise RuntimeError("observer input exceeds 64 KiB")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise RuntimeError("observer input must be UTF-8") from exc

    rows: list[dict] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        if len(rows) >= MAX_BATCH_EVENTS:
            raise RuntimeError("observer batch exceeds 128 events")
        try:
            item = json.loads(line)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"line {line_number}: invalid JSON") from exc
        if not isinstance(item, dict) or set(item) != EVENT_KEYS:
            raise RuntimeError(
                f"line {line_number}: only event_id, workflow, activity, outcome, evidence_ids are accepted"
            )
        event_id, workflow, activity = (item["event_id"], item["workflow"], item["activity"])
        if not isinstance(event_id, str) or not EVENT_ID.fullmatch(event_id):
            raise RuntimeError(f"line {line_number}: event_id must be a short opaque identifier")
        if not isinstance(workflow, str) or not WORKFLOW_LABEL.fullmatch(workflow):
            raise RuntimeError(f"line {line_number}: workflow must be a stable lowercase slug")
        if not isinstance(activity, str) or activity not in ACTIVITY_TO_STEP:
            raise RuntimeError(f"line {line_number}: unknown semantic activity")
        if item["outcome"] not in ("passed", "failed"):
            raise RuntimeError(f"line {line_number}: outcome must be passed or failed")
        proof = item["evidence_ids"]
        if (
            not isinstance(proof, list)
            or len(proof) > 5
            or any(not isinstance(value, str) or not WORKFLOW_PROOF.fullmatch(value) for value in proof)
            or (item["outcome"] == "passed" and not proof)
        ):
            raise RuntimeError(f"line {line_number}: passed activities need 1-5 short proof IDs")
        # Hash the host's idempotency key; never persist an original hook/event identifier.
        digest = hashlib.sha256(f"{source}\0{event_id}".encode("utf-8")).hexdigest()
        rows.append({
            "capture": "host-observer-v1",
            "source": source,
            "event_digest": digest,
            "workflow": workflow,
            "step": ACTIVITY_TO_STEP[activity],
            "outcome": item["outcome"],
            "evidence_ids": list(dict.fromkeys(proof)),
        })
    if not rows:
        raise RuntimeError("observer input contains no events")
    return rows


def apply_batch(path: pathlib.Path, source: str, rows: list[dict]) -> dict:
    if not path.is_file():
        raise RuntimeError("initialize a task journal before importing observations")
    data = load(path)
    require_open(data)
    if not isinstance(data.get("contract"), str) or not data["contract"].strip():
        raise RuntimeError("the target journal needs an initialized task contract")
    telemetry = data["telemetry"]
    observed = telemetry.setdefault("observed_workflow_events", [])
    if not isinstance(observed, list):
        raise RuntimeError("observed_workflow_events must be a list")
    seen: dict[str, dict] = {}
    for row in observed:
        if (
            not isinstance(row, dict)
            or not isinstance(row.get("event_digest"), str)
            or not SHA256.fullmatch(row["event_digest"])
        ):
            raise RuntimeError("existing observer events have invalid identity")
        if row["event_digest"] in seen:
            raise RuntimeError("existing observer events contain duplicate identities")
        seen[row["event_digest"]] = row

    additions = []
    replayed = 0
    for row in rows:
        digest = row["event_digest"]
        old = seen.get(digest)
        if old is not None:
            # Ignore the timestamp only: a changed replay must not rewrite history.
            if any(old.get(key) != value for key, value in row.items()):
                raise RuntimeError("observer event ID replayed with different evidence or activity")
            replayed += 1
            continue
        seen[digest] = row
        additions.append(row)
    if len(observed) + len(additions) > MAX_JOURNAL_EVENTS:
        raise RuntimeError("observer journal exceeds 500 events; rotate task journal")
    if additions:
        stamp = now()
        observed.extend({**row, "at": stamp} for row in additions)
        data["updated_at"] = stamp
        save(path, data)
    return {
        "accepted": len(additions),
        "idempotent_replays": replayed,
        "total_observed": len(observed),
        "capture": "host-observer-v1",
        "status": "recorded-not-verified",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("journal", help="Existing, initialized, open task journal")
    parser.add_argument("--source", required=True, help="Stable, non-sensitive host bridge slug")
    parser.add_argument("--events", required=True, help="UTF-8 JSONL metadata file or - for stdin")
    args = parser.parse_args()
    source = args.source.strip()
    if not WORKFLOW_LABEL.fullmatch(source):
        raise RuntimeError("--source must be a stable lowercase slug (2-48 chars)")
    if args.events == "-":
        raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    else:
        try:
            with pathlib.Path(args.events).open("rb") as stream:
                raw = stream.read(MAX_INPUT_BYTES + 1)
        except OSError as exc:
            raise RuntimeError(f"cannot open observation stream: {exc}") from exc
    rows = event_rows(raw, source)
    result = apply_batch(pathlib.Path(args.journal), source, rows)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(2)
