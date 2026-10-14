"""Opt-in host-observer data contract: candidates only, never implicit hooks."""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JOURNAL = ROOT / "scripts" / "engineering_journal.py"
OBSERVER = ROOT / "scripts" / "workflow_observer.py"
COMPACTOR = ROOT / "scripts" / "experience_compactor.py"


def invoke(*args, success=True):
    result = subprocess.run([sys.executable, *map(str, args)], text=True,
                            capture_output=True, check=False)
    if success:
        assert result.returncode == 0, result.stderr
    return result


def receipt(event_id, activity, *, outcome="passed", evidence_ids=None):
    return {
        "event_id": event_id,
        "workflow": "repo-validation",
        "activity": activity,
        "outcome": outcome,
        "evidence_ids": evidence_ids if evidence_ids is not None else [f"test:{event_id}"],
    }


def stream(path, records):
    path.write_text("".join(json.dumps(r) + "\n" for r in records), encoding="utf-8")
    return path


def task(tmp_path, identity, records, *, close=True):
    journal = tmp_path / f"{identity}.json"
    invoke(JOURNAL, journal, "init", "--contract", f"Task {identity}")
    file = stream(tmp_path / f"{identity}.jsonl", records)
    imported = invoke(OBSERVER, journal, "--source", "local-bridge", "--events", file)
    if close:
        invoke(JOURNAL, journal, "close", "--evidence-level", "focused-validated")
    return journal, json.loads(imported.stdout)


def candidates(*runs):
    result = invoke(COMPACTOR, *runs, "--scope-id", "repo:example/app", "--include-workflows")
    payload = json.loads(result.stdout)
    return [x for x in payload["candidates"] if x["kind"] == "repeated-workflow"]


def typical_run(suffix):
    return [
        receipt(f"inspect-{suffix}", "repo.inspect", evidence_ids=[f"commit:head-{suffix}"]),
        receipt(f"validate-{suffix}", "checks.focused", evidence_ids=[f"ci:green-{suffix}"]),
        receipt(f"review-{suffix}", "review.diff", evidence_ids=[f"review:diff-{suffix}"]),
    ]


def test_three_captured_tasks_create_scoped_review_candidate(tmp_path):
    runs = [task(tmp_path, f"task{i}", typical_run(str(i)))[0] for i in range(3)]
    found = candidates(*runs)
    assert len(found) == 1
    proposed = found[0]
    assert proposed["capture_modes"] == ["host-observer-v1"]
    assert proposed["independent_successful_runs"] == 3
    assert proposed["steps"] == ["inspect-head", "run-focused-tests", "review-diff"]
    assert proposed["review_required"] is True
    assert proposed["promotion_blocked"] is False
    assert proposed["scope_type"] == "project"
    data = json.loads(runs[0].read_text())
    saved = data["telemetry"]["observed_workflow_events"][0]
    assert saved["event_digest"] != "inspect-0"
    assert len(saved["event_digest"]) == 64
    assert "event_id" not in saved
    assert saved["capture"] == "host-observer-v1"


def test_idempotent_replay_and_conflicting_event_identity_rejected(tmp_path):
    records = typical_run("same")
    journal, initial = task(tmp_path, "original", records, close=False)
    assert initial["accepted"] == 3
    file = stream(tmp_path / "again.jsonl", records)
    replay = json.loads(invoke(OBSERVER, journal, "--source", "local-bridge",
                               "--events", file).stdout)
    assert replay["accepted"] == 0
    assert replay["idempotent_replays"] == 3
    before = journal.read_bytes()
    tampered = [dict(records[0], evidence_ids=["ci:swapped-proof"])]
    bad_file = stream(tmp_path / "changed.jsonl", tampered)
    denied = invoke(OBSERVER, journal, "--source", "local-bridge", "--events",
                    bad_file, success=False)
    assert denied.returncode == 2
    assert "replayed with different evidence" in denied.stderr
    assert journal.read_bytes() == before


def test_unknown_raw_payload_fields_and_invalid_batch_fail_without_writes(tmp_path):
    journal = tmp_path / "private.json"
    invoke(JOURNAL, journal, "init", "--contract", "Private task")
    before = journal.read_bytes()
    events = typical_run("ok") + [dict(receipt("unsafe", "review.diff"), raw_output="secret")]
    file = stream(tmp_path / "invalid.jsonl", events)
    result = invoke(OBSERVER, journal, "--source", "local-bridge", "--events",
                    file, success=False)
    assert result.returncode == 2
    assert "only event_id" in result.stderr
    assert journal.read_bytes() == before

    invalid_activity = stream(tmp_path / "raw-command.jsonl",
                              [receipt("unsafe", "shell:curl production-secret")])
    result = invoke(OBSERVER, journal, "--source", "local-bridge", "--events",
                    invalid_activity, success=False)
    assert result.returncode == 2
    assert "unknown semantic activity" in result.stderr
    assert journal.read_bytes() == before


def test_failed_open_and_mixed_source_tasks_block_promotion(tmp_path):
    good = [task(tmp_path, f"good{i}", typical_run(str(i)))[0] for i in range(3)]
    failed = typical_run("failed")
    failed[1]["outcome"] = "failed"
    bad_run, _ = task(tmp_path, "failed", failed)
    open_run, _ = task(tmp_path, "open", typical_run("open"), close=False)
    mixed_run, _ = task(tmp_path, "mixed", typical_run("mix"), close=False)
    invoke(JOURNAL, mixed_run, "workflow-step", "--workflow", "repo-validation",
           "--step", "inspect-head", "--outcome", "passed",
           "--evidence-id", "commit:independent")
    invoke(JOURNAL, mixed_run, "close", "--evidence-level", "focused-validated")
    found = candidates(*good, bad_run, open_run, mixed_run)
    assert len(found) == 1
    assert found[0]["independent_successful_runs"] == 3
    assert found[0]["counterexample_runs"] == 3
    assert found[0]["promotion_blocked"] is True


def test_recaptured_semantic_step_and_unproven_outcome_are_not_promoted(tmp_path):
    repeated = typical_run("repeat") + [receipt("new-id", "repo.inspect")]
    other = [task(tmp_path, f"ok{i}", typical_run(f"ok{i}"))[0] for i in range(3)]
    repeat_run, _ = task(tmp_path, "repeat", repeated)
    found = candidates(*other, repeat_run)
    assert len(found) == 1
    assert found[0]["promotion_blocked"] and found[0]["counterexample_runs"] == 1

    journal = tmp_path / "no-proof.json"
    invoke(JOURNAL, journal, "init", "--contract", "No unproven completion")
    empty_proof = [receipt("no-proof", "checks.ci", evidence_ids=[])]
    file = stream(tmp_path / "unproven.jsonl", empty_proof)
    result = invoke(OBSERVER, journal, "--source", "local-bridge", "--events",
                    file, success=False)
    assert result.returncode == 2
    assert "proof IDs" in result.stderr
