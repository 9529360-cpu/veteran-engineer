from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from workspace_overlay_deletion_gate import classify_deleted_paths, is_workspace_shipped_source  # noqa: E402


def test_workspace_overlay_gate_scopes_only_workspace_shipped_skill_files():
    assert is_workspace_shipped_source("skills/runtime-regression-debugger/references/example.md")
    assert is_workspace_shipped_source("skills/frontend-design-builder/references/example.md")
    assert not is_workspace_shipped_source(
        "skills/runtime-regression-debugger/assets/plugin-runtime-starter/src/runtime.mjs"
    )
    assert not is_workspace_shipped_source("src/runtime.mjs")


def test_known_retired_paths_are_overlay_safe():
    result = classify_deleted_paths([
        "skills/runtime-regression-debugger/references/host-capability-adaptation.md",
        "skills/runtime-regression-debugger/references/long-running-engineering-execution.md",
        "skills/runtime-regression-debugger/references/repository-engineering-execution.md",
        "skills/runtime-regression-debugger/evals/benchmark_scenarios.json",
        "skills/runtime-regression-debugger/tests/test_skill_workflow.py",
    ])

    assert result["status"] == "PASS"
    assert result["missing_tombstones"] == []
    assert len(result["tombstoned_deletions"]) == 5


def test_new_workspace_file_deletion_requires_tombstone():
    result = classify_deleted_paths([
        "skills/frontend-design-builder/references/future-owner.md",
    ])

    assert result["status"] == "FAIL"
    assert result["missing_tombstones"] == [
        "skills/frontend-design-builder/references/future-owner.md"
    ]


def test_published_skill_identity_deletion_is_never_tombstoned():
    result = classify_deleted_paths([
        "skills/frontend-design-builder/SKILL.md",
    ])

    assert result["status"] == "FAIL"
    assert result["identity_deletions"] == [
        "skills/frontend-design-builder/SKILL.md"
    ]
