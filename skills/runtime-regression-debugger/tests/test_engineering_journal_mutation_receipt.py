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
    assert payload["mutation_receipts"][1]["caused_by"] == "commit:abc123"
    assert payload["counts"]["mutation_receipts"] == 2


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
