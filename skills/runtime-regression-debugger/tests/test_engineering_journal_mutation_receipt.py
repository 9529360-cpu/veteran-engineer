import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JOURNAL = ROOT / "scripts" / "engineering_journal.py"


def run_journal(path: Path, *args: str, check: bool = True):
    return subprocess.run(
        [sys.executable, str(JOURNAL), str(path), *args],
        text=True,
        capture_output=True,
        check=check,
    )


def test_mutation_receipts_survive_compact_resume(tmp_path: Path):
    journal = tmp_path / "work.json"
    run_journal(journal, "init", "--contract", "merge -> CI -> publish")
    run_journal(
        journal,
        "mutation-receipt",
        "--surface",
        "github",
        "--action",
        "merge-pr",
        "--target",
        "acme/repo#42",
        "--evidence-kind",
        "tool-return",
        "--result-id",
        "commit:abc123",
        "--expected-descendant",
        "workflow:package",
        "--expected-descendant",
        "workflow:release",
    )
    run_journal(
        journal,
        "mutation-receipt",
        "--surface",
        "plugin",
        "--action",
        "publish",
        "--target",
        "Plugin_123",
        "--evidence-kind",
        "platform-binding",
        "--result-id",
        "release:rel456",
        "--caused-by",
        "commit:abc123",
    )

    payload = json.loads(run_journal(journal, "resume").stdout)

    assert [row["result_ids"] for row in payload["mutation_receipts"]] == [
        ["commit:abc123"],
        ["release:rel456"],
    ]
    assert payload["mutation_receipts"][0]["expected_descendants"] == [
        "workflow:package",
        "workflow:release",
    ]
    assert payload["mutation_receipts"][0]["evidence_kind"] == "tool-return"
    assert payload["mutation_receipts"][1]["evidence_kind"] == "platform-binding"
    assert payload["mutation_receipts"][1]["caused_by"] == "commit:abc123"
    for row in payload["mutation_receipts"]:
        assert row["attribution_scope"] == "historical-mission-record"
        assert row["requires_live_revalidation_for_session_attribution"] is True
        assert row["expected_descendants_status"] == "predicted-unverified"
    assert payload["counts"]["mutation_receipts"] == 2
    assert "not session identity proof" in payload["note"]


def test_mutation_receipt_requires_returned_identity(tmp_path: Path):
    journal = tmp_path / "work.json"
    run_journal(journal, "init", "--contract", "track remote mutation")

    proc = run_journal(
        journal,
        "mutation-receipt",
        "--surface",
        "github",
        "--action",
        "merge-pr",
        "--target",
        "acme/repo#42",
        check=False,
    )

    assert proc.returncode == 2
    assert "requires at least one --result-id" in proc.stderr


def test_mutation_receipt_rejects_non_namespaced_identity(tmp_path: Path):
    journal = tmp_path / "work.json"
    run_journal(journal, "init", "--contract", "track remote mutation")

    proc = run_journal(
        journal,
        "mutation-receipt",
        "--surface",
        "github",
        "--action",
        "merge-pr",
        "--target",
        "acme/repo#42",
        "--result-id",
        "abc123",
        check=False,
    )

    assert proc.returncode == 2
    assert "must use a namespaced identity" in proc.stderr


def test_mutation_receipt_rejects_duplicate_result_owner(tmp_path: Path):
    journal = tmp_path / "work.json"
    run_journal(journal, "init", "--contract", "track remote mutation")
    run_journal(
        journal,
        "mutation-receipt",
        "--surface",
        "github",
        "--action",
        "merge-pr",
        "--target",
        "acme/repo#42",
        "--evidence-kind",
        "tool-return",
        "--result-id",
        "commit:abc123",
    )

    proc = run_journal(
        journal,
        "mutation-receipt",
        "--surface",
        "github",
        "--action",
        "observe-commit",
        "--target",
        "acme/repo",
        "--result-id",
        "commit:abc123",
        check=False,
    )

    assert proc.returncode == 2
    assert "result identity already recorded" in proc.stderr


def test_mutation_receipt_causal_parent_must_already_exist(tmp_path: Path):
    journal = tmp_path / "work.json"
    run_journal(journal, "init", "--contract", "track causal mutation")

    proc = run_journal(
        journal,
        "mutation-receipt",
        "--surface",
        "plugin",
        "--action",
        "publish",
        "--target",
        "Plugin_123",
        "--evidence-kind",
        "platform-binding",
        "--result-id",
        "release:rel456",
        "--caused-by",
        "commit:missing",
        check=False,
    )

    assert proc.returncode == 2
    assert "must reference exactly one prior mutation receipt result identity" in proc.stderr


def test_manual_observation_is_explicitly_low_trust_on_resume(tmp_path: Path):
    journal = tmp_path / "work.json"
    run_journal(journal, "init", "--contract", "observe remote mutation")
    run_journal(
        journal,
        "mutation-receipt",
        "--surface",
        "github",
        "--action",
        "observe-workflow",
        "--target",
        "acme/repo",
        "--result-id",
        "workflow:17",
    )

    payload = json.loads(run_journal(journal, "resume").stdout)
    row = payload["mutation_receipts"][0]

    assert row["evidence_kind"] == "manual-observation"
    assert row["attribution_scope"] == "historical-mission-record"
    assert row["requires_live_revalidation_for_session_attribution"] is True
