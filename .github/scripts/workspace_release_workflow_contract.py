#!/usr/bin/env python3
"""Repository-local invariants for Workspace release workflow trust roots."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"


def read(name: str) -> str:
    return (WORKFLOWS / name).read_text(encoding="utf-8")


def require(text: str, needle: str, label: str) -> None:
    if needle not in text:
        raise SystemExit(f"{label}: missing required contract: {needle}")


def forbid(text: str, needle: str, label: str) -> None:
    if needle in text:
        raise SystemExit(f"{label}: forbidden contract present: {needle}")


def main() -> int:
    package = read("package-plugin-artifact.yml")
    ci = read("ci.yml")
    release = read("release.yml")
    skill = read("skill-engineering-tools.yml")
    cross = read("cross-platform-host-smoke.yml")

    for needle in (
        '356929464: "CI"',
        '358643055: "Skill Engineering Tools"',
        '358628814: "Cross-platform host smoke"',
        '358757508: "Release"',
        "Require sibling package profiles",
        '"Export desktop plugin artifact"',
        '"Export codex plugin artifact"',
        '"Export web plugin artifact"',
        "id: release-ready",
        "if: steps.release-ready.outcome == 'success'",
    ):
        require(package, needle, "package")

    if package.index("Require exact-main validation workflows") > package.index("Stage workspace install artifact"):
        raise SystemExit("package: exact-main gate must precede Workspace staging")
    if package.index("Require sibling package profiles") > package.index("Stage workspace install artifact"):
        raise SystemExit("package: sibling profile parity gate must precede Workspace staging")

    for needle in (
        ".github/workflows/ci.yml",
        ".github/workflows/skill-engineering-tools.yml",
        ".github/workflows/cross-platform-host-smoke.yml",
        ".github/workflows/package-plugin-artifact.yml",
        ".github/workflows/release.yml",
        "skills/runtime-regression-debugger/scripts/workspace_release_gate.py",
        "skills/runtime-regression-debugger/scripts/export_plugin_bundle.py",
        "skills/runtime-regression-debugger/tests/requirements-ci.txt",
        ".github/scripts/workspace_release_workflow_contract.py",
    ):
        require(package, needle, "package trust root")

    for needle in (
        "deadline = time.time() + 2 * 60",
        "merged PR association not visible yet; retrying",
        'pr.get("merge_commit_sha") == sha',
        'pr.get("base", {}).get("ref") == "main"',
        "len(merged) == 1",
    ):
        require(package, needle, "merged PR provenance")

    publishable = (
        "matrix.profile == 'workspace' && github.event_name == 'push' "
        "&& github.ref == 'refs/heads/main' && steps.studio-delta.outputs.changed == 'true' "
        "&& steps.studio-delta.outputs.trust_root_changed == 'false'"
    )
    if package.count(publishable) != 5:
        raise SystemExit(f"package: expected 5 publishable conditions, found {package.count(publishable)}")
    forbid(package, "github.event_name != 'pull_request'", "package")

    expected_concurrency = (
        "group: ${{ github.workflow }}-"
        "${{ github.event_name == 'pull_request' && github.ref || github.sha }}"
    )
    for name, text in (
        ("ci", ci),
        ("release", release),
        ("skill", skill),
        ("cross", cross),
        ("package", package),
    ):
        require(text, expected_concurrency, f"{name} concurrency")
        require(
            text,
            "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
            f"{name} concurrency",
        )
        forbid(text, "cancel-in-progress: true", f"{name} concurrency")

    for name, text in (("ci", ci), ("release", release), ("package", package)):
        require(text, "runs-on: ubuntu-24.04", f"{name} runner")
        forbid(text, "runs-on: ubuntu-latest", f"{name} runner")

    for needle in ("- ubuntu-24.04", "- macos-26-arm64", "- windows-2025-vs2026"):
        require(cross, needle, "cross runner matrix")
    for needle in ("ubuntu-latest", "macos-latest", "windows-latest"):
        forbid(cross, needle, "cross runner matrix")

    require(ci, 'node-version: "20.20.2"', "ci node")
    require(ci, 'node-version: "22.23.2"', "ci node")
    forbid(ci, "node-version: 20\n", "ci node")
    forbid(ci, "node-version: 22\n", "ci node")
    require(release, 'node-version: "20.20.2"', "release node")
    require(cross, 'node-version: "20.20.2"', "cross node")
    require(skill, 'python-version: "3.12.14"', "skill python")
    require(package, 'python-version: "3.12.14"', "package python")

    print("workspace_release_workflow_contract=pass")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
