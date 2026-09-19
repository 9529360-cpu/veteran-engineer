import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "execution_envelope_gate.py"


def run(tmp_path, payload):
    manifest = tmp_path / "envelope.json"
    manifest.write_text(json.dumps(payload), encoding="utf-8")
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), str(manifest), "--json"],
        text=True,
        capture_output=True,
    )
    return proc, json.loads(proc.stdout)


def base_payload():
    return {
        "capabilities": [
            {"id": "source-read", "state": "available", "evidence": "local checkout"},
            {"id": "source-write", "state": "available", "evidence": "working tree is writable"},
            {"id": "browser-render", "state": "unavailable", "evidence": "no browser/render tool exposed"},
            {"id": "remote-repository", "state": "unknown", "evidence": "remote connector not checked yet"},
        ],
        "requirements": [
            {
                "claim": "inspect current source",
                "requires_any": ["source-read"],
                "disposition": "supported",
            },
            {
                "claim": "visible UI acceptance",
                "requires_any": ["browser-render"],
                "disposition": "degraded",
                "fallback": "run component/integration checks and report rendered QA as unproven",
            },
        ],
    }


def test_capability_envelope_accepts_honest_fallback(tmp_path):
    proc, payload = run(tmp_path, base_payload())
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert payload["gate_passed"] is True
    assert payload["counts"]["degraded"] == 1
    assert payload["envelope_hash"]
    assert "not authorization" in payload["note"]


def test_capability_envelope_rejects_supported_claim_without_available_oracle(tmp_path):
    data = base_payload()
    data["requirements"][1] = {
        "claim": "rendered UI validated",
        "requires_any": ["browser-render"],
        "disposition": "supported",
    }
    proc, payload = run(tmp_path, data)
    assert proc.returncode != 0
    assert any(item["code"] == "UNSUPPORTED_CLAIM" for item in payload["blockers"])


def test_capability_envelope_requires_fallback_for_degraded_claim(tmp_path):
    data = base_payload()
    data["requirements"][1].pop("fallback")
    proc, payload = run(tmp_path, data)
    assert proc.returncode != 0
    assert any(item["code"] == "FALLBACK_REQUIRED" for item in payload["blockers"])


def test_capability_envelope_is_deterministic_for_same_observed_state(tmp_path):
    proc1, first = run(tmp_path, base_payload())
    proc2, second = run(tmp_path, base_payload())
    assert proc1.returncode == 0 and proc2.returncode == 0
    assert first["envelope_hash"] == second["envelope_hash"]
