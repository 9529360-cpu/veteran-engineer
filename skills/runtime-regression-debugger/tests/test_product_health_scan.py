import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GATE = ROOT / "scripts" / "product_stewardship_gate.py"


def run(tmp_path, payload):
    manifest = tmp_path / "health.json"
    manifest.write_text(json.dumps(payload), encoding="utf-8")
    proc = subprocess.run(
        [sys.executable, str(GATE), str(manifest), "--json"],
        text=True,
        capture_output=True,
    )
    return proc, json.loads(proc.stdout)


def valid_health_scan():
    return {
        "mode": "health-scan",
        "product_goal": "Improve the active product without inventing business policy",
        "authorization_scope": "ordinary reversible repository-local changes",
        "scope_boundary": "active web app and its release path",
        "dimensions_inspected": [
            "correctness-data-security",
            "ux-accessibility-content",
            "reliability-recovery-observability",
        ],
        "surfaces": [
            {
                "id": "main-ui",
                "kind": "web-ui",
                "user_goal": "complete the primary workflow",
                "evidence": "rendered route and focused tests",
                "checks": {
                    "visual_hierarchy": "inspected",
                    "interaction_states": "inspected",
                    "responsive": "inspected",
                    "accessibility": "inspected",
                    "copy_content": "inspected",
                    "design_consistency": "inspected",
                },
            }
        ],
        "candidates": [
            {
                "id": "c1",
                "category": "reliability",
                "action": "probe",
                "evidence": "timeout path has no terminal reconciliation evidence",
                "user_impact": "users can see an indefinite pending state",
                "reason": "high-impact active-path uncertainty",
                "confidence": "supported",
                "urgency": "now",
                "owner": "workflow status owner",
                "falsifier": "exercise timeout-after-commit and inspect authoritative status",
                "dependencies": [],
            },
            {
                "id": "c2",
                "category": "design-system",
                "action": "defer",
                "evidence": "minor spacing drift",
                "user_impact": "small visual inconsistency",
                "reason": "lower consequence than c1",
                "confidence": "confirmed",
                "urgency": "later",
                "owner": "shared spacing tokens",
                "falsifier": "compare representative consumers",
                "dependencies": [],
            },
        ],
        "prioritization_basis": "consequence first, then evidence strength, dependency order, reversibility, and effort",
        "selection": {"next_candidate_id": "c1", "why_now": "c1 can strand a core workflow and is cheaply falsifiable"},
        "validation": {
            "focused_oracle": "timeout-after-commit characterization",
            "visible_or_boundary_oracle": "real workflow reaches a terminal reconciled state",
        },
    }


def test_health_scan_supports_probe_without_fake_score(tmp_path):
    proc, payload = run(tmp_path, valid_health_scan())
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert payload["gate_passed"] is True
    assert payload["mode"] == "health-scan"
    assert payload["counts"]["active_candidates"] == 1
    assert "does not score project health" in payload["note"]


def test_health_scan_requires_confidence_owner_and_falsifier(tmp_path):
    data = valid_health_scan()
    for field in ("confidence", "owner", "falsifier"):
        data["candidates"][0].pop(field)
    proc, payload = run(tmp_path, data)
    assert proc.returncode != 0
    codes = {item["code"] for item in payload["blockers"]}
    assert "CANDIDATE_CONFIDENCE_INVALID" in codes
    assert "CANDIDATE_OWNER_REQUIRED" in codes
    assert "CANDIDATE_FALSIFIER_REQUIRED" in codes


def test_legacy_quality_sweep_shape_remains_supported(tmp_path):
    data = valid_health_scan()
    data.pop("mode")
    data.pop("dimensions_inspected")
    for candidate in data["candidates"]:
        candidate.pop("confidence")
        candidate.pop("urgency")
        candidate.pop("owner")
        candidate.pop("falsifier")
        candidate.pop("dependencies")
    data["candidates"][0]["action"] = "fix"
    proc, payload = run(tmp_path, data)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert payload["mode"] == "quality-sweep"
