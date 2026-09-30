import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "repository_continuation_gate.py"


def _run(tmp_path, payload):
    manifest = tmp_path / "continuation.json"
    manifest.write_text(json.dumps(payload), encoding="utf-8")
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(manifest)],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def _base_payload():
    return {
        "schema": "veteran-repository-continuation-v1",
        "user_intent": "continue-development",
        "repository": {
            "full_name": "9529360-cpu/veteran-engineer",
            "default_branch": "main",
            "default_head": "abc123",
            "default_head_refreshed": True,
            "main_validated": True,
        },
        "previous_slice": {
            "strongest_rung": "main-validated",
            "head": "abc123",
        },
        "material_next_actions": [
            {
                "id": "next-contract-gate",
                "description": "Add a focused repository-local continuation contract gate.",
                "material": True,
                "reversible": True,
            }
        ],
        "proposed_next_action": {
            "kind": "create-branch",
            "base_sha": "abc123",
        },
        "claim": {
            "kind": "continue",
            "strongest_rung": "main-validated",
        },
    }


def test_continuation_request_with_safe_next_slice_passes(tmp_path):
    result = _run(tmp_path, _base_payload())
    assert result.returncode == 0, result.stdout + result.stderr
    payload = json.loads(result.stdout)
    assert payload["status"] == "pass"
    assert payload["summary"]["proposed_next_action"] == "create-branch"


def test_status_only_claim_is_blocked_when_material_work_exists(tmp_path):
    payload = _base_payload()
    payload["claim"]["kind"] = "status-only"
    result = _run(tmp_path, payload)
    assert result.returncode == 1
    output = json.loads(result.stdout)
    assert {item["code"] for item in output["blockers"]} == {"STATUS_ONLY_WHILE_NEXT_ACTION_EXISTS"}


def test_new_continuation_branch_must_start_from_refreshed_main(tmp_path):
    payload = _base_payload()
    payload["proposed_next_action"]["base_sha"] = "stale-sha"
    result = _run(tmp_path, payload)
    assert result.returncode == 1
    output = json.loads(result.stdout)
    assert "NEXT_SLICE_BASE_STALE" in {item["code"] for item in output["blockers"]}


def test_after_merge_collect_main_validation_before_new_branch(tmp_path):
    payload = _base_payload()
    payload["previous_slice"]["strongest_rung"] = "merged"
    payload["repository"]["main_validated"] = False
    result = _run(tmp_path, payload)
    assert result.returncode == 1
    output = json.loads(result.stdout)
    assert "MAIN_VALIDATION_REQUIRED_BEFORE_NEXT_SLICE" in {item["code"] for item in output["blockers"]}


def test_collecting_main_validation_is_valid_after_merge(tmp_path):
    payload = _base_payload()
    payload["previous_slice"]["strongest_rung"] = "merged"
    payload["repository"]["main_validated"] = False
    payload["material_next_actions"] = []
    payload["proposed_next_action"] = {"kind": "collect-main-validation"}
    payload["claim"]["kind"] = "continue"
    payload["stop_reason"] = "main validation is the active continuation frontier"
    result = _run(tmp_path, payload)
    assert result.returncode == 0, result.stdout + result.stderr
