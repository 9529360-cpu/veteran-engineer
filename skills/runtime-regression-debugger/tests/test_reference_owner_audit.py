from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from reference_owner_audit import audit  # noqa: E402


def test_reference_owner_audit_passes_current_source():
    result = audit(ROOT)

    assert result["status"] == "PASS"
    assert result["unreachable_references"] == []
    assert result["retired_references"] == []
    assert result["active_reference_count"] == result["reference_count"]


def test_reference_owner_audit_treats_workspace_overlay_tombstones_as_retired(tmp_path: Path):
    copied = tmp_path / "skill"
    shutil.copytree(ROOT, copied)

    tombstone = copied / "references" / "retired-overlay.md"
    tombstone.write_text(
        "# Retired Workspace compatibility tombstone\n\n"
        "This path exists only to neutralize an overlay-retained file.\n",
        encoding="utf-8",
    )

    result = audit(copied)

    assert result["status"] == "PASS"
    assert result["unreachable_references"] == []
    assert result["retired_references"] == ["retired-overlay.md"]
    assert result["active_reference_count"] + 1 == result["reference_count"]
    retired = next(row for row in result["entries"] if row["reference"] == "retired-overlay.md")
    assert retired["retired"] is True
    assert retired["entry_modes"] == ["workspace-overlay-tombstone"]
